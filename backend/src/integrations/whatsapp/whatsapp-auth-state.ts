import { Logger } from '@nestjs/common';
import {
  BufferJSON,
  type AuthenticationCreds,
  type AuthenticationState,
  type SignalDataTypeMap,
  type SignalKeyStore,
  initAuthCreds,
} from '@whiskeysockets/baileys';
import type { PrismaService } from '@database/prisma.service';
import { CryptoUtil } from '@shared/utils/crypto.util';

type KeysMap = {
  [K in keyof SignalDataTypeMap]?: { [id: string]: SignalDataTypeMap[K] };
};

interface PersistedState {
  creds: AuthenticationCreds;
  keys: KeysMap;
}

/**
 * Owner de uma sessão Baileys.
 * - `EMPRESA`: WhatsApp central da empresa (ex: número de SAC).
 *   Persistido em `IntegracaoConexao` (empresaId, servico='whatsapp').
 * - `USUARIO`: WhatsApp pessoal do rep.
 *   Persistido em `UsuarioIntegracao` (usuarioId, servico='whatsapp').
 */
export type WhatsAppOwnerType = 'EMPRESA' | 'USUARIO';

export interface WhatsAppOwner {
  type: WhatsAppOwnerType;
  /** empresaId quando EMPRESA; usuarioId quando USUARIO. */
  id: string;
}

/** Chave string única que identifica uma sessão (`emp:<id>` ou `user:<id>`). */
export function ownerKey(owner: WhatsAppOwner): string {
  return owner.type === 'EMPRESA' ? `emp:${owner.id}` : `user:${owner.id}`;
}

/**
 * AuthState do Baileys persistido com cifragem AES-256-GCM via `CryptoUtil`.
 *
 * Suporta dois modos:
 *  - **EMPRESA**: persistido em `IntegracaoConexao(empresaId, servico='whatsapp')`
 *  - **USUARIO**: persistido em `UsuarioIntegracao(usuarioId, servico='whatsapp')`
 *
 * Saves throttled (200ms) pra reduzir I/O. `flush()` força persistência
 * imediata (chame antes de desligar).
 */
export class WhatsAppAuthState {
  private readonly logger = new Logger(WhatsAppAuthState.name);
  private state: PersistedState;
  private saveTimer: NodeJS.Timeout | null = null;
  private saveDirty = false;
  private saveInflight: Promise<void> | null = null;
  private static readonly SAVE_DEBOUNCE_MS = 200;

  private constructor(
    private readonly owner: WhatsAppOwner,
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoUtil,
    state: PersistedState,
  ) {
    this.state = state;
  }

  static async carregar(
    owner: WhatsAppOwner,
    prisma: PrismaService,
    encryptionKey: string,
  ): Promise<WhatsAppAuthState> {
    const crypto = new CryptoUtil(encryptionKey);
    const cifrado = await WhatsAppAuthState.lerCifrado(owner, prisma);
    let state: PersistedState;
    if (cifrado) {
      try {
        const raw = crypto.decrypt(cifrado);
        state = JSON.parse(raw, BufferJSON.reviver) as PersistedState;
        if (!state.keys) state.keys = {};
        if (!state.creds) state.creds = initAuthCreds();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        new Logger(WhatsAppAuthState.name).warn(
          `Auth state corrompido pra ${ownerKey(owner)} (${msg}) — inicializando novo`,
        );
        state = { creds: initAuthCreds(), keys: {} };
      }
    } else {
      state = { creds: initAuthCreds(), keys: {} };
    }
    return new WhatsAppAuthState(owner, prisma, crypto, state);
  }

  /** Apaga as credenciais persistidas (logout). */
  async limpar(): Promise<void> {
    this.cancelarTimer();
    this.state = { creds: initAuthCreds(), keys: {} };
    if (this.owner.type === 'EMPRESA') {
      await this.prisma.integracaoConexao.deleteMany({
        where: { empresaId: this.owner.id, servico: 'whatsapp' },
      });
    } else {
      await this.prisma.usuarioIntegracao.deleteMany({
        where: { usuarioId: this.owner.id, servico: 'whatsapp' },
      });
    }
  }

  /** Force flush qualquer save pendente. */
  async flush(): Promise<void> {
    this.cancelarTimer();
    if (this.saveDirty || this.saveInflight) {
      await this.persistir();
    }
  }

  /** Estrutura compatível com o que `makeWASocket` espera em `auth`. */
  build(): { state: AuthenticationState; saveCreds: () => Promise<void> } {
    const keysStore: SignalKeyStore = {
      get: async (type, ids) => {
        const bucket = (this.state.keys[type] ?? {}) as Record<string, unknown>;
        const out: Record<string, unknown> = {};
        for (const id of ids) {
          if (id in bucket) out[id] = bucket[id];
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return out as any;
      },
      set: async (data) => {
        for (const cat of Object.keys(data) as Array<keyof SignalDataTypeMap>) {
          const entries = data[cat];
          if (!entries) continue;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const bucket = (this.state.keys[cat] ??= {} as any) as Record<string, unknown>;
          for (const id of Object.keys(entries)) {
            const value = (entries as Record<string, unknown>)[id];
            if (value === null || value === undefined) {
              delete bucket[id];
            } else {
              bucket[id] = value;
            }
          }
        }
        this.agendarSave();
      },
      clear: async () => {
        this.state.keys = {};
        this.agendarSave();
      },
    };

    return {
      state: { creds: this.state.creds, keys: keysStore },
      saveCreds: async () => {
        // creds são mutados in-place pelo Baileys; basta agendar persist
        this.agendarSave();
      },
    };
  }

  // ─── persistência interna ────────────────────────────────────────────

  private static async lerCifrado(
    owner: WhatsAppOwner,
    prisma: PrismaService,
  ): Promise<string | null> {
    if (owner.type === 'EMPRESA') {
      const conn = await prisma.integracaoConexao.findUnique({
        where: { empresaId_servico: { empresaId: owner.id, servico: 'whatsapp' } },
      });
      return (conn?.credenciais as unknown as string) ?? null;
    }
    const conn = await prisma.usuarioIntegracao.findUnique({
      where: { usuarioId_servico: { usuarioId: owner.id, servico: 'whatsapp' } },
    });
    return (conn?.credenciais as unknown as string) ?? null;
  }

  private agendarSave(): void {
    this.saveDirty = true;
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      void this.persistir().catch((err) => {
        const m = err instanceof Error ? err.message : String(err);
        this.logger.warn(`Falha persistindo auth state pra ${ownerKey(this.owner)}: ${m}`);
      });
    }, WhatsAppAuthState.SAVE_DEBOUNCE_MS);
  }

  private cancelarTimer(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
  }

  private async persistir(): Promise<void> {
    if (this.saveInflight) {
      await this.saveInflight;
      if (!this.saveDirty) return;
    }
    this.saveDirty = false;
    const json = JSON.stringify(this.state, BufferJSON.replacer);
    const enc = this.crypto.encrypt(json);

    if (this.owner.type === 'EMPRESA') {
      this.saveInflight = this.prisma.integracaoConexao
        .upsert({
          where: { empresaId_servico: { empresaId: this.owner.id, servico: 'whatsapp' } },
          update: { credenciais: enc, ativo: true, errosRecentes: 0 },
          create: {
            empresaId: this.owner.id,
            servico: 'whatsapp',
            ativo: true,
            credenciais: enc,
          },
        })
        .then(() => undefined);
    } else {
      this.saveInflight = this.prisma.usuarioIntegracao
        .upsert({
          where: { usuarioId_servico: { usuarioId: this.owner.id, servico: 'whatsapp' } },
          update: { credenciais: enc, ativo: true, errosRecentes: 0 },
          create: {
            usuarioId: this.owner.id,
            servico: 'whatsapp',
            ativo: true,
            credenciais: enc,
          },
        })
        .then(() => undefined);
    }

    try {
      await this.saveInflight;
    } finally {
      this.saveInflight = null;
    }
    if (this.saveDirty) this.agendarSave();
  }
}
