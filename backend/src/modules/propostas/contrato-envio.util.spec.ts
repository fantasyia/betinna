import { describe, expect, it } from 'vitest';
import { Prisma } from '@prisma/client';
import {
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
  signatarioNome: 'Marina Torres Aguiar',
  signatarioEmail: 'marina@exemplo.com.br',
  signatarioTelefone: '(11) 99999-8888',
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
