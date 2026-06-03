import { randomBytes } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@database/prisma.service';
import { ForbiddenException, NotFoundException } from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';
import { getCallerEmpresaId } from '@shared/utils/auth-context';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { FluxoEventBusService } from './fluxo-event-bus.service';

/**
 * WebhookEntradaService (Fase C — spec §2.6) — webhooks de ENTRADA por empresa.
 * Um POST no endpoint público com o token dispara o gatilho WEBHOOK_RECEBIDO,
 * com o corpo do request no contexto ({{custom.*}} via payload).
 */
@Injectable()
export class WebhookEntradaService {
  private readonly logger = new Logger(WebhookEntradaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly bus: FluxoEventBusService,
  ) {}

  private requireEmpresa(user: AuthenticatedUser): string {
    const id = getCallerEmpresaId(user);
    if (!id) throw new ForbiddenException('Empresa não definida', ErrorCode.TENANT_ACCESS_DENIED);
    return id;
  }

  async criar(
    user: AuthenticatedUser,
    nome: string,
  ): Promise<{ id: string; nome: string; token: string }> {
    const empresaId = this.requireEmpresa(user);
    const token = randomBytes(24).toString('hex');
    const wh = await this.prisma.webhookEntrada.create({
      data: { empresaId, nome, token, ativo: true },
      select: { id: true, nome: true, token: true },
    });
    this.logger.log(`Webhook de entrada criado: ${wh.id} (${nome}) — empresa ${empresaId}`);
    return wh;
  }

  async listar(user: AuthenticatedUser) {
    const empresaId = this.requireEmpresa(user);
    return this.prisma.webhookEntrada.findMany({
      where: { empresaId },
      orderBy: { criadoEm: 'desc' },
      select: { id: true, nome: true, token: true, ativo: true, criadoEm: true },
    });
  }

  async remover(user: AuthenticatedUser, id: string): Promise<void> {
    const empresaId = this.requireEmpresa(user);
    const r = await this.prisma.webhookEntrada.deleteMany({ where: { id, empresaId } });
    if (r.count === 0) throw new NotFoundException('Webhook', id);
  }

  /** Receiver público: valida o token e dispara WEBHOOK_RECEBIDO com o payload. */
  async processar(token: string, payload: Record<string, unknown>): Promise<{ ok: boolean }> {
    const wh = await this.prisma.webhookEntrada.findUnique({
      where: { token },
      select: { id: true, empresaId: true, nome: true, ativo: true },
    });
    if (!wh || !wh.ativo) {
      // Não revela se existe — 404 genérico.
      throw new NotFoundException('Webhook', 'token');
    }
    await this.bus.disparar(wh.empresaId, 'WEBHOOK_RECEBIDO', {
      webhookId: wh.id,
      webhookNome: wh.nome,
      payload: payload ?? {},
    });
    return { ok: true };
  }
}
