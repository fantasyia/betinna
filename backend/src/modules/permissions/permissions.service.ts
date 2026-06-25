import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { UserRole } from '@prisma/client';
import { PrismaService } from '@database/prisma.service';
import {
  type ActionName,
  DEFAULT_PERMISSIONS,
  MODULES,
  type ModuleName,
} from './permissions.constants';

/**
 * Serviço de permissões granulares.
 *
 * - Carrega a matriz da tabela `Permissao` em memória ao subir (cache local O(1)).
 * - Recarrega na hora quando um admin altera permissões (upsert/applyDefaults).
 * - Sincroniza entre RÉPLICAS via refresh periódico: cada réplica tem seu cache
 *   local; sem isso, uma réplica que NÃO processou o upsert ficaria desatualizada
 *   para sempre (o cache não tinha TTL). O refresh relê a fonte da verdade (banco)
 *   e converge todas as réplicas em ≤REFRESH_MS. A réplica que escreve recarrega
 *   na hora; as outras pegam no próximo tick.
 */
@Injectable()
export class PermissionsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PermissionsService.name);
  /** Cache: `${role}:${module}:${action}` -> boolean */
  private cache: Map<string, boolean> = new Map();
  /** Re-sync entre réplicas — relê o banco a cada intervalo (convergência). */
  private static readonly REFRESH_MS = 60_000;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    await this.reloadCache();
    // Em teste não agenda o timer (evita handle aberto segurando o runner).
    if (process.env.NODE_ENV !== 'test') {
      this.refreshTimer = setInterval(() => {
        void this.reloadCache().catch((err) => {
          const msg = err instanceof Error ? err.message : String(err);
          this.logger.warn(`Refresh periódico do cache de permissões falhou: ${msg}`);
        });
      }, PermissionsService.REFRESH_MS);
      // unref: o timer não segura o processo vivo sozinho.
      this.refreshTimer.unref?.();
    }
  }

  onModuleDestroy(): void {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
  }

  async reloadCache(): Promise<void> {
    const rows = await this.prisma.permissao.findMany();
    this.cache.clear();
    for (const row of rows) {
      // Granular (`acoes` preenchido) é a fonte da verdade — não expande edit→delete/approve.
      if (row.acoes && row.acoes.length > 0) {
        for (const a of row.acoes) {
          this.cache.set(this.key(row.role, row.modulo as ModuleName, a as ActionName), true);
        }
        continue;
      }
      // Legado (sem `acoes`): expand coarse de podeVer/podeEditar (compat).
      if (row.podeVer) {
        this.cache.set(this.key(row.role, row.modulo as ModuleName, 'view'), true);
      }
      if (row.podeEditar) {
        for (const a of ['create', 'edit', 'delete', 'approve', 'export'] as ActionName[]) {
          this.cache.set(this.key(row.role, row.modulo as ModuleName, a), true);
        }
      }
    }
    this.logger.log(`Cache de permissões carregado: ${this.cache.size} entradas`);
  }

  userCan(role: UserRole, module: string, action: ActionName): boolean | Promise<boolean> {
    if (role === 'ADMIN') return true;
    return this.cache.get(this.key(role, module as ModuleName, action)) ?? false;
  }

  /**
   * Lista as permissões consolidadas para um papel — útil pro frontend
   * decidir o que exibir.
   */
  async listForRole(role: UserRole): Promise<Record<ModuleName, ActionName[]>> {
    const rows = await this.prisma.permissao.findMany({ where: { role } });
    const result = {} as Record<ModuleName, ActionName[]>;
    for (const m of MODULES) result[m] = [];
    for (const r of rows) {
      const mod = r.modulo as ModuleName;
      if (r.acoes && r.acoes.length > 0) {
        for (const a of r.acoes as ActionName[]) {
          if (!result[mod].includes(a)) result[mod].push(a);
        }
        continue;
      }
      if (r.podeVer) result[mod].push('view');
      if (r.podeEditar) {
        for (const a of ['create', 'edit', 'delete', 'approve', 'export'] as ActionName[]) {
          if (!result[mod].includes(a)) result[mod].push(a);
        }
      }
    }
    return result;
  }

  /**
   * Atualiza/insere a permissão de um papel para um módulo.
   * Apenas Admin deve poder chamar (controle no controller).
   */
  async upsert(
    role: UserRole,
    modulo: string,
    podeVer: boolean,
    podeEditar: boolean,
  ): Promise<void> {
    // O toggle do admin é COARSE (ver/editar) — limpa `acoes` pra valer o expand coarse (escolha
    // explícita do admin pela UI). A granularidade vive nos defaults (applyDefaults).
    await this.prisma.permissao.upsert({
      where: { role_modulo: { role, modulo } },
      update: { podeVer, podeEditar, acoes: [] },
      create: { role, modulo, podeVer, podeEditar, acoes: [] },
    });
    await this.reloadCache();
  }

  /**
   * Aplica a matriz padrão (DEFAULT_PERMISSIONS).
   * Usado pelo seed. Idempotente.
   */
  async applyDefaults(): Promise<void> {
    for (const role of Object.keys(DEFAULT_PERMISSIONS) as UserRole[]) {
      const moduleMap = DEFAULT_PERMISSIONS[role];
      for (const m of MODULES) {
        const actions = moduleMap[m] ?? [];
        const podeVer = actions.includes('view');
        const podeEditar = actions.some((a) => a !== 'view');
        // Grava a granularidade REAL da matriz em `acoes` — assim REP/SAC não herdam
        // delete/approve via expand de podeEditar. podeVer/podeEditar seguem por compat.
        await this.prisma.permissao.upsert({
          where: { role_modulo: { role, modulo: m } },
          update: { podeVer, podeEditar, acoes: actions },
          create: { role, modulo: m, podeVer, podeEditar, acoes: actions },
        });
      }
    }
    await this.reloadCache();
    this.logger.log('Permissões padrão aplicadas');
  }

  private key(role: UserRole, module: ModuleName, action: ActionName): string {
    return `${role}:${module}:${action}`;
  }
}
