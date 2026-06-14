import { describe, expect, it } from 'vitest';
import { OmieMapper } from './omie.mapper';
import type { OmieCliente, OmieProduto } from './omie.types';

describe('OmieMapper.clienteToPrismaUpsert', () => {
  const baseCliente: OmieCliente = {
    codigo_cliente_omie: 1001,
    razao_social: 'Empresa X LTDA',
    cnpj_cpf: '12.345.678/0001-90',
    email: 'a@b.com',
    telefone1_ddd: '11',
    telefone1_numero: '99999-1111',
    cidade: 'São Paulo',
    estado: 'SP',
    bloqueado: 'N',
    inativo: 'N',
  };

  it('retorna null quando codigo_cliente_omie ausente', () => {
    const r = OmieMapper.clienteToPrismaUpsert('emp-1', {
      ...baseCliente,
      codigo_cliente_omie: undefined,
    });
    expect(r).toBeNull();
  });

  it('mapeia ATIVO quando bloqueado=N', () => {
    const r = OmieMapper.clienteToPrismaUpsert('emp-1', baseCliente);
    expect(r).not.toBeNull();
    expect(r!.create.omieStatus).toBe('ATIVO');
    expect(r!.create.status).toBe('ATIVO');
  });

  it('mapeia BLOQUEADO quando bloqueado=S', () => {
    const r = OmieMapper.clienteToPrismaUpsert('emp-1', { ...baseCliente, bloqueado: 'S' });
    expect(r!.create.omieStatus).toBe('BLOQUEADO');
  });

  it('mapeia INATIVO quando inativo=S', () => {
    const r = OmieMapper.clienteToPrismaUpsert('emp-1', { ...baseCliente, inativo: 'S' });
    expect(r!.create.status).toBe('INATIVO');
  });

  it('preserva empresaId no payload (multi-tenant)', () => {
    const r = OmieMapper.clienteToPrismaUpsert('empresa-abc', baseCliente);
    expect(r!.create.empresaId).toBe('empresa-abc');
  });

  it('formata telefone com (DDD) número', () => {
    const r = OmieMapper.clienteToPrismaUpsert('emp-1', baseCliente);
    expect(r!.create.telefone).toBe('(11) 99999-1111');
  });

  it('converte codigo_cliente_omie pra string no upsert key (multi-tenant composite)', () => {
    const r = OmieMapper.clienteToPrismaUpsert('emp-1', baseCliente);
    expect(r!.where).toEqual({ empresaId_codigoOmie: { empresaId: 'emp-1', codigoOmie: '1001' } });
  });

  it('campos opcionais ausentes viram null', () => {
    const r = OmieMapper.clienteToPrismaUpsert('emp-1', {
      codigo_cliente_omie: 9,
      razao_social: 'Min',
      bloqueado: 'N',
    });
    expect(r!.create.cnpj).toBeNull();
    expect(r!.create.email).toBeNull();
    expect(r!.create.cidade).toBeNull();
  });
});

describe('OmieMapper.produtoToPrismaUpsert', () => {
  const baseProduto: OmieProduto = {
    codigo_produto: 2001,
    codigo: 'OLE-GIR-5L',
    descricao: 'Óleo de Girassol 5L',
    descricao_detalhada: 'Óleo refinado 5L',
    marca: 'Soya',
    unidade: 'UN',
    valor_unitario: 50,
    quantidade_estoque: 100,
    inativo: 'N',
  };

  it('retorna null quando codigo_produto ausente', () => {
    expect(
      OmieMapper.produtoToPrismaUpsert('emp-1', { ...baseProduto, codigo_produto: undefined }),
    ).toBeNull();
  });

  it('NÃO inventa custo: precoFabrica fica null no create (OMIE só manda preço de venda)', () => {
    const r = OmieMapper.produtoToPrismaUpsert('emp-1', baseProduto);
    expect(r!.create.precoTabela).toBe(50);
    expect(r!.create.precoFabrica).toBeNull();
  });

  it('NÃO sobrescreve custo no update (preserva o que foi definido à mão)', () => {
    const r = OmieMapper.produtoToPrismaUpsert('emp-1', baseProduto);
    expect(r!.update).not.toHaveProperty('precoFabrica');
  });

  it('marca ativo=false quando inativo=S', () => {
    const r = OmieMapper.produtoToPrismaUpsert('emp-1', { ...baseProduto, inativo: 'S' });
    expect(r!.create.ativo).toBe(false);
  });

  it('estoque ausente vira 0', () => {
    const r = OmieMapper.produtoToPrismaUpsert('emp-1', {
      ...baseProduto,
      quantidade_estoque: undefined,
    });
    expect(r!.create.estoque).toBe(0);
  });

  it('upsert key combina empresaId + codigoOmie (multi-tenant)', () => {
    const r = OmieMapper.produtoToPrismaUpsert('emp-1', baseProduto);
    expect(r!.where).toEqual({ empresaId_codigoOmie: { empresaId: 'emp-1', codigoOmie: '2001' } });
  });
});

describe('OmieMapper.pedidoItemToOmie', () => {
  it('usa codigo_produto quando codigoOmie disponível', () => {
    const r = OmieMapper.pedidoItemToOmie({
      produtoCodigoOmie: '2001',
      produtoSku: 'OLE-GIR-5L',
      quantidade: 10,
      precoUnitario: 50,
      desconto: 5,
    });
    expect(r.produto.codigo_produto).toBe(2001);
    expect(r.produto.codigo_produto_integracao).toBeUndefined();
    expect(r.produto.quantidade).toBe(10);
    expect(r.produto.valor_unitario).toBe(50);
    expect(r.produto.percentual_desconto).toBe(5);
  });

  it('cai pra codigo_produto_integracao (SKU) quando codigoOmie ausente', () => {
    const r = OmieMapper.pedidoItemToOmie({
      produtoCodigoOmie: null,
      produtoSku: 'OLE-GIR-5L',
      quantidade: 5,
      precoUnitario: 48,
      desconto: 0,
    });
    expect(r.produto.codigo_produto).toBeUndefined();
    expect(r.produto.codigo_produto_integracao).toBe('OLE-GIR-5L');
  });

  it('omite percentual_desconto quando 0', () => {
    const r = OmieMapper.pedidoItemToOmie({
      produtoCodigoOmie: '2001',
      produtoSku: 'X',
      quantidade: 1,
      precoUnitario: 10,
      desconto: 0,
    });
    expect(r.produto.percentual_desconto).toBeUndefined();
  });
});

describe('OmieMapper.dateToOmie / omieToDate', () => {
  it('converte Date pra dd/mm/aaaa', () => {
    // 2024-12-25 → 25/12/2024 (UTC, pra não depender do timezone do host)
    expect(OmieMapper.dateToOmie(new Date(Date.UTC(2024, 11, 25)))).toBe('25/12/2024');
  });

  it('zero-pad em dia/mês', () => {
    expect(OmieMapper.dateToOmie(new Date(Date.UTC(2025, 0, 5)))).toBe('05/01/2025');
  });

  it('parser aceita formato OMIE', () => {
    const d = OmieMapper.omieToDate('15/03/2026');
    expect(d).not.toBeNull();
    expect(d!.getUTCFullYear()).toBe(2026);
    expect(d!.getUTCMonth()).toBe(2);
    expect(d!.getUTCDate()).toBe(15);
  });

  it('parser retorna null quando formato inválido', () => {
    expect(OmieMapper.omieToDate('2024-12-25')).toBeNull();
    expect(OmieMapper.omieToDate(undefined)).toBeNull();
    expect(OmieMapper.omieToDate('')).toBeNull();
  });

  it('omieDateTimeToDate aceita só data (sem hora)', () => {
    const d = OmieMapper.omieDateTimeToDate('15/03/2026');
    expect(d).not.toBeNull();
    expect(d!.getUTCHours()).toBe(0);
  });

  it('omieDateTimeToDate aceita data + hora separadas', () => {
    const d = OmieMapper.omieDateTimeToDate('15/03/2026', '14:30:00');
    expect(d).not.toBeNull();
    expect(d!.getUTCHours()).toBe(14);
    expect(d!.getUTCMinutes()).toBe(30);
  });

  it('omieDateTimeToDate aceita formato combinado "dd/MM/yyyy HH:mm:ss"', () => {
    const d = OmieMapper.omieDateTimeToDate('15/03/2026 14:30:45');
    expect(d).not.toBeNull();
    expect(d!.getUTCHours()).toBe(14);
    expect(d!.getUTCSeconds()).toBe(45);
  });

  it('omieDateTimeToDate retorna null pra formato inválido', () => {
    expect(OmieMapper.omieDateTimeToDate('2026-03-15')).toBeNull();
    expect(OmieMapper.omieDateTimeToDate(undefined)).toBeNull();
  });

  it('round-trip dateToOmie → omieToDate preserva o dia (UTC)', () => {
    const original = new Date(Date.UTC(2026, 5, 14));
    const back = OmieMapper.omieToDate(OmieMapper.dateToOmie(original));
    expect(back!.getTime()).toBe(original.getTime());
  });
});
