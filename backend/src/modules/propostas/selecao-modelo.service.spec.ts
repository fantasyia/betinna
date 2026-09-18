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

/**
 * O CATÁLOGO REAL tem três produtos por faixa — o base, o `_D.S.` e o `_E.P.`
 * dividem a mesma corrente (conferido nos 36 cadastrados: 12 faixas, 3 SKUs
 * cada). O `LINHA` acima é uma simplificação e não exercita o desempate.
 *
 * 🔴 Antes da variante existir, o seletor fazia `find` e ficava com o primeiro
 * que o banco devolvesse. Os três são equipamentos legítimos pra aquela
 * corrente, com preços bem diferentes (MB-04 R$425, _E.P. R$729, _D.S. R$874
 * por mês) — então o rep podia receber o errado e nada acusava.
 */
const FAIXA_COMPLETA = [
  { id: 'b4', sku: 'MB-04', nome: 'Master Block MB-04', correnteMinA: 401, correnteMaxA: 500 },
  { id: 'd4', sku: 'MB-04_D.S.', nome: 'MB-04 Data Sense', correnteMinA: 401, correnteMaxA: 500 },
  { id: 'e4', sku: 'MB-04_E.P.', nome: 'MB-04 End Point', correnteMinA: 401, correnteMaxA: 500 },
];

describe('acompanhamento opcional — variante por quadro', () => {
  it.each([
    ['BASE', 'MB-04'],
    ['DATA_SENSE', 'MB-04_D.S.'],
    ['END_POINT', 'MB-04_E.P.'],
  ] as const)('420A + %s → %s', async (variante, sku) => {
    const { svc } = build(FAIXA_COMPLETA);
    const r = await svc.paraCorrente('emp-1', { correnteA: 420, variante });
    expect(r.ok && r.modelo.sku).toBe(sku);
  });

  it('sem pedir variante, vem o Master Block PURO', async () => {
    // Default seguro: errar pra cima poria no contrato um equipamento mais caro
    // que ninguém pediu.
    const { svc } = build(FAIXA_COMPLETA);
    const r = await svc.paraCorrente('emp-1', { correnteA: 420 });
    expect(r.ok && r.modelo.sku).toBe('MB-04');
  });

  it('a ORDEM do banco não decide a variante', async () => {
    // O mesmo catálogo embaralhado tem que dar o mesmo resultado. É o teste que
    // pega a volta do `find` arbitrário.
    const invertido = [...FAIXA_COMPLETA].reverse();
    const { svc } = build(invertido);
    const r = await svc.paraCorrente('emp-1', { correnteA: 420, variante: 'BASE' });
    expect(r.ok && r.modelo.sku).toBe('MB-04');
  });

  it('variante que não existe no catálogo RECUSA, não cai pro base', async () => {
    // Cair pro base entregaria um equipamento SEM acompanhamento a um cliente
    // que pediu acompanhamento — e ele só descobriria na instalação.
    const { svc } = build([FAIXA_COMPLETA[0]]);
    const r = await svc.paraCorrente('emp-1', { correnteA: 420, variante: 'DATA_SENSE' });
    expect(r).toEqual({ ok: false, motivo: 'variante-indisponivel' });
  });

  it('BASE é por exclusão: sufixo desconhecido não passa por Master Block puro', async () => {
    // Se amanhã entrar uma variante nova no catálogo, ela não pode ser servida
    // calada como se fosse o equipamento puro.
    const { svc } = build([
      {
        id: 'x4',
        sku: 'MB-04_X.Y.',
        nome: 'MB-04 variante nova',
        correnteMinA: 401,
        correnteMaxA: 500,
      },
      FAIXA_COMPLETA[1],
    ]);
    const r = await svc.paraCorrente('emp-1', { correnteA: 420, variante: 'BASE' });
    expect(r).toEqual({ ok: false, motivo: 'variante-indisponivel' });
  });

  it('acima da linha continua acima da linha, com ou sem acompanhamento', async () => {
    const { svc } = build(FAIXA_COMPLETA);
    const r = await svc.paraCorrente('emp-1', { correnteA: 7200, variante: 'DATA_SENSE' });
    expect(r).toEqual({ ok: false, motivo: 'acima-da-linha' });
  });
});
