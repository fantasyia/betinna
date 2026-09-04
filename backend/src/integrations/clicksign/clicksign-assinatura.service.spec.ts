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

function montar(contrato: unknown = CONTRATO) {
  const prisma = {
    contrato: { findFirst: vi.fn(async () => contrato), update: vi.fn(async () => ({})) },
    pedido: { updateMany: vi.fn(async () => ({ count: 1 })) },
  };
  const env = { get: vi.fn(() => 'x') };
  const notificacoes = { criarParaUsuario: vi.fn(async () => ({})) };
  const etapa = { mover: vi.fn(async () => 'movido' as const) };
  const propostaErp = { enviar: vi.fn(async () => ({ orcamentoErpId: '999' })) };
  const svc = new ClickSignAssinaturaService(
    prisma as never,
    env as never,
    notificacoes as never,
    etapa as never,
    propostaErp as never,
  );
  return { svc, prisma, notificacoes, etapa, propostaErp };
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
