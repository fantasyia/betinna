import { describe, expect, it, vi } from 'vitest';
import { ContratoComissoesService } from './contrato-comissoes.service';

/**
 * A regra da locação, textual (Léo, 09/09):
 * "5% pro Leonardo, 5% pro Harada e 10% pro representante, só isso, só essa regra".
 *
 * O que estava no ar não era isso. Medido no contrato de teste antes do
 * conserto: TRÊS pessoas a 5% — Leonardo, Harada e a conta ADMIN
 * `marketing@somatecblocking.com.br`, que não deveria receber nada e já tinha 4
 * linhas viradas em conta a pagar no ERP. E o representante recebia 5%, não 10%.
 *
 * A causa era o critério: "todo mundo com `comissaoPadrao > 0`". Participação é
 * de PESSOAS ESCOLHIDAS, não de quem por acaso tem um número preenchido num
 * campo que também significa outra coisa na comissão de venda.
 */
const REGRA = {
  representantePercentual: 10,
  participacao: [
    { usuarioId: 'leo', percentual: 5 },
    { usuarioId: 'harada', percentual: 5 },
  ],
};

const build = (
  over: { representanteId?: string | null; regra?: unknown; ativos?: string[] } = {},
) => {
  const criadas: Array<Record<string, unknown>> = [];
  const prisma = {
    contrato: {
      findUnique: vi.fn().mockResolvedValue({
        id: 'ctr-1',
        empresaId: 'emp-1',
        status: 'ATIVO',
        valorMensal: 1000,
        prazoMeses: 1,
        primeiraCobrancaEm: new Date('2026-09-01T00:00:00Z'),
        criadoEm: new Date('2026-09-01T00:00:00Z'),
        representanteId: over.representanteId === undefined ? 'anna' : over.representanteId,
      }),
    },
    empresa: {
      findUnique: vi.fn().mockResolvedValue({
        config: { comissoes: { locacao: over.regra === undefined ? REGRA : over.regra } },
      }),
    },
    usuario: {
      findMany: vi.fn().mockImplementation(async (args: { where: { id: { in: string[] } } }) => {
        const permitidos = over.ativos ?? ['leo', 'harada', 'anna'];
        return args.where.id.in.filter((id) => permitidos.includes(id)).map((id) => ({ id }));
      }),
    },
    contratoComissao: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockImplementation(async (a: { data: Record<string, unknown> }) => {
        criadas.push(a.data);
        return a.data;
      }),
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
  };
  const svc = new ContratoComissoesService(prisma as never);
  return { svc, prisma, criadas };
};

const resumo = (criadas: Array<Record<string, unknown>>) =>
  criadas.map((c) => `${String(c.usuarioId)}:${String(c.tipo)}:${String(c.percentual)}`).sort();

describe('comissão de locação — 5/5/10', () => {
  it('representante que NÃO tem participação recebe só os 10%', async () => {
    const { svc, criadas } = build({ representanteId: 'anna' });

    await svc.recalcular('ctr-1');

    expect(resumo(criadas)).toEqual(['anna:REP:10', 'harada:PARTICIPACAO:5', 'leo:PARTICIPACAO:5']);
  });

  it('quem é participante E representante recebe as DUAS — 5% + 10%', async () => {
    // Duas linhas, não uma de 15%: a chave única inclui o tipo justamente pra
    // isso. Com um tipo só, a segunda sobrescreveria a primeira e o Harada
    // receberia metade do combinado.
    const { svc, criadas } = build({ representanteId: 'harada' });

    expect(criadas.length).toBe(0);
    await svc.recalcular('ctr-1');

    expect(resumo(criadas)).toEqual([
      'harada:PARTICIPACAO:5',
      'harada:REP:10',
      'leo:PARTICIPACAO:5',
    ]);
  });

  it('contrato SEM representante segue pagando a participação', async () => {
    // A participação não depende de quem vendeu — é isso que a torna "fixa".
    const { svc, criadas } = build({ representanteId: null });

    await svc.recalcular('ctr-1');

    expect(resumo(criadas)).toEqual(['harada:PARTICIPACAO:5', 'leo:PARTICIPACAO:5']);
  });

  it('ninguém entra por ter `comissaoPadrao` preenchida', async () => {
    // Era exatamente esse o defeito: a conta ADMIN `marketing@` recebia 5% de
    // toda locação porque tinha um número no campo, e chegou a gerar 4 contas a
    // pagar no ERP. Agora só entra quem está NA REGRA.
    const { svc, prisma, criadas } = build();

    await svc.recalcular('ctr-1');

    // A busca de usuários filtra pelos ids da regra, não por percentual.
    const where = prisma.usuario.findMany.mock.calls[0][0].where as Record<string, unknown>;
    expect(where.comissaoPadrao).toBeUndefined();
    expect(criadas.some((c) => c.usuarioId === 'marketing')).toBe(false);
  });

  it('usuário DESLIGADO não recebe, mesmo estando na regra', async () => {
    const { svc, criadas } = build({ ativos: ['leo', 'anna'] });

    await svc.recalcular('ctr-1');

    expect(resumo(criadas)).toEqual(['anna:REP:10', 'leo:PARTICIPACAO:5']);
  });

  it('tenant SEM a regra configurada não comissiona nada', async () => {
    // Melhor contrato sem comissão (alguém nota e reclama) do que comissão
    // inventada por um default (ninguém nota e vira dinheiro pago errado).
    const { svc, criadas, prisma } = build({ regra: undefined, representanteId: 'anna' });
    prisma.empresa.findUnique.mockResolvedValue({ config: {} });

    await svc.recalcular('ctr-1');

    expect(criadas).toEqual([]);
  });
});
