import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { EnvService } from '@config/env.service';
import { PrismaService } from '@database/prisma.service';
import { IntegracoesService } from '@modules/integracoes/integracoes.service';
import { BusinessRuleException, IntegrationException } from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import {
  AsaasClient,
  ambienteDaChave,
  type AmbienteAsaas,
  type TaxasAsaas,
} from '@integrations/asaas/asaas.client';

/** O que fica em `Empresa.config.checkout` (sem segredo nenhum). */
export interface ConfigCheckout {
  ativo?: boolean;
  ambiente?: AmbienteAsaas;
  taxas?: TaxasAsaas;
  taxasLidasEm?: string;
  ativadoEm?: string;
}

/** Credenciais da conexão `asaas` (cifradas em IntegracaoConexao). */
interface CredAsaas {
  apiKey?: string;
  webhookId?: string;
  webhookToken?: string;
}

const regra = (msg: string) => new BusinessRuleException(msg, ErrorCode.BUSINESS_RULE_VIOLATION);

/**
 * Pagamento online da vitrine (checkout Asaas) — entrega 1: ligar a conta.
 *
 * A conta Asaas é DA EMPRESA (Integrações → Asaas, só a diretoria). "Ativar"
 * confere a chave, lê a tabela de taxas e cadastra no Asaas o aviso de
 * pagamento (webhook) desta empresa, com um código secreto que volta em todo
 * aviso. O estado (ativo, ambiente, taxas) fica em `config.checkout`; a chave e
 * o código ficam só na credencial cifrada.
 */
@Injectable()
export class CheckoutService {
  private readonly logger = new Logger(CheckoutService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly integracoes: IntegracoesService,
    private readonly env: EnvService,
  ) {}

  /** Injetável nos testes. */
  protected cliente(chave: string): AsaasClient {
    return new AsaasClient(chave);
  }

  private empresaDo(user: AuthenticatedUser): string {
    const id = user.empresaIdAtiva ?? user.empresaIds?.[0];
    if (!id) throw regra('Empresa não definida');
    return id;
  }

  private async config(empresaId: string): Promise<ConfigCheckout> {
    const e = await this.prisma.empresa.findUnique({
      where: { id: empresaId },
      select: { config: true },
    });
    return (((e?.config ?? {}) as Record<string, unknown>).checkout ?? {}) as ConfigCheckout;
  }

  private async gravarConfig(empresaId: string, parte: ConfigCheckout): Promise<void> {
    // jsonb_set atômico: não lê-modifica-escreve a config inteira (corrida com
    // quem salva outra seção ao mesmo tempo).
    await this.prisma.$executeRaw`
      UPDATE "Empresa"
      SET "config" = jsonb_set(
        COALESCE("config", '{}'::jsonb),
        '{checkout}',
        COALESCE("config"->'checkout', '{}'::jsonb) || ${JSON.stringify(parte)}::jsonb,
        true
      )
      WHERE "id" = ${empresaId}`;
  }

  private async credenciais(empresaId: string): Promise<CredAsaas | null> {
    try {
      const c = await this.integracoes.obterCredenciaisInternas(empresaId, 'asaas');
      return c.credenciais as CredAsaas;
    } catch {
      return null; // não conectado (ou desativado)
    }
  }

  /** Endereço do aviso de pagamento DESTA empresa (origem pública da API). */
  urlDoWebhook(empresaId: string): string {
    const origem = (this.env.get('API_PUBLIC_URL') || '').replace(/\/+$/, '');
    if (!origem) {
      throw regra('API_PUBLIC_URL não configurada — sem ela o Asaas não sabe pra onde avisar');
    }
    const prefixo = (this.env.get('API_PREFIX') || '').replace(/^\/+|\/+$/g, '');
    const base = prefixo && !origem.endsWith(`/${prefixo}`) ? `${origem}/${prefixo}` : origem;
    return `${base}/webhooks/asaas/${encodeURIComponent(empresaId)}`;
  }

  async status(user: AuthenticatedUser) {
    const empresaId = this.empresaDo(user);
    const [cfg, cred] = await Promise.all([this.config(empresaId), this.credenciais(empresaId)]);
    return {
      conectado: !!cred?.apiKey,
      ambiente: ambienteDaChave(cred?.apiKey) ?? null,
      ativo: cfg.ativo === true && !!cred?.apiKey,
      avisoCadastrado: !!cred?.webhookId,
      taxas: cfg.taxas ?? null,
      taxasLidasEm: cfg.taxasLidasEm ?? null,
      ativadoEm: cfg.ativadoEm ?? null,
    };
  }

  /**
   * Ativa: confere a chave, lê as taxas e cadastra (ou atualiza) o aviso de
   * pagamento no Asaas. Pode rodar de novo a qualquer hora — renova as taxas
   * e corrige o aviso (ex.: fila pausada, endereço mudou).
   */
  async ativar(user: AuthenticatedUser) {
    const empresaId = this.empresaDo(user);
    const cred = await this.credenciais(empresaId);
    if (!cred?.apiKey) {
      throw regra('Conecte a conta do Asaas em Integrações antes de ativar o pagamento online');
    }
    const asaas = this.cliente(cred.apiKey);
    await asaas.saldo(); // chave válida?
    const taxas = await asaas.taxas();
    const url = this.urlDoWebhook(empresaId);
    const token = cred.webhookToken || randomBytes(32).toString('hex');
    let webhook;
    try {
      webhook = await asaas.salvarWebhook(
        { url, authToken: token, email: user.email },
        cred.webhookId,
      );
    } catch (err) {
      // Aviso apagado lá no painel do Asaas: cria de novo.
      if (!cred.webhookId) throw err;
      this.logger.warn(
        `[asaas] aviso ${cred.webhookId} não atualizou (${String(err)}) — criando outro`,
      );
      webhook = await asaas.salvarWebhook({ url, authToken: token, email: user.email });
    }
    await this.integracoes.salvarCredenciaisInternas(
      empresaId,
      'asaas',
      { ...cred, webhookId: webhook.id, webhookToken: token },
      webhook.id,
    );
    const agora = new Date().toISOString();
    await this.gravarConfig(empresaId, {
      ativo: true,
      ambiente: asaas.ambiente,
      taxas,
      taxasLidasEm: agora,
      ativadoEm: agora,
    });
    this.logger.log(`[asaas] pagamento online ATIVADO (${asaas.ambiente}) na empresa ${empresaId}`);
    return this.status(user);
  }

  /** Desliga o pagamento online na vitrine (a conta e o aviso continuam). */
  async desativar(user: AuthenticatedUser) {
    const empresaId = this.empresaDo(user);
    await this.gravarConfig(empresaId, { ativo: false });
    return this.status(user);
  }

  /**
   * Aviso de pagamento chegando: confere o código secreto (tempo constante) e
   * grava o evento — repetido não duplica (o Asaas entrega "pelo menos uma
   * vez"). Responder rápido: o processamento é da entrega 2.
   */
  async registrarAviso(empresaId: string, tokenRecebido: string | undefined, corpo: unknown) {
    const cred = await this.credenciais(empresaId);
    const esperado = cred?.webhookToken ?? '';
    const recebido = tokenRecebido ?? '';
    const ok =
      esperado.length > 0 &&
      esperado.length === recebido.length &&
      timingSafeEqual(Buffer.from(esperado), Buffer.from(recebido));
    if (!ok) {
      throw new IntegrationException(
        'Aviso do Asaas com código inválido',
        ErrorCode.AUTH_INVALID_TOKEN,
      );
    }
    const ev = (corpo ?? {}) as { id?: unknown; event?: unknown; payment?: { id?: unknown } };
    if (typeof ev.id !== 'string' || typeof ev.event !== 'string') {
      throw regra('Aviso do Asaas sem id/evento');
    }
    try {
      await this.prisma.asaasEvento.create({
        data: {
          id: ev.id,
          empresaId,
          evento: ev.event,
          pagamentoId: typeof ev.payment?.id === 'string' ? ev.payment.id : null,
          payload: corpo as Prisma.InputJsonValue,
        },
      });
      return { novo: true };
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return { novo: false }; // já recebido: ACK sem gravar de novo
      }
      throw err;
    }
  }
}
