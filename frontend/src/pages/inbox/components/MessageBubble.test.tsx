import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MessageBubble } from './MessageBubble';
import type { Mensagem } from '../lib/types';

/**
 * Render-tests de contrato do MessageBubble.
 *
 * Sem @testing-library/jest-dom — apenas getByX/queryByX/getAllByX + matchers
 * core do vitest. Sem mocks de módulos externos: os sub-players de mídia
 * (MessageMedia variants) importam useApiQuery, que é mockado globalmente abaixo.
 */

// ----- Mocks ----------------------------------------------------------------

// useApiQuery → sempre loading para não exigir URL real nos sub-componentes
// de mídia. Os casos relevantes do player são cobertos em MessageMedia.test.tsx.
vi.mock('@/hooks/useApiQuery', () => ({
  useApiQuery: () => ({ data: null, loading: true, error: null, refetch: vi.fn() }),
}));

// cn não precisa de mock (é util puro), mas lucide-react renderiza SVGs —
// jsdom suporta SVG, nenhum problema.

// ----- Helpers ---------------------------------------------------------------

const BASE_DATE = '2024-01-15T14:30:00.000Z';

function makeMsg(over: Partial<Mensagem> = {}): Mensagem {
  return {
    id: 'msg1',
    conteudo: 'Olá mundo',
    direction: 'INBOUND',
    tipo: 'TEXT',
    criadoEm: BASE_DATE,
    ...over,
  };
}

afterEach(() => cleanup());

// ----- Testes ----------------------------------------------------------------

describe('MessageBubble — texto básico', () => {
  it('renderiza o conteúdo da mensagem', () => {
    const msg = makeMsg({ conteudo: 'Oi tudo bem?' });
    render(<MessageBubble msg={msg} showAuthor={false} />);

    const el = screen.getByText('Oi tudo bem?');
    expect(el.tagName).toBe('P');
  });

  it('renderiza data-testid correto com id da mensagem', () => {
    const msg = makeMsg({ id: 'abc123' });
    render(<MessageBubble msg={msg} showAuthor={false} />);

    const wrapper = document.querySelector('[data-testid="msg-abc123"]');
    expect(wrapper).toBeTruthy();
  });

  it('mensagem INBOUND: alinhamento justify-start (não contém justify-end)', () => {
    const msg = makeMsg({ direction: 'INBOUND' });
    render(<MessageBubble msg={msg} showAuthor={false} />);

    const wrapper = document.querySelector('[data-testid="msg-msg1"]') as HTMLElement;
    expect(wrapper.className).toContain('justify-start');
    expect(wrapper.className).not.toContain('justify-end');
  });

  it('mensagem OUTBOUND: alinhamento justify-end', () => {
    const msg = makeMsg({ direction: 'OUTBOUND' });
    render(<MessageBubble msg={msg} showAuthor={false} />);

    const wrapper = document.querySelector('[data-testid="msg-msg1"]') as HTMLElement;
    expect(wrapper.className).toContain('justify-end');
  });

  it('exibe horário formatado no span de tempo', () => {
    const msg = makeMsg({ criadoEm: BASE_DATE });
    render(<MessageBubble msg={msg} showAuthor={false} />);

    // fmtHHMM devolve algo com ":" — ex: "11:30" (UTC-3) ou similar.
    // Buscamos por aria/title que contém a data ou por texto com ":".
    const spans = document.querySelectorAll('span');
    const timeSpan = Array.from(spans).find((s) => /\d{1,2}:\d{2}/.test(s.textContent ?? ''));
    expect(timeSpan).toBeTruthy();
  });
});

describe('MessageBubble — autor e grupo', () => {
  it('showAuthor=true + autor.nome: exibe nome do autor', () => {
    const msg = makeMsg({ autor: { id: 'u1', nome: 'Maria Silva' } });
    render(<MessageBubble msg={msg} showAuthor={true} />);

    const authorSpan = screen.getByText('Maria Silva');
    expect(authorSpan).toBeTruthy();
  });

  it('showAuthor=false: não exibe nome do autor', () => {
    const msg = makeMsg({ autor: { id: 'u1', nome: 'Maria Silva' } });
    render(<MessageBubble msg={msg} showAuthor={false} />);

    // O nome pode existir no DOM de outras formas, mas não como autor-span
    const authorEl = document.querySelector('[class*="text-muted"][class*="px-1"]');
    // O conteúdo da bolha não deve ter "Maria Silva" como autor (pode ser null)
    const spans = Array.from(document.querySelectorAll('span'));
    const authorSpans = spans.filter(
      (s) => s.textContent === 'Maria Silva' && s.className.includes('text-muted'),
    );
    expect(authorSpans).toHaveLength(0);
    void authorEl; // suprime lint unused
  });

  it('mensagem INBOUND com senderName: exibe data-testid de grupo', () => {
    const msg = makeMsg({
      direction: 'INBOUND',
      meta: { senderName: 'João Lima' },
    });
    render(<MessageBubble msg={msg} showAuthor={false} />);

    const senderEl = document.querySelector('[data-testid="msg-group-sender-msg1"]');
    expect(senderEl).toBeTruthy();
    expect(senderEl?.textContent).toBe('João Lima');
  });

  it('mensagem OUTBOUND com senderName: NÃO exibe sender de grupo', () => {
    const msg = makeMsg({
      direction: 'OUTBOUND',
      meta: { senderName: 'João Lima' },
    });
    render(<MessageBubble msg={msg} showAuthor={false} />);

    const senderEl = document.querySelector('[data-testid="msg-group-sender-msg1"]');
    expect(senderEl).toBeNull();
  });
});

describe('MessageBubble — reação e bot', () => {
  it('exibe reação quando meta.reacao está presente', () => {
    const msg = makeMsg({ meta: { reacao: '👍' } });
    render(<MessageBubble msg={msg} showAuthor={false} />);

    const reacao = document.querySelector('[data-testid="msg-reacao-msg1"]');
    expect(reacao).toBeTruthy();
    expect(reacao?.textContent).toBe('👍');
  });

  it('não exibe reação quando meta.reacao está ausente', () => {
    const msg = makeMsg({ meta: {} });
    render(<MessageBubble msg={msg} showAuthor={false} />);

    const reacao = document.querySelector('[data-testid="msg-reacao-msg1"]');
    expect(reacao).toBeNull();
  });

  it('exibe tag de bot (🤖 Muller) quando enviadaPorBot=true', () => {
    const msg = makeMsg({ enviadaPorBot: true });
    render(<MessageBubble msg={msg} showAuthor={false} />);

    const botTag = document.querySelector('[data-testid="msg-bot-tag-msg1"]');
    expect(botTag).toBeTruthy();
  });

  it('não exibe tag de bot quando enviadaPorBot=false', () => {
    const msg = makeMsg({ enviadaPorBot: false });
    render(<MessageBubble msg={msg} showAuthor={false} />);

    const botTag = document.querySelector('[data-testid="msg-bot-tag-msg1"]');
    expect(botTag).toBeNull();
  });
});

describe('MessageBubble — citação (quote)', () => {
  it('exibe bloco de citação quando citada é passada', () => {
    const msg = makeMsg({ id: 'msg2' });
    const citada = makeMsg({ id: 'msg1', conteudo: 'Mensagem original', direction: 'INBOUND' });
    render(<MessageBubble msg={msg} showAuthor={false} citada={citada} />);

    const quote = document.querySelector('[data-testid="msg-quote-msg2"]');
    expect(quote).toBeTruthy();
    expect(quote?.textContent).toContain('Mensagem original');
  });

  it('citada OUTBOUND mostra "Você" como label', () => {
    const msg = makeMsg({ id: 'msg2' });
    const citada = makeMsg({ id: 'msg1', direction: 'OUTBOUND', conteudo: 'Olá' });
    render(<MessageBubble msg={msg} showAuthor={false} citada={citada} />);

    const quote = document.querySelector('[data-testid="msg-quote-msg2"]');
    expect(quote?.textContent).toContain('Você');
  });

  it('citada INBOUND sem senderName mostra "Contato"', () => {
    const msg = makeMsg({ id: 'msg2' });
    const citada = makeMsg({ id: 'msg1', direction: 'INBOUND', conteudo: 'Oi' });
    render(<MessageBubble msg={msg} showAuthor={false} citada={citada} />);

    const quote = document.querySelector('[data-testid="msg-quote-msg2"]');
    expect(quote?.textContent).toContain('Contato');
  });

  it('citada INBOUND com senderName mostra o nome', () => {
    const msg = makeMsg({ id: 'msg2' });
    const citada = makeMsg({
      id: 'msg1',
      direction: 'INBOUND',
      conteudo: 'Oi',
      meta: { senderName: 'Pedro' },
    });
    render(<MessageBubble msg={msg} showAuthor={false} citada={citada} />);

    const quote = document.querySelector('[data-testid="msg-quote-msg2"]');
    expect(quote?.textContent).toContain('Pedro');
  });

  it('sem citada: bloco de quote não aparece', () => {
    const msg = makeMsg({ id: 'msg2' });
    render(<MessageBubble msg={msg} showAuthor={false} />);

    const quote = document.querySelector('[data-testid="msg-quote-msg2"]');
    expect(quote).toBeNull();
  });
});

describe('MessageBubble — tipos de mídia (fallback sem mediaUrl)', () => {
  it('IMAGE sem mediaUrl: exibe span de tipo (classe "lowercase", conteúdo "IMAGE")', () => {
    const msg = makeMsg({ tipo: 'IMAGE', mediaUrl: null, conteudo: '[imagem]' });
    render(<MessageBubble msg={msg} showAuthor={false} />);

    // A classe Tailwind "lowercase" aplica text-transform via CSS — o DOM contém "IMAGE" (uppercase).
    // Buscamos o span com className "lowercase" que contém o tipo.
    const spans = document.querySelectorAll('span.lowercase');
    const typeSpan = Array.from(spans).find((s) => s.textContent === 'IMAGE');
    expect(typeSpan).toBeTruthy();
  });

  it('VIDEO sem mediaUrl: exibe span de tipo "VIDEO" com classe lowercase', () => {
    const msg = makeMsg({ tipo: 'VIDEO', mediaUrl: null, conteudo: '[vídeo]' });
    render(<MessageBubble msg={msg} showAuthor={false} />);

    const spans = document.querySelectorAll('span.lowercase');
    const typeSpan = Array.from(spans).find((s) => s.textContent === 'VIDEO');
    expect(typeSpan).toBeTruthy();
  });

  it('AUDIO sem mediaUrl: exibe span de tipo "AUDIO" com classe lowercase', () => {
    const msg = makeMsg({ tipo: 'AUDIO', mediaUrl: null, conteudo: '[áudio]' });
    render(<MessageBubble msg={msg} showAuthor={false} />);

    const spans = document.querySelectorAll('span.lowercase');
    const typeSpan = Array.from(spans).find((s) => s.textContent === 'AUDIO');
    expect(typeSpan).toBeTruthy();
  });

  it('DOCUMENT sem mediaUrl: exibe span de tipo "DOCUMENT" com classe lowercase', () => {
    const msg = makeMsg({ tipo: 'DOCUMENT', mediaUrl: null, conteudo: '[documento]' });
    render(<MessageBubble msg={msg} showAuthor={false} />);

    const spans = document.querySelectorAll('span.lowercase');
    const typeSpan = Array.from(spans).find((s) => s.textContent === 'DOCUMENT');
    expect(typeSpan).toBeTruthy();
  });

  it('IMAGE com mediaUrl: não mostra cabeçalho de tipo (delegado ao player)', () => {
    const msg = makeMsg({ tipo: 'IMAGE', mediaUrl: 'https://cdn.example.com/img.jpg' });
    render(<MessageBubble msg={msg} showAuthor={false} />);

    // Com mediaUrl, showHeader é false — tipo span não deve aparecer (delegado ao player).
    // O DOM contém "IMAGE" (uppercase) quando showHeader=true. Com mediaUrl, não deve haver.
    const spans = document.querySelectorAll('span.lowercase');
    const imageTypeSpan = Array.from(spans).find((s) => s.textContent?.trim() === 'IMAGE');
    expect(imageTypeSpan).toBeUndefined();
  });

  it('mediaMime aparece junto ao header de fallback quando presente', () => {
    const msg = makeMsg({
      tipo: 'DOCUMENT',
      mediaUrl: null,
      mediaMime: 'application/pdf',
      conteudo: 'arquivo.pdf',
    });
    render(<MessageBubble msg={msg} showAuthor={false} />);

    const mimeSpan = screen.getByText('· application/pdf');
    expect(mimeSpan).toBeTruthy();
  });

  it('TEXT: não exibe cabeçalho de tipo de mídia (sem span.lowercase)', () => {
    const msg = makeMsg({ tipo: 'TEXT', conteudo: 'Mensagem de texto' });
    render(<MessageBubble msg={msg} showAuthor={false} />);

    // Para TEXT, MediaIcon é null → showHeader é false → sem span de tipo
    const spans = document.querySelectorAll('span.lowercase');
    expect(spans).toHaveLength(0);
  });
});

describe('MessageBubble — ações (responder / reagir)', () => {
  it('botão responder renderiza quando onResponder é passado (OUTBOUND)', () => {
    const onResponder = vi.fn();
    const msg = makeMsg({ id: 'msg1', direction: 'OUTBOUND' });
    render(<MessageBubble msg={msg} showAuthor={false} onResponder={onResponder} />);

    const btn = document.querySelector('[data-testid="msg-responder-msg1"]');
    expect(btn).toBeTruthy();
  });

  it('botão responder chama onResponder ao clicar', () => {
    const onResponder = vi.fn();
    const msg = makeMsg({ id: 'msg1', direction: 'OUTBOUND' });
    render(<MessageBubble msg={msg} showAuthor={false} onResponder={onResponder} />);

    const btn = document.querySelector('[data-testid="msg-responder-msg1"]') as HTMLElement;
    fireEvent.click(btn);
    expect(onResponder).toHaveBeenCalledTimes(1);
  });

  it('botão responder renderiza para INBOUND também', () => {
    const onResponder = vi.fn();
    const msg = makeMsg({ id: 'msg1', direction: 'INBOUND' });
    render(<MessageBubble msg={msg} showAuthor={false} onResponder={onResponder} />);

    const btn = document.querySelector('[data-testid="msg-responder-msg1"]');
    expect(btn).toBeTruthy();
  });

  it('sem onResponder e sem podeReagir: botão responder não aparece', () => {
    const msg = makeMsg({ id: 'msg1' });
    render(<MessageBubble msg={msg} showAuthor={false} />);

    const btn = document.querySelector('[data-testid="msg-responder-msg1"]');
    expect(btn).toBeNull();
  });

  it('podeReagir=true: botão reagir (data-testid msg-reagir-btn) aparece', () => {
    const msg = makeMsg({ direction: 'OUTBOUND' });
    render(
      <MessageBubble msg={msg} showAuthor={false} podeReagir={true} onReagir={vi.fn()} />,
    );

    const btn = document.querySelector('[data-testid="msg-reagir-btn"]');
    expect(btn).toBeTruthy();
  });

  it('clicar no reagir abre o picker e exibe os 6 emojis', () => {
    const msg = makeMsg({ direction: 'OUTBOUND' });
    render(
      <MessageBubble msg={msg} showAuthor={false} podeReagir={true} onReagir={vi.fn()} />,
    );

    const btn = document.querySelector('[data-testid="msg-reagir-btn"]') as HTMLElement;
    fireEvent.click(btn);

    // Os 6 emojis do picker devem aparecer como buttons
    const emojiButtons = Array.from(document.querySelectorAll('button')).filter((b) =>
      ['👍', '❤️', '😂', '😮', '😢', '🙏'].includes(b.textContent ?? ''),
    );
    expect(emojiButtons).toHaveLength(6);
  });

  it('escolher emoji chama onReagir com o emoji correto', () => {
    const onReagir = vi.fn();
    const msg = makeMsg({ direction: 'OUTBOUND' });
    render(
      <MessageBubble msg={msg} showAuthor={false} podeReagir={true} onReagir={onReagir} />,
    );

    const btn = document.querySelector('[data-testid="msg-reagir-btn"]') as HTMLElement;
    fireEvent.click(btn);

    const thumbsUp = Array.from(document.querySelectorAll('button')).find(
      (b) => b.textContent === '👍',
    ) as HTMLElement;
    fireEvent.click(thumbsUp);

    expect(onReagir).toHaveBeenCalledWith('👍');
  });
});

describe('MessageBubble — conteúdo oculto (DOCUMENT/placeholders)', () => {
  it('DOCUMENT com mediaUrl: conteudo (fileName) não aparece como parágrafo solto', () => {
    const msg = makeMsg({
      tipo: 'DOCUMENT',
      mediaUrl: 'https://cdn.example.com/doc.pdf',
      conteudo: 'relatorio.pdf',
    });
    render(<MessageBubble msg={msg} showAuthor={false} />);

    // O conteudo de DOCUMENT com mediaUrl deve ser suprimido como <p> solto
    const paras = document.querySelectorAll('p');
    const paraComFileName = Array.from(paras).find(
      (p) => p.textContent === 'relatorio.pdf',
    );
    expect(paraComFileName).toBeUndefined();
  });

  it('IMAGE com mediaUrl e conteudo="[imagem]": placeholder não aparece como <p>', () => {
    const msg = makeMsg({
      tipo: 'IMAGE',
      mediaUrl: 'https://cdn.example.com/img.jpg',
      conteudo: '[imagem]',
    });
    render(<MessageBubble msg={msg} showAuthor={false} />);

    const paras = document.querySelectorAll('p');
    const placeholder = Array.from(paras).find((p) => p.textContent === '[imagem]');
    expect(placeholder).toBeUndefined();
  });

  it('TEXT com conteudo normal: aparece como <p>', () => {
    const msg = makeMsg({ tipo: 'TEXT', conteudo: 'Mensagem normal' });
    render(<MessageBubble msg={msg} showAuthor={false} />);

    const p = document.querySelector('p');
    expect(p?.textContent).toBe('Mensagem normal');
  });
});
