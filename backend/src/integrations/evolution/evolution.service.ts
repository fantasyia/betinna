import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import QRCode from 'qrcode';
import { EnvService } from '@config/env.service';
import { HttpClientService } from '@shared/http/http-client.service';
import { HttpClientError } from '@shared/http/http-client.types';
import { BusinessRuleException } from '@shared/errors/app-exception';
import { RedisService } from '@database/redis.service';

/** O QR pode vir em vários campos dependendo da resposta do Evolution. */
type RespostaQr = {
  base64?: string;
  code?: string;
  qrcode?: { base64?: string; code?: string };
};

/**
 * Status no formato que o front entende (WhatsAppPage). ⚠️ O front SÓ renderiza
 * o QR quando status === 'QR_PENDING' — 'CONNECTING' mostra só "Conectando…".
 */
type EstadoWhats = {
  status: 'CONNECTED' | 'CONNECTING' | 'QR_PENDING' | 'DISCONNECTED' | 'ERROR';
  qrDataUrl?: string;
  /** Número pareado (do ownerJid) — preenchido quando CONNECTED, pro front exibir. */
  numero?: string;
  erro?: string;
};

/**
 * Cliente HTTP do **Evolution API v2** — WhatsApp não-oficial rodando como
 * serviço SEPARADO (Railway). O app deixa de hospedar o socket Baileys e vira
 * cliente: ENVIA por HTTP e RECEBE por webhook. Assim, deploy do app não derruba
 * mais o WhatsApp (a conexão vive no container do Evolution, com sessão no
 * Postgres dele → reconecta sem novo QR).
 *
 * Auth: header `apikey` com a AUTHENTICATION_API_KEY global do Evolution.
 * Uma "instância" por dono (`emp_<id>` / `user_<id>`), espelhando o dual-owner.
 */
@Injectable()
export class EvolutionService {
  private readonly logger = new Logger(EvolutionService.name);
  /** Cache do subject de grupos (`instância|jid` → nome) — TTL 30min. */
  private readonly nomeGrupoCache = new Map<string, { nome?: string; em: number }>();

  constructor(
    private readonly http: HttpClientService,
    private readonly env: EnvService,
    private readonly redis: RedisService,
  ) {}

  /** True quando o provider está em 'evolution' E a URL/chave estão configuradas. */
  ativo(): boolean {
    return (
      this.env.get('WHATSAPP_PROVIDER') === 'evolution' &&
      !!this.env.get('EVOLUTION_API_URL') &&
      !!this.env.get('EVOLUTION_API_KEY')
    );
  }

  private get baseUrl(): string {
    return (this.env.get('EVOLUTION_API_URL') || '').replace(/\/+$/, '');
  }

  private headers(): Record<string, string> {
    return { apikey: this.env.get('EVOLUTION_API_KEY') || '' };
  }

  private async req<T>(
    method: 'get' | 'post' | 'delete',
    path: string,
    body?: Record<string, unknown>,
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const opts = {
      headers: this.headers(),
      integration: 'evolution',
      redactKeys: ['apikey'],
      retries: 1,
      timeoutMs: 30_000,
      ...(body ? { body } : {}),
    };
    const res =
      method === 'get'
        ? await this.http.get<T>(url, opts)
        : method === 'delete'
          ? await this.http.delete<T>(url, opts)
          : await this.http.post<T>(url, opts);
    return res.data;
  }

  // ─── Instâncias ───────────────────────────────────────────────────────────

  /** Cria a instância (idempotente do lado nosso — se já existe, o Evolution avisa). */
  async criarInstancia(
    instance: string,
    webhookUrl?: string,
  ): Promise<{ hash?: string } & RespostaQr> {
    // Segredo do webhook vai num HEADER (não na URL — URLs vazam em log/Referer).
    // O Evolution v2 anexa esses headers em CADA POST do webhook.
    const headerSecret = EvolutionService.webhookHeaderSecret(
      this.env.get('EVOLUTION_API_KEY') || '',
    );
    return this.req('post', '/instance/create', {
      instanceName: instance,
      integration: 'WHATSAPP-BAILEYS',
      qrcode: true,
      ...(webhookUrl
        ? {
            webhook: {
              url: webhookUrl,
              byEvents: false,
              base64: true,
              ...(headerSecret
                ? { headers: { [EvolutionService.WEBHOOK_HEADER]: headerSecret } }
                : {}),
              events: ['MESSAGES_UPSERT', 'CONNECTION_UPDATE', 'QRCODE_UPDATED'],
            },
          }
        : {}),
    });
  }

  /** QR code (base64) pra parear. Também (re)conecta uma instância existente. */
  async conectar(instance: string): Promise<RespostaQr> {
    return this.req('get', `/instance/connect/${encodeURIComponent(instance)}`);
  }

  /**
   * Extrai o QR de qualquer formato do Evolution e devolve SEMPRE algo renderável
   * num `<img src>` (o front usa qrDataUrl direto). Preferência: base64 (já é/vira
   * data URL); fallback: o texto cru do QR (`code`) → gera a imagem (igual Baileys).
   */
  private async extrairQrDataUrl(resp: unknown): Promise<string | undefined> {
    const r = (resp ?? {}) as RespostaQr;
    const base64 = r.qrcode?.base64 ?? r.base64;
    if (base64) {
      // Evolution v2 normalmente já manda data URL; se vier base64 cru, prefixa.
      return base64.startsWith('data:') ? base64 : `data:image/png;base64,${base64}`;
    }
    // Só veio o texto do QR → renderiza a imagem nós mesmos (senão o <img> quebra).
    const code = r.qrcode?.code ?? r.code;
    if (code) {
      try {
        return await QRCode.toDataURL(code, { errorCorrectionLevel: 'M', margin: 1, width: 320 });
      } catch (err) {
        this.logger.warn(`[evolution] falha ao gerar imagem do QR: ${this.detalheErro(err)}`);
        return undefined;
      }
    }
    return undefined;
  }

  /** Detalha um erro HTTP incluindo o CORPO da resposta (o motivo real do Evolution). */
  private detalheErro(err: unknown): string {
    if (err instanceof HttpClientError) {
      const corpo = err.body ? ` — ${JSON.stringify(err.body).slice(0, 300)}` : '';
      return `HTTP ${err.status}${corpo}`;
    }
    return err instanceof Error ? err.message : String(err);
  }

  /** Estado: 'open' (conectado) | 'connecting' | 'close'. */
  async estado(instance: string): Promise<{ instance?: { state?: string } }> {
    return this.req('get', `/instance/connectionState/${encodeURIComponent(instance)}`);
  }

  /**
   * Busca UMA instância no fetchInstances — traz `ownerJid` (= já pareada),
   * `connectionStatus` e `disconnectionReasonCode`. O reason 401 = deslogada:
   * o Evolution às vezes deixa o connectionStatus preso em 'open' mesmo deslogado
   * (instância ZUMBI) — só dá pra detectar pelo reason.
   */
  private async buscarInstancia(instance: string): Promise<{
    connectionStatus?: string;
    ownerJid?: string | null;
    disconnectionReasonCode?: number | null;
  } | null> {
    const lista = await this.req<
      Array<{
        name?: string;
        instanceName?: string;
        connectionStatus?: string;
        ownerJid?: string | null;
        disconnectionReasonCode?: number | null;
      }>
    >('get', `/instance/fetchInstances?instanceName=${encodeURIComponent(instance)}`).catch(
      () => null,
    );
    if (!Array.isArray(lista)) return null;
    return lista.find((i) => (i.name ?? i.instanceName) === instance) ?? null;
  }

  /** True quando a instância está REALMENTE conectada (open E não deslogada/401). */
  private saudavel(inst: {
    connectionStatus?: string;
    disconnectionReasonCode?: number | null;
  }): boolean {
    return inst.connectionStatus === 'open' && inst.disconnectionReasonCode == null;
  }

  /** Extrai só os dígitos do número a partir do ownerJid (ex: '5511...@s.whatsapp.net'). */
  private jidParaNumero(jid?: string | null): string | undefined {
    if (!jid) return undefined;
    const num = jid.split('@')[0]?.split(':')[0]?.replace(/\D/g, '');
    return num || undefined;
  }

  /** Anexa o número (do ownerJid) a um estado CONNECTED, pro front mostrar quem pareou. */
  private comNumero(estado: EstadoWhats, inst: { ownerJid?: string | null } | null): EstadoWhats {
    const numero = this.jidParaNumero(inst?.ownerJid);
    return numero ? { ...estado, numero } : estado;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }

  /**
   * Reset FORTE — destrói a instância mesmo travada/zumbi. O Evolution recusa
   * logout/delete numa instância 'open' (500/400), então primeiro dá RESTART
   * (desgruda o socket preso em 'open' na memória dele), espera re-inicializar,
   * e aí desloga + deleta. Tudo best-effort: o que importa é sair do 'open'.
   */
  async resetarForte(instance: string): Promise<void> {
    await this.req('post', `/instance/restart/${encodeURIComponent(instance)}`).catch(
      () => undefined,
    );
    await this.sleep(4000); // socket re-inicializa e sai do 'open' travado
    await this.logout(instance).catch(() => undefined);
    await this.sleep(1500);
    await this.deletar(instance).catch(() => undefined);
    this.logger.warn(`[evolution] ${instance} reset forte (restart+logout+delete) executado`);
  }

  /** Nomes das instâncias emp_/user_ existentes no Evolution (pro poll de fallback). */
  async listarInstancias(): Promise<string[]> {
    const lista = await this.req<Array<{ name?: string; instanceName?: string }>>(
      'get',
      '/instance/fetchInstances',
    ).catch(() => null);
    if (!Array.isArray(lista)) return [];
    return lista.map((i) => i.name ?? i.instanceName ?? '').filter((n) => /^(emp|user)_/.test(n));
  }

  /**
   * Mensagens recentes de uma instância (newest-first), pro poll de fallback que
   * cobre o que o webhook perde quando o socket do Evolution oscila.
   */
  async mensagensRecentes(instance: string, limit = 30): Promise<unknown[]> {
    const resp = await this.req<{ messages?: { records?: unknown[] } }>(
      'post',
      `/chat/findMessages/${encodeURIComponent(instance)}`,
      { where: {}, page: 1, offset: limit },
    ).catch(() => null);
    return resp?.messages?.records ?? [];
  }

  /**
   * Descriptografa a mídia de uma mensagem e devolve o base64. Usado quando a
   * mensagem chega SEM base64 (pelo poll de fallback, ou webhook sem base64) —
   * o registro só tem a URL CRIPTOGRAFADA do WhatsApp, que não dá pra baixar
   * direto. O Evolution descriptografa só com o key.id.
   */
  async baixarMidiaBase64(instance: string, messageId: string): Promise<string | undefined> {
    if (!messageId) return undefined;
    const resp = await this.req<{ base64?: string }>(
      'post',
      `/chat/getBase64FromMediaMessage/${encodeURIComponent(instance)}`,
      { message: { key: { id: messageId } } },
    ).catch(() => null);
    return resp?.base64 ?? undefined;
  }

  /**
   * Nome (subject) de um grupo via Evolution. Cacheado 30min — evita um GET por
   * mensagem de grupo. Retorna undefined em falha (sem permissão / erro de rede);
   * o caller cai pro fallback "Grupo".
   */
  async nomeGrupo(instance: string, groupJid: string): Promise<string | undefined> {
    const chave = `${instance}|${groupJid}`;
    const cached = this.nomeGrupoCache.get(chave);
    if (cached && Date.now() - cached.em < 30 * 60_000) return cached.nome;
    let nome: string | undefined;
    try {
      const resp = await this.req<{ subject?: string }>(
        'get',
        `/group/findGroupInfos/${encodeURIComponent(instance)}?groupJid=${encodeURIComponent(groupJid)}`,
      );
      const s = typeof resp?.subject === 'string' ? resp.subject.trim() : '';
      nome = s || undefined;
    } catch {
      nome = undefined;
    }
    this.nomeGrupoCache.set(chave, { nome, em: Date.now() });
    return nome;
  }

  async logout(instance: string): Promise<unknown> {
    return this.req('delete', `/instance/logout/${encodeURIComponent(instance)}`);
  }

  async deletar(instance: string): Promise<unknown> {
    return this.req('delete', `/instance/delete/${encodeURIComponent(instance)}`);
  }

  // ─── Envio ─────────────────────────────────────────────────────────────────

  /**
   * Texto. `delayMs` simula "digitando". `quoted` = cita uma mensagem (reply):
   * key.id da msg citada (= externalId no nosso banco) + fromMe.
   */
  async enviarTexto(
    instance: string,
    numero: string,
    texto: string,
    delayMs = 0,
    quoted?: { id: string; fromMe?: boolean; participant?: string },
    idempotencyKey?: string,
  ): Promise<{ key?: { id?: string } }> {
    return this.enviarReq(
      `/message/sendText/${encodeURIComponent(instance)}`,
      {
        number: this.normalizarNumero(numero),
        text: texto,
        ...(delayMs > 0 ? { delay: delayMs } : {}),
        ...(quoted
          ? {
              quoted: {
                key: {
                  id: quoted.id,
                  fromMe: quoted.fromMe ?? false,
                  ...(quoted.participant ? { participant: quoted.participant } : {}),
                },
              },
            }
          : {}),
      },
      idempotencyKey,
    );
  }

  /** Mídia (imagem/vídeo/documento). `media` = base64 puro (sem prefixo) ou URL. */
  async enviarMidia(
    instance: string,
    numero: string,
    m: {
      mediatype: 'image' | 'video' | 'document';
      mimetype?: string;
      media: string;
      fileName?: string;
      caption?: string;
    },
  ): Promise<{ key?: { id?: string } }> {
    return this.enviarReq(`/message/sendMedia/${encodeURIComponent(instance)}`, {
      number: this.normalizarNumero(numero),
      ...m,
    });
  }

  /** Áudio de voz (PTT). `audio` = base64 puro ou URL. */
  async enviarAudio(
    instance: string,
    numero: string,
    audio: string,
  ): Promise<{ key?: { id?: string } }> {
    return this.enviarReq(`/message/sendWhatsAppAudio/${encodeURIComponent(instance)}`, {
      number: this.normalizarNumero(numero),
      audio,
    });
  }

  /** Presença "composing" (digitando) / "paused" — best-effort. */
  async enviarPresenca(
    instance: string,
    numero: string,
    presence: 'composing' | 'paused',
    delayMs?: number,
  ): Promise<void> {
    // `delay` mantém o "digitando…" VISÍVEL pela duração (o Evolution v2 re-emite
    // a presença nesse intervalo; sem ele o WhatsApp limpa em ~1s e mal aparece).
    await this.req('post', `/chat/sendPresence/${encodeURIComponent(instance)}`, {
      number: this.normalizarNumero(numero),
      presence,
      ...(delayMs && delayMs > 0 ? { delay: Math.min(Math.round(delayMs), 20_000) } : {}),
    }).catch(() => undefined);
  }

  /** Reage a uma mensagem com um emoji (ex: 👍). `emoji` vazio REMOVE a reação. */
  async enviarReacao(
    instance: string,
    remoteJid: string,
    fromMe: boolean,
    messageId: string,
    emoji: string,
  ): Promise<{ key?: { id?: string } }> {
    return this.req('post', `/message/sendReaction/${encodeURIComponent(instance)}`, {
      key: { remoteJid, fromMe, id: messageId },
      reaction: emoji,
    });
  }

  /** Nome da instância a partir do dono (espelha o ownerKey do Baileys). */
  static instanceName(owner: { type: 'EMPRESA' | 'USUARIO'; id: string }): string {
    return `${owner.type === 'EMPRESA' ? 'emp' : 'user'}_${owner.id}`;
  }

  /** Token do webhook derivado da API key (não expõe a key crua na URL). */
  static webhookToken(apiKey: string): string {
    if (!apiKey) return '';
    return createHash('sha256').update(`evolution-webhook:${apiKey}`).digest('hex').slice(0, 32);
  }

  /** Header que carrega o segredo do webhook (substitui o token na URL). */
  static readonly WEBHOOK_HEADER = 'x-evolution-webhook-token';

  /**
   * Segredo do webhook enviado no HEADER (não na URL). Derivado da API key com
   * domínio DISTINTO do token-de-URL legado (256 bits, sem slice). URLs vazam em
   * log de proxy/histórico/Referer; headers não — por isso o segredo migra pra cá.
   */
  static webhookHeaderSecret(apiKey: string): string {
    if (!apiKey) return '';
    return createHash('sha256').update(`evolution-webhook-header:${apiKey}`).digest('hex');
  }

  /**
   * URL do webhook de entrada: `<API_PUBLIC_URL>/<API_PREFIX>/webhooks/evolution`.
   * SEM token na URL — o segredo agora vai no header `WEBHOOK_HEADER` (configurado
   * em `criarInstancia`). O endpoint vive SOB o prefixo global (ex: /api/v1) —
   * incluí-lo aqui evita o Evolution postar num 404. Aceita o API_PUBLIC_URL como
   * origem pura OU já contendo o prefixo (sem duplicar).
   */
  webhookUrl(): string {
    const origem = (this.env.get('API_PUBLIC_URL') || '').replace(/\/+$/, '');
    if (!origem) return '';
    const prefixo = (this.env.get('API_PREFIX') || '').replace(/^\/+|\/+$/g, '');
    const base = prefixo && !origem.endsWith(`/${prefixo}`) ? `${origem}/${prefixo}` : origem;
    return `${base}/webhooks/evolution`;
  }

  /**
   * Botão **Conectar** — AUTO-CURÁVEL. Se já está REALMENTE conectado (open E sem
   * logout), diz CONNECTED. Se está zumbi/travado/deslogado/qualquer estado
   * não-são, faz RESET FORTE (restart+logout+delete) e recria do zero — assim
   * SEMPRE sai um QR novo, sem precisar mexer no Evolution. status 'QR_PENDING'
   * quando há QR (o front só renderiza o QR nesse status).
   */
  async conectarOuEstado(instance: string): Promise<EstadoWhats> {
    if (!this.env.get('EVOLUTION_API_URL') || !this.env.get('EVOLUTION_API_KEY')) {
      throw new BusinessRuleException(
        'Evolution não configurado no backend: faltam EVOLUTION_API_URL e/ou EVOLUTION_API_KEY no env (api + worker).',
      );
    }

    // 1. Já REALMENTE conectado? (open E sem logout). Zumbi 'open'+401 NÃO conta.
    const inst = await this.buscarInstancia(instance);
    if (inst && this.saudavel(inst)) return this.comNumero({ status: 'CONNECTED' }, inst);

    // 2. Existe mas NÃO está são (zumbi/close/deslogado) → RESET FORTE antes de
    //    recriar (senão o Evolution recusa recriar/deletar a instância travada).
    if (inst) {
      this.logger.warn(
        `[evolution] ${instance} não-são (status=${inst.connectionStatus} reason=${inst.disconnectionReasonCode ?? 'null'}) — reset forte`,
      );
      await this.resetarForte(instance);
    }

    // 3. Cria do ZERO (com webhook) — a criação já costuma trazer o QR.
    let qr: string | undefined;
    try {
      qr = await this.extrairQrDataUrl(await this.criarInstancia(instance, this.webhookUrl()));
    } catch (err) {
      this.logger.warn(
        `[evolution] criarInstancia ${instance}: ${this.detalheErro(err)} (segue pro connect)`,
      );
    }
    if (qr) return { status: 'QR_PENDING', qrDataUrl: qr };

    // 4. Fallback: QR pelo connect.
    const resp = await this.conectar(instance).catch((err) => {
      this.logger.warn(`[evolution] connect ${instance}: ${this.detalheErro(err)}`);
      return null;
    });
    qr = await this.extrairQrDataUrl(resp);
    if (qr) return { status: 'QR_PENDING', qrDataUrl: qr };

    // 5. Ainda nada → erro VISÍVEL com diagnóstico (chaves da resposta).
    const chaves =
      resp && typeof resp === 'object'
        ? Object.keys(resp as object).join(',')
        : String(typeof resp);
    this.logger.warn(`[evolution] ${instance} sem QR mesmo após reset forte — resposta: ${chaves}`);
    return {
      status: 'ERROR',
      erro: `Evolution não devolveu QR (${chaves}). Clique "Resetar credenciais" e tente de novo.`,
    };
  }

  /**
   * SÓ LEITURA — pro polling de status. Detecta a instância ZUMBI (open mas
   * deslogada/401) e reporta DISCONNECTED pro botão Conectar aparecer (o Conectar
   * faz o reset forte). NÃO chama connect numa instância pareada e saudável
   * (derrubaria a sessão — era o bug do "parou depois de 2min").
   *  - sem instância → DISCONNECTED
   *  - REALMENTE conectada (open + sem logout) → CONNECTED
   *  - pareada e só reconectando (connecting, sem logout) → CONNECTING (não mexe)
   *  - zumbi / close / deslogada → DISCONNECTED (Conectar reseta+recria)
   *  - nunca pareada → connect pra pegar o QR → QR_PENDING
   */
  async estadoComQr(instance: string): Promise<EstadoWhats> {
    if (!this.env.get('EVOLUTION_API_URL') || !this.env.get('EVOLUTION_API_KEY')) {
      return { status: 'DISCONNECTED' };
    }
    const inst = await this.buscarInstancia(instance);
    if (!inst) return { status: 'DISCONNECTED' };
    if (this.saudavel(inst)) return this.comNumero({ status: 'CONNECTED' }, inst);

    // Pareada e só reconectando (sem logout) → não mexe (Baileys reconecta sozinho).
    if (
      inst.ownerJid &&
      inst.connectionStatus === 'connecting' &&
      inst.disconnectionReasonCode == null
    ) {
      return { status: 'CONNECTING' };
    }
    // Nunca pareada → tenta o QR direto (connect é seguro aqui).
    if (!inst.ownerJid) {
      const qr = await this.extrairQrDataUrl(await this.conectar(instance).catch(() => null));
      if (qr) return { status: 'QR_PENDING', qrDataUrl: qr };
    }
    // Zumbi (open+401) / close / deslogada → DISCONNECTED pro botão Conectar.
    return { status: 'DISCONNECTED' };
  }

  private soDigitos(numero: string): string {
    return numero.replace(/\D/g, '');
  }

  /**
   * Normaliza o número pro formato que o Evolution exige (dígitos + DDI). Sistema
   * é BR: número NACIONAL (10 dígitos = fixo DDD+8, 11 = celular DDD+9) ganha o
   * DDI 55. 12-13 dígitos já têm código de país (mantém). Sem isso, telefone
   * digitado na mão (ex: "(11) 99999-9999") ia sem o 55 e o Evolution devolvia
   * 400 — diferente das respostas do inbox, onde o jid já vem completo do webhook.
   */
  private normalizarNumero(numero: string): string {
    // Grupos (@g.us) e LIDs (@lid) do inbox: manda como veio — soDigitos
    // destruiria o sufixo e o grupo/lid viraria um número solto.
    if (numero.includes('@g.us') || numero.includes('@lid')) return numero;
    // Já INTERNACIONAL (E.164 com '+') ou já com DDI (>=12 dígitos): manda só os
    // dígitos, NÃO prefixa 55 — senão corromperia número estrangeiro (ex: US de
    // 11 dígitos viraria "55+US"). Atendemos clientes de qualquer país.
    const internacional = numero.includes('+');
    const n = this.soDigitos(numero);
    if (internacional || n.length >= 12) return n;
    // Nacional BR SEM DDI (10/11 dígitos): assume 55 (legado pré-E.164, e o
    // caso do FLUXO que montava "<DDD+numero>@s.whatsapp.net" sem o 55).
    if (n.length === 10 || n.length === 11) return `55${n}`;
    return n;
  }

  /**
   * POST de ENVIO com erro enriquecido: inclui o corpo da resposta do Evolution
   * (o motivo real do 400, ex: "number not exists") na mensagem do throw — assim
   * o log do fluxo mostra a causa, não só "status 400".
   */
  private async enviarReq<T>(
    path: string,
    body: Record<string, unknown>,
    idempotencyKey?: string,
  ): Promise<T> {
    // Sem chave: comportamento antigo (sem dedup).
    if (!idempotencyKey) {
      return this.postEnvio<T>(path, body);
    }
    // Gate de idempotência: a Evolution NÃO aceita id de cliente no payload, então a dedup
    // é NOSSA. SETNX antes do POST claima a chave; um reenvio (retry/crash) com a MESMA
    // chave vira no-op → o destinatário NUNCA recebe 2×. Hoje só o sendText passa a chave
    // (enviarMidia/enviarAudio não dedupam). Preferimos SUPRIMIR a DUPLICAR (dinheiro).
    // O marcador PENDING tem TTL CURTO (120s, ~duração do POST): se o worker crashar entre o
    // SETNX e o POST, a chave expira em 120s e um retry legítimo RE-ENVIA — em vez de ficar
    // suprimido por 24h. Após o POST OK, o resultado é gravado com TTL longo (24h) p/ dedup.
    const k = `idem:wa:${idempotencyKey}`;
    let claimed: boolean;
    try {
      claimed = await this.redis.setNxEx(k, 'PENDING', 120);
    } catch (err) {
      // Redis fora → degrada pro envio direto (não bloqueia operação por infra).
      this.logger.warn(
        `Gate de idempotência indisponível (Redis): ${err instanceof Error ? err.message : err}`,
      );
      return this.postEnvio<T>(path, body);
    }
    if (!claimed) {
      const cached = await this.redis.get(k).catch(() => null);
      if (cached && cached !== 'PENDING') return JSON.parse(cached) as T; // já enviado: no-op
      // 'PENDING' de outra tentativa em voo → não re-POST (no-op seguro).
      this.logger.log(`Envio WhatsApp suprimido por idempotência (${idempotencyKey})`);
      return { key: { id: undefined } } as T;
    }
    try {
      const r = await this.postEnvio<T>(path, body);
      // Memoriza o resultado real (externalId) p/ futuros no-ops devolverem o mesmo id.
      await this.redis.setEx(k, JSON.stringify(r), 86_400).catch(() => undefined);
      return r;
    } catch (err) {
      // POST falhou DE VERDADE → libera a chave pra um retry legítimo re-enviar.
      await this.redis.del(k).catch(() => undefined);
      throw err;
    }
  }

  /** POST de envio cru com erro enriquecido (sem gate). */
  private async postEnvio<T>(path: string, body: Record<string, unknown>): Promise<T> {
    try {
      return await this.req<T>('post', path, body);
    } catch (err) {
      const detalhe = this.detalheErro(err);
      this.logger.warn(`Evolution envio falhou (${path}): ${detalhe}`);
      throw new BusinessRuleException(`Falha ao enviar pelo WhatsApp (Evolution): ${detalhe}`);
    }
  }
}
