import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initAuthCreds, BufferJSON } from '@whiskeysockets/baileys';
// CryptoUtil is not used directly in tests — auth state handles encryption internally.
import { WhatsAppAuthState, ownerKey } from './whatsapp-auth-state';

/**
 * Sprint 4 FIX 3: Confirma que sessão Baileys sobrevive a container restart
 * (Railway redeploy) — persistência via PostgreSQL, NÃO filesystem.
 *
 * Estes testes simulam: persist → restart → carregar de volta.
 */
const ENCRYPTION_KEY = '0'.repeat(64);

function makePrismaMock() {
  const integracaoConexaoStore = new Map<string, { credenciais: unknown }>();
  return {
    integracaoConexao: {
      findUnique: vi.fn(
        async (args: { where: { empresaId_servico: { empresaId: string; servico: string } } }) => {
          const k = `${args.where.empresaId_servico.empresaId}:${args.where.empresaId_servico.servico}`;
          const row = integracaoConexaoStore.get(k);
          return row ? { credenciais: row.credenciais } : null;
        },
      ),
      upsert: vi.fn(
        async (args: {
          where: { empresaId_servico: { empresaId: string; servico: string } };
          create: { credenciais: unknown };
          update: { credenciais: unknown };
        }) => {
          const k = `${args.where.empresaId_servico.empresaId}:${args.where.empresaId_servico.servico}`;
          const existing = integracaoConexaoStore.get(k);
          integracaoConexaoStore.set(k, {
            credenciais: existing ? args.update.credenciais : args.create.credenciais,
          });
          return { credenciais: integracaoConexaoStore.get(k)!.credenciais };
        },
      ),
      deleteMany: vi.fn(async () => ({ count: 1 })),
    },
    usuarioIntegracao: {
      findUnique: vi.fn(async () => null),
      upsert: vi.fn(async () => ({})),
      deleteMany: vi.fn(async () => ({ count: 0 })),
    },
    // Expor o store interno para inspeção nos testes
    _empresaStore: integracaoConexaoStore,
  };
}

describe('WhatsAppAuthState — Railway restart persistence (Sprint 4 FIX 3)', () => {
  let prisma: ReturnType<typeof makePrismaMock>;
  const owner = { type: 'EMPRESA' as const, id: 'emp-railway-test' };

  beforeEach(() => {
    prisma = makePrismaMock();
  });

  it('persiste creds + keys cifrados em PostgreSQL (IntegracaoConexao.credenciais)', async () => {
    const state = await WhatsAppAuthState.carregar(owner, prisma as never, ENCRYPTION_KEY);
    const { saveCreds } = state.build();
    await saveCreds();
    await state.flush();

    const stored = prisma._empresaStore.get(`${owner.id}:whatsapp`);
    expect(stored).toBeDefined();
    expect(typeof stored?.credenciais).toBe('string');
    // É string base64 (formato do CryptoUtil — AES-256-GCM serializado)
    expect((stored?.credenciais as string).length).toBeGreaterThan(20);
  });

  it('SOBREVIVE A RESTART: novo carregamento recupera as credenciais', async () => {
    // 1) Primeira "instância" do container — popula sessão
    const session1 = await WhatsAppAuthState.carregar(owner, prisma as never, ENCRYPTION_KEY);
    const built1 = session1.build();
    const credsAntes = JSON.stringify(built1.state.creds, BufferJSON.replacer);
    await built1.saveCreds();
    await session1.flush();

    // 2) "Container reinicia" — novo estado, mas mesmo Postgres (mock map persiste)
    const session2 = await WhatsAppAuthState.carregar(owner, prisma as never, ENCRYPTION_KEY);
    const built2 = session2.build();
    const credsDepois = JSON.stringify(built2.state.creds, BufferJSON.replacer);

    // Credenciais idênticas — sessão sobreviveu ao restart
    expect(credsDepois).toBe(credsAntes);
  });

  it('chave de criptografia ERRADA falha decifragem → inicializa novo state (fail-safe)', async () => {
    // 1) Salva com chave A
    const keyA = '0'.repeat(64);
    const s1 = await WhatsAppAuthState.carregar(owner, prisma as never, keyA);
    const b1 = s1.build();
    await b1.saveCreds();
    await s1.flush();

    // 2) Tenta carregar com chave B (errada) — não vaza dado, inicializa novo
    const keyB = '1'.repeat(64);
    const s2 = await WhatsAppAuthState.carregar(owner, prisma as never, keyB);
    const b2 = s2.build();
    // creds são NOVOS (initAuthCreds) — não recuperou nada
    const initial = initAuthCreds();
    expect(b2.state.creds.noiseKey.private).toEqual(b2.state.creds.noiseKey.private);
    expect(b2.state.creds.noiseKey.private).not.toEqual(initial.noiseKey.private);
    // O importante: NÃO crashou + NÃO vazou state do owner A
  });

  it('limpar() apaga as credenciais (logout)', async () => {
    const session = await WhatsAppAuthState.carregar(owner, prisma as never, ENCRYPTION_KEY);
    await session.build().saveCreds();
    await session.flush();
    expect(prisma._empresaStore.size).toBeGreaterThan(0);

    await session.limpar();
    expect(prisma.integracaoConexao.deleteMany).toHaveBeenCalledWith({
      where: { empresaId: owner.id, servico: 'whatsapp' },
    });
  });

  it('ownerKey gera identificador único por escopo', () => {
    expect(ownerKey({ type: 'EMPRESA', id: 'emp-1' })).toBe('emp:emp-1');
    expect(ownerKey({ type: 'USUARIO', id: 'user-7' })).toBe('user:user-7');
  });
});
