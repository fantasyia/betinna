import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PropostaAceiteService } from './proposta-aceite.service';
import { carregarModelo } from './contrato-documento.util';

/**
 * O link de aceite é o ponto ÚNICO por onde a proposta vai ao cliente (e-mail
 * e WhatsApp do rep usam o mesmo link). Regra do Léo (25/09): a locação não
 * sai sem TUDO o que o contrato exige, inclusive o celular de quem assina.
 * Antes o link só conferia o projeto anexado e o resto era descoberto no
 * aceite — o cliente aceitava e o contrato não saía.
 */

const COMPLETA = {
  id: 'prop-27',
  numero: 'PROP-0027',
  criadoEm: new Date('2026-09-25T15:00:00Z'),
  valor: 1528,
  modalidade: 'LOCACAO',
  signatarioNome: 'Marina Torres Aguiar',
  signatarioEmail: 'pedido@somatecblocking.com.br',
  signatarioTelefone: '+5511999998888',
  validoAte: new Date('2026-10-24T12:00:00Z'),
  prazoEntregaDias: 45,
  prazoInstalacaoDias: 15,
  prazoVerificacaoDias: 5,
  prazoSoftwareDias: 7,
  servicosTotal: 12000,
  customizacaoUnitario: 1500,
  customizacaoQuantidade: 1,
  itens: [
    {
      produtoId: 'prod-mb04',
      quadroPainel: 'QGBT',
      tensaoV: 380,
      correnteA: 420,
      quantidade: 1,
      total: 1528,
    },
  ],
  cliente: {
    nome: 'Indústria Teste Contrato Ltda',
    email: 'compras@exemplo.com.br',
    cnpj: '76851812000102',
    telefone: '1133334444',
    endereco: 'Avenida Paulista',
    numero: '1000',
    complemento: null,
    bairro: 'Bela Vista',
    cidade: 'São Paulo',
    uf: 'SP',
  },
};

function montar(proposta: Record<string, unknown>, anexos = 1) {
  const prisma = {
    propostaAnexo: { count: vi.fn().mockResolvedValue(anexos) },
    proposta: {
      findUnique: vi.fn().mockResolvedValue(proposta),
      update: vi.fn().mockResolvedValue({ clienteId: 'cli-1' }),
    },
    produto: { findMany: vi.fn().mockResolvedValue([{ id: 'prod-mb04', sku: 'MB-04_D.S.' }]) },
  };
  const etapa = { mover: vi.fn(async () => 'movido' as const) };
  const modelos = { emUso: vi.fn(async () => ({ arquivo: carregarModelo(), versao: 4 })) };
  const previa = {
    salvar: vi.fn(
      async (_e: string, _p: string, _a: Buffer, tipo = 'docx', rotulo = 'contrato') => ({
        path: tipo === 'docx' ? 'emp-1/prop-27/1.docx' : `emp-1/prop-27/1-${rotulo}.pdf`,
        sha256: tipo === 'docx' ? 'abc' : `hash-${rotulo}`,
      }),
    ),
  };
  const docxPdf = { converter: vi.fn(async () => Buffer.from('%PDF-1.7 contrato')) };
  const levantamentoPdf = { gerar: vi.fn(async () => Buffer.from('%PDF-1.7 levantamento')) };
  const svc = new PropostaAceiteService(
    prisma as never,
    { get: vi.fn(() => 'k'.repeat(64)) } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    etapa as never,
    {} as never,
    modelos as never,
    previa as never,
    levantamentoPdf as never,
    docxPdf as never,
  );
  return { svc, prisma, previa, levantamentoPdf, docxPdf };
}

describe('gerarLink — a proposta só vai ao cliente pronta pra virar contrato', () => {
  beforeEach(() => vi.clearAllMocks());

  it('completa: gera o link e muda o status', async () => {
    const { svc, prisma } = montar(COMPLETA);
    const r = await svc.gerarLink('prop-27', 'emp-1', 'RASCUNHO');
    expect(r.url).toContain('/proposta/aceite/');
    expect(prisma.proposta.update).toHaveBeenCalledTimes(1);
  });

  /** "O contrato é o mesmo" (Léo, 25/09): congela o .docx junto com o token. */
  it('congela o CONTRATO no link: guarda o .docx e grava caminho, hash e versão', async () => {
    const { svc, prisma, previa } = montar(COMPLETA);
    await svc.gerarLink('prop-27', 'emp-1', 'RASCUNHO');
    expect(previa.salvar).toHaveBeenCalledTimes(3); // contrato .docx + contrato .pdf + levantamento
    const [, , arquivo] = previa.salvar.mock.calls[0] as unknown as [string, string, Buffer];
    expect(arquivo.subarray(0, 2).toString()).toBe('PK'); // é um .docx de verdade
    expect(prisma.proposta.update.mock.calls[0][0].data).toMatchObject({
      contratoPreviaPath: 'emp-1/prop-27/1.docx',
      contratoPreviaSha256: 'abc',
      contratoPreviaModeloVersao: 4,
    });
  });

  it('não conseguiu guardar o contrato → NÃO gera o link (o aprovar não teria o mesmo arquivo)', async () => {
    const { svc, prisma, previa } = montar(COMPLETA);
    previa.salvar.mockRejectedValueOnce(new Error('storage fora'));
    await expect(svc.gerarLink('prop-27', 'emp-1', 'RASCUNHO')).rejects.toThrow();
    expect(prisma.proposta.update).not.toHaveBeenCalled();
  });

  it('🔴 completa MENOS o celular: recusa, diz o que falta e NÃO muda o status', async () => {
    const { svc, prisma } = montar({ ...COMPLETA, signatarioTelefone: null });
    await expect(svc.gerarLink('prop-27', 'emp-1', 'RASCUNHO')).rejects.toThrow(
      /celular de quem assina/,
    );
    expect(prisma.proposta.update).not.toHaveBeenCalled();
  });

  it('lista TUDO que falta de uma vez, na mesma mensagem', async () => {
    const { svc } = montar({
      ...COMPLETA,
      signatarioTelefone: null,
      validoAte: null,
      servicosTotal: null,
    });
    const erro = await svc.gerarLink('prop-27', 'emp-1', 'RASCUNHO').catch((e: Error) => e);
    expect(String((erro as Error).message)).toMatch(
      /celular de quem assina.*validade da proposta.*valor total de instalação/s,
    );
  });

  it('venda não passa pela checagem do contrato — não gera contrato', async () => {
    const { svc, prisma, previa } = montar({
      ...COMPLETA,
      modalidade: 'VENDA',
      signatarioTelefone: null,
    });
    await svc.gerarLink('prop-27', 'emp-1', 'RASCUNHO');
    expect(prisma.proposta.update).toHaveBeenCalledTimes(1);
    expect(previa.salvar).not.toHaveBeenCalled();
  });

  /** Léo, 25/09: trocar o token invalidava o link que o cliente já recebeu. */
  it('link VALENDO é reaproveitado: não troca o token, não congela outro contrato', async () => {
    const expiraEm = new Date(Date.now() + 86_400_000);
    const { svc, prisma, previa } = montar({
      ...COMPLETA,
      status: 'AGUARDANDO_ASSINATURA',
      aceiteToken: 'tok-vigente',
      aceiteExpiraEm: expiraEm,
    });
    const r = await svc.gerarLink('prop-27', 'emp-1', 'AGUARDANDO_ASSINATURA');
    expect(r.token).toBe('tok-vigente');
    expect(r.expiraEm).toBe(expiraEm);
    expect(prisma.proposta.update).not.toHaveBeenCalled();
    expect(previa.salvar).not.toHaveBeenCalled();
  });

  it('link VENCIDO ou proposta de volta a rascunho: gera link novo', async () => {
    const vencido = montar({
      ...COMPLETA,
      status: 'AGUARDANDO_ASSINATURA',
      aceiteToken: 'tok-velho',
      aceiteExpiraEm: new Date(Date.now() - 1000),
    });
    expect(
      (await vencido.svc.gerarLink('prop-27', 'emp-1', 'AGUARDANDO_ASSINATURA')).token,
    ).not.toBe('tok-velho');
    const rascunho = montar({
      ...COMPLETA,
      status: 'RASCUNHO',
      aceiteToken: 'tok-velho',
      aceiteExpiraEm: new Date(Date.now() + 86_400_000),
    });
    expect((await rascunho.svc.gerarLink('prop-27', 'emp-1', 'RASCUNHO')).token).not.toBe(
      'tok-velho',
    );
    expect(rascunho.prisma.proposta.update).toHaveBeenCalledTimes(1);
  });

  /** Léo, 25/09: o app GERA o levantamento; o rep não anexa mais nada. */
  it('sem anexo do rep: o link SAI — o levantamento é gerado pelo app', async () => {
    const { svc, prisma } = montar(COMPLETA, 0);
    await svc.gerarLink('prop-27', 'emp-1', 'RASCUNHO');
    expect(prisma.proposta.update).toHaveBeenCalledTimes(1);
  });

  it('congela o LEVANTAMENTO TÉCNICO DE PROJETO (PDF) junto com o contrato', async () => {
    const { svc, prisma, previa, levantamentoPdf } = montar(COMPLETA);
    await svc.gerarLink('prop-27', 'emp-1', 'RASCUNHO');
    // Gerado com os dados do resumo da proposta (os mesmos da página de aceite).
    const [emp, resumo] = levantamentoPdf.gerar.mock.calls[0] as unknown as [
      string,
      { numero: string; aluguelMensalTotal: number },
    ];
    expect(emp).toBe('emp-1');
    expect(resumo).toMatchObject({ numero: 'PROP-0027', aluguelMensalTotal: 1528 });
    const pdf = previa.salvar.mock.calls.find((c) => c[4] === 'levantamento');
    expect(String(pdf?.[2])).toContain('%PDF');
    expect(prisma.proposta.update.mock.calls[0][0].data).toMatchObject({
      levantamentoPdfPath: 'emp-1/prop-27/1-levantamento.pdf',
      levantamentoPdfSha256: 'hash-levantamento',
    });
  });

  /** Léo, 25/09: o cliente lê e assina o MESMO PDF — convertido aqui, uma vez. */
  it('congela o CONTRATO em PDF: converte o .docx montado e guarda com o hash', async () => {
    const { svc, prisma, previa, docxPdf } = montar(COMPLETA);
    await svc.gerarLink('prop-27', 'emp-1', 'RASCUNHO');
    const docx = previa.salvar.mock.calls.find((c) => c[3] === undefined || c[3] === 'docx');
    // O MESMO .docx guardado (mesma referência — comparar 1 MB byte a byte estoura o tempo).
    expect((docxPdf.converter.mock.calls[0] as unknown[])[0]).toBe(docx?.[2]);
    const pdf = previa.salvar.mock.calls.find((c) => c[3] === 'pdf' && c[4] === 'contrato');
    expect(String(pdf?.[2])).toContain('%PDF-1.7 contrato');
    expect(prisma.proposta.update.mock.calls[0][0].data).toMatchObject({
      contratoPdfPath: 'emp-1/prop-27/1-contrato.pdf',
      contratoPdfSha256: 'hash-contrato',
    });
  });

  it('Word → PDF falhou → NÃO sai link', async () => {
    const { svc, prisma, docxPdf } = montar(COMPLETA);
    docxPdf.converter.mockRejectedValueOnce(new Error('soffice fora'));
    await expect(svc.gerarLink('prop-27', 'emp-1', 'RASCUNHO')).rejects.toThrow();
    expect(prisma.proposta.update).not.toHaveBeenCalled();
  });

  it('levantamento não gerou → NÃO sai link', async () => {
    const { svc, prisma, levantamentoPdf } = montar(COMPLETA);
    levantamentoPdf.gerar.mockRejectedValueOnce(new Error('pdf quebrou'));
    await expect(svc.gerarLink('prop-27', 'emp-1', 'RASCUNHO')).rejects.toThrow();
    expect(prisma.proposta.update).not.toHaveBeenCalled();
  });
});
