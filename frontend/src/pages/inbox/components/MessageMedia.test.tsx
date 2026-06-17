import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import {
  MessageMediaImage,
  MessageMediaVideo,
  MessageMediaAudio,
  MessageMediaDocument,
} from './MessageMedia';

/**
 * Render-tests de contrato dos 4 players de mídia do Inbox.
 *
 * Sem @testing-library/jest-dom — apenas getByX/queryByX/getAllByX + matchers
 * core do vitest.
 *
 * Estratégia: mockamos useApiQuery para simular os 3 estados possíveis
 * (loading / error / dados com url). A lógica de cada player é exercitada
 * nestes estados observáveis, sem rede real.
 *
 * jsdom não implementa HTMLMediaElement.play/pause — stubbamos via
 * Object.defineProperty para que <audio>/<video> não crashem.
 */

// ----- jsdom stubs -----------------------------------------------------------

// URL.createObjectURL / revokeObjectURL não existem em jsdom
vi.stubGlobal('URL', {
  ...URL,
  createObjectURL: vi.fn(() => 'blob:fake-url'),
  revokeObjectURL: vi.fn(),
});

// HTMLMediaElement.play/pause não existe em jsdom
beforeEach(() => {
  Object.defineProperty(window.HTMLMediaElement.prototype, 'play', {
    configurable: true,
    writable: true,
    value: vi.fn().mockResolvedValue(undefined),
  });
  Object.defineProperty(window.HTMLMediaElement.prototype, 'pause', {
    configurable: true,
    writable: true,
    value: vi.fn(),
  });
});

// ----- Mock factory ----------------------------------------------------------

type MediaQueryResult =
  | { data: null; loading: true; error: null; refetch: ReturnType<typeof vi.fn> }
  | { data: null; loading: false; error: string; refetch: ReturnType<typeof vi.fn> }
  | { data: { url: string; mime: string | null }; loading: false; error: null; refetch: ReturnType<typeof vi.fn> };

let _mockResult: MediaQueryResult = {
  data: { url: 'https://cdn.example.com/media', mime: null },
  loading: false,
  error: null,
  refetch: vi.fn(),
};

vi.mock('@/hooks/useApiQuery', () => ({
  useApiQuery: () => _mockResult,
}));

function setLoading() {
  _mockResult = { data: null, loading: true, error: null, refetch: vi.fn() };
}

function setError(refetch = vi.fn()) {
  _mockResult = { data: null, loading: false, error: 'Erro ao carregar', refetch };
}

function setData(url: string, mime: string | null = null, refetch = vi.fn()) {
  _mockResult = { data: { url, mime }, loading: false, error: null, refetch };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// ============================================================================
// MessageMediaImage
// ============================================================================

describe('MessageMediaImage', () => {
  it('loading: renderiza placeholder com data-testid correto', () => {
    setLoading();
    render(<MessageMediaImage msgId="m1" />);

    const placeholder = document.querySelector('[data-testid="msg-img-loading-m1"]');
    expect(placeholder).toBeTruthy();
  });

  it('loading: não renderiza <img>', () => {
    setLoading();
    render(<MessageMediaImage msgId="m1" />);

    const img = document.querySelector('[data-testid="msg-img-m1"]');
    expect(img).toBeNull();
  });

  it('error: renderiza mensagem "Imagem indisponível"', () => {
    setError();
    render(<MessageMediaImage msgId="m1" />);

    const span = screen.getByText('Imagem indisponível');
    expect(span).toBeTruthy();
  });

  it('error: renderiza botão de retry com data-testid correto', () => {
    setError();
    render(<MessageMediaImage msgId="m1" />);

    const retry = document.querySelector('[data-testid="msg-img-retry-m1"]');
    expect(retry).toBeTruthy();
  });

  it('error: clicar em retry chama refetch', () => {
    const refetch = vi.fn();
    setError(refetch);
    render(<MessageMediaImage msgId="m1" />);

    const retry = document.querySelector('[data-testid="msg-img-retry-m1"]') as HTMLElement;
    fireEvent.click(retry);
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('dados: renderiza <img> com data-testid e src corretos', () => {
    setData('https://cdn.example.com/foto.jpg');
    render(<MessageMediaImage msgId="m1" />);

    const img = document.querySelector('[data-testid="msg-img-m1"]') as HTMLImageElement;
    expect(img).toBeTruthy();
    expect(img.tagName).toBe('IMG');
    expect(img.src).toBe('https://cdn.example.com/foto.jpg');
  });

  it('dados: img está dentro de um <a> com href igual à url', () => {
    setData('https://cdn.example.com/foto.jpg');
    render(<MessageMediaImage msgId="m1" />);

    const img = document.querySelector('[data-testid="msg-img-m1"]') as HTMLImageElement;
    const link = img.closest('a') as HTMLAnchorElement;
    expect(link).toBeTruthy();
    expect(link.href).toBe('https://cdn.example.com/foto.jpg');
    expect(link.target).toBe('_blank');
  });

  it('dados: não renderiza placeholder nem mensagem de erro', () => {
    setData('https://cdn.example.com/foto.jpg');
    render(<MessageMediaImage msgId="m1" />);

    expect(document.querySelector('[data-testid="msg-img-loading-m1"]')).toBeNull();
    expect(document.querySelector('[data-testid="msg-img-retry-m1"]')).toBeNull();
  });
});

// ============================================================================
// MessageMediaVideo
// ============================================================================

describe('MessageMediaVideo', () => {
  it('loading: renderiza placeholder com data-testid correto', () => {
    setLoading();
    render(<MessageMediaVideo msgId="m2" />);

    const placeholder = document.querySelector('[data-testid="msg-video-loading-m2"]');
    expect(placeholder).toBeTruthy();
  });

  it('error: renderiza "Vídeo indisponível"', () => {
    setError();
    render(<MessageMediaVideo msgId="m2" />);

    const span = screen.getByText('Vídeo indisponível');
    expect(span).toBeTruthy();
  });

  it('dados: renderiza <video> com data-testid correto', () => {
    setData('https://cdn.example.com/video.mp4', 'video/mp4');
    render(<MessageMediaVideo msgId="m2" />);

    const video = document.querySelector('[data-testid="msg-video-m2"]') as HTMLVideoElement;
    expect(video).toBeTruthy();
    expect(video.tagName).toBe('VIDEO');
  });

  it('dados com mime: renderiza <source> com type correto', () => {
    setData('https://cdn.example.com/video.mp4', 'video/mp4');
    render(<MessageMediaVideo msgId="m2" />);

    const sources = document.querySelectorAll('[data-testid="msg-video-m2"] source');
    const mimeSource = Array.from(sources).find(
      (s) => (s as HTMLSourceElement).type === 'video/mp4',
    );
    expect(mimeSource).toBeTruthy();
  });

  it('dados sem mime: renderiza <video> sem source tipado (apenas fallback)', () => {
    setData('https://cdn.example.com/video.mp4', null);
    render(<MessageMediaVideo msgId="m2" />);

    const video = document.querySelector('[data-testid="msg-video-m2"]');
    expect(video).toBeTruthy();

    // Sem mime, o primeiro <source> com type não deve existir
    const sources = document.querySelectorAll('[data-testid="msg-video-m2"] source');
    const typedSources = Array.from(sources).filter((s) => (s as HTMLSourceElement).type !== '');
    expect(typedSources).toHaveLength(0);
  });

  it('onError no video: troca para link de download', () => {
    setData('https://cdn.example.com/video.mp4', 'video/mp4');
    render(<MessageMediaVideo msgId="m2" />);

    const video = document.querySelector('[data-testid="msg-video-m2"]') as HTMLVideoElement;
    fireEvent.error(video);

    // Após erro, o <video> some e aparece link de download
    const videoAfter = document.querySelector('[data-testid="msg-video-m2"]');
    expect(videoAfter).toBeNull();

    const downloadText = screen.getByText('Baixar vídeo');
    expect(downloadText).toBeTruthy();
  });
});

// ============================================================================
// MessageMediaAudio
// ============================================================================

describe('MessageMediaAudio', () => {
  it('loading: renderiza placeholder com data-testid correto', () => {
    setLoading();
    render(<MessageMediaAudio msgId="m3" />);

    const placeholder = document.querySelector('[data-testid="msg-audio-loading-m3"]');
    expect(placeholder).toBeTruthy();
  });

  it('error: renderiza "Áudio indisponível"', () => {
    setError();
    render(<MessageMediaAudio msgId="m3" />);

    const span = screen.getByText('Áudio indisponível');
    expect(span).toBeTruthy();
  });

  it('dados: renderiza <audio> com data-testid correto', () => {
    setData('https://cdn.example.com/audio.ogg', 'audio/ogg;codecs=opus');
    render(<MessageMediaAudio msgId="m3" />);

    const audio = document.querySelector('[data-testid="msg-audio-m3"]') as HTMLAudioElement;
    expect(audio).toBeTruthy();
    expect(audio.tagName).toBe('AUDIO');
  });

  it('dados com mime: renderiza <source> com type correto', () => {
    setData('https://cdn.example.com/audio.ogg', 'audio/ogg;codecs=opus');
    render(<MessageMediaAudio msgId="m3" />);

    const sources = document.querySelectorAll('[data-testid="msg-audio-m3"] source');
    const mimeSource = Array.from(sources).find(
      (s) => (s as HTMLSourceElement).type === 'audio/ogg;codecs=opus',
    );
    expect(mimeSource).toBeTruthy();
  });

  it('dados sem mime: não renderiza source tipado', () => {
    setData('https://cdn.example.com/audio.ogg', null);
    render(<MessageMediaAudio msgId="m3" />);

    const audio = document.querySelector('[data-testid="msg-audio-m3"]');
    expect(audio).toBeTruthy();

    const sources = document.querySelectorAll('[data-testid="msg-audio-m3"] source');
    const typedSources = Array.from(sources).filter((s) => (s as HTMLSourceElement).type !== '');
    expect(typedSources).toHaveLength(0);
  });

  it('onError no audio: troca para link de download', () => {
    setData('https://cdn.example.com/audio.ogg', 'audio/ogg');
    render(<MessageMediaAudio msgId="m3" />);

    const audio = document.querySelector('[data-testid="msg-audio-m3"]') as HTMLAudioElement;
    fireEvent.error(audio);

    const audioAfter = document.querySelector('[data-testid="msg-audio-m3"]');
    expect(audioAfter).toBeNull();

    const downloadText = screen.getByText('Baixar áudio');
    expect(downloadText).toBeTruthy();
  });

  it('error: botão de retry presente (sem data-testid explícito, mas presente)', () => {
    setError();
    render(<MessageMediaAudio msgId="m3" />);

    // O botão de retry tem texto "tentar de novo" (sem data-testid, por isso queryByText)
    const retry = screen.getByText('tentar de novo');
    expect(retry).toBeTruthy();
  });
});

// ============================================================================
// MessageMediaDocument
// ============================================================================

describe('MessageMediaDocument', () => {
  it('loading: renderiza placeholder com data-testid correto', () => {
    setLoading();
    render(<MessageMediaDocument msgId="m4" />);

    const placeholder = document.querySelector('[data-testid="msg-doc-loading-m4"]');
    expect(placeholder).toBeTruthy();
  });

  it('error: renderiza "Documento indisponível"', () => {
    setError();
    render(<MessageMediaDocument msgId="m4" />);

    const span = screen.getByText('Documento indisponível');
    expect(span).toBeTruthy();
  });

  it('dados: renderiza link de download com data-testid correto', () => {
    setData('https://cdn.example.com/relatorio.pdf', 'application/pdf');
    render(<MessageMediaDocument msgId="m4" fileName="relatorio.pdf" />);

    const link = document.querySelector('[data-testid="msg-doc-m4"]') as HTMLAnchorElement;
    expect(link).toBeTruthy();
    expect(link.tagName).toBe('A');
    expect(link.href).toBe('https://cdn.example.com/relatorio.pdf');
  });

  it('dados: link usa o fileName como display e como download attr', () => {
    setData('https://cdn.example.com/contrato.pdf', 'application/pdf');
    render(<MessageMediaDocument msgId="m4" fileName="contrato.pdf" />);

    const link = document.querySelector('[data-testid="msg-doc-m4"]') as HTMLAnchorElement;
    expect(link.download).toBe('contrato.pdf');

    const nameSpan = screen.getByText('contrato.pdf');
    expect(nameSpan).toBeTruthy();
  });

  it('dados sem fileName: usa "Documento" como displayName', () => {
    setData('https://cdn.example.com/doc.pdf', null);
    render(<MessageMediaDocument msgId="m4" />);

    const link = document.querySelector('[data-testid="msg-doc-m4"]') as HTMLAnchorElement;
    expect(link.download).toBe('Documento');

    const docLabel = screen.getByText('Documento');
    expect(docLabel).toBeTruthy();
  });

  it('dados com mime: exibe o mime abaixo do nome', () => {
    setData('https://cdn.example.com/doc.pdf', 'application/pdf');
    render(<MessageMediaDocument msgId="m4" fileName="doc.pdf" />);

    const mimeSpan = screen.getByText('application/pdf');
    expect(mimeSpan).toBeTruthy();
  });

  it('dados sem mime: não exibe span de mime', () => {
    setData('https://cdn.example.com/doc.pdf', null);
    render(<MessageMediaDocument msgId="m4" fileName="doc.pdf" />);

    // Não deve ter nenhum span com texto parecido com mime type
    const spans = Array.from(document.querySelectorAll('span'));
    const mimeSpan = spans.find((s) => /\//.test(s.textContent ?? ''));
    expect(mimeSpan).toBeUndefined();
  });

  it('link tem target="_blank" e rel="noopener noreferrer"', () => {
    setData('https://cdn.example.com/doc.pdf', null);
    render(<MessageMediaDocument msgId="m4" />);

    const link = document.querySelector('[data-testid="msg-doc-m4"]') as HTMLAnchorElement;
    expect(link.target).toBe('_blank');
    expect(link.rel).toBe('noopener noreferrer');
  });

  it('loading: não renderiza link de download', () => {
    setLoading();
    render(<MessageMediaDocument msgId="m4" />);

    const link = document.querySelector('[data-testid="msg-doc-m4"]');
    expect(link).toBeNull();
  });
});
