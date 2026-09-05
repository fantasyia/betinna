import { describe, expect, it } from 'vitest';
import { faseDaComissao, rotuloDaFase, vencimentoDia5 } from './fase-comissao.util';

describe('faseDaComissao', () => {
  it('sem conta no ERP: aguardando envio (venda ainda não expedida)', () => {
    expect(faseDaComissao({ valor: 10 })).toBe('AGUARDANDO_ENVIO');
  });

  it('com conta no ERP: a pagar', () => {
    expect(faseDaComissao({ valor: 10, contaPagarErpId: '123' })).toBe('A_PAGAR');
  });

  it('conta baixada: paga', () => {
    expect(faseDaComissao({ valor: 10, contaPagarErpId: '123', pagoEm: new Date() })).toBe('PAGA');
  });

  it('cancelamento ZERA a linha mas mantém o id da conta — não pode virar "a pagar"', () => {
    // A API do Tiny não apaga conta: o cancelamento zera o valor aqui e deixa o
    // marcador CANCELADA lá. Sem a ordem certa, isto apareceria como a receber.
    expect(faseDaComissao({ valor: 0, contaPagarErpId: '123' })).toBe('CANCELADA');
  });

  it('pedido cancelado com linha ainda não zerada também é cancelada', () => {
    expect(faseDaComissao({ valor: 10, origemCancelada: true })).toBe('CANCELADA');
  });

  it('paga GANHA de cancelada — o dinheiro já saiu, o extrato não pode mentir', () => {
    expect(
      faseDaComissao({
        valor: 0,
        contaPagarErpId: '123',
        pagoEm: new Date(),
        origemCancelada: true,
      }),
    ).toBe('PAGA');
  });

  describe('locação', () => {
    it('mês sem mensalidade recebida: aguardando mensalidade', () => {
      expect(faseDaComissao({ valor: 12.1, mensalidadeRecebidaEm: null })).toBe(
        'AGUARDANDO_MENSALIDADE',
      );
    });

    it('mensalidade recebida, conta ainda não criada: aguardando envio (provisão)', () => {
      expect(faseDaComissao({ valor: 12.1, mensalidadeRecebidaEm: new Date() })).toBe(
        'AGUARDANDO_ENVIO',
      );
    });

    it('mensalidade recebida + conta criada: a pagar', () => {
      expect(
        faseDaComissao({ valor: 12.1, mensalidadeRecebidaEm: new Date(), contaPagarErpId: '9' }),
      ).toBe('A_PAGAR');
    });
  });
});

describe('rotuloDaFase', () => {
  it('a pagar mostra o dia do vencimento', () => {
    expect(rotuloDaFase('A_PAGAR', '2026-10-05')).toBe('A pagar em 05/10');
  });

  it('a pagar sem data não inventa uma', () => {
    expect(rotuloDaFase('A_PAGAR')).toBe('A pagar');
  });

  it('demais fases', () => {
    expect(rotuloDaFase('PAGA')).toBe('Paga');
    expect(rotuloDaFase('CANCELADA')).toBe('Cancelada');
    expect(rotuloDaFase('AGUARDANDO_MENSALIDADE')).toBe('Aguardando mensalidade');
    expect(rotuloDaFase('AGUARDANDO_ENVIO')).toBe('Aguardando envio');
  });
});

describe('vencimentoDia5', () => {
  it('mês normal', () => {
    expect(vencimentoDia5(9, 2026)).toBe('2026-10-05');
  });

  it('dezembro vira janeiro do ano seguinte', () => {
    expect(vencimentoDia5(12, 2026)).toBe('2027-01-05');
  });
});
