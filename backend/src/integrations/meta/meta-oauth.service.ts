import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '@database/redis.service';
import { EnvService } from '@config/env.service';
import { PrismaService } from '@database/prisma.service';
import { IntegracoesService } from '@modules/integracoes/integracoes.service';
import { BusinessRuleException, IntegrationException } from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';
import {
  deriveOAuthStateSecret,
  signOAuthState,
  verifyOAuthState,
} from '@shared/utils/oauth-state.util';
import { CryptoUtil } from '@shared/utils/crypto.util';
import { MetaAppService } from './meta-app.service';
import { MetaGraphClientService } from './meta-graph-client.service';
import type { AssinaturaPagina, FacebookCredenciais, InstagramCredenciais } from './meta.types';

const DEFAULT_SCOPE = [
  'public_profile',
  'email',
  'pages_show_list',
  'pages_messaging',
  'pages_manage_metadata',
  'pages_read_engagement',
  'instagram_basic',
  'instagram_manage_messages',
  'business_management',
  // Lead Ads (29/09): sem `leads_retrieval` o `GET /{leadgen_id}` falha e o lead
  // se perde; `pages_manage_ads` é exigida junto pra ler lead da Página; e
  // `ads_read` resolve o ad_id no NOME da campanha (a atribuição).
  'leads_retrieval',
  'pages_manage_ads',
  'ads_read',
].join(',');

/**
 * Campos que o app assina na Página (`subscribed_apps`). O POST SUBSTITUI a
 * lista inteira — assinar só `leadgen` desligaria o Messenger. Por isso vão os
 * de mensagem junto.
 */
export const CAMPOS_ASSINATURA_PAGINA = [
  'messages',
  'messaging_postbacks',
  'message_deliveries',
  'message_reads',
  'leadgen',
];

export interface ConectarPagesResult {
  pagesConectadas: Array<{
    pageId: string;
    pageName: string;
    igUserId?: string;
    igUsername?: string;
  }>;
  /**
   * A conta administra MAIS DE UMA Página (item 3a, 29/09): nada foi conectado
   * ainda — a tela de Integrações pergunta qual usar.
   */
  escolherPagina?: Array<{ id: string; name: string }>;
}

/** Escolha pendente (Redis, cifrada): o que o callback obteve e a tela confirma. */
interface EscolhaPendente {
  userToken: string;
  userTokenExpiresAt: number;
  pages: Array<{ id: string; name: string; access_token: string }>;
}

/** Tempo pra escolher a Página depois do login. */
const TTL_ESCOLHA_S = 15 * 60;
const chaveEscolha = (empresaId: string) => `meta:escolha-pagina:${empresaId}`;

/**
 * OAuth da Meta (Facebook Login) + onboarding multi-page.
 *
 * Fluxo:
 *  1. `buildAuthUrl(empresaId)` — gera URL com state JWT (CSRF) e scopes
 *     pra páginas e IG Business Messaging
 *  2. `processCallback(code, state)` — exchange code → user token → long-lived,
 *     lista todas pages do user, pra cada page checa IG vinculado e persiste:
 *       - IntegracaoConexao(servico='facebook') por page
 *       - IntegracaoConexao(servico='instagram') por IG (quando existir)
 *
 * Como podem haver várias pages, e o nosso schema tem unique(empresaId, servico),
 * usamos a primeira por padrão (MVP). Pra multi-page por empresa precisaremos
 * de tabela separada (decisão futura — fica anotada em CLAUDE.md).
 */
/**
 * Validade assumida do user token long-lived quando o Meta NÃO manda
 * `expires_in` (#41).
 *
 * O Graph às vezes responde a troca long-lived sem o campo. Nesse caso
 * `userTokenExpiresAt` ficava `undefined`, o cron de renovação devolvia
 * 'sem-expiracao' e NUNCA renovava: por volta do 60º dia o token morria sozinho
 * e a Inbox de IG/FB parava de receber mensagem sem nenhum alerta — quem
 * descobria era o cliente reclamando que ninguém respondeu. 55 dias (não 60) dá
 * margem pro cron de 14 dias agir antes do vencimento real.
 */
const META_LONG_LIVED_FALLBACK_MS = 55 * 86_400_000;

@Injectable()
export class MetaOAuthService {
  private readonly logger = new Logger(MetaOAuthService.name);
  private readonly stateSecret: Uint8Array;

  constructor(
    private readonly env: EnvService,
    private readonly graph: MetaGraphClientService,
    private readonly prisma: PrismaService,
    private readonly integracoes: IntegracoesService,
    private readonly redis: RedisService,
    private readonly apps: MetaAppService,
  ) {
    this.stateSecret = deriveOAuthStateSecret(this.env.get('ENCRYPTION_KEY'), 'meta-oauth-state');
    // Só pra a escolha pendente no Redis (15 min, tem token). Credencial
    // PERSISTIDA continua passando pelo IntegracoesService (D9).
    this.cripto = new CryptoUtil(this.env.get('ENCRYPTION_KEY'));
  }

  private readonly cripto: CryptoUtil;

  /** O redirect é o ÚNICO pedaço global: cada app da empresa libera essa URL no painel. */
  isConfigured(): boolean {
    return !!this.env.get('META_GRAPH_REDIRECT_URI');
  }

  async buildAuthUrl(empresaId: string): Promise<string> {
    if (!this.isConfigured()) {
      throw new IntegrationException(
        'Meta OAuth não configurado — defina META_GRAPH_REDIRECT_URI',
        ErrorCode.INTEGRATION_ERROR,
      );
    }
    // Item 13: o login usa o app DA EMPRESA (sem ele, erro claro — nunca o de outra).
    const app = await this.apps.obter(empresaId);
    const state = await this.signState(empresaId);
    const params = new URLSearchParams({
      client_id: app.appId,
      redirect_uri: this.env.get('META_GRAPH_REDIRECT_URI'),
      response_type: 'code',
      scope: DEFAULT_SCOPE,
      state,
    });
    return `${this.graph.oauthDialogUrl}?${params}`;
  }

  async processCallback(code: string, state: string): Promise<ConectarPagesResult> {
    const empresaId = await this.verifyState(state);
    const app = await this.apps.obter(empresaId);

    // 1. code → short-lived user token
    const shortLived = await this.graph.exchangeCode(
      code,
      this.env.get('META_GRAPH_REDIRECT_URI'),
      app,
    );
    // 2. → long-lived (~60 dias)
    const longLived = await this.graph.exchangeLongLived(shortLived.access_token, app);
    const userToken = longLived.access_token;
    const userTokenExpiresAt = longLived.expires_in
      ? Date.now() + longLived.expires_in * 1000
      : Date.now() + META_LONG_LIVED_FALLBACK_MS; // #41: nunca deixa sem prazo

    // 3. Lista pages do user
    const pages = await this.graph.listarPages(userToken);
    if (pages.length === 0) {
      throw new BusinessRuleException(
        'Nenhuma página encontrada nesta conta — verifique permissões pages_show_list',
      );
    }

    // Mais de uma Página: o admin escolhe (item 3a, 29/09). Antes pegava a 1ª
    // da lista — a ordem é da Meta, e a empresa podia ficar ligada na Página
    // errada sem perceber. A escolha fica 15 min no Redis, cifrada (tem token).
    if (pages.length > 1) {
      const pendente: EscolhaPendente = {
        userToken,
        userTokenExpiresAt,
        pages: pages.map((p) => ({ id: p.id, name: p.name, access_token: p.access_token })),
      };
      await this.redis.setEx(
        chaveEscolha(empresaId),
        this.cripto.encrypt(JSON.stringify(pendente)),
        TTL_ESCOLHA_S,
      );
      return {
        pagesConectadas: [],
        escolherPagina: pages.map((p) => ({ id: p.id, name: p.name })),
      };
    }
    return this.conectarPagina(empresaId, pages[0], userToken, userTokenExpiresAt, app.appId);
  }

  /** Páginas esperando escolha pra esta empresa (vazio = nenhuma pendente). */
  async paginasPendentes(empresaId: string): Promise<Array<{ id: string; name: string }>> {
    const p = await this.lerEscolha(empresaId);
    return (p?.pages ?? []).map((x) => ({ id: x.id, name: x.name }));
  }

  /** Confirma a Página escolhida na tela e conecta. */
  async escolherPagina(empresaId: string, pageId: string): Promise<ConectarPagesResult> {
    const p = await this.lerEscolha(empresaId);
    if (!p) {
      throw new BusinessRuleException(
        'A escolha da Página expirou — clique em Conectar de novo no Facebook.',
      );
    }
    const page = p.pages.find((x) => x.id === pageId);
    if (!page) throw new BusinessRuleException('Essa Página não está entre as da sua conta.');
    const app = await this.apps.obter(empresaId);
    const r = await this.conectarPagina(
      empresaId,
      page,
      p.userToken,
      p.userTokenExpiresAt,
      app.appId,
    );
    await this.redis.del(chaveEscolha(empresaId));
    return r;
  }

  private async lerEscolha(empresaId: string): Promise<EscolhaPendente | null> {
    const bruto = await this.redis.get(chaveEscolha(empresaId));
    if (!bruto) return null;
    try {
      return JSON.parse(this.cripto.decrypt(bruto)) as EscolhaPendente;
    } catch {
      return null;
    }
  }

  /** Conecta UMA Página (e o IG vinculado a ela) na empresa. */
  private async conectarPagina(
    empresaId: string,
    page: { id: string; name: string; access_token: string },
    userToken: string,
    userTokenExpiresAt: number,
    appId: string,
  ): Promise<ConectarPagesResult> {
    const resultado: ConectarPagesResult = { pagesConectadas: [] };
    const igAccount = await this.graph
      .obterIgVinculadoPage(page.id, page.access_token)
      .catch(() => null);

    // Persiste Facebook
    const fbCreds: FacebookCredenciais = {
      pageId: page.id,
      pageName: page.name,
      pageAccessToken: page.access_token,
      userAccessToken: userToken,
      userTokenExpiresAt,
    };
    // Assina a Página no app (Lead Ads + Messenger). Era passo MANUAL no painel
    // da Meta — empresa nova ficava sem receber lead nenhum e sem aviso. Falha
    // aqui NÃO derruba a conexão: fica gravada e a tela mostra o estado.
    fbCreds.assinatura = await this.assinarPagina(page.id, page.access_token, appId);
    await this.persistirConexao(empresaId, 'facebook', fbCreds, page.id, true);

    // Persiste Instagram (se houver)
    if (igAccount) {
      const igCreds: InstagramCredenciais = {
        pageId: page.id,
        pageAccessToken: page.access_token,
        igUserId: igAccount.id,
        igUsername: igAccount.username,
        userAccessToken: userToken,
        userTokenExpiresAt,
      };
      await this.persistirConexao(empresaId, 'instagram', igCreds, igAccount.id, true);
    }

    resultado.pagesConectadas.push({
      pageId: page.id,
      pageName: page.name,
      igUserId: igAccount?.id,
      igUsername: igAccount?.username,
    });

    this.logger.log(
      `Meta conectado empresa=${empresaId} page=${page.name} ig=${igAccount?.username ?? 'n/a'}`,
    );
    return resultado;
  }

  /**
   * Renova proativamente o token long-lived do Meta (FB/IG) — auditoria #15.
   *
   * O user token long-lived dura ~60 dias e o page token segue ele. Sem renovar,
   * o token expira e FB/IG desconectam em silêncio. Aqui re-trocamos o user token
   * (fb_exchange_token estende por mais ~60d) e re-obtemos o page token a partir
   * dele. Chamado pelo `MetaTokenRefreshJob` (cron diário) só quando faltam poucos
   * dias pra expirar.
   *
   * @returns o que aconteceu, pra o job logar/alertar:
   *  - 'renovado'      → token trocado e persistido
   *  - 'ok'            → ainda longe de expirar (> limiarDias), nada a fazer
   *  - 'sem-conexao'   → não há conexão ativa desse serviço
   *  - 'sem-expiracao' → conexão sem userAccessToken/expiração conhecida (legado)
   */
  async renovarTokenSeNecessario(
    empresaId: string,
    servico: 'facebook' | 'instagram',
    limiarDias = 14,
  ): Promise<'renovado' | 'ok' | 'sem-conexao' | 'sem-expiracao'> {
    // Decifragem centralizada no IntegracoesService (ponto único — D9).
    let creds: FacebookCredenciais | InstagramCredenciais;
    try {
      const conn = await this.integracoes.obterCredenciaisInternas(empresaId, servico);
      creds = conn.credenciais as unknown as FacebookCredenciais | InstagramCredenciais;
    } catch {
      // Sem conexão ativa / credenciais ilegíveis — o cron apenas pula esta empresa.
      return 'sem-conexao';
    }

    if (!creds.userAccessToken) return 'sem-conexao';
    // #41: conexão ANTIGA, salva antes do fallback, pode não ter prazo nenhum.
    // Tratar como "vence agora" é o certo — renova e passa a ter data.
    const expiraEm = creds.userTokenExpiresAt ?? 0;

    const diasRestantes = (expiraEm - Date.now()) / 86_400_000;
    if (diasRestantes > limiarDias) return 'ok';

    // Renova o user token long-lived (Meta estende por mais ~60d) — com o app DA EMPRESA.
    const app = await this.apps.obter(empresaId);
    const longLived = await this.graph.exchangeLongLived(creds.userAccessToken, app);
    const novoUserToken = longLived.access_token;
    const novoExpiresAt = longLived.expires_in
      ? Date.now() + longLived.expires_in * 1000
      : Date.now() + META_LONG_LIVED_FALLBACK_MS; // #41

    // Re-obtém o page token a partir do user token renovado.
    const pages = await this.graph.listarPages(novoUserToken);
    const page = pages.find((p) => p.id === creds.pageId);
    if (!page) {
      throw new BusinessRuleException(
        `Página ${creds.pageId} não acessível com o token renovado (revogada ou sem permissão)`,
      );
    }

    const novasCreds: FacebookCredenciais | InstagramCredenciais = {
      ...creds,
      pageAccessToken: page.access_token,
      userAccessToken: novoUserToken,
      userTokenExpiresAt: novoExpiresAt,
    };
    const externalAccountId =
      servico === 'facebook'
        ? (novasCreds as FacebookCredenciais).pageId
        : (novasCreds as InstagramCredenciais).igUserId;
    await this.persistirConexao(empresaId, servico, novasCreds, externalAccountId);

    this.logger.log(
      `Meta token renovado empresa=${empresaId} servico=${servico}` +
        (novoExpiresAt ? ` (+${Math.round((novoExpiresAt - Date.now()) / 86_400_000)}d)` : ''),
    );
    return 'renovado';
  }

  /** Lookup reverso: dado canal + externalAccountId, retorna credenciais decifradas + empresaId. */
  async resolverPorAccount(
    servico: 'facebook' | 'instagram',
    externalAccountId: string,
  ): Promise<{
    empresaId: string;
    credenciais: FacebookCredenciais | InstagramCredenciais;
  } | null> {
    // Lookup reverso por externalAccountId precisa do Prisma (ainda não sabemos
    // a empresa); a DECIFRAGEM, porém, passa pelo ponto central (D9).
    //
    // São 2 reads (acha empresaId → decifra por empresaId+servico), então há uma
    // janela mínima onde um reconnect concorrente poderia desativar a linha entre
    // eles. É FAIL-SAFE de propósito: se isso acontece, obterCredenciaisInternas
    // lança (linha inativa) e caímos no catch → null. O caller do webhook trata
    // null como "não resolvido" — nunca devolve credencial de outra empresa.
    const conn = await this.prisma.integracaoConexao.findFirst({
      where: { servico, externalAccountId, ativo: true },
      select: { empresaId: true },
    });
    if (!conn) return null;
    try {
      const dec = await this.integracoes.obterCredenciaisInternas(conn.empresaId, servico);
      return {
        empresaId: conn.empresaId,
        credenciais: dec.credenciais as unknown as FacebookCredenciais | InstagramCredenciais,
      };
    } catch {
      return null;
    }
  }

  // ─── Internos ────────────────────────────────────────────────────────

  /** `true` só na volta do provedor (a pessoa autorizou). O refresh de token
   *  passa pelo mesmo caminho e NÃO pode carimbar. */
  /**
   * Assina o app na Página e devolve o estado pra gravar/mostrar. Nunca
   * estoura: o erro vira texto no estado.
   */
  async assinarPagina(
    pageId: string,
    pageAccessToken: string,
    appId: string,
  ): Promise<AssinaturaPagina> {
    const em = new Date().toISOString();
    try {
      await this.graph.assinarAppNaPagina(pageId, pageAccessToken, CAMPOS_ASSINATURA_PAGINA);
      const campos = await this.graph.camposAssinadosNaPagina(pageId, pageAccessToken, appId);
      return { leadgen: campos.includes('leadgen'), campos, em };
    } catch (err) {
      const erro = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Meta: não assinou a Página ${pageId} no app — ${erro}`);
      return { leadgen: false, campos: [], em, erro: erro.slice(0, 300) };
    }
  }

  /**
   * Estado da assinatura da Página conectada, lido AO VIVO da Meta (a tela de
   * Integrações mostra). `reassinar` tenta de novo antes de ler.
   */
  async estadoAssinatura(
    empresaId: string,
    reassinar = false,
  ): Promise<(AssinaturaPagina & { pageId: string; pageName: string }) | null> {
    let creds: FacebookCredenciais;
    try {
      const conn = await this.integracoes.obterCredenciaisInternas(empresaId, 'facebook');
      creds = conn.credenciais as unknown as FacebookCredenciais;
    } catch {
      return null;
    }
    const app = await this.apps.talvez(empresaId);
    if (!app) {
      return {
        leadgen: false,
        campos: [],
        em: new Date().toISOString(),
        erro: 'App da Meta não cadastrado em Integrações',
        pageId: creds.pageId,
        pageName: creds.pageName,
      };
    }
    let estado: AssinaturaPagina;
    if (reassinar) {
      estado = await this.assinarPagina(creds.pageId, creds.pageAccessToken, app.appId);
      await this.persistirConexao(
        empresaId,
        'facebook',
        { ...creds, assinatura: estado },
        creds.pageId,
      );
    } else {
      try {
        const campos = await this.graph.camposAssinadosNaPagina(
          creds.pageId,
          creds.pageAccessToken,
          app.appId,
        );
        estado = { leadgen: campos.includes('leadgen'), campos, em: new Date().toISOString() };
      } catch (err) {
        const erro = err instanceof Error ? err.message : String(err);
        estado = {
          leadgen: false,
          campos: [],
          em: new Date().toISOString(),
          erro: erro.slice(0, 300),
        };
      }
    }
    return { ...estado, pageId: creds.pageId, pageName: creds.pageName };
  }

  private async persistirConexao(
    empresaId: string,
    servico: 'facebook' | 'instagram',
    credenciais: FacebookCredenciais | InstagramCredenciais,
    externalAccountId: string,
    carimbarConexao = false,
  ): Promise<void> {
    await this.integracoes.salvarCredenciaisInternas(
      empresaId,
      servico,
      credenciais as unknown as Record<string, unknown>,
      externalAccountId,
      { carimbarConexao },
    );
  }

  private signState(empresaId: string): Promise<string> {
    return signOAuthState(this.stateSecret, { eid: empresaId });
  }

  private verifyState(state: string): Promise<string> {
    return verifyOAuthState(this.stateSecret, state, 'eid', (jti, ttl) =>
      // #B17: SET NX = o 1º callback queima o jti; replay não passa.
      this.redis.setNxEx(`oauth:jti:${jti}`, '1', ttl),
    );
  }
}
