import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
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
 * - Carrega a matriz da tabela `Permissao` em memória ao subir.
 * - Permite consulta O(1) (`userCan(role, module, action)`).
 * - Permite reload manual via `reloadCache()` quando um admin altera permissões.
 */
@Injectable()
export class PermissionsService implements OnModuleInit {
  private readonly logger = new Logger(PermissionsService.name);
  /** Cache: `${role}:${module}:${action}` -> boolean */
  private cache: Map<string, boolean> = new Map();

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    await this.reloadCache();
  }

  async reloadCache(): Promise<void> {
    const rows = await this.prisma.permissao.findMany();
    this.cache.clear();
    for (const row of rows) {
      if (row.podeVer) {
        this.cache.set(this.key(row.role, row.modulo as ModuleName, 'view'), true);
      }
      if (row.podeEditar) {
        // 'edit' implica 'create' e 'delete' a menos que existam linhas específicas
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
    await this.prisma.permissao.upsert({
      where: { role_modulo: { role, modulo } },
      update: { podeVer, podeEditar },
      create: { role, modulo, podeVer, podeEditar },
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
        await this.prisma.permissao.upsert({
          where: { role_modulo: { role, modulo: m } },
          update: { podeVer, podeEditar },
          create: { role, modulo: m, podeVer, podeEditar },
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
