import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { UserRole } from '@prisma/client';
import { PrismaService } from '@database/prisma.service';
import {
  type ActionName,
  DEFAULT_PERMISSIONS,
  MODULES,
  type ModuleName,
} from './permissions.constants';

/** Linha coarse (ver/editar) usada pela UI de permissões. */
export interface PermissaoRow {
  modulo: ModuleName;
  podeVer: boolean;
  podeEditar: boolean;
}

/** Linha efetiva de um usuário: papel + override individual (se houver). */
export interface PermissaoEfetivaRow extends PermissaoRow {
  /** true quando existe override individual pra este módulo (não é o padrão do papel). */
  override: boolean;
}

/**
 * Serviço de permissões granulares.
 *
 * Duas camadas:
 *  1. Papel (tabela `Permissao`) — matriz Role×Módulo×Ação, editada no painel.
 *  2. Usuário (tabela `UsuarioPermissao`) — override individual coarse (ver/editar).
 *     Linha presente pra (usuario, modulo) SUBSTITUI o papel naquele módulo.
 *
 * - Carrega ambas em memória ao subir (cache local O(1)).
 * - Recarrega na hora quando um admin altera permissões (upsert/applyDefaults).
 * - Sincroniza entre RÉPLICAS via refresh periódico: cada réplica tem seu cache
 *   local; o refresh relê a fonte da verdade (banco) e converge em ≤REFRESH_MS.
 */
@Injectable()
export class PermissionsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PermissionsService.name);
  /** Cache papel: `${role}:${module}:${action}` -> boolean */
  private cache: Map<string, boolean> = new Map();
  /** Cache override por usuário: `${usuarioId}:${modulo}` -> { podeVer, podeEditar } */
  private userCache: Map<string, { podeVer: boolean; podeEditar: boolean }> = new Map();
  /** Re-sync entre réplicas — relê o banco a cada intervalo (convergência). */
  private static readonly REFRESH_MS = 60_000;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    // Semeia os defaults que FALTAM antes de carregar o cache. Conserta o caso
    // "matriz Permissao nunca semeada em prod → todo não-ADMIN cai em 403".
    // Falha aqui não pode derrubar o boot — loga e segue com o que houver.
    try {
      await this.seedMissingDefaults();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Seed de permissões faltantes falhou (segue sem derrubar): ${msg}`);
    }
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
    const [rows, userRows] = await Promise.all([
      this.prisma.permissao.findMany(),
      this.prisma.usuarioPermissao.findMany(),
    ]);
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
    this.userCache.clear();
    for (const row of userRows) {
      this.userCache.set(`${row.usuarioId}:${row.modulo}`, {
        podeVer: row.podeVer,
        podeEditar: row.podeEditar,
      });
    }
    this.logger.log(
      `Cache de permissões carregado: ${this.cache.size} entradas (papéis) + ${this.userCache.size} overrides de usuário`,
    );
  }

  /** Permissão por PAPEL apenas (sem override individual). */
  userCan(role: UserRole, module: string, action: ActionName): boolean | Promise<boolean> {
    if (role === 'ADMIN') return true;
    return this.cache.get(this.key(role, module as ModuleName, action)) ?? false;
  }

  /**
   * Permissão EFETIVA de um usuário: override individual quando existir,
   * senão a matriz do papel. É o que o PermissionsGuard usa.
   */
  userCanFor(usuarioId: string, role: UserRole, module: string, action: ActionName): boolean {
    if (role === 'ADMIN') return true;
    const doPapel = this.cache.get(this.key(role, module as ModuleName, action)) ?? false;
    const override = this.userCache.get(`${usuarioId}:${module}`);
    if (override) {
      // O override do usuário só controla DIRETAMENTE ver e editar (é o que a UI
      // expõe). Ações críticas (create/delete/approve/export) NÃO são concedidas
      // por um override de "editar" — isso seria escalonamento silencioso. O
      // override só pode REMOVÊ-las (podeEditar=false); pra CONCEDER, o papel
      // precisa já ter a ação (AND com a matriz do papel).
      if (action === 'view') return override.podeVer;
      if (action === 'edit') return override.podeEditar;
      return override.podeEditar && doPapel;
    }
    return doPapel;
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
   * Linhas coarse (ver/editar) de um papel — shape que a página de permissões
   * consome direto ({ modulo, podeVer, podeEditar }[]).
   */
  async listForRoleRows(role: UserRole): Promise<PermissaoRow[]> {
    const matrix = await this.listForRole(role);
    return MODULES.map((m) => {
      const actions = matrix[m] ?? [];
      return {
        modulo: m,
        podeVer: actions.includes('view'),
        podeEditar: actions.some((a) => a !== 'view'),
      };
    });
  }

  /**
   * Permissões EFETIVAS de um usuário (papel + overrides), com flag de override
   * por módulo. Usado pelo painel "por usuário" e pelo GET /permissions/me.
   * ADMIN → tudo true (bypass).
   */
  async listEffectiveForUser(usuarioId: string, role: UserRole): Promise<PermissaoEfetivaRow[]> {
    if (role === 'ADMIN') {
      return MODULES.map((m) => ({ modulo: m, podeVer: true, podeEditar: true, override: false }));
    }
    const [base, overrides] = await Promise.all([
      this.listForRoleRows(role),
      this.prisma.usuarioPermissao.findMany({ where: { usuarioId } }),
    ]);
    const ovMap = new Map(overrides.map((o) => [o.modulo, o]));
    return base.map((row) => {
      const ov = ovMap.get(row.modulo);
      if (!ov) return { ...row, override: false };
      return { modulo: row.modulo, podeVer: ov.podeVer, podeEditar: ov.podeEditar, override: true };
    });
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

  /** Cria/atualiza um override individual (usuario × módulo). */
  async upsertUserOverride(
    usuarioId: string,
    modulo: string,
    podeVer: boolean,
    podeEditar: boolean,
  ): Promise<void> {
    await this.prisma.usuarioPermissao.upsert({
      where: { usuarioId_modulo: { usuarioId, modulo } },
      update: { podeVer, podeEditar },
      create: { usuarioId, modulo, podeVer, podeEditar },
    });
    await this.reloadCache();
  }

  /** Remove o override individual — o módulo volta ao padrão do papel. */
  async removeUserOverride(usuarioId: string, modulo: string): Promise<void> {
    await this.prisma.usuarioPermissao.deleteMany({ where: { usuarioId, modulo } });
    await this.reloadCache();
  }

  /**
   * Semeia os defaults SÓ nas linhas que FALTAM (create-only) — NUNCA sobrescreve
   * uma linha já existente, então respeita a customização do painel e qualquer
   * ajuste manual. Roda no boot (idempotente): em env novo/réplica sem seed,
   * preenche a matriz; em prod já configurado, é no-op (só um findMany).
   *
   * Diferença pro applyDefaults(): este NÃO faz update — por isso é seguro rodar
   * sempre. O applyDefaults (update+create) fica pro seed manual / reset.
   */
  async seedMissingDefaults(): Promise<number> {
    const existentes = await this.prisma.permissao.findMany({
      select: { role: true, modulo: true },
    });
    const has = new Set(existentes.map((r) => `${r.role}:${r.modulo}`));
    const faltantes: Array<{
      role: UserRole;
      modulo: string;
      podeVer: boolean;
      podeEditar: boolean;
      acoes: ActionName[];
    }> = [];
    for (const role of Object.keys(DEFAULT_PERMISSIONS) as UserRole[]) {
      const moduleMap = DEFAULT_PERMISSIONS[role];
      for (const m of MODULES) {
        if (has.has(`${role}:${m}`)) continue; // já existe → preserva
        const actions = moduleMap[m] ?? [];
        faltantes.push({
          role,
          modulo: m,
          podeVer: actions.includes('view'),
          podeEditar: actions.some((a) => a !== 'view'),
          acoes: actions,
        });
      }
    }
    if (faltantes.length === 0) return 0;
    // skipDuplicates cobre corrida entre réplicas subindo ao mesmo tempo.
    await this.prisma.permissao.createMany({ data: faltantes, skipDuplicates: true });
    this.logger.log(`Permissões: semeadas ${faltantes.length} linha(s) que faltavam (create-only)`);
    return faltantes.length;
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
