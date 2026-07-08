import { describe, expect, it, vi, beforeEach } from 'vitest';
import { EvolutionInboundService } from './evolution-inbound.service';

/**
 * Cobre o provider de WhatsApp do Evolution em dois eixos:
 *
 *  1. PARSING do webhook — `onMensagem` (via `processarEvento`) é o ponto onde o
 *     payload cru do Evolution/Baileys vira o objeto entregue à Inbox: extrai
 *     peer, telefone, canal, direção (fromMe → OUTBOUND/INBOUND), nome do
 *     contato e o conteúdo (delegado ao parser `extrairConteudo`). Testamos
 *     payload válido + edge cases (grupo, broadcast, sem texto, mídia, LID,
 *     malformado).
 *
 *  2. FLUXO PRINCIPAL — roteamento de instância → dono → empresa, descarte
 *     silencioso (com warning) quando a instância/empresa não resolve, e a
 *     entrega final no `InboxService.processarMensagemEntrante`.
 *
 * Tudo mockado com vi.fn — nenhuma dep real (Prisma/Inbox/Session/Media/
 * Evolution). O parser de conteúdo é stubado no `session` mock e validado pelo
 * que o provider FAZ com o resultado (tipo/conteudo/mediaMime).
 */

const CONTEUDO_TEXTO = {
  conteudo: 'oi',
  tipo: 'TEXT' as const,
  mediaMime: undefined,
  extras: undefined,
};

function setup(opts?: {
  empresaIdResolve?: string | undefined;
  extrair?: {
    conteudo: string;
    tipo: string;
    mediaMime?: string;
    extras?: Record<string, unknown>;
  };
}) {
  const empresas =
    opts?.empresaIdResolve === undefined
      ? [{ empresaId: 'emp-X' }]
      : [{ empresaId: opts.empresaIdResolve }];
  const prisma = {
    usuario: {
      findUnique: vi
        .fn()
        .mockResolvedValue(
          opts?.empresaIdResolve === null ? { empresas: [] } : { empresas: empresas },
        ),
    },
  };
  const inbox = {
    processarMensagemEntrante: vi
      .fn()
      .mockResolvedValue({ conversationId: 'c1', messageId: 'm1', duplicada: false }),
  };
  const session = {
    extrairConteudo: vi.fn().mockReturnValue(opts?.extrair ?? CONTEUDO_TEXTO),
  };
  const media = {
    uploadOutbound: vi.fn().mockResolvedValue('whatsapp-media/emp/path.jpg'),
  };
  const evolution = {
    listarInstancias: vi.fn().mockResolvedValue([]),
    mensagensRecentes: vi.fn().mockResolvedValue([]),
    baixarMidiaBase64: vi.fn().mockResolvedValue(undefined),
    nomeGrupo: vi.fn().mockResolvedValue('Time Comercial'),
  };
  const instancias = { sincronizarConexao: vi.fn(), remover: vi.fn() };
  const svc = new EvolutionInboundService(
    prisma as never,
    inbox as never,
    session as never,
    media as never,
    evolution as never,
    instancias as never,
  );
  return { svc, prisma, inbox, session, media, evolution, instancias };
}

/** Payload no formato do webhook messages.upsert do Evolution. */
function upsert(data: unknown, instance = 'emp_emp-X') {
  return { event: 'messages.upsert', instance, data };
}

const msgTexto = (overrides: Record<string, unknown> = {}) => ({
  key: {
    remoteJid: '5511999998888@s.whatsapp.net',
    fromMe: false,
    id: 'WAID1',
    ...((overrides.key as object) ?? {}),
  },
  pushName: 'Cliente Zé',
  message: { conversation: 'oi' },
  messageTimestamp: 1_700_000_000,
  ...overrides,
});

describe('EvolutionInboundService — parsing do webhook (messages.upsert)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('payload VÁLIDO: extrai peer, telefone, canal, direção INBOUND, nome e conteúdo', async () => {
    const { svc, inbox, session } = setup();
    await svc.processarEvento(upsert({ messages: [msgTexto()] }));

    expect(session.extrairConteudo).toHaveBeenCalledWith({ conversation: 'oi' });
    expect(inbox.processarMensagemEntrante).toHaveBeenCalledTimes(1);
    const arg = inbox.processarMensagemEntrante.mock.calls[0][0];
    expect(arg).toMatchObject({
      empresaId: 'emp-X',
      canal: 'WHATSAPP',
      peerId: '5511999998888@s.whatsapp.net',
      peerNome: 'Cliente Zé',
      peerTelefone: '5511999998888',
      tipo: 'TEXT',
      conteudo: 'oi',
      externalId: 'WAID1',
      direction: 'INBOUND',
    });
    expect(arg.meta).toMatchObject({ provider: 'evolution', jid: '5511999998888@s.whatsapp.net' });
    expect(arg.data).toBeInstanceOf(Date);
    // messageTimestamp (s) → Date (ms)
    expect(arg.data.getTime()).toBe(1_700_000_000 * 1000);
  });

  it('aceita objeto único (sem array messages) — Evolution às vezes manda 1 msg só', async () => {
    const { svc, inbox } = setup();
    await svc.processarEvento(upsert(msgTexto()));
    expect(inbox.processarMensagemEntrante).toHaveBeenCalledTimes(1);
  });

  it('fromMe=true vira OUTBOUND e NÃO usa pushName como nome do contato', async () => {
    const { svc, inbox } = setup();
    await svc.processarEvento(
      upsert({
        messages: [
          msgTexto({
            key: { remoteJid: '5511999998888@s.whatsapp.net', fromMe: true, id: 'OUT1' },
          }),
        ],
      }),
    );
    const arg = inbox.processarMensagemEntrante.mock.calls[0][0];
    expect(arg.direction).toBe('OUTBOUND');
    expect(arg.peerNome).toBeUndefined();
  });

  it('LID: remoteJid `<id>@lid` + remoteJidAlt telefone → usa o telefone real como peer', async () => {
    const { svc, inbox } = setup();
    await svc.processarEvento(
      upsert({
        messages: [
          msgTexto({
            key: {
              remoteJid: '12345678901234@lid',
              remoteJidAlt: '5511988887777@s.whatsapp.net',
              fromMe: false,
              id: 'LID1',
            },
          }),
        ],
      }),
    );
    const arg = inbox.processarMensagemEntrante.mock.calls[0][0];
    expect(arg.peerId).toBe('5511988887777@s.whatsapp.net');
    expect(arg.peerTelefone).toBe('5511988887777');
  });

  it('CAÇADA-BUG #28: LID SEM remoteJidAlt → peerTelefone undefined (não usa o id opaco do @lid)', async () => {
    const { svc, inbox } = setup();
    await svc.processarEvento(
      upsert({
        messages: [
          msgTexto({
            key: { remoteJid: '12345678901234@lid', fromMe: false, id: 'LID2' },
          }),
        ],
      }),
    );
    const arg = inbox.processarMensagemEntrante.mock.calls[0][0];
    // O peer segue sendo o @lid, mas o telefone NÃO pode ser os dígitos opacos (envenenaria o
    // match por sufixo). Fica undefined.
    expect(arg.peerTelefone).toBeUndefined();
  });

  it('GRUPO (@g.us) é persistido: peerNome = subject, senderName = autor, sem telefone', async () => {
    const { svc, inbox, evolution } = setup();
    await svc.processarEvento(
      upsert({
        messages: [msgTexto({ key: { remoteJid: '123456789@g.us', fromMe: false, id: 'G1' } })],
      }),
    );
    expect(evolution.nomeGrupo).toHaveBeenCalledWith('emp_emp-X', '123456789@g.us');
    expect(inbox.processarMensagemEntrante).toHaveBeenCalledTimes(1);
    const arg = inbox.processarMensagemEntrante.mock.calls[0][0];
    expect(arg.peerId).toBe('123456789@g.us');
    expect(arg.peerNome).toBe('Time Comercial'); // subject do grupo
    expect(arg.senderName).toBe('Cliente Zé'); // pushName do autor
    expect(arg.peerTelefone).toBeUndefined(); // grupo não tem telefone único
  });

  it('BROADCAST / status@broadcast são ignorados', async () => {
    const { svc, inbox } = setup();
    await svc.processarEvento(
      upsert({
        messages: [
          msgTexto({ key: { remoteJid: 'status@broadcast', fromMe: false, id: 'B1' } }),
          msgTexto({ key: { remoteJid: '123@broadcast', fromMe: false, id: 'B2' } }),
        ],
      }),
    );
    expect(inbox.processarMensagemEntrante).not.toHaveBeenCalled();
  });

  it('TEXT vazio (parser não reconheceu) → entrega placeholder "[mensagem não suportada]" (não perde a msg)', async () => {
    const { svc, inbox } = setup({ extrair: { conteudo: '', tipo: 'TEXT' } });
    await svc.processarEvento(upsert({ messages: [msgTexto({ message: {} })] }));
    expect(inbox.processarMensagemEntrante).toHaveBeenCalledTimes(1);
    expect(inbox.processarMensagemEntrante.mock.calls[0][0].conteudo).toBe(
      '[mensagem não suportada]',
    );
  });

  it('tipo NÃO-TEXT com conteúdo vazio → descartada (não vira placeholder)', async () => {
    const { svc, inbox } = setup({ extrair: { conteudo: '', tipo: 'STICKER' } });
    await svc.processarEvento(
      upsert({ messages: [msgTexto({ message: { stickerMessage: {} } })] }),
    );
    expect(inbox.processarMensagemEntrante).not.toHaveBeenCalled();
  });

  it('payload MALFORMADO (data vazio / key ausente) não quebra e não entrega nada', async () => {
    const { svc, inbox } = setup();
    await svc.processarEvento(upsert({ messages: [{}] }));
    // peerId vazio → pula
    expect(inbox.processarMensagemEntrante).not.toHaveBeenCalled();
  });

  it('sem messageTimestamp → data fica undefined (não inventa data)', async () => {
    const { svc, inbox } = setup();
    await svc.processarEvento(upsert({ messages: [msgTexto({ messageTimestamp: undefined })] }));
    const arg = inbox.processarMensagemEntrante.mock.calls[0][0];
    expect(arg.data).toBeUndefined();
  });
});

describe('EvolutionInboundService — mídia', () => {
  beforeEach(() => vi.clearAllMocks());

  it('mídia com base64 no webhook → sobe via media.uploadOutbound e anexa mediaUrl', async () => {
    const { svc, inbox, media } = setup({
      extrair: { conteudo: '[imagem]', tipo: 'IMAGE', mediaMime: 'image/jpeg' },
    });
    await svc.processarEvento(
      upsert({ messages: [msgTexto({ message: { imageMessage: {} }, base64: 'QUJD' })] }),
    );
    expect(media.uploadOutbound).toHaveBeenCalledTimes(1);
    const upArgs = media.uploadOutbound.mock.calls[0];
    expect(upArgs[0]).toBe('emp-X'); // empresaId
    expect(Buffer.isBuffer(upArgs[2])).toBe(true); // buffer do base64
    expect(upArgs[3]).toBe('image/jpeg'); // mime
    const arg = inbox.processarMensagemEntrante.mock.calls[0][0];
    expect(arg.tipo).toBe('IMAGE');
    expect(arg.mediaUrl).toBe('whatsapp-media/emp/path.jpg');
    expect(arg.mediaMime).toBe('image/jpeg');
  });

  it('mídia SEM base64 no webhook → busca via evolution.baixarMidiaBase64', async () => {
    const { svc, media, evolution } = setup({
      extrair: { conteudo: '[áudio]', tipo: 'AUDIO', mediaMime: 'audio/ogg' },
    });
    evolution.baixarMidiaBase64.mockResolvedValue('QUJD');
    await svc.processarEvento(
      upsert({
        messages: [
          msgTexto({
            message: { audioMessage: {} },
            key: { remoteJid: '5511999998888@s.whatsapp.net', fromMe: false, id: 'AUD1' },
          }),
        ],
      }),
    );
    expect(evolution.baixarMidiaBase64).toHaveBeenCalledWith('emp_emp-X', 'AUD1');
    expect(media.uploadOutbound).toHaveBeenCalledTimes(1);
  });

  it('mídia sem base64 e download falha → segue sem mediaUrl mas ainda entrega a msg', async () => {
    const { svc, inbox, media, evolution } = setup({
      extrair: { conteudo: '[imagem]', tipo: 'IMAGE', mediaMime: 'image/jpeg' },
    });
    evolution.baixarMidiaBase64.mockResolvedValue(undefined);
    await svc.processarEvento(upsert({ messages: [msgTexto({ message: { imageMessage: {} } })] }));
    expect(media.uploadOutbound).not.toHaveBeenCalled();
    const arg = inbox.processarMensagemEntrante.mock.calls[0][0];
    expect(arg.mediaUrl).toBeUndefined();
    expect(arg.tipo).toBe('IMAGE');
  });
});

describe('EvolutionInboundService — fluxo principal (roteamento instância → empresa)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('instância emp_<id> → empresaId direto (sem consultar usuario), proprietarioId undefined', async () => {
    const { svc, inbox, prisma } = setup();
    await svc.processarEvento(upsert({ messages: [msgTexto()] }, 'emp_emp-42'));
    expect(prisma.usuario.findUnique).not.toHaveBeenCalled();
    const arg = inbox.processarMensagemEntrante.mock.calls[0][0];
    expect(arg.empresaId).toBe('emp-42');
    expect(arg.proprietarioId).toBeUndefined();
  });

  it('instância user_<id> → resolve empresa do usuário e seta proprietarioId', async () => {
    const { svc, inbox, prisma } = setup();
    prisma.usuario.findUnique.mockResolvedValue({ empresas: [{ empresaId: 'emp-do-rep' }] });
    await svc.processarEvento(upsert({ messages: [msgTexto()] }, 'user_rep-7'));
    expect(prisma.usuario.findUnique).toHaveBeenCalledTimes(1);
    const arg = inbox.processarMensagemEntrante.mock.calls[0][0];
    expect(arg.empresaId).toBe('emp-do-rep');
    expect(arg.proprietarioId).toBe('rep-7');
  });

  it('instância fora do padrão emp_/user_ → descarta, nem consulta empresa', async () => {
    const { svc, inbox, prisma } = setup();
    await svc.processarEvento(upsert({ messages: [msgTexto()] }, 'instancia-aleatoria'));
    expect(prisma.usuario.findUnique).not.toHaveBeenCalled();
    expect(inbox.processarMensagemEntrante).not.toHaveBeenCalled();
  });

  it('user_<id> SEM empresa vinculada → descarta (não entrega à inbox)', async () => {
    const { svc, inbox, prisma } = setup();
    prisma.usuario.findUnique.mockResolvedValue({ empresas: [] });
    await svc.processarEvento(upsert({ messages: [msgTexto()] }, 'user_rep-sem-empresa'));
    expect(inbox.processarMensagemEntrante).not.toHaveBeenCalled();
  });

  it('payload sem instance → no-op silencioso', async () => {
    const { svc, inbox } = setup();
    await svc.processarEvento({ event: 'messages.upsert', data: { messages: [msgTexto()] } });
    expect(inbox.processarMensagemEntrante).not.toHaveBeenCalled();
  });

  it('erro do inbox NÃO propaga (catch no processarEvento) — webhook não pode 500', async () => {
    const { svc, inbox } = setup();
    inbox.processarMensagemEntrante.mockRejectedValue(new Error('db down'));
    await expect(svc.processarEvento(upsert({ messages: [msgTexto()] }))).resolves.toBeUndefined();
  });
});

describe('EvolutionInboundService — outros eventos (connection/qr)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('connection.update guarda o estado e expõe via estadoDe', async () => {
    const { svc } = setup();
    await svc.processarEvento({
      event: 'connection.update',
      instance: 'emp_emp-X',
      data: { state: 'open' },
    });
    expect(svc.estadoDe('emp_emp-X')).toBe('open');
  });

  it('qrcode.updated guarda o QR e expõe via qrDe (fresco)', async () => {
    const { svc } = setup();
    await svc.processarEvento({
      event: 'qrcode.updated',
      instance: 'emp_emp-X',
      data: { qrcode: { base64: 'data:image/png;base64,XYZ' } },
    });
    expect(svc.qrDe('emp_emp-X')).toBe('data:image/png;base64,XYZ');
  });

  it('qrDe retorna undefined pra instância sem QR', () => {
    const { svc } = setup();
    expect(svc.qrDe('emp_inexistente')).toBeUndefined();
  });
});

describe('EvolutionInboundService — sincronizarRecentes (poll de fallback)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sem instâncias → não faz nada', async () => {
    const { svc, evolution, inbox } = setup();
    evolution.listarInstancias.mockResolvedValue([]);
    await svc.sincronizarRecentes();
    expect(evolution.mensagensRecentes).not.toHaveBeenCalled();
    expect(inbox.processarMensagemEntrante).not.toHaveBeenCalled();
  });

  it('só reprocessa msgs na janela 45s–12min (descarta nova demais e antiga demais)', async () => {
    const { svc, evolution, inbox } = setup();
    const agora = Date.now();
    const tsSeg = (msAtras: number) => Math.floor((agora - msAtras) / 1000);
    evolution.listarInstancias.mockResolvedValue(['emp_emp-X']);
    evolution.mensagensRecentes.mockResolvedValue([
      msgTexto({
        messageTimestamp: tsSeg(10_000),
        key: { remoteJid: '5511999998888@s.whatsapp.net', fromMe: false, id: 'NOVA' },
      }), // 10s — nova demais
      msgTexto({
        messageTimestamp: tsSeg(2 * 60_000),
        key: { remoteJid: '5511999998888@s.whatsapp.net', fromMe: false, id: 'OK' },
      }), // 2min — entra
      msgTexto({
        messageTimestamp: tsSeg(30 * 60_000),
        key: { remoteJid: '5511999998888@s.whatsapp.net', fromMe: false, id: 'VELHA' },
      }), // 30min — velha demais
    ]);
    await svc.sincronizarRecentes();
    expect(inbox.processarMensagemEntrante).toHaveBeenCalledTimes(1);
    expect(inbox.processarMensagemEntrante.mock.calls[0][0].externalId).toBe('OK');
  });
});

describe('EvolutionInboundService — connection.update persiste o estado da instância', () => {
  it('chama sincronizarConexao com instância + estado + wuid', async () => {
    const { svc, instancias } = setup();
    await svc.processarEvento({
      event: 'connection.update',
      instance: 'emp_emp-1',
      data: { state: 'open', wuid: '5511999998888@s.whatsapp.net' },
    });
    expect(instancias.sincronizarConexao).toHaveBeenCalledWith(
      'emp_emp-1',
      'open',
      '5511999998888@s.whatsapp.net',
    );
  });
});
