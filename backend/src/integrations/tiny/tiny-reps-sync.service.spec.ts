import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TinyRepsSyncService } from './tiny-reps-sync.service';

/**
 * Rep novo no app vira CONTATO no ERP — é o passo que permite marcá-lo como
 * vendedor lá e, daí em diante, o pedido dele voltar pro dono certo aqui.
 *
 * O que estes testes protegem é o silêncio: contato duplicado (que espalha
 * histórico e comissão) e rep sem documento sumindo sem ninguém saber.
 */
function build(
  reps: Array<Record<string, unknown>>,
  contatos: { achar?: number | null; criar?: number } = {},
) {
  const prisma = {
    usuario: {
      findMany: vi.fn().mockResolvedValue(reps),
      update: vi.fn().mockResolvedValue({}),
    },
  };
  const svcContatos = {
    achar: vi.fn().mockResolvedValue(contatos.achar ?? null),
    criar: vi.fn().mockResolvedValue(contatos.criar ?? 555),
  };
  const svc = new TinyRepsSyncService(prisma as never, svcContatos as never);
  return { svc, prisma, contatos: svcContatos };
}

const REP = {
  id: 'u-1',
  nome: 'Marcelo Harada',
  email: 'harada@ig.com.br',
  telefone: '11999990000',
  cpfCnpj: '52998224725',
};

describe('reps do app → contatos do ERP', () => {
  beforeEach(() => vi.clearAllMocks());

  it('cria o contato e GUARDA o vínculo', async () => {
    // Sem guardar o id, a rodada de amanhã procuraria de novo — e uma busca que
    // falhe cria o contato duplicado.
    const { svc, prisma, contatos } = build([REP]);

    const r = await svc.sincronizar('emp-1');

    expect(contatos.criar).toHaveBeenCalled();
    expect(prisma.usuario.update.mock.calls[0][0].data).toEqual({ contatoErpId: '555' });
    expect(r.criados).toBe(1);
  });

  it('contato que JÁ existe no ERP é reaproveitado, não duplicado', async () => {
    const { svc, prisma, contatos } = build([REP], { achar: 777 });

    const r = await svc.sincronizar('emp-1');

    expect(contatos.criar).not.toHaveBeenCalled();
    expect(prisma.usuario.update.mock.calls[0][0].data).toEqual({ contatoErpId: '777' });
    expect(r.jaExistiam).toBe(1);
  });

  it('rep SEM documento não sobe — e aparece no contador', async () => {
    // Sem CPF/CNPJ a deduplicação seria por nome, que é justamente como se
    // criam dois cadastros da mesma pessoa.
    const { svc, prisma, contatos } = build([{ ...REP, cpfCnpj: null }]);

    const r = await svc.sincronizar('emp-1');

    expect(contatos.criar).not.toHaveBeenCalled();
    expect(prisma.usuario.update).not.toHaveBeenCalled();
    expect(r.semDocumento).toBe(1);
  });

  it('documento com máscara é aceito (o rep digita com ponto e traço)', async () => {
    const { svc, contatos } = build([{ ...REP, cpfCnpj: '529.982.247-25' }]);

    await svc.sincronizar('emp-1');

    expect(contatos.criar.mock.calls[0][1].cpfCnpj).toBe('52998224725');
  });

  it('um rep que falha não trava a fila dos outros', async () => {
    const { svc, contatos } = build([REP, { ...REP, id: 'u-2', nome: 'Outro Rep' }]);
    contatos.criar.mockRejectedValueOnce(new Error('429 rate limit'));

    const r = await svc.sincronizar('emp-1');

    expect(r.erros).toBe(1);
    expect(r.criados).toBe(1);
  });

  it('só olha quem ainda não tem vínculo (a query não varre a base toda)', async () => {
    const { svc, prisma } = build([]);

    await svc.sincronizar('emp-1');

    const where = prisma.usuario.findMany.mock.calls[0][0].where;
    expect(where.contatoErpId).toBeNull();
    expect(where.role).toBe('REP');
  });
});
