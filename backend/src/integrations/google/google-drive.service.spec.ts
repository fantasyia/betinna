import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GoogleDriveService } from './google-drive.service';

/**
 * A cópia no Drive é a SEGUNDA casa do contrato assinado — a primeira é o
 * Storage do app. Ela existe porque o Tiny não anexa arquivo em contrato
 * (medido contra a API em 12/09), então o que se testa aqui é sobretudo o que
 * ela NÃO pode fazer: derrubar a assinatura quando o Google não coopera.
 */
const build = (over: { conexoes?: unknown[]; token?: () => Promise<string> } = {}) => {
  const prisma = {
    usuarioIntegracao: {
      findMany: vi
        .fn()
        .mockResolvedValue(
          over.conexoes ?? [{ usuarioId: 'u-dir', usuario: { role: 'DIRECTOR' } }],
        ),
    },
  };
  const oauth = { getAccessToken: vi.fn(over.token ?? (async () => 'tok-1')) };
  const svc = new GoogleDriveService(oauth as never, prisma as never);
  return { svc, prisma, oauth };
};

const respostaOk = (corpo: unknown) => ({
  ok: true,
  status: 200,
  text: async () => JSON.stringify(corpo),
});

describe('GoogleDriveService.donoDoDrive', () => {
  beforeEach(() => vi.clearAllMocks());

  it('prefere o DIRECTOR: o contrato é documento do tenant, e o mandatário é ele', async () => {
    const { svc } = build({
      conexoes: [
        { usuarioId: 'u-admin', usuario: { role: 'ADMIN' } },
        { usuarioId: 'u-dir', usuario: { role: 'DIRECTOR' } },
      ],
    });

    await expect(svc.donoDoDrive('emp-1')).resolves.toBe('u-dir');
  });

  it('sem DIRECTOR conectado, aceita o ADMIN', async () => {
    const { svc } = build({ conexoes: [{ usuarioId: 'u-admin', usuario: { role: 'ADMIN' } }] });

    await expect(svc.donoDoDrive('emp-1')).resolves.toBe('u-admin');
  });

  it('ninguém conectou → null, e isso NÃO é erro', async () => {
    const { svc } = build({ conexoes: [] });

    await expect(svc.donoDoDrive('emp-1')).resolves.toBeNull();
  });

  it('só procura quem está ATIVO e é do tenant — Drive não é de qualquer um', async () => {
    const { svc, prisma } = build();

    await svc.donoDoDrive('emp-1');

    expect(prisma.usuarioIntegracao.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          servico: 'google_calendar',
          ativo: true,
          usuario: expect.objectContaining({
            status: 'ATIVO',
            role: { in: ['DIRECTOR', 'ADMIN'] },
            empresas: { some: { empresaId: 'emp-1' } },
          }),
        }),
      }),
    );
  });
});

describe('GoogleDriveService.guardarContrato', () => {
  beforeEach(() => vi.clearAllMocks());

  it('cria a pasta na primeira vez e sobe o PDF dentro dela', async () => {
    const { svc } = build();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(respostaOk({ files: [] })) // busca: não existe
      .mockResolvedValueOnce(respostaOk({ id: 'pasta-1' })) // cria a pasta
      .mockResolvedValueOnce(
        respostaOk({ id: 'arq-1', webViewLink: 'https://drive.google.com/file/d/arq-1/view' }),
      );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      svc.guardarContrato('emp-1', 'Contrato PROP-0025.pdf', Buffer.from('%PDF-1.7')),
    ).resolves.toEqual({ id: 'arq-1', url: 'https://drive.google.com/file/d/arq-1/view' });

    const [urlUpload, opts] = fetchMock.mock.calls[2];
    expect(String(urlUpload)).toContain('uploadType=multipart');
    expect(String(opts.headers['Content-Type'])).toContain('multipart/related; boundary=');
    // O PDF vai no corpo junto dos metadados, numa requisição só.
    expect(opts.body.toString()).toContain('%PDF-1.7');
    expect(opts.body.toString()).toContain('"parents":["pasta-1"]');
  });

  it('reaproveita a pasta que já existe — não cria uma por contrato', async () => {
    const { svc } = build();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(respostaOk({ files: [{ id: 'pasta-velha' }] }))
      .mockResolvedValueOnce(respostaOk({ id: 'arq-2' }));
    vi.stubGlobal('fetch', fetchMock);

    await svc.guardarContrato('emp-1', 'Contrato PROP-0026.pdf', Buffer.from('%PDF'));

    expect(fetchMock).toHaveBeenCalledTimes(2); // buscou e subiu; não criou
    expect(fetchMock.mock.calls[1][1].body.toString()).toContain('"parents":["pasta-velha"]');
  });

  /**
   * 🔴 Estes três são o ponto do arquivo: a cópia no Drive NÃO pode derrubar o
   * webhook de assinatura. Trocar "um arquivo a menos" por "contrato que não
   * fica assinado" seria o defeito caro.
   */
  it('ninguém conectou o Google → devolve null, sem chamar o Drive', async () => {
    const { svc, oauth } = build({ conexoes: [] });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      svc.guardarContrato('emp-1', 'Contrato.pdf', Buffer.from('%PDF')),
    ).resolves.toBeNull();
    expect(oauth.getAccessToken).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('token que não renova (escopo velho, acesso revogado) → null, não exceção', async () => {
    const { svc } = build({
      token: async () => {
        throw new Error('refresh_token inválido');
      },
    });

    await expect(
      svc.guardarContrato('emp-1', 'Contrato.pdf', Buffer.from('%PDF')),
    ).resolves.toBeNull();
  });

  it('Drive recusando (403 de escopo, cota) → null, não exceção', async () => {
    const { svc } = build();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        text: async () => '{"error":{"message":"Insufficient Permission"}}',
      }),
    );

    await expect(
      svc.guardarContrato('emp-1', 'Contrato.pdf', Buffer.from('%PDF')),
    ).resolves.toBeNull();
  });
});
