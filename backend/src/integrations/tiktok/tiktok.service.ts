import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import type { MessageChannel } from '@prisma/client';
import { CanalAdapterRegistry } from '@modules/inbox/canal-adapter.registry';
import type { CanalAdapter } from '@modules/inbox/inbox.types';
import { BusinessRuleException } from '@shared/errors/app-exception';
import { TikTokClientService } from './tiktok-client.service';

/**
 * Adapter TikTok Shop pra Inbox.
 *
 * Limitação inerente da API: TikTok Shop NÃO expõe chat livre comprador↔
 * vendedor — toda interação é estruturada (returns, evidence, etc.).
 *
 * Por isso `enviarTexto` é bloqueado explicitamente. Operações específicas
 * (aceitar/rejeitar return, anexar evidência) são feitas via endpoints
 * dedicados em `TikTokReturnsService`.
 */
@Injectable()
export class TikTokService implements CanalAdapter, OnModuleInit {
  readonly canal: MessageChannel = 'MARKETPLACE_TIKTOK';
  private readonly logger = new Logger(TikTokService.name);

  constructor(
    private readonly registry: CanalAdapterRegistry,
    private readonly client: TikTokClientService,
  ) {}

  onModuleInit(): void {
    this.registry.registrar(this);
  }

  async estaDisponivel(empresaId: string): Promise<boolean> {
    try {
      await this.client.getCredenciais(empresaId);
      return true;
    } catch {
      return false;
    }
  }

  async enviarTexto(): Promise<{ externalId?: string }> {
    throw new BusinessRuleException(
      'TikTok Shop não expõe chat livre via API. Use os endpoints específicos de returns ' +
        '(aceitar/rejeitar/anexar evidência) ou responda no Seller Center.',
    );
  }
}
