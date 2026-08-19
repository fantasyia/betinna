import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@database/prisma.service';
import { RedisService } from '@database/redis.service';
import {
  ENVIO_WHATSAPP_DEFAULT,
  type EnvioWhatsappConfig,
  ForaDaJanelaEnvioError,
  JANELA_ENVIO_DEFAULT,
  type JanelaEnvioConfig,
  esperaAteJanelaMs,
  incrementoMs,
  resolveEnvioWhatsapp,
  resolveJanelaEnvio,
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

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  private async lerConfig(
    empresaId: string,
  ): Promise<{ envio: EnvioWhatsappConfig; janela: JanelaEnvioConfig }> {
    try {
      const empresa = await this.prisma.empresa.findUnique({
        where: { id: empresaId },
        select: { config: true },
      });
      const raw = (empresa?.config as { envioWhatsapp?: { janela?: unknown } } | null)
        ?.envioWhatsapp;
      return { envio: resolveEnvioWhatsapp(raw), janela: resolveJanelaEnvio(raw?.janela) };
    } catch {
      // Banco fora não pode virar silêncio: cai no default (que tem janela ativa
      // 8h–20h) em vez de bloquear ou liberar geral.
      return { envio: ENVIO_WHATSAPP_DEFAULT, janela: JANELA_ENVIO_DEFAULT };
    }
  }

  /**
   * Quantos ms faltam pra janela de envio PROATIVO abrir (0 = pode mandar agora).
   *
   * É o que os pontos que sabem reagendar (motor de fluxos, campanhas) consultam
   * ANTES de começar o trabalho — assim eles devolvem o job pra fila com delay em
   * vez de segurar um slot de worker a noite inteira num `setTimeout` que evapora
   * no primeiro redeploy.
   */
  async esperaPorJanelaMs(empresaId: string): Promise<number> {
    if (!empresaId) return 0;
    const { janela } = await this.lerConfig(empresaId);
    return esperaAteJanelaMs(janela, new Date());
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
    const { envio, janela } = await this.lerConfig(empresaId);

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
}
