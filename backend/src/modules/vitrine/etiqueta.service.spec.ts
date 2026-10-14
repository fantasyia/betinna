import { describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { EtiquetaService, type EstadoEtiqueta } from './etiqueta.service';
import { faltandoNoRemetente, pecasPorCaixa, umaCaixaPorEnvio } from './frete';

/** Etiqueta do Melhor Envio pelo pedido (Léo, 11/10). */

const remetente = {
  nome: 'Ribelt Têxtil Ltda',
  cnpj: '31.183.032/0001-01',
  telefone: '(11) 93380-9738',
  email: 'contato@ribelt.com.br',
  cep: '07631-480',
  endereco: 'Rua das Fábricas',
  numero: '100',
  bairro: 'Centro',
  cidade: 'Mairiporã',
  uf: 'SP',
};
const cfg = {
  ativo: true,
  ambiente: 'sandbox' as const,
  cepOrigem: '07631480',
  pesoMaxVolumeKg: 25,
  embalagemIndividual: {
    nome: 'Embalagem individual',
    comprimentoCm: 36,
    larguraCm: 26,
    alturaCm: 3,
    pesoVazioG: 50,
    capacidadePecas: 1,
  },
  caixas: [
    {
      nome: 'Caixa grande',
      comprimentoCm: 50,
      larguraCm: 50,
      alturaCm: 38,
      pesoVazioG: 1000,
      capacidadePecas: 75,
    },
  ],
  remetente,
};

function pedido(entregaExtra: Record<string, unknown> = {}, transportadora = 'Jadlog') {
  return {
    id: 'ped-1',
    numero: 'PED-0010',
    status: 'PAGO',
    empresaId: 'emp-1',
    cliente: {
      nome: 'Loja da Ana',
      cnpj: '123.456.789-09',
      email: 'ana@x.com',
      telefone: '(21) 99999-1111',
    },
    itens: [
      { quantidade: 60, total: new Prisma.Decimal(1139.4), produto: { nome: 'Bermuda Bege M' } },
      { quantidade: 40, total: new Prisma.Decimal(759.6), produto: { nome: 'Bermuda Preta G' } },
    ],
    entrega: {
      cep: '20040-020',
      endereco: 'Av. Rio Branco',
      numero: '1',
      bairro: 'Centro',
      cidade: 'Rio de Janeiro',
      uf: 'RJ',
      servico: { id: 3, nome: '.Package', transportadora },
      valor: 120,
      volumes: [
        { embalagem: 'Caixa grande', pecas: 75, pesoKg: 22 },
        { embalagem: 'Caixa grande', pecas: 25, pesoKg: 8 },
      ],
      ...entregaExtra,
    },
  };
}

function montar(p = pedido(), mudaTrava = 1) {
  let estado: EstadoEtiqueta | undefined = (p.entrega as { etiqueta?: EstadoEtiqueta }).etiqueta;
  const me = {
    adicionarAoCarrinho: vi.fn().mockImplementation(async () => ({
      id: `ord-${me.adicionarAoCarrinho.mock.calls.length}`,
      precoC: 6000,
    })),
    comprar: vi.fn().mockResolvedValue({ totalC: 12345 }),
    gerar: vi
      .fn()
      .mockImplementation(async (ids: string[]) =>
        ids.map((id) => ({ id, ok: true, mensagem: 'ok' })),
      ),
    imprimir: vi.fn().mockResolvedValue('https://sandbox.melhorenvio.com.br/imprimir/abc'),
    pdfs: vi.fn(),
  };
  const executeRaw = vi
    .fn()
    .mockImplementation(async (sql: TemplateStringsArray, ...vals: unknown[]) => {
      const texto = sql.join('?');
      if (texto.includes(`NOT ("entrega" ? 'etiqueta')`)) return mudaTrava;
      if (texto.includes(`- 'etiqueta'`)) estado = undefined;
      else if (texto.includes('jsonb_set'))
        estado = JSON.parse(vals[0] as string) as EstadoEtiqueta;
      return 1;
    });
  const prisma = {
    pedido: {
      findFirst: vi.fn().mockImplementation(async () => ({
        ...p,
        entrega: { ...p.entrega, ...(estado ? { etiqueta: estado } : {}) },
      })),
    },
    $executeRaw: executeRaw,
  };
  const frete = { paraEtiqueta: vi.fn().mockResolvedValue({ me, cfg }) };
  class Teste extends EtiquetaService {
    protected override esperar() {
      return Promise.resolve(undefined);
    }
  }
  const svc = new Teste(prisma as never, frete as never);
  const user = { id: 'u1', empresaIdAtiva: 'emp-1', empresaIds: ['emp-1'] } as never;
  return { svc, me, prisma, user, estado: () => estado };
}

describe('EtiquetaService.imprimir', () => {
  it('1º clique: carrinho → compra → gera → imprime, e devolve o link', async () => {
    const { svc, me, user, estado } = montar();
    const r = await svc.imprimir(user, 'ped-1');
    expect(me.adicionarAoCarrinho).toHaveBeenCalledTimes(1); // Jadlog: um envio com as 2 caixas
    expect(me.comprar).toHaveBeenCalledWith(['ord-1']);
    expect(me.gerar).toHaveBeenCalledWith(['ord-1']);
    expect(r).toEqual({
      url: 'https://sandbox.melhorenvio.com.br/imprimir/abc',
      etiquetas: 1,
      totalC: 12345,
      reimpressao: false,
    });
    expect(estado()).toMatchObject({ ids: ['ord-1'], totalC: 12345 });
    expect(estado()?.compradaEm).toBeTruthy();
  });

  it('⚠️ 2º clique REIMPRIME: não põe no carrinho nem compra de novo', async () => {
    const { svc, me, user } = montar();
    await svc.imprimir(user, 'ped-1');
    const r = await svc.imprimir(user, 'ped-1');
    expect(me.adicionarAoCarrinho).toHaveBeenCalledTimes(1);
    expect(me.comprar).toHaveBeenCalledTimes(1);
    expect(me.imprimir).toHaveBeenCalledTimes(2);
    expect(r.reimpressao).toBe(true);
  });

  it('falhou na geração: o próximo clique continua de onde parou (sem comprar outra vez)', async () => {
    const { svc, me, user } = montar();
    me.gerar.mockResolvedValueOnce([
      { id: 'ord-1', ok: false, mensagem: 'transportadora fora do ar' },
    ]);
    await expect(svc.imprimir(user, 'ped-1')).rejects.toThrow(/não cobra outra vez/);
    await svc.imprimir(user, 'ped-1');
    expect(me.comprar).toHaveBeenCalledTimes(1);
    expect(me.gerar).toHaveBeenCalledTimes(2);
  });

  it('dois cliques ao mesmo tempo: a trava barra o segundo antes do carrinho', async () => {
    const { svc, me, user } = montar(pedido(), 0);
    await expect(svc.imprimir(user, 'ped-1')).rejects.toThrow(/já está sendo emitida/);
    expect(me.adicionarAoCarrinho).not.toHaveBeenCalled();
  });

  it('carrinho falhou: solta a trava (o próximo clique tenta de novo) e não compra', async () => {
    const { svc, me, user, estado } = montar();
    me.adicionarAoCarrinho.mockRejectedValueOnce(new Error('CEP inválido'));
    await expect(svc.imprimir(user, 'ped-1')).rejects.toThrow(/CEP inválido/);
    expect(estado()).toBeUndefined();
    expect(me.comprar).not.toHaveBeenCalled();
  });

  it('Correios com 2 caixas: 2 envios, cada um com 1 caixa e as peças DELA declaradas', async () => {
    const { svc, me, user } = montar(pedido({}, 'Correios'));
    await svc.imprimir(user, 'ped-1');
    expect(me.adicionarAoCarrinho).toHaveBeenCalledTimes(2);
    const [a, b] = me.adicionarAoCarrinho.mock.calls.map((c) => c[0]);
    expect(a.volumes).toHaveLength(1);
    expect(b.volumes).toHaveLength(1);
    const pecas = (e: { products: Array<{ quantity: string }> }) =>
      e.products.reduce((s, p) => s + Number(p.quantity), 0);
    expect([pecas(a), pecas(b)]).toEqual([75, 25]);
    expect(me.comprar).toHaveBeenCalledWith(['ord-1', 'ord-2']);
  });

  it('declaração de conteúdo: non_commercial, sem nota e sem inscrição; valor = soma dos produtos', async () => {
    const { svc, me, user } = montar();
    await svc.imprimir(user, 'ped-1');
    const e = me.adicionarAoCarrinho.mock.calls[0][0];
    expect(e.options).toMatchObject({ non_commercial: true, insurance_value: 1899 });
    expect(e.options.invoice).toBeUndefined();
    expect(e.from).toMatchObject({
      company_document: '31183032000101',
      state_register: '',
      postal_code: '07631480',
    });
    expect(e.to).toMatchObject({
      document: '12345678909',
      company_document: '',
      postal_code: '20040020',
      state_abbr: 'RJ',
    });
    expect(e.service).toBe(3);
  });

  it('recusa sem pagamento, retirada, frete a combinar ou cliente sem CPF/CNPJ', async () => {
    const naoPago = montar({ ...pedido(), status: 'RASCUNHO' } as ReturnType<typeof pedido>);
    await expect(naoPago.svc.imprimir(naoPago.user, 'ped-1')).rejects.toThrow(/pago/);
    const ret = montar(pedido({ retirada: true }));
    await expect(ret.svc.imprimir(ret.user, 'ped-1')).rejects.toThrow(/retirada/);
    const comb = montar(pedido({ freteAConfirmar: true, servico: undefined }));
    await expect(comb.svc.imprimir(comb.user, 'ped-1')).rejects.toThrow(/a combinar/);
    const semDoc = montar({
      ...pedido(),
      cliente: { ...pedido().cliente, cnpj: null },
    } as unknown as ReturnType<typeof pedido>);
    await expect(semDoc.svc.imprimir(semDoc.user, 'ped-1')).rejects.toThrow(/CPF\/CNPJ/);
    expect(semDoc.me.comprar).not.toHaveBeenCalled();
  });
});

describe('frete — peças da etiqueta', () => {
  it('umaCaixaPorEnvio: Correios, J&T e Loggi; Jadlog não', () => {
    expect(umaCaixaPorEnvio('Correios')).toBe(true);
    expect(umaCaixaPorEnvio('J&T Express')).toBe(true);
    expect(umaCaixaPorEnvio('Loggi')).toBe(true);
    expect(umaCaixaPorEnvio('Jadlog')).toBe(false);
  });

  it('pecasPorCaixa: cada caixa leva as próximas N peças, agrupadas por produto', () => {
    const r = pecasPorCaixa(
      [
        { nome: 'A', quantidade: 3, unitarioC: 100 },
        { nome: 'B', quantidade: 2, unitarioC: 200 },
      ],
      [{ pecas: 4 }, { pecas: 1 }],
    );
    expect(r).toEqual([
      [
        { nome: 'A', quantidade: 3, unitarioC: 100 },
        { nome: 'B', quantidade: 1, unitarioC: 200 },
      ],
      [{ nome: 'B', quantidade: 1, unitarioC: 200 }],
    ]);
  });

  it('faltandoNoRemetente lista o que falta; completo = vazio', () => {
    expect(faltandoNoRemetente(remetente)).toEqual([]);
    expect(faltandoNoRemetente({ ...remetente, cnpj: '123', uf: '' })).toEqual(['CNPJ', 'UF']);
    expect(faltandoNoRemetente(null)).toHaveLength(10);
  });
});

/** Etiqueta sem login (14/10): todas as etiquetas do pedido num PDF só. */
describe('EtiquetaService.pdf', () => {
  const umPdf = async (txt: string) => {
    const { PDFDocument } = await import('pdf-lib');
    const d = await PDFDocument.create();
    d.addPage().drawText(txt);
    return Buffer.from(await d.save());
  };

  it('2 caixas = 2 etiquetas = 1 PDF com 2 páginas, com o nome do pedido', async () => {
    const { svc, me, user } = montar(
      pedido({ etiqueta: { ids: ['o1', 'o2'], geradaEm: '2026-10-14T18:00:00Z' } }),
    );
    me.pdfs.mockResolvedValue([await umPdf('1'), await umPdf('2')]);
    const r = await svc.pdf(user, 'ped-1');
    expect(me.pdfs).toHaveBeenCalledWith(['o1', 'o2']);
    const { PDFDocument } = await import('pdf-lib');
    expect((await PDFDocument.load(r.conteudo)).getPageCount()).toBe(2);
    expect(r.nome).toMatch(/^etiqueta-.+\.pdf$/);
  });

  it('ainda não emitida: recusa (não compra nada por aqui)', async () => {
    const { svc, me, user } = montar();
    await expect(svc.pdf(user, 'ped-1')).rejects.toThrow(/ainda não foi emitida/);
    expect(me.pdfs).not.toHaveBeenCalled();
    expect(me.comprar).not.toHaveBeenCalled();
  });
});
