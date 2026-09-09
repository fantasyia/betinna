import { describe, expect, it, vi } from 'vitest';
import { ContratosService } from './contratos.service';

/**
 * Faltava a ponte entre "mudar a regra" e "aplicar a regra".
 *
 * A regra de comissão da locação vive em `Empresa.config.comissoes.locacao` e
 * muda sem deploy — mas contrato existente só recalculava quando a NF de
 * comodato chegava, e isso acontece UMA vez na vida do contrato. Resultado: o
 * Léo trocou 5/5/5 por 5/5/10 e o contrato que já existia continuou pagando o
 * antigo, sem nada indicando isso.
 *
 * Trocar uma porcentagem e nada mudar é pior que não poder trocar: parece que
 * aplicou.
 */
const build = (achaContrato = true) => {
  const prisma = {
    contrato: {
      findFirst: vi.fn().mockResolvedValue(achaContrato ? { id: 'ctr-1' } : null),
    },
    contratoComissao: { count: vi.fn().mockResolvedValue(3) },
  };
  const comissoes = { recalcular: vi.fn().mockResolvedValue(undefined) };
  const svc = new ContratosService(
    prisma as never,
    // O construtor monta um client do Supabase Storage; sem URL/chave ele
    // estoura antes de qualquer teste rodar.
    { get: (k: string) => (k === 'SUPABASE_URL' ? 'https://x.supabase.co' : 'chave') } as never,
    {} as never,
    comissoes as never,
  );
  return { svc, prisma, comissoes };
};

describe('recalcular comissões de um contrato', () => {
  it('recalcula e devolve quantas linhas ficaram', async () => {
    const { svc, comissoes } = build();

    await expect(svc.recalcularComissoes('emp-1', 'ctr-1')).resolves.toEqual({
      contratoId: 'ctr-1',
      linhas: 3,
    });
    expect(comissoes.recalcular).toHaveBeenCalledWith('ctr-1');
  });

  it('contrato de OUTRA empresa não recalcula', async () => {
    // Recalcular contrato alheio mexeria em dinheiro que não é de quem pediu.
    const { svc, comissoes } = build(false);

    await expect(svc.recalcularComissoes('emp-1', 'ctr-de-outro')).rejects.toThrow();
    expect(comissoes.recalcular).not.toHaveBeenCalled();
  });

  it('o filtro do banco casa contrato E empresa', async () => {
    const { svc, prisma } = build();

    await svc.recalcularComissoes('emp-1', 'ctr-1');

    expect(prisma.contrato.findFirst.mock.calls[0][0].where).toEqual({
      id: 'ctr-1',
      empresaId: 'emp-1',
    });
  });
});
