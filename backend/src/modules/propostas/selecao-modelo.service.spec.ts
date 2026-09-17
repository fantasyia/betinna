import { describe, expect, it, vi } from 'vitest';
import { SelecaoModeloService } from './selecao-modelo.service';

/**
 * Seleção do Master Block pela CORRENTE medida no quadro — a régua da tabela
 * oficial do Leandro (2026). Os 12 modelos cobrem a mesma tensão (110–1100V) e
 * se diferenciam pela corrente de carga.
 *
 * ⛔ O que este serviço NÃO pode fazer é chutar. Modelo subdimensionado não
 * protege a instalação, e o prejuízo só aparece quando queima — por isso
 * corrente fora de faixa devolve motivo, nunca "o mais próximo".
 */
const LINHA = [
  { id: 'p1', sku: 'MB-01', nome: 'Master Block MB-01', correnteMinA: 1, correnteMaxA: 125 },
  { id: 'p2', sku: 'MB-02', nome: 'Master Block MB-02', correnteMinA: 126, correnteMaxA: 250 },
  { id: 'p3', sku: 'MB-03', nome: 'Master Block MB-03', correnteMinA: 251, correnteMaxA: 400 },
  { id: 'p12', sku: 'MB-12', nome: 'Master Block MB-12', correnteMinA: 3201, correnteMaxA: 6300 },
];

function build(catalogo = LINHA) {
  const prisma = { produto: { findMany: vi.fn().mockResolvedValue(catalogo) } };
  return { svc: new SelecaoModeloService(prisma as never), prisma };
}

describe('seleção do modelo pela corrente', () => {
  it.each([
    [50, 'MB-01'],
    [125, 'MB-01'],
    [126, 'MB-02'],
    [250, 'MB-02'],
    [251, 'MB-03'],
    [6300, 'MB-12'],
  ])('%iA → %s', async (correnteA, sku) => {
    const { svc } = build();
    const r = await svc.paraCorrente('emp-1', { correnteA });
    expect(r.ok && r.modelo.sku).toBe(sku);
  });

  /**
   * As BORDAS são o que importa aqui: 125 e 126 decidem entre dois modelos, e
   * errar por um ampère é entregar o equipamento errado. Por isso elas estão no
   * `it.each` acima em vez de só o meio da faixa.
   */
  it('a borda pertence à faixa de BAIXO, não à de cima', async () => {
    const { svc } = build();
    expect((await svc.paraCorrente('emp-1', { correnteA: 125 })).ok).toBe(true);
    const r = await svc.paraCorrente('emp-1', { correnteA: 125 });
    expect(r.ok && r.modelo.sku).toBe('MB-01');
  });

  /**
   * 🔴 Acima do teto da linha NÃO cai no maior modelo. É instalação que o
   * catálogo não atende — resposta comercial (projeto especial), não técnica.
   */
  it('acima da linha inteira: recusa com motivo, não devolve o MB-12', async () => {
    const { svc } = build();
    const r = await svc.paraCorrente('emp-1', { correnteA: 9000 });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.motivo).toBe('acima-da-linha');
  });

  /**
   * Buraco ENTRE faixas é outra coisa: não é instalação grande demais, é
   * cadastro com lacuna. Motivo separado porque o conserto é outro — juntos num
   * "não achei", ninguém sabe qual dos dois arrumar.
   */
  it('lacuna no cadastro tem motivo PRÓPRIO, separado de "acima da linha"', async () => {
    // Linha furada de propósito: nada cobre 126–250.
    const { svc } = build([LINHA[0], LINHA[2]]);
    const r = await svc.paraCorrente('emp-1', { correnteA: 200 });
    expect(!r.ok && r.motivo).toBe('sem-faixa-cadastrada');
  });

  it.each([0, -5, Number.NaN])('corrente inválida (%s) é recusada', async (correnteA) => {
    const { svc } = build();
    const r = await svc.paraCorrente('emp-1', { correnteA });
    expect(!r.ok && r.motivo).toBe('corrente-invalida');
  });

  it('catálogo sem faixa cadastrada não chuta', async () => {
    const { svc } = build([]);
    const r = await svc.paraCorrente('emp-1', { correnteA: 50 });
    expect(!r.ok && r.motivo).toBe('sem-faixa-cadastrada');
  });

  /** Só produto ATIVO e da empresa entra — seleção é multi-tenant como o resto. */
  it('consulta filtra por empresa e por ativo', async () => {
    const { svc, prisma } = build();
    await svc.paraCorrente('emp-1', { correnteA: 50 });
    expect(prisma.produto.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ empresaId: 'emp-1', ativo: true }),
      }),
    );
  });
});
