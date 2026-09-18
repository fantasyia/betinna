import { describe, expect, it } from 'vitest';
import { extrairYoutubeId, urlDaMiniatura, urlDeEmbed } from './youtube-id.util';

/**
 * Ninguém cola um ID: cola a barra de endereços, o botão Compartilhar, ou o
 * `<iframe>` inteiro. Cada forma é um caso real, e errar aqui produz um embed
 * que falha em silêncio ("vídeo indisponível") — ou, pior, mostra o vídeo de
 * outra pessoa.
 */
describe('extrairYoutubeId', () => {
  it.each([
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://youtube.com/watch?v=dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['http://www.youtube.com/watch?v=dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://youtu.be/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://www.youtube.com/embed/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://www.youtube.com/shorts/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://www.youtube.com/live/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://www.youtube.com/v/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['  https://youtu.be/dQw4w9WgXcQ  ', 'dQw4w9WgXcQ'],
  ])('%s → %s', (entrada, esperado) => {
    expect(extrairYoutubeId(entrada)).toBe(esperado);
  });

  it('aguenta o lixo que vem junto do link compartilhado', () => {
    // O app do YouTube gruda `t`, `si`, `feature`, `list`… no link.
    expect(extrairYoutubeId('https://youtu.be/dQw4w9WgXcQ?t=42&si=aBcDeF')).toBe('dQw4w9WgXcQ');
    expect(extrairYoutubeId('https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL123&index=2')).toBe(
      'dQw4w9WgXcQ',
    );
    // `v` no meio da query, não no começo.
    expect(extrairYoutubeId('https://www.youtube.com/watch?app=desktop&v=dQw4w9WgXcQ')).toBe(
      'dQw4w9WgXcQ',
    );
  });

  it('aceita o <iframe> inteiro colado', () => {
    const iframe =
      '<iframe width="560" height="315" src="https://www.youtube.com/embed/dQw4w9WgXcQ?si=x" ' +
      'title="YouTube video player" frameborder="0" allowfullscreen></iframe>';
    expect(extrairYoutubeId(iframe)).toBe('dQw4w9WgXcQ');
  });

  /**
   * ⛔ Recusar é o comportamento certo. Um ID chutado gera um embed que carrega
   * sem erro e mostra "vídeo indisponível" — ou o vídeo de outra pessoa. A hora
   * de alguém perceber é no cadastro.
   */
  it.each([
    ['', 'vazio'],
    ['   ', 'só espaço'],
    ['https://www.youtube.com/', 'sem vídeo'],
    ['https://vimeo.com/123456789', 'outro serviço'],
    ['https://www.youtube.com/watch?v=curto', 'id curto demais'],
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQextra', 'id longo demais'],
    ['https://www.youtube.com/@canal', 'link de canal'],
    ['https://www.youtube.com/playlist?list=PL123456', 'playlist, não vídeo'],
    ['Reunião de terça', 'texto solto'],
  ])('recusa %s (%s)', (entrada) => {
    expect(extrairYoutubeId(entrada)).toBeNull();
  });

  it('recusa entrada que não é texto', () => {
    expect(extrairYoutubeId(null)).toBeNull();
    expect(extrairYoutubeId(undefined)).toBeNull();
    expect(extrairYoutubeId(12345 as unknown as string)).toBeNull();
  });
});

describe('urlDeEmbed', () => {
  it('usa youtube-nocookie', () => {
    // Deliberado: o domínio normal planta cookie de rastreio do Google em todo
    // funcionário que abrir a aba, sem ninguém ter escolhido isso.
    expect(urlDeEmbed('dQw4w9WgXcQ')).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
  });
});

describe('urlDaMiniatura', () => {
  it('aponta pro CDN do YouTube, não pro nosso servidor', () => {
    // O ponto da decisão inteira: nem o vídeo nem a capa passam por nós.
    expect(urlDaMiniatura('dQw4w9WgXcQ')).toBe('https://i.ytimg.com/vi/dQw4w9WgXcQ/mqdefault.jpg');
  });
});
