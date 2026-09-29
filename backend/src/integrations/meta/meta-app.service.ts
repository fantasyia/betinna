import { Injectable } from '@nestjs/common';
import { IntegracoesService } from '@modules/integracoes/integracoes.service';
import { BusinessRuleException } from '@shared/errors/app-exception';

/** Credenciais do app da Meta de UMA empresa (item 13 do card 📣, 29/09). */
export interface MetaAppCredenciais {
  appId: string;
  appSecret: string;
  verifyToken: string;
}

/**
 * App da Meta POR EMPRESA (decisão do Léo, 29/09): cada cliente tem o próprio
 * app no portfólio dele (como o "Somatec Ads"), cadastrado na tela de
 * Integrações (`IntegracaoConexao` servico='meta_app', cifrado — D9).
 *
 * É a base de tudo da Meta: o OAuth usa o client_id/secret DESTE app, a troca e
 * a renovação do token também, e o webhook da empresa (`/webhooks/meta/:empresaId`)
 * valida a assinatura com o segredo DELE. Não existe mais app global no env: o
 * caminho global nunca rodou em produção (nenhuma conexão FB/IG, conferido em
 * 29/09), e sem ele nenhuma empresa nova cai no app de outra por engano.
 */
@Injectable()
export class MetaAppService {
  constructor(private readonly integracoes: IntegracoesService) {}

  /** Credenciais do app da empresa, ou `null` se não cadastrado/incompleto. */
  async talvez(empresaId: string): Promise<MetaAppCredenciais | null> {
    try {
      const conn = await this.integracoes.obterCredenciaisInternas(empresaId, 'meta_app');
      const c = conn.credenciais as Partial<Record<keyof MetaAppCredenciais, unknown>>;
      const appId = typeof c.appId === 'string' ? c.appId.trim() : '';
      const appSecret = typeof c.appSecret === 'string' ? c.appSecret.trim() : '';
      const verifyToken = typeof c.verifyToken === 'string' ? c.verifyToken.trim() : '';
      if (!appId || !appSecret || !verifyToken) return null;
      return { appId, appSecret, verifyToken };
    } catch {
      return null;
    }
  }

  /** Igual a `talvez`, mas explica o que falta — pro OAuth e a tela. */
  async obter(empresaId: string): Promise<MetaAppCredenciais> {
    const app = await this.talvez(empresaId);
    if (!app) {
      throw new BusinessRuleException(
        'Cadastre o App da Meta desta empresa em Integrações (ID do app, chave secreta e token de verificação) antes de conectar o Facebook/Instagram.',
      );
    }
    return app;
  }
}
