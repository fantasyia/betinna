import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OrquestracaoLeadEventsService } from './orquestracao-lead-events.service';

const makePrisma = () => ({
  lead: { findFirst: vi.fn(), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
  // Match de lead por telefone agora é via $queryRaw (sufixo normalizado no SQL).
  $queryRaw: vi.fn().mockResolvedValue([]),
});
const makeBus = () => ({ disparar: vi.fn() });
const makeInbox = () => ({ registrarLeadEventHook: vi.fn() });
const makeConversarIa = () => ({
  aguardandoPorLead: vi.fn().mockResolvedValue(null),
  prepararEntrada: vi.fn().mockResolvedValue({ mensagemIA: 'texto', imagemDataUrl: undefined }),
  retomar: vi.fn(),
});
// setNxEx=true → "primeira vez" (dispara). false → duplicata do split (suprime).
const makeRedis = () => ({ setNxEx: vi.fn().mockResolvedValue(true) });

const resultado = (over = {}) => ({
  conversationId: 'conv-1',
  messageId: 'm-1',
  duplicada: false,
  ...over,
});

describe('OrquestracaoLeadEventsService', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let bus: ReturnType<typeof makeBus>;
  let inbox: ReturnType<typeof makeInbox>;
  let redis: ReturnType<typeof makeRedis>;
  let svc: OrquestracaoLeadEventsService;

  beforeEach(() => {
    prisma = makePrisma();
    bus = makeBus();
    inbox = makeInbox();
    redis = makeRedis();
    svc = new OrquestracaoLeadEventsService(
      prisma as never,
      bus as never,
      inbox as never,
      makeConversarIa() as never,
      redis as never,
    );
  });

  it('onModuleInit registra o hook na inbox', () => {
    svc.onModuleInit();
    expect(inbox.registrarLeadEventHook).toHaveBeenCalledTimes(1);
  });

  it('dispara LEAD_RESPONDEU quando casa lead por telefone (sufixo normalizado)', async () => {
    prisma.$queryRaw.mockResolvedValue([{ id: 'lead-9' }]);
    await svc.aoReceberMensagem(
      { empresaId: 'emp-1', peerTelefone: '+55 11 99999-0000', conteudo: 'oi' } as never,
      resultado(),
    );
    // O sufixo passado ao SQL é de 8 dígitos PUROS (3º arg do tagged template).
    expect(prisma.$queryRaw.mock.calls[0]?.[2]).toBe('99990000');
    expect(bus.disparar).toHaveBeenCalledWith(
      'emp-1',
      'LEAD_RESPONDEU',
      expect.objectContaining({ leadId: 'lead-9', conversationId: 'conv-1', texto: 'oi' }),
    );
  });

  // REGRESSÃO: o "Conversar com IA" parava de responder depois do opener porque o
  // resolverLead usava `contatoTelefone: { contains: sufixo }`, que QUEBRA quando o
  // lead tem telefone formatado (o hífen cai no meio dos 8 dígitos do sufixo). O lead
  // nunca casava → retomar nunca era chamado → execução presa em AGUARDANDO.
  it('casa lead com telefone FORMATADO (hífen no meio do sufixo) e dispara LEAD_RESPONDEU', async () => {
    prisma.$queryRaw.mockResolvedValue([{ id: 'lead-anna' }]);
    await svc.aoReceberMensagem(
      {
        empresaId: 'emp-1',
        peerTelefone: '+55 (11) 97053-5832',
        conteudo: 'opa blz? sim vamos lá',
      } as never,
      resultado(),
    );
    // Sufixo só-dígitos — a normalização do ARMAZENADO acontece no SQL (RIGHT(REGEXP_REPLACE..)).
    expect(prisma.$queryRaw.mock.calls[0]?.[2]).toBe('70535832');
    expect(bus.disparar).toHaveBeenCalledWith(
      'emp-1',
      'LEAD_RESPONDEU',
      expect.objectContaining({ leadId: 'lead-anna' }),
    );
  });

  it('ignora mensagens duplicadas', async () => {
    await svc.aoReceberMensagem(
      { empresaId: 'emp-1', peerTelefone: '11999990000', conteudo: 'x' } as never,
      resultado({ duplicada: true }),
    );
    expect(bus.disparar).not.toHaveBeenCalled();
  });

  it('dispara MENSAGEM_CANAL mas não LEAD_RESPONDEU quando nenhum lead casa', async () => {
    prisma.lead.findFirst.mockResolvedValue(null);
    await svc.aoReceberMensagem(
      {
        empresaId: 'emp-1',
        peerTelefone: '11999990000',
        conteudo: 'x',
        canal: 'WHATSAPP',
      } as never,
      resultado(),
    );
    expect(bus.disparar).toHaveBeenCalledWith(
      'emp-1',
      'MENSAGEM_CANAL',
      expect.objectContaining({ leadId: null }),
    );
    expect(bus.disparar).not.toHaveBeenCalledWith('emp-1', 'LEAD_RESPONDEU', expect.anything());
  });

  it('propaga proprietarioId no MENSAGEM_CANAL (dual-owner D38 — base do filtro escopo)', async () => {
    prisma.lead.findFirst.mockResolvedValue(null);
    await svc.aoReceberMensagem(
      {
        empresaId: 'emp-1',
        peerTelefone: '11999990000',
        conteudo: 'x',
        canal: 'WHATSAPP',
        proprietarioId: 'rep-1', // WhatsApp PESSOAL do rep
      } as never,
      resultado(),
    );
    expect(bus.disparar).toHaveBeenCalledWith(
      'emp-1',
      'MENSAGEM_CANAL',
      expect.objectContaining({ proprietarioId: 'rep-1' }),
    );
  });

  it('proprietarioId ausente vira null no MENSAGEM_CANAL (WhatsApp central da empresa)', async () => {
    prisma.lead.findFirst.mockResolvedValue(null);
    await svc.aoReceberMensagem(
      {
        empresaId: 'emp-1',
        peerTelefone: '11999990000',
        conteudo: 'x',
        canal: 'WHATSAPP',
      } as never,
      resultado(),
    );
    expect(bus.disparar).toHaveBeenCalledWith(
      'emp-1',
      'MENSAGEM_CANAL',
      expect.objectContaining({ proprietarioId: null }),
    );
  });

  it('dedup: split webhook/poll (setNxEx=false) NÃO redispara MENSAGEM_CANAL', async () => {
    redis.setNxEx.mockResolvedValue(false); // 2ª chegada do mesmo texto na janela
    await svc.aoReceberMensagem(
      {
        empresaId: 'emp-1',
        peerTelefone: '11999990000',
        conteudo: 'cancelar',
        canal: 'WHATSAPP',
      } as never,
      resultado(),
    );
    expect(bus.disparar).not.toHaveBeenCalledWith('emp-1', 'MENSAGEM_CANAL', expect.anything());
  });

  it('dedup fail-open: Redis fora do ar ainda dispara MENSAGEM_CANAL', async () => {
    redis.setNxEx.mockRejectedValue(new Error('redis down'));
    await svc.aoReceberMensagem(
      {
        empresaId: 'emp-1',
        peerTelefone: '11999990000',
        conteudo: 'cancelar',
        canal: 'WHATSAPP',
      } as never,
      resultado(),
    );
    expect(bus.disparar).toHaveBeenCalledWith('emp-1', 'MENSAGEM_CANAL', expect.anything());
  });
});

/**
 * O LEAD_RESPONDEU passa a dizer em QUAL linha a mensagem chegou (D38).
 *
 * Sem isso o bus não tinha como distinguir o WhatsApp central da empresa do
 * pessoal do rep — e conversa particular (tecido, 11/09) disparava o E4. O
 * `retomar` logo abaixo já usava a porta pra não cruzar conversa; o gatilho é
 * que saía cego.
 */
describe('LEAD_RESPONDEU carrega a porta da mensagem', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let bus: ReturnType<typeof makeBus>;
  let svc: OrquestracaoLeadEventsService;

  beforeEach(() => {
    prisma = makePrisma();
    bus = makeBus();
    svc = new OrquestracaoLeadEventsService(
      prisma as never,
      bus as never,
      makeInbox() as never,
      makeConversarIa() as never,
      makeRedis() as never,
    );
    prisma.$queryRaw.mockResolvedValue([{ id: 'lead-julio' }]);
  });

  it('mensagem no WhatsApp PESSOAL do rep → proprietarioId preenchido', async () => {
    await svc.aoReceberMensagem(
      {
        empresaId: 'emp-1',
        peerTelefone: '11999990000',
        conteudo: 'Boa noite Léo',
        proprietarioId: 'rep-10fb0fca',
      } as never,
      resultado(),
    );
    expect(bus.disparar).toHaveBeenCalledWith(
      'emp-1',
      'LEAD_RESPONDEU',
      expect.objectContaining({ leadId: 'lead-julio', proprietarioId: 'rep-10fb0fca' }),
    );
  });

  it('mensagem no WhatsApp CENTRAL → proprietarioId null (nunca ausente)', async () => {
    await svc.aoReceberMensagem(
      { empresaId: 'emp-1', peerTelefone: '11999990000', conteudo: 'oi' } as never,
      resultado(),
    );
    expect(bus.disparar).toHaveBeenCalledWith(
      'emp-1',
      'LEAD_RESPONDEU',
      expect.objectContaining({ proprietarioId: null }),
    );
  });
});

/**
 * Auditoria 13/09/2026 (A-2, decisão do Léo): grupo não dispara gatilho de
 * conversa — bot só em conversa 1:1. Antes cada mensagem de grupo abria uma
 * execução da triagem que morria sem lead.
 */
describe('OrquestracaoLeadEvents — grupo (@g.us) não dispara MENSAGEM_CANAL', () => {
  it('mensagem em grupo é persistida mas não vira gatilho', async () => {
    const prisma = makePrisma();
    const bus = makeBus();
    prisma.lead.findFirst.mockResolvedValue(null);
    const svc = new OrquestracaoLeadEventsService(
      prisma as never,
      bus as never,
      makeInbox() as never,
      makeConversarIa() as never,
      makeRedis() as never,
    );

    await svc.aoReceberMensagem(
      {
        empresaId: 'emp-1',
        peerId: '120363@g.us',
        conteudo: 'bom dia grupo',
        canal: 'WHATSAPP',
      } as never,
      resultado(),
    );

    expect(bus.disparar).not.toHaveBeenCalledWith(
      expect.anything(),
      'MENSAGEM_CANAL',
      expect.anything(),
    );
  });
});

/**
 * Itens 11 e 12 do card 📣 (29/09): o fluxo enxerga a campanha do anúncio, e
 * quem já é lead e clica num anúncio novo ganha o toque (1º intacto, último = este).
 */
describe('OrquestracaoLeadEventsService — anúncio (CTWA)', () => {
  const REF = {
    sourceId: '120210000000001',
    campanha: 'mb-industria-agosto',
    campanhaFonte: 'meta',
  };
  const montar = (opts: { lead?: boolean; metadata?: unknown } = {}) => {
    const prisma = {
      ...makePrisma(),
      conversation: { findFirst: vi.fn(async () => ({ metadata: opts.metadata ?? null })) },
      $executeRaw: vi.fn().mockResolvedValue(1),
    };
    if (opts.lead) prisma.$queryRaw.mockResolvedValue([{ id: 'lead-9' }]);
    const bus = makeBus();
    const svc = new OrquestracaoLeadEventsService(
      prisma as never,
      bus as never,
      makeInbox() as never,
      makeConversarIa() as never,
      makeRedis() as never,
    );
    return { svc, prisma, bus };
  };
  const mensagem = (comReferral: boolean) =>
    ({
      empresaId: 'emp-1',
      peerTelefone: '+5511999990000',
      conteudo: 'vi o anúncio',
      canal: 'WHATSAPP',
      peerId: '5511999990000@s.whatsapp.net',
      meta: comReferral ? { ctwaReferral: { sourceId: REF.sourceId } } : {},
    }) as never;

  it('MENSAGEM_CANAL leva a campanha (nome do Meta) e o veioDeAnuncio', async () => {
    const m = montar({ metadata: { atribuicao: REF } });
    await m.svc.aoReceberMensagem(mensagem(true), resultado());
    expect(m.bus.disparar).toHaveBeenCalledWith(
      'emp-1',
      'MENSAGEM_CANAL',
      expect.objectContaining({
        veioDeAnuncio: true,
        utmSource: 'meta',
        utmMedium: 'click_to_whatsapp',
        utmCampaign: 'mb-industria-agosto',
        campanhaFonte: 'meta',
      }),
    );
  });

  it('usa o toque MAIS RECENTE da conversa (atribuicaoUltima) quando houver', async () => {
    const m = montar({
      metadata: { atribuicao: REF, atribuicaoUltima: { ...REF, campanha: 'mb-comercio-setembro' } },
    });
    await m.svc.aoReceberMensagem(mensagem(true), resultado());
    expect(m.bus.disparar).toHaveBeenCalledWith(
      'emp-1',
      'MENSAGEM_CANAL',
      expect.objectContaining({ utmCampaign: 'mb-comercio-setembro' }),
    );
  });

  it('lead que já existe e clicou num anúncio: grava o toque por merge jsonb (1º intacto)', async () => {
    const m = montar({ lead: true, metadata: { atribuicao: REF } });
    await m.svc.aoReceberMensagem(mensagem(true), resultado());
    const sql = (m.prisma.$executeRaw.mock.calls[0]?.[0] as string[]).join('?');
    expect(sql).toContain("jsonb_build_object('ultimo'");
    expect(sql).toContain("WHEN variaveis->'atribuicao'->'primeiro' IS NULL");
    expect(m.prisma.$executeRaw.mock.calls[0]).toContain('lead-9');
  });

  it('mensagem SEM referral (conversa orgânica ou já em andamento) não grava toque', async () => {
    const m = montar({ lead: true, metadata: { atribuicao: REF } });
    await m.svc.aoReceberMensagem(mensagem(false), resultado());
    expect(m.prisma.$executeRaw).not.toHaveBeenCalled();
    expect(m.bus.disparar).toHaveBeenCalledWith(
      'emp-1',
      'MENSAGEM_CANAL',
      expect.objectContaining({ veioDeAnuncio: false, utmCampaign: 'mb-industria-agosto' }),
    );
  });

  it('conversa orgânica: campanha nula, sem estourar', async () => {
    const m = montar();
    await m.svc.aoReceberMensagem(mensagem(false), resultado());
    expect(m.bus.disparar).toHaveBeenCalledWith(
      'emp-1',
      'MENSAGEM_CANAL',
      expect.objectContaining({ utmCampaign: null, veioDeAnuncio: false }),
    );
  });
});

/**
 * Item 10 (29/09): conversa de ANÚNCIO nunca termina sem lead — e não duplica
 * com o CRIAR_LEAD do T1: o lead nasce ANTES do MENSAGEM_CANAL sair, então
 * quando o T1 roda a conversa já está amarrada (conversa_ja_tem_lead).
 */
describe('OrquestracaoLeadEventsService — lead garantido na conversa de anúncio', () => {
  const CONVERSA = {
    id: 'conv-1',
    peerId: '5511999990000@s.whatsapp.net',
    peerNome: 'Ana',
    leadId: null as string | null,
    clienteId: null,
    proprietarioId: null,
    utmCampaign: 'mb-industria-agosto',
    metadata: { atribuicao: { campanha: 'mb-industria-agosto', campanhaFonte: 'meta' } },
    ultimaMsgEm: new Date(),
  };
  const montar = (
    opts: {
      leadPorTelefone?: boolean;
      conversaComLead?: boolean;
      travado?: boolean;
      ctwaEtapa?: string;
    } = {},
  ) => {
    const ordem: string[] = [];
    const prisma = {
      ...makePrisma(),
      conversation: {
        findFirst: vi.fn(async () => ({
          ...CONVERSA,
          leadId: opts.conversaComLead ? 'lead-ja' : null,
        })),
      },
      empresa: {
        findUnique: vi.fn(async () => ({
          config: opts.ctwaEtapa ? { entradaAnuncios: { ctwaEtapaId: opts.ctwaEtapa } } : null,
        })),
      },
      funilEtapa: {
        findFirst: vi.fn(async (a: { where: { id: string } }) => ({ id: a.where.id })),
      },
      $executeRaw: vi.fn().mockResolvedValue(1),
    };
    if (opts.leadPorTelefone) prisma.$queryRaw.mockResolvedValue([{ id: 'lead-9' }]);
    const bus = { disparar: vi.fn(async (_e: string, ev: string) => void ordem.push(ev)) };
    const executor = {
      criarLeadDaConversa: vi.fn(async () => {
        ordem.push('CRIOU_LEAD');
        return { criado: true, leadId: 'lead-novo' };
      }),
    };
    const redis = {
      setNxEx: vi.fn(async (k: string) => !(opts.travado && k.startsWith('ctwa:lead:'))),
    };
    const svc = new OrquestracaoLeadEventsService(
      prisma as never,
      bus as never,
      makeInbox() as never,
      makeConversarIa() as never,
      redis as never,
      executor as never,
    );
    return { svc, executor, ordem };
  };
  const msg = (comReferral = true) =>
    ({
      empresaId: 'emp-1',
      peerTelefone: '+5511999990000',
      conteudo: 'vi o anúncio',
      canal: 'WHATSAPP',
      peerId: CONVERSA.peerId,
      meta: comReferral ? { ctwaReferral: { sourceId: '120210000000001' } } : {},
    }) as never;

  it('sem lead: cria na etapa de entrada do CTWA ANTES do MENSAGEM_CANAL sair', async () => {
    const m = montar({ ctwaEtapa: 'etapa-triagem-novo' });
    await m.svc.aoReceberMensagem(msg(), resultado());
    expect(m.executor.criarLeadDaConversa).toHaveBeenCalledWith(
      'emp-1',
      expect.objectContaining({ id: 'conv-1' }),
      { funilEtapaId: 'etapa-triagem-novo' },
      expect.objectContaining({ hops: 0 }),
    );
    expect(m.ordem.indexOf('CRIOU_LEAD')).toBeLessThan(m.ordem.indexOf('MENSAGEM_CANAL'));
  });

  it('sem etapa configurada: funil padrão (funilEtapaId vazio)', async () => {
    const m = montar();
    await m.svc.aoReceberMensagem(msg(), resultado());
    expect(m.executor.criarLeadDaConversa).toHaveBeenCalledWith(
      'emp-1',
      expect.anything(),
      { funilEtapaId: undefined },
      expect.anything(),
    );
  });

  it('telefone que já é lead / conversa já amarrada / mensagem orgânica: NÃO cria', async () => {
    for (const m of [montar({ leadPorTelefone: true }), montar({ conversaComLead: true })]) {
      await m.svc.aoReceberMensagem(msg(), resultado());
      expect(m.executor.criarLeadDaConversa).not.toHaveBeenCalled();
    }
    const org = montar();
    await org.svc.aoReceberMensagem(msg(false), resultado());
    expect(org.executor.criarLeadDaConversa).not.toHaveBeenCalled();
  });

  it('trava por conversa: segunda mensagem de anúncio em corrida não cria outro lead', async () => {
    const m = montar({ travado: true });
    await m.svc.aoReceberMensagem(msg(), resultado());
    expect(m.executor.criarLeadDaConversa).not.toHaveBeenCalled();
  });

  it('falha ao criar NÃO derruba o gatilho (o CRIAR_LEAD do fluxo ainda tenta)', async () => {
    const m = montar();
    m.executor.criarLeadDaConversa.mockRejectedValueOnce(new Error('db fora'));
    await m.svc.aoReceberMensagem(msg(), resultado());
    expect(m.ordem).toContain('MENSAGEM_CANAL');
  });
});
