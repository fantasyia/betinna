import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { ContratoReenvioService, type EnvioAssinatura } from './contrato-reenvio.service';
import { carregarModelo } from '@modules/propostas/contrato-documento.util';

/** Uma proposta de locação completa — o caso em que o reenvio DEVE sair. */
const PROPOSTA = {
  id: 'prop1',
  numero: 'PROP-0042',
  valor: new Prisma.Decimal(4350),
  modalidade: 'LOCACAO',
  prazoMeses: 60,
  diaVencimento: 5,
  signatarioNome: 'Marina Torres Aguiar',
  signatarioEmail: 'marina@exemplo.com.br',
  signatarioTelefone: '11999998888',
  // Documento único (Anexo I, 24/09): o que a montagem exige além do contrato v4.
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
      produtoId: 'prod-mb04',
      quadroPainel: 'QGBT',
      tensaoV: 220,
      correnteA: 105,
      quantidade: 1,
      total: new Prisma.Decimal(4350),
    },
  ],
  cliente: {
    nome: 'Indústria Exemplo Ltda',
    email: 'contato@exemplo.com.br',
    cnpj: '12345678000190',
    telefone: '1133334444',
    endereco: 'Rua das Turbinas',
    numero: '100',
    complemento: null,
    bairro: 'Distrito',
    cidade: 'São Paulo',
    uf: 'SP',
  },
};

const CONTRATO = {
  id: 'c1',
  status: 'AGUARDANDO_ASSINATURA',
  assinaturaId: 'env-velho',
  assinaturaDocumentoId: 'doc-velho',
  assinaturaUrl: 'https://app.clicksign.com/velho',
  assinadoEm: null,
  enviosAssinatura: null,
  proposta: PROPOSTA,
};

function montar(contrato: Record<string, unknown> | null = CONTRATO) {
  const prisma = {
    contrato: {
      findFirst: vi.fn().mockResolvedValue(contrato),
      update: vi.fn().mockResolvedValue({}),
    },
    // O SKU diz o modelo e o acompanhamento do quadro no documento.
    produto: { findMany: vi.fn().mockResolvedValue([{ id: 'prod-mb04', sku: 'MB-04_D.S.' }]) },
  };
  const clicksign = {
    expirarEnvelope: vi.fn().mockResolvedValue(true),
    enviarParaAssinatura: vi.fn().mockResolvedValue({
      envelopeId: 'env-novo',
      documentoId: 'doc-novo',
      signatarios: [],
    }),
  };
  // Modelo EM USO: default = o padrão do app (nenhuma versão ativa).
  const modelos = {
    emUso: vi.fn().mockResolvedValue({ arquivo: carregarModelo(), versao: null }),
  };
  const svc = new ContratoReenvioService(
    prisma as never,
    clicksign as never,
    modelos as never,
  ) as ContratoReenvioService;
  return { svc, prisma, clicksign, modelos };
}

const CHAMADA = {
  empresaId: 'e1',
  contratoId: 'c1',
  usuarioId: 'u1',
  motivo: 'cláusula 7 alterada',
};

describe('ContratoReenvioService', () => {
  beforeEach(() => vi.clearAllMocks());

  it('expira o envelope anterior ANTES de criar o novo', async () => {
    const { svc, clicksign } = montar();
    await svc.reenviar(CHAMADA);

    expect(clicksign.expirarEnvelope).toHaveBeenCalledWith('e1', 'env-velho');
    // A ordem é o ponto: se o novo sair primeiro, existe uma janela com DOIS
    // links válidos e o cliente pode assinar a versão que pediu pra mudar.
    const ordemExpirar = clicksign.expirarEnvelope.mock.invocationCallOrder[0];
    const ordemEnviar = clicksign.enviarParaAssinatura.mock.invocationCallOrder[0];
    expect(ordemExpirar).toBeLessThan(ordemEnviar);
  });

  it('grava a rodada nova e marca a anterior como substituída', async () => {
    const { svc, prisma } = montar();
    const r = await svc.reenviar(CHAMADA);

    expect(r).toMatchObject({ envelopeId: 'env-novo', documentoId: 'doc-novo', rodada: 2 });
    const dados = prisma.contrato.update.mock.calls[0][0].data;
    expect(dados.assinaturaId).toBe('env-novo');
    // O link antigo apontava pro documento substituído — deixá-lo faria a tela
    // do contrato oferecer justamente a versão recusada.
    expect(dados.assinaturaUrl).toBeNull();

    const rastro = dados.enviosAssinatura as EnvioAssinatura[];
    expect(rastro).toHaveLength(2);
    // A 1ª rodada nasceu no aceite, antes do rastro existir: ela é recuperada
    // dos campos do contrato pra não sumir do histórico.
    expect(rastro[0]).toMatchObject({ envelopeId: 'env-velho', desfecho: 'substituido' });
    expect(rastro[1]).toMatchObject({
      envelopeId: 'env-novo',
      desfecho: 'enviado',
      porUsuarioId: 'u1',
      motivo: 'cláusula 7 alterada',
    });
  });

  it('acumula rodadas e rebaixa TODAS as anteriores', async () => {
    const anterior: EnvioAssinatura[] = [
      {
        envelopeId: 'env-1',
        documentoId: 'doc-1',
        url: null,
        enviadoEm: '2026-09-01T00:00:00.000Z',
        porUsuarioId: null,
        motivo: 'envio inicial (aceite da proposta)',
        desfecho: 'substituido',
      },
      {
        envelopeId: 'env-velho',
        documentoId: 'doc-velho',
        url: null,
        enviadoEm: '2026-09-10T00:00:00.000Z',
        porUsuarioId: 'u9',
        motivo: 'prazo de pagamento',
        desfecho: 'enviado',
      },
    ];
    const { svc, prisma } = montar({ ...CONTRATO, enviosAssinatura: anterior });
    const r = await svc.reenviar(CHAMADA);

    expect(r.rodada).toBe(3);
    const rastro = prisma.contrato.update.mock.calls[0][0].data
      .enviosAssinatura as EnvioAssinatura[];
    expect(rastro.map((e) => e.desfecho)).toEqual(['substituido', 'substituido', 'enviado']);
    // Nada do que já estava lá é reescrito além do desfecho.
    expect(rastro[1].motivo).toBe('prazo de pagamento');
  });

  it('RECUSA contrato já assinado — seria aditivo, não reenvio', async () => {
    const { svc, clicksign } = montar({ ...CONTRATO, status: 'ASSINADO' });
    await expect(svc.reenviar(CHAMADA)).rejects.toThrow(/ADITIVO/);
    expect(clicksign.enviarParaAssinatura).not.toHaveBeenCalled();
    // Nem expirar: o envelope assinado é o documento que vincula.
    expect(clicksign.expirarEnvelope).not.toHaveBeenCalled();
  });

  it('RECUSA pelo fato (assinadoEm) mesmo com o status atrasado', async () => {
    // Webhook em voo ou ajuste manual: o status ficou pra trás, mas o cliente
    // já assinou. O fato manda.
    const { svc, clicksign } = montar({
      ...CONTRATO,
      status: 'AGUARDANDO_ASSINATURA',
      assinadoEm: new Date('2026-09-15T12:00:00Z'),
    });
    await expect(svc.reenviar(CHAMADA)).rejects.toThrow(/ADITIVO/);
    expect(clicksign.enviarParaAssinatura).not.toHaveBeenCalled();
  });

  it('RECUSA proposta sem signatário em vez de mandar contrato pela metade', async () => {
    const { svc, clicksign } = montar({
      ...CONTRATO,
      proposta: {
        ...PROPOSTA,
        signatarioNome: null,
        cliente: { ...PROPOSTA.cliente, email: null },
      },
    });
    await expect(svc.reenviar(CHAMADA)).rejects.toThrow(/signatário/);
    // E não mata o envelope que o cliente tem em mãos por causa de um envio que
    // não vai acontecer.
    expect(clicksign.expirarEnvelope).not.toHaveBeenCalled();
  });

  it('404 quando o contrato é de outra empresa', async () => {
    const { svc, clicksign } = montar(null);
    await expect(svc.reenviar(CHAMADA)).rejects.toThrow(/não encontrado/);
    expect(clicksign.enviarParaAssinatura).not.toHaveBeenCalled();
  });

  it('segue em frente quando a ClickSign não conseguiu expirar, mas AVISA', async () => {
    const { svc, clicksign } = montar();
    clicksign.expirarEnvelope.mockResolvedValue(false);
    const r = await svc.reenviar(CHAMADA);
    // Não bloqueia: o contrato novo é o que vale comercialmente. Mas o chamador
    // recebe o aviso de que o link antigo pode continuar de pé.
    expect(r.anteriorExpirado).toBe(false);
    expect(clicksign.enviarParaAssinatura).toHaveBeenCalled();
  });

  it('histórico vem do mais recente pro mais antigo', async () => {
    const envios: EnvioAssinatura[] = [
      {
        envelopeId: 'env-1',
        documentoId: 'doc-1',
        url: null,
        enviadoEm: '2026-09-01T00:00:00.000Z',
        porUsuarioId: null,
        motivo: null,
        desfecho: 'substituido',
      },
      {
        envelopeId: 'env-2',
        documentoId: 'doc-2',
        url: null,
        enviadoEm: '2026-09-10T00:00:00.000Z',
        porUsuarioId: 'u9',
        motivo: null,
        desfecho: 'enviado',
      },
    ];
    const { svc } = montar({ ...CONTRATO, enviosAssinatura: envios });
    expect((await svc.historico('e1', 'c1')).map((e) => e.envelopeId)).toEqual(['env-2', 'env-1']);
  });

  it('aguenta rastro corrompido no banco sem derrubar o reenvio', async () => {
    // JSON de banco não tem tipo garantido: um valor escrito à mão no painel
    // não pode impedir o contrato de ir pro cliente.
    const { svc, prisma } = montar({ ...CONTRATO, enviosAssinatura: 'lixo' });
    await svc.reenviar(CHAMADA);
    const rastro = prisma.contrato.update.mock.calls[0][0].data
      .enviosAssinatura as EnvioAssinatura[];
    expect(rastro).toHaveLength(2);
    expect(rastro[1].envelopeId).toBe('env-novo');
  });
});

/** O modelo subido pela tela (24/09): qual versão saiu fica no rastro. */
describe('ContratoReenvioService — modelo do contrato em uso', () => {
  beforeEach(() => vi.clearAllMocks());

  it('registra no rastro QUAL versão do modelo saiu neste envio', async () => {
    const { svc, prisma, modelos } = montar();
    modelos.emUso.mockResolvedValue({ arquivo: carregarModelo(), versao: 4 });

    await svc.reenviar(CHAMADA);

    const rastro = prisma.contrato.update.mock.calls[0][0].data
      .enviosAssinatura as EnvioAssinatura[];
    expect(rastro.at(-1)).toMatchObject({ desfecho: 'enviado', modeloVersao: 4 });
    expect(modelos.emUso).toHaveBeenCalledWith('e1');
  });

  it('modelo ativo ilegível RECUSA — e não mata o envelope que o cliente tem', async () => {
    // Cair pro padrão em silêncio mandaria um texto diferente do que o
    // diretor ativou.
    const { svc, clicksign, modelos } = montar();
    modelos.emUso.mockRejectedValue(new Error('Storage fora'));

    await expect(svc.reenviar(CHAMADA)).rejects.toThrow(
      /modelo de contrato ativo não pôde ser lido/,
    );
    expect(clicksign.expirarEnvelope).not.toHaveBeenCalled();
    expect(clicksign.enviarParaAssinatura).not.toHaveBeenCalled();
  });
});
