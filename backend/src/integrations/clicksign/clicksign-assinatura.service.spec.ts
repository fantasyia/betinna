import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ClickSignAssinaturaService } from './clicksign-assinatura.service';

// Storage e download do PDF ficam de fora: aqui o que importa é o que acontece
// no APP quando o contrato volta assinado.
const { mockUpload, mockCreateSignedUrl, mockListBuckets, mockCreateBucket } = vi.hoisted(() => ({
  mockUpload: vi.fn(async () => ({ error: null })),
  mockCreateSignedUrl: vi.fn(),
  mockListBuckets: vi.fn(async () => ({ data: [{ name: 'contratos-assinados' }] })),
  mockCreateBucket: vi.fn(),
}));
vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    storage: {
      listBuckets: mockListBuckets,
      createBucket: mockCreateBucket,
      from: vi.fn(() => ({ upload: mockUpload, createSignedUrl: mockCreateSignedUrl })),
    },
  })),
}));

const CONTRATO = {
  id: 'ct-1',
  empresaId: 'emp-1',
  clienteId: 'cli-1',
  representanteId: 'rep-1',
  status: 'AGUARDANDO_ASSINATURA',
  assinaturaUrl: null,
  documentoUrl: null,
  proposta: { id: 'prop-1', numero: 'PROP-0020', orcamentoErpId: null },
  cliente: { nome: 'INDÚSTRIA TESTE LTDA' },
};

const corpo = (extra: Record<string, unknown> = {}) =>
  Buffer.from(
    JSON.stringify({
      event: { name: 'document_closed' },
      document: {
        key: 'doc-1',
        status: 'closed',
        finished_at: '2026-09-04T16:13:30.000Z',
        downloads: { signed_file_url: 'https://arquivo/contrato.pdf' },
        ...extra,
      },
    }),
    'utf8',
  );

/** A API devolve o arquivo ora como URL completa, ora como caminho. */
const corpoComCaminhoRelativo = () =>
  Buffer.from(
    JSON.stringify({
      event: { name: 'document_closed' },
      document: {
        key: 'doc-1',
        status: 'closed',
        finished_at: '2026-09-04T16:13:30.000Z',
        downloads: { signed_file_url: '/2026/09/13/contrato.pdf' },
      },
    }),
    'utf8',
  );

function montar(contrato: unknown = CONTRATO) {
  const prisma = {
    contrato: {
      findFirst: vi.fn(async (_args?: unknown) => contrato),
      update: vi.fn(async (_args: { data: Record<string, unknown> }) => ({})),
    },
    // A PROPOSTA acompanha o contrato: ACEITA → ASSINADA quando o documento volta.
    proposta: { update: vi.fn(async () => ({})) },
    pedido: { updateMany: vi.fn(async () => ({ count: 1 })) },
  };
  const env = { get: vi.fn(() => 'x') };
  const notificacoes = { criarParaUsuario: vi.fn(async () => ({})) };
  const etapa = { mover: vi.fn(async () => 'movido' as const) };
  const propostaErp = { enviar: vi.fn(async () => ({ orcamentoErpId: '999' })) };
  const comissoesContrato = { recalcular: vi.fn(async () => undefined) };
  // A base da conta agora vem da EMPRESA (sandbox × produção são hosts
  // diferentes) — é ela que monta a URL quando a ClickSign devolve o arquivo
  // como caminho relativo.
  const clicksign = { baseDaEmpresa: vi.fn(async () => 'https://sandbox.clicksign.com') };
  const esteira = { entrarNaEsteira: vi.fn().mockResolvedValue('criado') };
  const svc = new ClickSignAssinaturaService(
    prisma as never,
    env as never,
    notificacoes as never,
    etapa as never,
    propostaErp as never,
    // Cronograma de comissão do contrato (locação paga por MÊS): a assinatura
    // dispara o recálculo, mas não depende dele pra concluir.
    comissoesContrato as never,
    clicksign as never,
    // Esteira pós-assinatura: o card do Leandro nasce aqui, best-effort — a
    // assinatura não pode depender dele.
    esteira as never,
  );
  return { svc, prisma, notificacoes, etapa, propostaErp, comissoesContrato, clicksign, esteira };
}

beforeEach(() => {
  vi.clearAllMocks();
  // O PDF assinado é baixado por fetch antes de subir pro Storage.
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) })),
  );
});

describe('ClickSignAssinaturaService.registrarAssinado', () => {
  /** Desde 25/09 o envelope tem 2 documentos: contrato + levantamento anexado. */
  it('evento com a LISTA e o anexo primeiro: acha o contrato no documento certo', async () => {
    const { svc, prisma } = montar();
    prisma.contrato.findFirst.mockImplementation(async (a: unknown) =>
      JSON.stringify(a).includes('doc-anexo') ? null : CONTRATO,
    );
    const lista = Buffer.from(
      JSON.stringify({
        event: { name: 'auto_close' },
        document: [
          {
            key: 'doc-anexo',
            status: 'closed',
            downloads: { signed_file_url: 'https://arquivo/anexo.pdf' },
          },
          {
            key: 'doc-1',
            status: 'closed',
            finished_at: '2026-09-04T16:13:30.000Z',
            downloads: { signed_file_url: 'https://arquivo/contrato.pdf' },
          },
        ],
      }),
      'utf8',
    );
    await expect(svc.registrarAssinado(lista)).resolves.toBe('aplicado');
    // O PDF guardado é o do CONTRATO, não o do anexo.
    expect(prisma.contrato.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ assinaturaUrl: 'https://arquivo/contrato.pdf' }),
      }),
    );
  });

  it('a PROPOSTA passa de aceita pra ASSINADA — senão a lista não conta que o contrato voltou', async () => {
    const { svc, prisma } = montar();

    await svc.registrarAssinado(corpo());

    expect(prisma.proposta.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'prop-1' }, data: { status: 'ASSINADA' } }),
    );
  });

  it('marca ASSINADO, trava o pedido, sobe pro ERP e move a etapa', async () => {
    const { svc, prisma, etapa, propostaErp } = montar();

    await expect(svc.registrarAssinado(corpo())).resolves.toBe('aplicado');

    expect(prisma.contrato.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'ASSINADO' }) }),
    );
    // O pedido do aceite sai de RASCUNHO e fica esperando a liberação no ERP.
    expect(prisma.pedido.updateMany).toHaveBeenCalledWith({
      where: { empresaId: 'emp-1', propostaNumero: 'PROP-0020', status: 'RASCUNHO' },
      data: { status: 'AGUARDANDO_LIBERACAO' },
    });
    expect(propostaErp.enviar).toHaveBeenCalledWith('prop-1', 'emp-1');
    expect(etapa.mover).toHaveBeenCalledWith(
      expect.objectContaining({ marco: 'contratoAssinado', clienteId: 'cli-1' }),
    );
  });

  /**
   * O card do Leandro é o que faz a esteira existir — sem ele o contrato assina
   * e ninguém sabe que tem produção pra começar.
   */
  it('contrato assinado ENTRA na esteira pós-assinatura', async () => {
    const { svc, esteira } = montar();

    await svc.registrarAssinado(corpo());

    expect(esteira.entrarNaEsteira).toHaveBeenCalledWith('ct-1');
  });

  /**
   * ⚠️ E a recíproca, que é a que importa mais: falhar em criar o card NÃO pode
   * desfazer a assinatura nem derrubar o webhook. O contrato já está assinado e
   * o PDF guardado quando isto roda; a ClickSign reentregaria, e reentrega com
   * efeito colateral pela metade é pior que a ausência do card.
   */
  it('esteira fora do ar NÃO derruba a assinatura', async () => {
    const { svc, esteira, prisma } = montar();
    esteira.entrarNaEsteira.mockRejectedValue(new Error('kanban fora'));

    await expect(svc.registrarAssinado(corpo())).resolves.toBe('aplicado');
    expect(prisma.contrato.update).toHaveBeenCalled();
  });

  it('ERP fora do ar NÃO desfaz a assinatura — avisa e segue', async () => {
    const { svc, prisma, etapa, propostaErp, notificacoes } = montar();
    propostaErp.enviar.mockRejectedValueOnce(new Error('Tiny HTTP 500'));

    await expect(svc.registrarAssinado(corpo())).resolves.toBe('aplicado');

    expect(prisma.contrato.update).toHaveBeenCalled();
    expect(etapa.mover).toHaveBeenCalled();
    expect(notificacoes.criarParaUsuario).toHaveBeenCalledWith(
      expect.objectContaining({ titulo: expect.stringContaining('não subiu pro ERP') }),
    );
  });

  it('não sobe duas vezes: proposta que já tem orçamento no ERP é ignorada', async () => {
    const { svc, propostaErp } = montar({
      ...CONTRATO,
      proposta: { ...CONTRATO.proposta, orcamentoErpId: '777' },
    });

    await svc.registrarAssinado(corpo());

    expect(propostaErp.enviar).not.toHaveBeenCalled();
  });

  it('webhook repetido não refaz nada', async () => {
    const { svc, prisma, propostaErp } = montar({
      ...CONTRATO,
      status: 'ASSINADO',
      documentoUrl: 'emp-1/ct-1.pdf',
    });

    await expect(svc.registrarAssinado(corpo())).resolves.toBe('repetido');

    expect(prisma.contrato.update).not.toHaveBeenCalled();
    expect(prisma.pedido.updateMany).not.toHaveBeenCalled();
    expect(propostaErp.enviar).not.toHaveBeenCalled();
  });
});

describe('PDF assinado — a base vem da conta DA EMPRESA', () => {
  /**
   * A ClickSign devolve `signed_file_url` ora como URL completa, ora como
   * caminho. Montar o caminho contra o host errado (sandbox × produção) dá 404
   * num download best-effort: o contrato fica assinado e SEM cópia local, e
   * nada acusa — por isso a base não pode mais vir do ambiente.
   */
  it('caminho relativo é montado contra a base da empresa', async () => {
    const { svc, clicksign } = montar();
    await svc.registrarAssinado(corpoComCaminhoRelativo());
    expect(clicksign.baseDaEmpresa).toHaveBeenCalledWith('emp-1');
    expect(fetch).toHaveBeenCalledWith(
      'https://sandbox.clicksign.com/2026/09/13/contrato.pdf',
      expect.anything(),
    );
  });

  it('URL completa passa intacta — não consulta a integração', async () => {
    const { svc, clicksign } = montar();
    await svc.registrarAssinado(corpo());
    expect(clicksign.baseDaEmpresa).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledWith('https://arquivo/contrato.pdf', expect.anything());
  });
});

describe('registrarExpiracao — prazo estourou sem assinatura', () => {
  const corpoDeadline = () =>
    Buffer.from(
      JSON.stringify({
        event: { name: 'deadline' },
        document: { key: 'doc-1', status: 'running' },
      }),
      'utf8',
    );

  it('encerra o contrato dizendo que foi o PRAZO, não recusa', async () => {
    const { svc, prisma } = montar();
    await expect(svc.registrarExpiracao(corpoDeadline())).resolves.toBe('aplicado');
    const dados = prisma.contrato.update.mock.calls[0][0].data;
    expect(dados.status).toBe('CANCELADO');
    expect(dados.motivoEncerramento).toMatch(/prazo/i);
    expect(dados.motivoEncerramento).not.toMatch(/recus/i);
  });

  it('avisa quem vendeu — senão o negócio morre em silêncio', async () => {
    const { svc, notificacoes } = montar();
    await svc.registrarExpiracao(corpoDeadline());
    expect(notificacoes.criarParaUsuario).toHaveBeenCalledWith(
      expect.objectContaining({ titulo: expect.stringMatching(/EXPIROU/) }),
    );
  });

  /**
   * Webhook fora de ordem existe, e aqui ele é caro: aplicar a expiração em
   * cima de um contrato já assinado desfaria uma assinatura VÁLIDA.
   */
  it.each(['ASSINADO', 'ATIVO'])('não mexe em contrato já %s', async (status) => {
    const { svc, prisma } = montar({ ...CONTRATO, status });
    await expect(svc.registrarExpiracao(corpoDeadline())).resolves.toBe('sem-contrato');
    expect(prisma.contrato.update).not.toHaveBeenCalled();
  });
});
