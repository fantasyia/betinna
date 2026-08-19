import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@database/prisma.service';
import { RedisService } from '@database/redis.service';
import {
  ENVIO_WHATSAPP_DEFAULT,
  type EnvioWhatsappConfig,
  ForaDaJanelaEnvioError,
  JANELA_ENVIO_DEFAULT,
  type JanelaEnvioConfig,
  TETO_DIARIO_DEFAULT,
  type TetoDiarioConfig,
  chaveTetoDiario,
  esperaAteJanelaMs,
  esperaAteProximoDiaMs,
  incrementoMs,
  resolveEnvioWhatsapp,
  resolveJanelaEnvio,
  resolveTetoDiario,
} from './whatsapp-pacing.util';

/**
 * Gate de pacing global do WhatsApp por empresa.
 *
 * `aguardarSlot(empresaId)` bloqueia (await) até o próximo horário permitido de
 * envio dessa empresa, espaçando QUALQUER mensagem outbound (fluxo, campanha,
 * resposta do bot) com intervalo + jitter — nunca dispara tudo de uma vez.
 *
 * O cursor é um timestamp em Redis (`wa:pace:<empresaId>`) reservado atomicamente
 * via Lua, então funciona cross-processo (api + worker) e cross-concorrência
 * (os 5 jobs simultâneos do fluxo serializam pelo mesmo cursor). Como a reserva
 * acontece quando o job começa, o "look-ahead" é limitado pela concorrência —
 * não pela fila inteira — então a espera máxima é pequena e previsível.
 */
@Injectable()
export class WhatsappPacingService {
  private readonly logger = new Logger(WhatsappPacingService.name);
  private avisouRedisFora = false;

  // Reserva o próximo slot: slot = max(now, cursor); cursor += incremento.
  private static readonly RESERVA_LUA = `
local cursor = tonumber(redis.call('GET', KEYS[1]) or '0')
local now = tonumber(ARGV[1])
local slot = now
if cursor > now then slot = cursor end
redis.call('SET', KEYS[1], slot + tonumber(ARGV[2]), 'PX', tonumber(ARGV[3]))
return slot`;

  // Reserva 1 unidade da cota do dia — só incrementa se ainda couber. Ler e
  // depois incrementar em duas chamadas deixaria dois workers passarem juntos
  // no ultimo slot; e um INCR seco inflaria o contador nas tentativas negadas,
  // fazendo o teto "vazar" pra baixo a cada retry.
  private static readonly TETO_LUA = `
local usado = tonumber(redis.call('GET', KEYS[1]) or '0')
if usado >= tonumber(ARGV[1]) then return -1 end
local novo = redis.call('INCR', KEYS[1])
redis.call('EXPIRE', KEYS[1], tonumber(ARGV[2]))
return novo`;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  private async lerConfig(
    empresaId: string,
  ): Promise<{ envio: EnvioWhatsappConfig; janela: JanelaEnvioConfig; teto: TetoDiarioConfig }> {
    try {
      const empresa = await this.prisma.empresa.findUnique({
        where: { id: empresaId },
        select: { config: true },
      });
      const raw = (
        empresa?.config as { envioWhatsapp?: { janela?: unknown; tetoDiario?: unknown } } | null
      )?.envioWhatsapp;
      return {
        envio: resolveEnvioWhatsapp(raw),
        janela: resolveJanelaEnvio(raw?.janela),
        teto: resolveTetoDiario(raw?.tetoDiario),
      };
    } catch {
      // Banco fora não pode virar silêncio: cai no default (que tem janela ativa
      // 8h–20h e teto de 500/dia) em vez de bloquear ou liberar geral.
      return {
        envio: ENVIO_WHATSAPP_DEFAULT,
        janela: JANELA_ENVIO_DEFAULT,
        teto: TETO_DIARIO_DEFAULT,
      };
    }
  }

  /**
   * Quantos ms faltam até poder mandar um PROATIVO (0 = pode mandar agora).
   * Cobre as duas travas de volume: a janela de horário e o teto diário.
   *
   * É o que os pontos que sabem reagendar (motor de fluxos, campanhas) consultam
   * ANTES de começar o trabalho — assim eles devolvem o job pra fila com delay em
   * vez de segurar um slot de worker a noite inteira num `setTimeout` que evapora
   * no primeiro redeploy.
   *
   * Aqui o contador do dia é só LIDO, não reservado: quem reserva é o
   * `aguardarSlot`, imediatamente antes do envio. Entre a consulta e a reserva
   * cabe uma corrida de um punhado de jobs no exato slot final do teto — quem
   * perder recebe o erro, e o executor reagenda do mesmo jeito.
   */
  async esperaAntesDoProativoMs(empresaId: string): Promise<number> {
    if (!empresaId) return 0;
    const agora = new Date();
    const { janela, teto } = await this.lerConfig(empresaId);
    const esperaJanela = esperaAteJanelaMs(janela, agora);
    if (esperaJanela > 0) return esperaJanela;
    if (!teto.ativo) return 0;
    let usado = 0;
    try {
      const r = await this.redis.get(chaveTetoDiario(empresaId, agora));
      usado = Number(r ?? 0) || 0;
    } catch {
      return 0; // Redis fora não segura envio (mesma postura do resto do pacing).
    }
    return usado >= teto.maxPorDia ? esperaAteProximoDiaMs(janela, agora) : 0;
  }

  /**
   * Bloqueia até o próximo slot de envio da empresa. Chamar UMA vez por operação
   * de envio (por destinatário/resposta) — não por balão. `reativo=true` usa a
   * faixa rápida (resposta a quem escreveu); proativo (abordagem/campanha) usa a
   * faixa conservadora. As faixas têm cursores separados (não competem entre si).
   * Degrada gracioso: se o Redis estiver fora, não trava o envio (perde espaçamento).
   */
  async aguardarSlot(
    empresaId: string,
    reativo = false,
    opts: { ignorarJanela?: boolean } = {},
  ): Promise<void> {
    if (!empresaId) return;
    const { envio, janela, teto } = await this.lerConfig(empresaId);

    // JANELA: envio proativo fora do horário NÃO sai — e falha alto em vez de
    // esperar. Um `await` de 10 horas aqui prenderia o worker e sumiria no
    // próximo deploy; quem chama é que sabe como reagendar (fila, cron, retry).
    // Reativo passa direto: responder quem escreveu às 23h é o certo.
    //
    // `ignorarJanela` é a válvula pra REPARO — reenviar algo que já passou pelo
    // gate uma vez e falhou no transporte. Não é atalho pra envio novo: quem
    // usar isso num caminho novo está mandando mensagem de madrugada.
    if (!reativo && !opts.ignorarJanela) {
      const esperaJanela = esperaAteJanelaMs(janela, new Date());
      if (esperaJanela > 0) {
        throw new ForaDaJanelaEnvioError(esperaJanela, new Date(Date.now() + esperaJanela));
      }
      // TETO DIÁRIO: consome 1 da cota do dia. Aqui, e não na consulta acima,
      // porque este é o último ponto antes do envio de verdade — reservar mais
      // cedo gastaria cota em passo que ainda pode ser descartado (lead
      // suprimido por LGPD, lead sem telefone, execução cancelada no meio).
      await this.reservarCotaDoDia(empresaId, janela, teto);
    }

    const incremento = incrementoMs(envio, Math.random(), reativo);
    const now = Date.now();
    const ttl = Math.max(60_000, incremento * 4);
    const key = reativo ? `wa:pace:r:${empresaId}` : `wa:pace:${empresaId}`;

    let slot = now;
    try {
      const r = await this.redis.eval(
        WhatsappPacingService.RESERVA_LUA,
        [key],
        [now, incremento, ttl],
      );
      slot = typeof r === 'number' ? r : Number(r) || now;
      this.avisouRedisFora = false;
    } catch (err) {
      if (!this.avisouRedisFora) {
        this.logger.warn(
          `Pacing sem Redis — envio segue sem espaçamento: ${err instanceof Error ? err.message : String(err)}`,
        );
        this.avisouRedisFora = true;
      }
      return;
    }

    const espera = slot - Date.now();
    if (espera > 0) await new Promise((resolve) => setTimeout(resolve, espera));
  }

  /**
   * Consome 1 unidade da cota diária de PROATIVOS. Estourou → lança, e quem
   * chamou reagenda pro dia seguinte: teto ADIA, nunca descarta mensagem.
   *
   * Redis fora = passa direto, igual ao resto do pacing. Um teto que vira
   * bloqueio total quando o Redis pisca seria pior que não ter teto — a
   * proteção derrubaria a operação inteira em vez de proteger o número.
   */
  private async reservarCotaDoDia(
    empresaId: string,
    janela: JanelaEnvioConfig,
    teto: TetoDiarioConfig,
  ): Promise<void> {
    if (!teto.ativo) return;
    const agora = new Date();
    let r: unknown;
    try {
      r = await this.redis.eval(
        WhatsappPacingService.TETO_LUA,
        [chaveTetoDiario(empresaId, agora)],
        // TTL de 36h: cobre a virada do dia com folga e não deixa chave eterna.
        [teto.maxPorDia, 36 * 3600],
      );
    } catch {
      return;
    }
    if (Number(r) === -1) {
      const espera = esperaAteProximoDiaMs(janela, agora);
      this.logger.warn(
        `Teto diário de envio proativo atingido (${teto.maxPorDia}/dia) na empresa ${empresaId} — ` +
          `adiando ${Math.round(espera / 60000)} min`,
      );
      throw new ForaDaJanelaEnvioError(espera, new Date(Date.now() + espera), 'teto_diario');
    }
  }
}
