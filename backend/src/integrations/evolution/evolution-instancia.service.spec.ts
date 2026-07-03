import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EvolutionInstanciaService } from './evolution-instancia.service';

const makePrisma = () => ({
  evolutionInstancia: {
    upsert: vi.fn().mockResolvedValue({}),
    deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
    findMany: vi.fn().mockResolvedValue([]),
  },
  usuario: { findUnique: vi.fn(), findMany: vi.fn().mockResolvedValue([]) },
});

const makeEvolution = () => ({
  ativo: vi.fn().mockReturnValue(true),
  logout: vi.fn().mockResolvedValue(undefined),
  deletar: vi.fn().mockResolvedValue(undefined),
});

describe('EvolutionInstanciaService', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let evolution: ReturnType<typeof makeEvolution>;
  let svc: EvolutionInstanciaService;

  beforeEach(() => {
    prisma = makePrisma();
    evolution = makeEvolution();
    svc = new EvolutionInstanciaService(prisma as never, evolution as never);
  });

  it('emp_<id>: empresaId = id, usuarioId = null', async () => {
    await svc.sincronizarConexao('emp_emp-1', 'open', '5511999998888@s.whatsapp.net');
    expect(prisma.usuario.findUnique).not.toHaveBeenCalled(); // empresa não precisa resolver
    const arg = prisma.evolutionInstancia.upsert.mock.calls[0][0];
    expect(arg.where).toEqual({ instanceName: 'emp_emp-1' });
    expect(arg.create).toMatchObject({
      empresaId: 'emp-1',
      usuarioId: null,
      connectionStatus: 'open',
      ownerJid: '5511999998888@s.whatsapp.net',
    });
    expect(arg.update).toMatchObject({
      connectionStatus: 'open',
      ownerJid: '5511999998888@s.whatsapp.net',
    });
  });

  it('user_<id>: resolve empresa via usuario.empresas[0] e seta usuarioId', async () => {
    prisma.usuario.findUnique.mockResolvedValue({ empresas: [{ empresaId: 'emp-9' }] });
    await svc.sincronizarConexao('user_rep-1', 'connecting');
    expect(prisma.usuario.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'rep-1' } }),
    );
    const arg = prisma.evolutionInstancia.upsert.mock.calls[0][0];
    expect(arg.create).toMatchObject({
      empresaId: 'emp-9',
      usuarioId: 'rep-1',
      connectionStatus: 'connecting',
    });
    // sem ownerJid → não vai no update (não sobrescreve com null)
    expect(arg.update.ownerJid).toBeUndefined();
  });

  it('instanceName fora do padrão → no-op (não faz upsert)', async () => {
    await svc.sincronizarConexao('lixo', 'open');
    expect(prisma.evolutionInstancia.upsert).not.toHaveBeenCalled();
  });

  it('user sem empresa vinculada → no-op', async () => {
    prisma.usuario.findUnique.mockResolvedValue({ empresas: [] });
    await svc.sincronizarConexao('user_rep-x', 'open');
    expect(prisma.evolutionInstancia.upsert).not.toHaveBeenCalled();
  });

  it('best-effort: erro no prisma NÃO lança (não pode derrubar o webhook)', async () => {
    prisma.evolutionInstancia.upsert.mockRejectedValue(new Error('db down'));
    await expect(svc.sincronizarConexao('emp_emp-1', 'open')).resolves.toBeUndefined();
  });

  it('remover deleta por instanceName (best-effort)', async () => {
    await svc.remover('emp_emp-1');
    expect(prisma.evolutionInstancia.deleteMany).toHaveBeenCalledWith({
      where: { instanceName: 'emp_emp-1' },
    });
  });

  it('desativar (EMPRESA): logout + deletar no Evolution + remove o registro local', async () => {
    await svc.desativar({ type: 'EMPRESA', id: 'emp-1' });
    expect(evolution.logout).toHaveBeenCalledWith('emp_emp-1');
    expect(evolution.deletar).toHaveBeenCalledWith('emp_emp-1');
    expect(prisma.evolutionInstancia.deleteMany).toHaveBeenCalledWith({
      where: { instanceName: 'emp_emp-1' },
    });
  });

  it('desativar com provider != evolution: NÃO chama o Evolution, mas remove o registro local', async () => {
    evolution.ativo.mockReturnValue(false);
    await svc.desativar({ type: 'USUARIO', id: 'rep-1' });
    expect(evolution.logout).not.toHaveBeenCalled();
    expect(prisma.evolutionInstancia.deleteMany).toHaveBeenCalledWith({
      where: { instanceName: 'user_rep-1' },
    });
  });

  describe('listarDaEmpresa', () => {
    it('mapeia número da empresa + reps com nome, número e status', async () => {
      prisma.evolutionInstancia.findMany.mockResolvedValue([
        {
          instanceName: 'emp_e1',
          empresaId: 'e1',
          usuarioId: null,
          ownerJid: '5511000000000@s.whatsapp.net',
          connectionStatus: 'open',
          ultimoEventoEm: new Date('2026-01-01'),
        },
        {
          instanceName: 'user_u1',
          empresaId: 'e1',
          usuarioId: 'u1',
          ownerJid: null,
          connectionStatus: 'close',
          ultimoEventoEm: null,
        },
      ]);
      prisma.usuario.findMany.mockResolvedValue([{ id: 'u1', nome: 'Rep Ana', email: 'ana@x.com' }]);

      const r = await svc.listarDaEmpresa('e1');

      expect(r).toHaveLength(2);
      expect(r.find((x) => x.tipo === 'empresa')).toMatchObject({
        nome: 'Número da empresa',
        numero: '5511000000000',
        conectado: true,
      });
      expect(r.find((x) => x.tipo === 'rep')).toMatchObject({
        nome: 'Rep Ana',
        email: 'ana@x.com',
        numero: null,
        conectado: false,
      });
    });

    it('sem instâncias → lista vazia (sem buscar usuários)', async () => {
      prisma.evolutionInstancia.findMany.mockResolvedValue([]);
      const r = await svc.listarDaEmpresa('e1');
      expect(r).toEqual([]);
      expect(prisma.usuario.findMany).not.toHaveBeenCalled();
    });
  });
});
