import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import type { UserRole } from '@prisma/client';
import { BusinessRuleException, ForbiddenException } from '@shared/errors/app-exception';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { ContatosMesclagemService } from './contatos-mesclagem.service';

const user = (over: Partial<AuthenticatedUser> = {}): AuthenticatedUser => ({
  id: 'u1',
  email: 'u@x.com',
  nome: 'U',
  role: 'DIRECTOR' as UserRole,
  empresaIds: ['emp-1'],
  empresaIdAtiva: 'emp-1',
  ...over,
});

const cliVelho = {
  id: 'cli-velho',
  empresaId: 'emp-1',
  nome: 'ACME LTDA',
  cnpj: '11.222.333/0001-44',
  telefone: '11999990001',
  email: 'contato@acme.com',
  cidade: 'São Paulo',
  criadoEm: new Date('2026-01-01T00:00:00Z'),
  limiteCredito: new Prisma.Decimal(5000),
};
const cliNovo = {
  id: 'cli-novo',
  empresaId: 'emp-1',
  nome: 'Acme',
  cnpj: '11222333000144', // mesmo CNPJ, formato diferente
  telefone: null,
  email: null,
  cidade: null,
  criadoEm: new Date('2026-06-01T00:00:00Z'),
  limiteCredito: null,
};

const makePrisma = () => {
  const dep = () => ({
    findMany: vi.fn().mockResolvedValue([]),
    updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    count: vi.fn().mockResolvedValue(0),
    create: vi.fn().mockResolvedValue({}),
    delete: vi.fn().mockResolvedValue({}),
    findUnique: vi.fn().mockResolvedValue(null),
    upsert: vi.fn().mockResolvedValue({}),
    update: vi.fn().mockResolvedValue({}),
  });
  const modelos = [
    'pedido',
    'proposta',
    'amostra',
    'ocorrencia',
    'devolucao',
    'internalThread',
    'notaPrivada',
    'documento',
    'agendaItem',
    'campanhaDestinatario',
    'conversation',
    'marketplaceIncident',
    'respostaNPS',
    'movimentoFidelidade',
    'lead',
    'clienteTag',
    'clientePrecoEspecial',
    'saldoFidelidade',
    'cliente',
    'mesclagemContato',
  ];
  const tx: Record<string, ReturnType<typeof dep>> = {};
  for (const m of modelos) tx[m] = dep();
  tx.mesclagemContato.create.mockResolvedValue({ id: 'msc-1' });

  const prisma: Record<string, unknown> = {
    tx,
    cliente: {
      findMany: vi.fn().mockResolvedValue([cliNovo, cliVelho]),
      findUnique: vi.fn().mockResolvedValue(null),
    },
    pedido: { count: vi.fn().mockResolvedValue(3) },
    proposta: { count: vi.fn().mockResolvedValue(1) },
    amostra: { count: vi.fn().mockResolvedValue(0) },
    clientePrecoEspecial: { findMany: vi.fn().mockResolvedValue([]) },
    saldoFidelidade: { findUnique: vi.fn().mockResolvedValue(null) },
    mesclagemContato: { findFirst: vi.fn().mockResolvedValue(null) },
    $transaction: vi.fn(async (arg: unknown) =>
      typeof arg === 'function' ? (arg as (t: unknown) => unknown)(tx) : arg,
    ),
  };
  return prisma as typeof prisma & { tx: typeof tx };
};

describe('ContatosMesclagemService — Cliente + Cliente', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let svc: ContatosMesclagemService;

  beforeEach(() => {
    prisma = makePrisma();
    svc = new ContatosMesclagemService(prisma as never);
  });

  describe('permissão + guard de CNPJ', () => {
    it('GERENTE não mescla cliente (só ADMIN/DIRECTOR)', async () => {
      await expect(
        svc.mesclarClientes(user({ role: 'GERENTE' as UserRole }), 'cli-novo', 'cli-velho'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('CNPJ diferente = recusa (empresas distintas)', async () => {
      prisma.cliente.findMany.mockResolvedValue([{ ...cliNovo, cnpj: '99999999000199' }, cliVelho]);
      await expect(svc.mesclarClientes(user(), 'cli-novo', 'cli-velho')).rejects.toBeInstanceOf(
        BusinessRuleException,
      );
    });

    it('mesmo CNPJ com formatação diferente é aceito', async () => {
      const r = await svc.mesclarClientes(user(), 'cli-novo', 'cli-velho');
      expect(r.mesclagemId).toBe('msc-1');
    });

    it('um sem CNPJ é aceito', async () => {
      prisma.cliente.findMany.mockResolvedValue([{ ...cliNovo, cnpj: null }, cliVelho]);
      const r = await svc.mesclarClientes(user(), 'cli-novo', 'cli-velho');
      expect(r.mesclagemId).toBe('msc-1');
    });
  });

  describe('migração dos dependentes', () => {
    it('repointa pedido/proposta pro sobrevivente pelos IDS (pra poder desfazer)', async () => {
      prisma.tx.pedido.findMany.mockResolvedValue([{ id: 'ped-1' }, { id: 'ped-2' }]);

      await svc.mesclarClientes(user(), 'cli-novo', 'cli-velho');

      // Captura ids ANTES de mover.
      expect(prisma.tx.pedido.findMany).toHaveBeenCalledWith({
        where: { clienteId: 'cli-velho' },
        select: { id: true },
      });
      expect(prisma.tx.pedido.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['ped-1', 'ped-2'] } },
        data: { clienteId: 'cli-novo' },
      });
      expect(prisma.tx.cliente.delete).toHaveBeenCalledWith({ where: { id: 'cli-velho' } });
    });

    it('preço especial em conflito: sobrevivente vence (migra só produto novo)', async () => {
      prisma.tx.clientePrecoEspecial.findMany
        .mockResolvedValueOnce([
          { id: 'pe-1', produtoId: 'prod-A' },
          { id: 'pe-2', produtoId: 'prod-B' },
        ]) // do absorvido
        .mockResolvedValueOnce([{ produtoId: 'prod-A' }]); // do principal (já tem prod-A)

      await svc.mesclarClientes(user(), 'cli-novo', 'cli-velho');

      // prod-A é conflito → NÃO migra (sobrevivente vence); prod-B migra.
      expect(prisma.tx.clientePrecoEspecial.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['pe-2'] } },
        data: { clienteId: 'cli-novo' },
      });
    });

    it('SOMA os pontos de fidelidade no saldo do sobrevivente e apaga o do absorvido', async () => {
      prisma.tx.saldoFidelidade.findUnique.mockResolvedValue({
        clienteId: 'cli-velho',
        pontos: 120,
      });

      await svc.mesclarClientes(user(), 'cli-novo', 'cli-velho');

      expect(prisma.tx.saldoFidelidade.delete).toHaveBeenCalledWith({
        where: { clienteId: 'cli-velho' },
      });
      expect(prisma.tx.saldoFidelidade.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { clienteId: 'cli-novo' },
          update: { pontos: { increment: 120 } },
        }),
      );
    });
  });

  describe('desfazer', () => {
    it('recria o cliente com o MESMO id, devolve os deps e subtrai os pontos somados', async () => {
      prisma.mesclagemContato.findFirst.mockResolvedValue({
        id: 'msc-1',
        empresaId: 'emp-1',
        tipo: 'cliente_cliente',
        principalId: 'cli-novo',
        absorvidoId: 'cli-velho',
        desfeitaEm: null,
        snapshot: {
          absorvido: { ...cliVelho, criadoEm: '2026-01-01T00:00:00.000Z', limiteCredito: '5000' },
          principalAntes: {},
          migradosSimples: { pedido: ['ped-1', 'ped-2'], proposta: ['prop-1'] },
          tagsMigradas: ['tag-x'],
          tagsDescartadas: ['tag-y'],
          precoMigrado: ['pe-2'],
          precoDescartado: [
            {
              id: 'pe-1',
              clienteId: 'cli-velho',
              produtoId: 'prod-A',
              precoEspecial: '99.90',
              descontoBase: 0,
            },
          ],
          pontosAbsorvidos: 120,
        },
      });

      await svc.desfazer(user(), 'msc-1');

      // Cliente recriado com o mesmo id.
      expect(prisma.tx.cliente.create.mock.calls[0][0].data.id).toBe('cli-velho');
      // Pedidos voltam pelos ids exatos.
      expect(prisma.tx.pedido.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['ped-1', 'ped-2'] } },
        data: { clienteId: 'cli-velho' },
      });
      // Preço descartado é recriado; pontos somados são subtraídos.
      expect(prisma.tx.clientePrecoEspecial.create).toHaveBeenCalled();
      expect(prisma.tx.saldoFidelidade.update).toHaveBeenCalledWith({
        where: { clienteId: 'cli-novo' },
        data: { pontos: { decrement: 120 } },
      });
    });

    it('desfazer cliente exige ADMIN/DIRECTOR (GERENTE não)', async () => {
      prisma.mesclagemContato.findFirst.mockResolvedValue({
        id: 'msc-1',
        empresaId: 'emp-1',
        tipo: 'cliente_cliente',
        desfeitaEm: null,
        snapshot: {},
      });
      await expect(
        svc.desfazer(user({ role: 'GERENTE' as UserRole }), 'msc-1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('previa', () => {
    it('mostra dinheiro que migra + conflitos de preço, sem alterar nada', async () => {
      prisma.clientePrecoEspecial.findMany
        .mockResolvedValueOnce([{ produtoId: 'prod-A' }, { produtoId: 'prod-B' }]) // absorvido
        .mockResolvedValueOnce([{ produtoId: 'prod-A' }]); // principal
      prisma.saldoFidelidade.findUnique.mockResolvedValue({ pontos: 50 });

      const r = await svc.previaCliente(user(), 'cli-novo', 'cli-velho');

      expect(r.migra).toEqual({ pedidos: 3, propostas: 1, amostras: 0 });
      expect(r.conflitosPreco).toBe(1); // prod-A
      expect(r.pontosFidelidadeSomados).toBe(50);
      expect(prisma.tx.cliente.delete).not.toHaveBeenCalled();
    });
  });
});
