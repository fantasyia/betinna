import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TinyClientesSyncService } from './tiny-clientes-sync.service';

/**
 * Situação do cliente vinda do ERP — quem está bloqueado lá.
 *
 * O erro caro aqui tem nome: os códigos de situação do Tiny NÃO são intuitivos
 * (B = Ativo, A = Ativo com acesso, I = Inativo, E = Excluído). Ler "A = ativo"
 * marcaria como BLOQUEADO justamente os clientes normais — e o app passaria a
 * avisar bloqueio de quem está em dia.
 */
function build(contatos: Array<Record<string, unknown>>, clientes: Array<Record<string, unknown>>) {
  const client = { get: vi.fn().mockResolvedValue({ itens: contatos }) };
  const prisma = {
    cliente: {
      findMany: vi.fn().mockResolvedValue(clientes),
      update: vi.fn().mockResolvedValue({}),
    },
  };
  const notificacoes = {
    criarParaUsuario: vi.fn().mockResolvedValue({}),
    criarParaRole: vi.fn().mockResolvedValue(1),
  };
  const svc = new TinyClientesSyncService(prisma as never, client as never, notificacoes as never);
  return { svc, prisma, client, notificacoes };
}

const CLIENTE = {
  id: 'cli-1',
  nome: 'Indústria Alfa',
  cnpj: '12345678000190',
  codigoErp: '900',
  erpStatus: 'ATIVO',
  representanteId: 'rep-1',
};

describe('situação do cliente vinda do ERP', () => {
  beforeEach(() => vi.clearAllMocks());

  it('situação "B" é ATIVO (é o código normal, não bloqueio)', async () => {
    const { svc, prisma } = build(
      [{ id: 900, situacao: 'B' }],
      [{ ...CLIENTE, erpStatus: 'BLOQUEADO' }],
    );

    const r = await svc.sincronizar('emp-1');

    expect(prisma.cliente.update.mock.calls[0][0].data.erpStatus).toBe('ATIVO');
    expect(r.bloqueados).toBe(0);
  });

  it('situação "I" bloqueia e AVISA o rep dono da carteira', async () => {
    // Descobrir o bloqueio no pedido recusado, na frente do cliente, é o que
    // este aviso existe pra evitar.
    const { svc, prisma, notificacoes } = build([{ id: 900, situacao: 'I' }], [CLIENTE]);

    const r = await svc.sincronizar('emp-1');

    expect(prisma.cliente.update.mock.calls[0][0].data.erpStatus).toBe('BLOQUEADO');
    expect(notificacoes.criarParaUsuario).toHaveBeenCalled();
    expect(notificacoes.criarParaUsuario.mock.calls[0][0].usuarioId).toBe('rep-1');
    expect(r.bloqueados).toBe(1);
  });

  it('cliente sem rep: o aviso vai pra gestão, não some', async () => {
    const { svc, notificacoes } = build(
      [{ id: 900, situacao: 'E' }],
      [{ ...CLIENTE, representanteId: null }],
    );

    await svc.sincronizar('emp-1');

    expect(notificacoes.criarParaRole).toHaveBeenCalled();
  });

  it('casa por DOCUMENTO quando o cliente ainda não tem código do ERP — e grava o vínculo', async () => {
    const { svc, prisma, notificacoes } = build(
      [{ id: 901, cpfCnpj: '12.345.678/0001-90', situacao: 'B' }],
      [{ ...CLIENTE, codigoErp: null }],
    );

    const r = await svc.sincronizar('emp-1');

    expect(prisma.cliente.update.mock.calls[0][0].data.codigoErp).toBe('901');
    expect(r.vinculados).toBe(1);
    expect(notificacoes.criarParaUsuario).not.toHaveBeenCalled();
  });

  it('cliente que não existe no ERP fica como está — ausência não é bloqueio', async () => {
    // Bloquear por omissão travaria a venda de quem só não foi cadastrado ainda.
    const { svc, prisma } = build(
      [{ id: 999, situacao: 'B' }],
      [{ ...CLIENTE, codigoErp: null, cnpj: null }],
    );

    const r = await svc.sincronizar('emp-1');

    expect(prisma.cliente.update).not.toHaveBeenCalled();
    expect(r.atualizados).toBe(0);
  });

  it('status igual não vira escrita no banco', async () => {
    const { svc, prisma } = build([{ id: 900, situacao: 'A' }], [CLIENTE]);

    await svc.sincronizar('emp-1');

    expect(prisma.cliente.update).not.toHaveBeenCalled();
  });
});
