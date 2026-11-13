import { describe, expect, it, vi } from 'vitest';
import {
  ehCanalComentario,
  extrairComentarios,
  peerDoComentario,
  rotaRespostaPublica,
} from './meta-comentarios';
import { alvoDaConversa, MetaComentariosService } from './meta-comentarios.service';

describe('extrairComentarios — Instagram', () => {
  const ig = (value: Record<string, unknown>) => [{ field: 'comments', value }];

  it('comentário de 1º nível: alvo é ele mesmo; aceita comment_id ou id', () => {
    const a = extrairComentarios(
      'instagram',
      'ig-1',
      ig({
        from: { id: 'u1', username: 'ana' },
        comment_id: 'c1',
        text: 'oi',
        media: { id: 'm1' },
      }),
    );
    expect(a).toEqual([
      expect.objectContaining({
        canal: 'INSTAGRAM_COMENTARIO',
        comentarioId: 'c1',
        alvoId: 'c1',
        postId: 'm1',
        autorId: 'u1',
        autorNome: 'ana',
        texto: 'oi',
      }),
    ]);
    const b = extrairComentarios(
      'instagram',
      'ig-1',
      ig({ from: { id: 'u1' }, id: 'c9', text: 'oi', media: { id: 'm1' } }),
    );
    expect(b[0]?.comentarioId).toBe('c9');
  });

  it('resposta a comentário: IG só aceita resposta no 1º nível → alvo é o pai', () => {
    const [c] = extrairComentarios(
      'instagram',
      'ig-1',
      ig({
        from: { id: 'u1' },
        comment_id: 'c2',
        parent_id: 'c1',
        text: 'e no G?',
        media: { id: 'm1' },
      }),
    );
    expect(c?.alvoId).toBe('c1');
    expect(c?.comentarioId).toBe('c2');
  });

  it('anúncio vem junto quando o comentário foi em post patrocinado', () => {
    const [c] = extrairComentarios(
      'instagram',
      'ig-1',
      ig({
        from: { id: 'u1' },
        comment_id: 'c3',
        text: 'preço?',
        media: { id: 'm1', ad_id: 'ad-7', ad_title: 'Moletom' },
      }),
    );
    expect(c).toMatchObject({ anuncioId: 'ad-7', anuncioTitulo: 'Moletom' });
  });

  it('ignora: autor = a própria conta, sem texto, sem mídia, campo errado', () => {
    const v = { comment_id: 'c', text: 'x', media: { id: 'm' } };
    expect(extrairComentarios('instagram', 'ig-1', ig({ ...v, from: { id: 'ig-1' } }))).toEqual([]);
    expect(
      extrairComentarios('instagram', 'ig-1', ig({ ...v, from: { id: 'u' }, text: undefined })),
    ).toEqual([]);
    expect(
      extrairComentarios('instagram', 'ig-1', ig({ ...v, from: { id: 'u' }, media: undefined })),
    ).toEqual([]);
    expect(
      extrairComentarios('instagram', 'ig-1', [
        { field: 'mentions', value: { ...v, from: { id: 'u' } } },
      ]),
    ).toEqual([]);
  });
});

describe('extrairComentarios — Facebook (feed)', () => {
  const feed = (value: Record<string, unknown>) => [{ field: 'feed', value }];
  const base = {
    item: 'comment',
    verb: 'add',
    from: { id: 'u5', name: 'Maria' },
    comment_id: 'post_c1',
    post_id: 'page_post',
    message: 'Quanto custa?',
    created_time: 1731500000,
  };

  it('comentário novo de 1º nível (parent_id = post): alvo é ele mesmo', () => {
    const [c] = extrairComentarios('page', 'page-1', feed({ ...base, parent_id: 'page_post' }));
    expect(c).toMatchObject({
      canal: 'FACEBOOK_COMENTARIO',
      comentarioId: 'post_c1',
      alvoId: 'post_c1',
      postId: 'page_post',
      autorNome: 'Maria',
    });
    expect(c?.data?.toISOString()).toBe(new Date(1731500000 * 1000).toISOString());
  });

  it('resposta a comentário: alvo é o comentário pai (mesmo fio)', () => {
    const [c] = extrairComentarios('page', 'page-1', feed({ ...base, parent_id: 'post_c0' }));
    expect(c?.alvoId).toBe('post_c0');
  });

  it('ignora curtida, edição, remoção, post e a própria Página', () => {
    expect(extrairComentarios('page', 'page-1', feed({ ...base, item: 'reaction' }))).toEqual([]);
    expect(extrairComentarios('page', 'page-1', feed({ ...base, verb: 'edited' }))).toEqual([]);
    expect(extrairComentarios('page', 'page-1', feed({ ...base, verb: 'remove' }))).toEqual([]);
    expect(extrairComentarios('page', 'page-1', feed({ ...base, item: 'status' }))).toEqual([]);
    const daPagina = { ...base, from: { id: 'page-1', name: 'Ribelt' } };
    expect(extrairComentarios('page', 'page-1', feed(daPagina))).toEqual([]);
  });

  it('object e field cruzados não passam (feed no IG, comments na Página)', () => {
    expect(extrairComentarios('instagram', 'ig-1', feed(base))).toEqual([]);
    const igLike = { from: { id: 'u' }, comment_id: 'c', text: 'x', media: { id: 'm' } };
    expect(extrairComentarios('page', 'page-1', [{ field: 'comments', value: igLike }])).toEqual(
      [],
    );
  });
});

describe('endpoint da resposta pública', () => {
  it('IG responde em /replies; FB em /comments', () => {
    expect(rotaRespostaPublica('INSTAGRAM_COMENTARIO', '179')).toBe('/179/replies');
    expect(rotaRespostaPublica('FACEBOOK_COMENTARIO', '12_34')).toBe('/12_34/comments');
  });
});

describe('peer e canal', () => {
  it('uma conversa por autor × publicação', () => {
    expect(peerDoComentario('m1', 'u1')).toBe('cmt:m1:u1');
    expect(ehCanalComentario('INSTAGRAM_COMENTARIO')).toBe(true);
    expect(ehCanalComentario('INSTAGRAM')).toBe(false);
  });

  it('conversa sem o id do comentário: falha alto, não chuta', () => {
    expect(() => alvoDaConversa({ metadata: {} })).toThrow(/sem o id do comentário/);
    expect(alvoDaConversa({ metadata: { comentario_alvo_id: 'c1', comentario_id: 'c2' } })).toEqual(
      { alvoId: 'c1', comentarioId: 'c2' },
    );
  });
});

describe('MetaComentariosService — adapters', () => {
  const montar = () => {
    const registrados: Array<{ canal: string; [k: string]: unknown }> = [];
    const graph = {
      responderComentario: vi.fn(async () => ({ id: 'resp-1' })),
      responderComentarioNoPrivado: vi.fn(async () => ({ recipient_id: 'r', message_id: 'mid-1' })),
    };
    const integracoes = {
      obterCredenciaisInternas: vi.fn(async (_e: string, servico: string) => ({
        ativo: true,
        credenciais:
          servico === 'instagram'
            ? { pageId: 'page-1', pageAccessToken: 'tok', igUserId: 'ig-1' }
            : { pageId: 'page-1', pageAccessToken: 'tok' },
      })),
    };
    const inbox = { processarMensagemEntrante: vi.fn(async () => ({})) };
    const svc = new MetaComentariosService(
      graph as never,
      integracoes as never,
      { registrar: (a: { canal: string }) => registrados.push(a) } as never,
      inbox as never,
    );
    svc.onModuleInit();
    const adapter = (canal: string) =>
      registrados.find((a) => a.canal === canal) as unknown as {
        enviarTexto: (e: string, p: string, t: string, c: unknown) => Promise<unknown>;
        responderNoPrivado: (e: string, p: string, t: string, c: unknown) => Promise<unknown>;
      };
    return { graph, inbox, svc, adapter };
  };
  const ctx = { metadata: { comentario_alvo_id: 'alvo-1', comentario_id: 'c-2' } };

  it('registra um adapter por canal de comentário', () => {
    const t = montar();
    expect(t.adapter('INSTAGRAM_COMENTARIO')).toBeTruthy();
    expect(t.adapter('FACEBOOK_COMENTARIO')).toBeTruthy();
  });

  it('resposta pública vai no comentário-alvo, com o canal certo', async () => {
    const t = montar();
    await expect(
      t.adapter('INSTAGRAM_COMENTARIO').enviarTexto('e1', 'cmt:m:u', 'Tem sim!', ctx),
    ).resolves.toEqual({ externalId: 'resp-1' });
    expect(t.graph.responderComentario).toHaveBeenCalledWith({
      canal: 'INSTAGRAM_COMENTARIO',
      alvoId: 'alvo-1',
      pageAccessToken: 'tok',
      texto: 'Tem sim!',
    });
  });

  it('resposta privada: IG sai pela conta do IG, FB pela Página, sempre no comentário', async () => {
    const t = montar();
    await t.adapter('INSTAGRAM_COMENTARIO').responderNoPrivado('e1', 'p', 'Oi!', ctx);
    expect(t.graph.responderComentarioNoPrivado).toHaveBeenLastCalledWith(
      expect.objectContaining({ senderEndpointId: 'ig-1', comentarioId: 'c-2' }),
    );
    await t.adapter('FACEBOOK_COMENTARIO').responderNoPrivado('e1', 'p', 'Oi!', ctx);
    expect(t.graph.responderComentarioNoPrivado).toHaveBeenLastCalledWith(
      expect.objectContaining({ senderEndpointId: 'page-1', comentarioId: 'c-2' }),
    );
  });

  it('comentário recebido vira mensagem com o alvo na metadata', async () => {
    const t = montar();
    await t.svc.receber(
      'e1',
      {
        canal: 'FACEBOOK_COMENTARIO',
        comentarioId: 'c-9',
        alvoId: 'c-8',
        postId: 'post-1',
        autorId: 'u-1',
        autorNome: 'Maria',
        texto: 'Quanto custa?',
      },
      'page-1',
    );
    expect(t.inbox.processarMensagemEntrante).toHaveBeenCalledWith(
      expect.objectContaining({
        canal: 'FACEBOOK_COMENTARIO',
        peerId: 'cmt:post-1:u-1',
        externalId: 'c-9',
        meta: expect.objectContaining({ comentario_alvo_id: 'c-8', comentario_id: 'c-9' }),
      }),
    );
  });
});
