import { Injectable, Logger } from '@nestjs/common';
import { EnvService } from '@config/env.service';
import { PrismaService } from '@database/prisma.service';
import { IntegracoesService } from '@modules/integracoes/integracoes.service';
import { BusinessRuleException, IntegrationException } from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';
import { CryptoUtil } from '@shared/utils/crypto.util';
import {
  deriveOAuthStateSecret,
  signOAuthState,
  verifyOAuthState,
} from '@shared/utils/oauth-state.util';
import { MetaGraphClientService } from './meta-graph-client.service';
import type { FacebookCredenciais, InstagramCredenciais } from './meta.types';

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
].join(',');

interface ConectarPagesResult {
  pagesConectadas: Array<{
    pageId: string;
    pageName: string;
    igUserId?: string;
    igUsername?: string;
  }>;
}

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
@Injectable()
export class MetaOAuthService {
  private readonly logger = new Logger(MetaOAuthService.name);
  private readonly stateSecret: Uint8Array;
  private readonly crypto: CryptoUtil;

  constructor(
    private readonly env: EnvService,
    private readonly graph: MetaGraphClientService,
    private readonly prisma: PrismaService,
    private readonly integracoes: IntegracoesService,
  ) {
    this.stateSecret = deriveOAuthStateSecret(this.env.get('ENCRYPTION_KEY'), 'meta-oauth-state');
    this.crypto = new CryptoUtil(this.env.get('ENCRYPTION_KEY'));
  }

  isConfigured(): boolean {
    return !!(
      this.env.get('META_GRAPH_APP_ID') &&
      this.env.get('META_GRAPH_APP_SECRET') &&
      this.env.get('META_GRAPH_REDIRECT_URI')
    );
  }

  async buildAuthUrl(empresaId: string): Promise<string> {
    if (!this.isConfigured()) {
      throw new IntegrationException(
        'Meta OAuth não configurado — defina META_GRAPH_APP_ID/SECRET/REDIRECT_URI',
        ErrorCode.INTEGRATION_ERROR,
      );
    }
    const state = await this.signState(empresaId);
    const params = new URLSearchParams({
      client_id: this.env.get('META_GRAPH_APP_ID'),
      redirect_uri: this.env.get('META_GRAPH_REDIRECT_URI'),
      response_type: 'code',
      scope: DEFAULT_SCOPE,
      state,
    });
    return `${this.graph.oauthDialogUrl}?${params}`;
  }

  async processCallback(code: string, state: string): Promise<ConectarPagesResult> {
    const empresaId = await this.verifyState(state);

    // 1. code → short-lived user token
    const shortLived = await this.graph.exchangeCode(code, this.env.get('META_GRAPH_REDIRECT_URI'));
    // 2. → long-lived (~60 dias)
    const longLived = await this.graph.exchangeLongLived(shortLived.access_token);
    const userToken = longLived.access_token;
    const userTokenExpiresAt = longLived.expires_in
      ? Date.now() + longLived.expires_in * 1000
      : undefined;

    // 3. Lista pages do user
    const pages = await this.graph.listarPages(userToken);
    if (pages.length === 0) {
      throw new BusinessRuleException(
        'Nenhuma página encontrada nesta conta — verifique permissões pages_show_list',
      );
    }

    const resultado: ConectarPagesResult = { pagesConectadas: [] };
    // MVP: usa primeira page. Multi-page → next iteration.
    const page = pages[0];
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
    await this.persistirConexao(empresaId, 'facebook', fbCreds, page.id);

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
      await this.persistirConexao(empresaId, 'instagram', igCreds, igAccount.id);
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
    const conn = await this.prisma.integracaoConexao.findFirst({
      where: { empresaId, servico, ativo: true },
    });
    if (!conn) return 'sem-conexao';

    let creds: FacebookCredenciais | InstagramCredenciais;
    try {
      creds = JSON.parse(this.crypto.decrypt(conn.credenciais as unknown as string));
    } catch {
      return 'sem-conexao';
    }

    if (!creds.userAccessToken || !creds.userTokenExpiresAt) return 'sem-expiracao';

    const diasRestantes = (creds.userTokenExpiresAt - Date.now()) / 86_400_000;
    if (diasRestantes > limiarDias) return 'ok';

    // Renova o user token long-lived (Meta estende por mais ~60d).
    const longLived = await this.graph.exchangeLongLived(creds.userAccessToken);
    const novoUserToken = longLived.access_token;
    const novoExpiresAt = longLived.expires_in
      ? Date.now() + longLived.expires_in * 1000
      : undefined;

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
    const conn = await this.prisma.integracaoConexao.findFirst({
      where: { servico, externalAccountId, ativo: true },
    });
    if (!conn) return null;
    try {
      const raw = this.crypto.decrypt(conn.credenciais as unknown as string);
      const creds = JSON.parse(raw);
      return { empresaId: conn.empresaId, credenciais: creds };
    } catch {
      return null;
    }
  }

  // ─── Internos ────────────────────────────────────────────────────────

  private async persistirConexao(
    empresaId: string,
    servico: 'facebook' | 'instagram',
    credenciais: FacebookCredenciais | InstagramCredenciais,
    externalAccountId: string,
  ): Promise<void> {
    const enc = this.crypto.encrypt(JSON.stringify(credenciais));
    await this.prisma.integracaoConexao.upsert({
      where: { empresaId_servico: { empresaId, servico } },
      update: { credenciais: enc, ativo: true, errosRecentes: 0, externalAccountId },
      create: {
        empresaId,
        servico,
        ativo: true,
        credenciais: enc,
        externalAccountId,
      },
    });
    // garante invalidação do cache do IntegracoesService
    await this.integracoes.registrarSyncOk(empresaId, servico).catch(() => undefined);
  }

  private signState(empresaId: string): Promise<string> {
    return signOAuthState(this.stateSecret, { eid: empresaId });
  }

  private verifyState(state: string): Promise<string> {
    return verifyOAuthState(this.stateSecret, state, 'eid');
  }
}
