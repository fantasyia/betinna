import { Injectable, Logger } from '@nestjs/common';
import { EnvService } from '@config/env.service';
import { RedisService } from '@database/redis.service';
import { IntegracoesService } from '@modules/integracoes/integracoes.service';
import { IntegrationException } from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';
import {
  deriveOAuthStateSecret,
  signOAuthState,
  verifyOAuthState,
} from '@shared/utils/oauth-state.util';
import { decifrarSecretKey } from './shein-assinatura';
import { SheinClientService } from './shein.client';

const EMPOWER = 'https://openapi-sem.sheincorp.com/#/empower';
const PATH_TOKEN = '/open-api/auth/get-by-token';

interface InfoToken {
  openKeyId?: string;
  secretKey?: string;
  supplierId?: string | number;
}

/**
 * Autorização da loja na Shein (01/11):
 *  1. a empresa já colou o ID e o segredo do aplicativo (Integrações);
 *  2. `urlAutorizacao` monta o link da Shein (appid + redirectUrl em base64 + state);
 *  3. a Shein volta no callback com `tempToken` (vale 10 min);
 *  4. `processarCallback` troca o tempToken pelo openKeyId e secretKey DA LOJA
 *     (o secretKey vem cifrado — decifrarSecretKey) e grava junto do par do app.
 */
@Injectable()
export class SheinOAuthService {
  private readonly logger = new Logger(SheinOAuthService.name);
  private readonly stateSecret: Uint8Array;

  constructor(
    private readonly env: EnvService,
    private readonly redis: RedisService,
    private readonly integracoes: IntegracoesService,
    private readonly shein: SheinClientService,
  ) {
    this.stateSecret = deriveOAuthStateSecret(this.env.get('ENCRYPTION_KEY'), 'shein-oauth-state');
  }

  /** URL pública do callback (a Shein redireciona o navegador pra cá). */
  redirectUrl(): string {
    const origem = (this.env.get('API_PUBLIC_URL') || '').replace(/\/+$/, '');
    if (!origem) {
      throw new IntegrationException(
        'API_PUBLIC_URL não configurada — sem ela a Shein não tem pra onde voltar',
        ErrorCode.INTEGRATION_NOT_CONFIGURED,
      );
    }
    const prefixo = (this.env.get('API_PREFIX') || '').replace(/^\/+|\/+$/g, '');
    const base = prefixo && !origem.endsWith(`/${prefixo}`) ? `${origem}/${prefixo}` : origem;
    return `${base}/integracoes/shein/oauth/callback`;
  }

  async urlAutorizacao(empresaId: string): Promise<string> {
    const { appId } = await this.shein.credenciais(empresaId);
    const state = await signOAuthState(this.stateSecret, { eid: empresaId });
    const q = new URLSearchParams({
      appid: appId,
      redirectUrl: Buffer.from(this.redirectUrl()).toString('base64'),
      state,
    });
    // A Shein lê os parâmetros depois do "#" (rota da página de autorização).
    return `${EMPOWER}?${q}`;
  }

  async processarCallback(tempToken: string, state: string): Promise<{ supplierId: string }> {
    const empresaId = await verifyOAuthState(this.stateSecret, state, 'eid', (jti, ttl) =>
      this.redis.setNxEx(`oauth:jti:${jti}`, '1', ttl),
    );
    const app = await this.shein.credenciais(empresaId);
    const info = await this.shein.postApp<InfoToken>(app.appId, app.appSecret, PATH_TOKEN, {
      tempToken,
    });
    if (!info?.openKeyId || !info.secretKey) {
      throw new IntegrationException(
        'A Shein não devolveu as chaves da loja — tente autorizar de novo',
        ErrorCode.INTEGRATION_ERROR,
      );
    }
    const supplierId = String(info.supplierId ?? info.openKeyId);
    await this.integracoes.salvarCredenciaisInternas(
      empresaId,
      'shein',
      {
        appId: app.appId,
        appSecret: app.appSecret,
        openKeyId: info.openKeyId,
        secretKey: decifrarSecretKey(info.secretKey, app.appSecret),
        supplierId,
      },
      supplierId,
      { carimbarConexao: true },
    );
    this.logger.log(`Shein autorizada empresa=${empresaId} supplier=${supplierId}`);
    return { supplierId };
  }
}
