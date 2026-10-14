import { describe, expect, it } from 'vitest';
import { acabamentoPorPeca, idDoServico, servicosAcabamento } from './acabamento';

/** Acabamento da Isabela (Léo, 14/10): cordão, embalar, ilhós — R$ por peça. */
describe('acabamento', () => {
  const servicos = [
    { id: 'cordao', nome: 'Passar cordão', preco: 0.25 },
    { id: 'embalar', nome: 'Dobrar e embalar', preco: 0.25 },
    { id: 'ilhos', nome: 'Colocar 2 pares de ilhós', preco: 0.25 },
  ];

  it('soma os serviços marcados na grade; id que saiu da lista não conta', () => {
    expect(acabamentoPorPeca(['cordao', 'embalar', 'ilhos'], servicos)).toBeCloseTo(0.75, 6);
    expect(acabamentoPorPeca(['embalar', 'apagado'], servicos)).toBeCloseTo(0.25, 6);
    expect(acabamentoPorPeca(null, servicos)).toBe(0);
  });

  it('lê a lista da config da empresa (sem config = vazia)', () => {
    expect(servicosAcabamento({ acabamento: { servicos } })).toHaveLength(3);
    expect(servicosAcabamento(null)).toEqual([]);
  });

  it('id estável pelo nome, sem acento e sem repetir', () => {
    const usados = new Set<string>(['passar-cordao']);
    expect(idDoServico('Passar cordão', usados)).toBe('passar-cordao-2');
    expect(idDoServico('Colocar 2 pares de ilhós', usados)).toBe('colocar-2-pares-de-ilhos');
  });
});
