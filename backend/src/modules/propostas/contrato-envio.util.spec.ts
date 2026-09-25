import { describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import PizZip from 'pizzip';
import {
  comSkus,
  montarContratoParaAssinar,
  telefoneDeAssinatura,
  type PropostaParaEnvio,
} from './contrato-envio.util';

const BASE: PropostaParaEnvio = {
  id: 'prop1',
  numero: 'PROP-0042',
  valor: new Prisma.Decimal(4350),
  modalidade: 'LOCACAO',
  prazoMeses: 60,
  diaVencimento: 5,
  carenciaMeses: 1,
  signatarioNome: 'Marina Torres Aguiar',
  signatarioEmail: 'marina@exemplo.com.br',
  signatarioTelefone: '(11) 99999-8888',
  validoAte: new Date('2026-10-24T12:00:00Z'),
  prazoEntregaDias: 10,
  prazoInstalacaoDias: 15,
  prazoVerificacaoDias: 5,
  prazoSoftwareDias: 20,
  servicosTotal: new Prisma.Decimal(9000),
  customizacaoUnitario: new Prisma.Decimal(1500),
  customizacaoQuantidade: 1,
  itens: [
    {
      quadroPainel: 'QGBT',
      tensaoV: 220,
      correnteA: 105,
      quantidade: 1,
      total: new Prisma.Decimal(4350),
      sku: 'MB-04_D.S.',
    },
  ],
  cliente: {
    nome: 'Indústria Exemplo Ltda',
    email: 'contato@exemplo.com.br',
    cnpj: '12345678000190',
    telefone: '(11) 3333-4444',
    endereco: 'Rua das Turbinas',
    numero: '100',
    complemento: null,
    bairro: 'Distrito',
    cidade: 'São Paulo',
    uf: 'SP',
  },
};

describe('montarContratoParaAssinar', () => {
  it('monta o envelope da proposta completa', () => {
    const r = montarContratoParaAssinar(BASE);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.dados.titulo).toBe('Proposta-Contrato PROP-0042 — Indústria Exemplo Ltda');
    // O metadata volta no webhook — é o que liga a assinatura ao contrato daqui.
    expect(r.dados.metadata).toEqual({ proposta: 'PROP-0042', proposta_id: 'prop1' });
    expect(r.dados.cliente.nome).toBe('Marina Torres Aguiar');
  });

  it('RECUSA sem prazo ou dia de vencimento em vez de inventar', () => {
    // São termo comercial: um default sairia impresso num documento que alguém
    // assina, e ninguém saberia que o número veio do sistema.
    expect(montarContratoParaAssinar({ ...BASE, prazoMeses: null })).toEqual({
      ok: false,
      motivo: 'faltam o prazo em meses e/ou o dia de vencimento na proposta',
    });
    expect(montarContratoParaAssinar({ ...BASE, diaVencimento: null }).ok).toBe(false);
  });

  it('RECUSA sem signatário — a razão social não serve como nome', () => {
    const r = montarContratoParaAssinar({ ...BASE, signatarioNome: '   ' });
    expect(r).toEqual({ ok: false, motivo: 'sem signatário definido' });
  });

  it('cai pro e-mail do cliente quando a proposta não tem um', () => {
    const r = montarContratoParaAssinar({ ...BASE, signatarioEmail: null });
    expect(r.ok && r.dados.cliente.email).toBe('contato@exemplo.com.br');
  });

  it('manda o DOCUMENTO pronto (.docx do Anexo I), não variáveis de modelo', () => {
    const r = montarContratoParaAssinar(BASE, { criadoEm: new Date(2026, 8, 24) });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.dados.variaveis).toBeUndefined();
    expect(r.dados.documento?.nome).toBe('PROP-0042.docx');
    const xml = new PizZip(r.dados.documento!.arquivo).file('word/document.xml')!.asText();
    expect(xml).toContain('Indústria Exemplo Ltda');
    expect(xml).toContain('QGBT');
    expect(xml).not.toContain('{{');
  });

  it('RECUSA listando o que falta do documento — nunca manda com lacuna', () => {
    const r = montarContratoParaAssinar({
      ...BASE,
      servicosTotal: null,
      prazoVerificacaoDias: null,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.motivo).toMatch(/^falta na proposta: /);
    expect(r.motivo).toContain('prazo de verificação de funcionamento');
    expect(r.motivo).toContain('valor total de instalação, materiais e customização');
  });

  it('modelo que não fecha com os dados vira MOTIVO, não exceção', () => {
    const r = montarContratoParaAssinar(BASE, { modelo: Buffer.from('não é docx') });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.motivo).toMatch(/modelo do contrato não pôde ser preenchido/);
  });

  it('RECUSA venda avulsa — não gera contrato recorrente', () => {
    expect(montarContratoParaAssinar({ ...BASE, modalidade: 'VENDA' })).toEqual({
      ok: false,
      motivo: 'a proposta não é de locação',
    });
  });
});

describe('telefoneDeAssinatura', () => {
  it('normaliza pra dígitos com DDI', () => {
    expect(telefoneDeAssinatura('(11) 99999-8888')).toBe('5511999998888');
    expect(telefoneDeAssinatura('5511999998888')).toBe('5511999998888');
  });

  it('usa o 1º candidato preenchido', () => {
    expect(telefoneDeAssinatura(null, '  ', '(11) 3333-4444')).toBe('551133334444');
  });

  it('devolve undefined quando não dá número válido — a assinatura cai pro e-mail', () => {
    expect(telefoneDeAssinatura(null, undefined, '')).toBeUndefined();
    expect(telefoneDeAssinatura('123')).toBeUndefined();
  });
});

describe('comSkus', () => {
  it('completa o SKU de cada item a partir do produto — é ele que diz modelo e acompanhamento', async () => {
    const prisma = {
      produto: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'p1', sku: 'MB-04_D.S.' },
          { id: 'p2', sku: 'MB-02' },
        ]),
      },
    };
    const { itens, ...resto } = BASE;
    const r = await comSkus(prisma, {
      ...resto,
      itens: [
        { ...itens[0], produtoId: 'p1' },
        { ...itens[0], produtoId: 'p2' },
        { ...itens[0], produtoId: 'p1' },
      ].map(({ sku: _sku, ...i }) => i),
    });
    expect(r.itens.map((i) => i.sku)).toEqual(['MB-04_D.S.', 'MB-02', 'MB-04_D.S.']);
    // Uma consulta só, sem repetir id.
    expect(prisma.produto.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.produto.findMany.mock.calls[0][0].where.id.in).toEqual(['p1', 'p2']);
  });

  it('produto apagado vira sku null — a montagem recusa (modelo faltando), não inventa', async () => {
    const prisma = { produto: { findMany: vi.fn().mockResolvedValue([]) } };
    const { itens, ...resto } = BASE;
    const r = await comSkus(prisma, {
      ...resto,
      itens: [{ ...itens[0], produtoId: 'sumiu' }].map(({ sku: _sku, ...i }) => i),
    });
    expect(r.itens[0].sku).toBeNull();
    expect(montarContratoParaAssinar(r)).toMatchObject({ ok: false });
  });
});
