/**
 * Composer.test.tsx — render tests para o compositor de mensagem do Inbox.
 *
 * Cobre (por data-testid / role):
 *  - render inicial (área de texto + botão Enviar presente e desabilitado quando vazio)
 *  - digitar texto habilita o botão Enviar
 *  - Ctrl+Enter chama envio (via envio.enviar)
 *  - clicar no botão Enviar chama envio.enviar
 *  - canal RESOLVIDA / ARQUIVADA mostra lockedCompose (sem textarea)
 *  - canal sem texto livre (Amazon) mostra banner bloqueado (sem textarea)
 *  - canal WhatsApp mostra botões de mídia (image/mic/attach)
 *  - canal não-WhatsApp não mostra botões de mídia
 *  - preview "respondendo a…" renderiza e cancel chama setRespondendoA(null)
 *  - banner de gravação: recording="recording" mostra pausa/cancelar/enviar
 *  - banner de gravação: recording="paused" mostra continuar/cancelar/enviar
 *  - clicar Cancelar chama cancelRecording; Pausar → pauseRecording; Continuar → resumeRecording; Enviar → stopRecording
 *  - botão Mic desabilitado enquanto sending=true
 *  - dropdown de templates aparece ao digitar "/"
 *  - clicar num template chama inserirTemplate com o objeto correto
 *  - emoji picker abre ao clicar no botão e fecha ao clicar no backdrop
 *  - sendError renderiza mensagem de erro
 *  - contador de caracteres reflete resposta.length / 4096
 */

import { render, screen, fireEvent, within, cleanup } from '@testing-library/react';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { Composer } from './Composer';
import type { Conversation, Mensagem, RespostaRapida } from '../lib/types';

// ── Mocks de dependências externas ──────────────────────────────────────────

// @/components/ui já é CSS-only; não precisa de mock de lógica.
// @/lib/cn é utilitário puro (sem side-effects).
// @/pages/inbox/lib/canais é código puro importado diretamente (sem mock).

// ── Factories ────────────────────────────────────────────────────────────────

function makeConv(over: Partial<Conversation> = {}): Conversation {
  return {
    id: 'c1',
    canal: 'WHATSAPP',
    status: 'ABERTA',
    peerId: '+5511999999999',
    ...over,
  };
}

function makeMensagem(over: Partial<Mensagem> = {}): Mensagem {
  return {
    id: 'm1',
    direction: 'INBOUND',
    tipo: 'TEXT',
    criadoEm: new Date().toISOString(),
    conteudo: 'Olá, preciso de ajuda',
    ...over,
  };
}

function makeTemplate(over: Partial<RespostaRapida> = {}): RespostaRapida {
  return {
    id: 't1',
    titulo: 'Saudação',
    atalho: '/ola',
    conteudo: 'Olá, tudo bem?',
    global: true,
    ...over,
  };
}

/** Retorna o bloco de props `envio` com todos os handlers como vi.fn(). */
function makeEnvio(over: Partial<ReturnType<typeof makeEnvio>> = {}) {
  const imageInputRef = { current: null } as React.MutableRefObject<HTMLInputElement | null>;
  const attachInputRef = { current: null } as React.MutableRefObject<HTMLInputElement | null>;
  return {
    sending: false,
    sendError: null as string | null,
    enviar: vi.fn(),
    onFileSelected: vi.fn(),
    onAttachSelected: vi.fn(),
    imageInputRef,
    attachInputRef,
    ...over,
  };
}

type RecordingState = 'idle' | 'recording' | 'paused';

/** Retorna o bloco de props `gravacao` com todos os handlers como vi.fn(). */
function makeGravacao(over: Partial<ReturnType<typeof makeGravacao>> = {}) {
  return {
    recording: 'idle' as RecordingState,
    recordSeconds: 0,
    startRecording: vi.fn(),
    pauseRecording: vi.fn(),
    resumeRecording: vi.fn(),
    stopRecording: vi.fn(),
    cancelRecording: vi.fn(),
    ...over,
  };
}

/** Templates query mínima (sem dados). */
function makeTemplatesQuery(data: RespostaRapida[] = []) {
  return {
    data,
    loading: false,
    error: null,
    refetch: vi.fn(),
  };
}

/** Props mínimas pro Composer (idle, WHATSAPP, texto vazio). */
function defaultProps(over: {
  conv?: Conversation | null;
  resposta?: string;
  setResposta?: (v: string) => void;
  respondendoA?: Mensagem | null;
  setRespondendoA?: (v: Mensagem | null) => void;
  emojiAberto?: boolean;
  setEmojiAberto?: (v: boolean | ((p: boolean) => boolean)) => void;
  templates?: ReturnType<typeof makeTemplatesQuery>;
  inserirTemplate?: (t: RespostaRapida) => void;
  envio?: ReturnType<typeof makeEnvio>;
  gravacao?: ReturnType<typeof makeGravacao>;
} = {}) {
  const composeRef = { current: null } as React.MutableRefObject<HTMLTextAreaElement | null>;
  return {
    conv: makeConv(),
    resposta: '',
    setResposta: vi.fn(),
    respondendoA: null,
    setRespondendoA: vi.fn(),
    composeRef,
    emojiAberto: false,
    setEmojiAberto: vi.fn(),
    templates: makeTemplatesQuery(),
    inserirTemplate: vi.fn(),
    envio: makeEnvio(),
    gravacao: makeGravacao(),
    ...over,
  };
}

afterEach(cleanup);

// ── Suite principal ──────────────────────────────────────────────────────────

describe('Composer', () => {
  // ── Render inicial ──────────────────────────────────────────────────────

  it('render inicial: textarea e botão Enviar presentes', () => {
    render(<Composer {...defaultProps()} />);
    expect(screen.getByTestId('inbox-compose')).toBeTruthy();
    expect(screen.getByTestId('inbox-send-btn')).toBeTruthy();
  });

  it('botão Enviar desabilitado quando resposta está vazia', () => {
    render(<Composer {...defaultProps({ resposta: '' })} />);
    const btn = screen.getByTestId('inbox-send-btn') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('botão Enviar desabilitado quando resposta é só espaços', () => {
    render(<Composer {...defaultProps({ resposta: '   ' })} />);
    const btn = screen.getByTestId('inbox-send-btn') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('botão Enviar habilitado quando resposta tem conteúdo', () => {
    render(<Composer {...defaultProps({ resposta: 'Olá' })} />);
    const btn = screen.getByTestId('inbox-send-btn') as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
  });

  // ── Ações de envio ──────────────────────────────────────────────────────

  it('clicar no botão Enviar chama envio.enviar', () => {
    const envio = makeEnvio({ sending: false });
    render(<Composer {...defaultProps({ resposta: 'oi', envio })} />);
    fireEvent.click(screen.getByTestId('inbox-send-btn'));
    expect(envio.enviar).toHaveBeenCalledTimes(1);
  });

  it('Ctrl+Enter na textarea chama envio.enviar', () => {
    const envio = makeEnvio();
    render(<Composer {...defaultProps({ resposta: 'oi', envio })} />);
    const ta = screen.getByTestId('inbox-compose');
    fireEvent.keyDown(ta, { key: 'Enter', ctrlKey: true });
    expect(envio.enviar).toHaveBeenCalledTimes(1);
  });

  it('Meta+Enter na textarea chama envio.enviar', () => {
    const envio = makeEnvio();
    render(<Composer {...defaultProps({ resposta: 'oi', envio })} />);
    const ta = screen.getByTestId('inbox-compose');
    fireEvent.keyDown(ta, { key: 'Enter', metaKey: true });
    expect(envio.enviar).toHaveBeenCalledTimes(1);
  });

  it('Enter sem modificador NÃO chama envio.enviar', () => {
    const envio = makeEnvio();
    render(<Composer {...defaultProps({ resposta: 'oi', envio })} />);
    fireEvent.keyDown(screen.getByTestId('inbox-compose'), { key: 'Enter' });
    expect(envio.enviar).not.toHaveBeenCalled();
  });

  it('botão Enviar desabilitado quando sending=true', () => {
    const envio = makeEnvio({ sending: true });
    render(<Composer {...defaultProps({ resposta: 'oi', envio })} />);
    const btn = screen.getByTestId('inbox-send-btn') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  // ── onChange da textarea chama setResposta ──────────────────────────────

  it('onChange na textarea chama setResposta com o novo valor', () => {
    const setResposta = vi.fn();
    render(<Composer {...defaultProps({ resposta: '', setResposta })} />);
    const ta = screen.getByTestId('inbox-compose') as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: 'texto novo' } });
    expect(setResposta).toHaveBeenCalledWith('texto novo');
  });

  // ── Locked compose (RESOLVIDA / ARQUIVADA) ──────────────────────────────

  it('conversa RESOLVIDA mostra lockedCompose (sem textarea)', () => {
    const conv = makeConv({ status: 'RESOLVIDA' });
    render(<Composer {...defaultProps({ conv })} />);
    expect(screen.queryByTestId('inbox-compose')).toBeNull();
    // Deve mostrar texto de "conversa resolvida"
    expect(screen.getByText(/Reabra pra responder/i)).toBeTruthy();
  });

  it('conversa ARQUIVADA mostra lockedCompose (sem textarea)', () => {
    const conv = makeConv({ status: 'ARQUIVADA' });
    render(<Composer {...defaultProps({ conv })} />);
    expect(screen.queryByTestId('inbox-compose')).toBeNull();
    expect(screen.getByText(/Reabra pra responder/i)).toBeTruthy();
  });

  // ── Canal bloqueado (Amazon / TikTok) ──────────────────────────────────

  it('canal MARKETPLACE_AMAZON mostra banner de bloqueio (sem textarea)', () => {
    const conv = makeConv({ canal: 'MARKETPLACE_AMAZON' });
    render(<Composer {...defaultProps({ conv })} />);
    expect(screen.getByTestId('inbox-canal-bloqueado')).toBeTruthy();
    expect(screen.queryByTestId('inbox-compose')).toBeNull();
  });

  it('canal MARKETPLACE_TIKTOK mostra banner de bloqueio', () => {
    const conv = makeConv({ canal: 'MARKETPLACE_TIKTOK' });
    render(<Composer {...defaultProps({ conv })} />);
    expect(screen.getByTestId('inbox-canal-bloqueado')).toBeTruthy();
  });

  it('canal MARKETPLACE_SHOPEE + DEVOLUCAO mostra banner de bloqueio', () => {
    const conv = makeConv({ canal: 'MARKETPLACE_SHOPEE', categoria: 'DEVOLUCAO' });
    render(<Composer {...defaultProps({ conv })} />);
    expect(screen.getByTestId('inbox-canal-bloqueado')).toBeTruthy();
  });

  it('canal MARKETPLACE_SHOPEE sem categoria bloqueada NÃO mostra banner', () => {
    const conv = makeConv({ canal: 'MARKETPLACE_SHOPEE', categoria: 'GERAL' });
    render(<Composer {...defaultProps({ conv })} />);
    expect(screen.queryByTestId('inbox-canal-bloqueado')).toBeNull();
    expect(screen.getByTestId('inbox-compose')).toBeTruthy();
  });

  // ── conv null / undefined ───────────────────────────────────────────────

  it('conv=null não renderiza nada (sem crash)', () => {
    render(<Composer {...defaultProps({ conv: null })} />);
    expect(screen.queryByTestId('inbox-compose')).toBeNull();
    expect(screen.queryByTestId('inbox-canal-bloqueado')).toBeNull();
  });

  // ── Botões de mídia (só canal WhatsApp) ────────────────────────────────

  it('canal WHATSAPP mostra botões de imagem, mic e arquivo', () => {
    const conv = makeConv({ canal: 'WHATSAPP' });
    render(<Composer {...defaultProps({ conv })} />);
    expect(screen.getByTestId('inbox-attach-image')).toBeTruthy();
    expect(screen.getByTestId('inbox-record-mic')).toBeTruthy();
    expect(screen.getByTestId('inbox-attach-file')).toBeTruthy();
  });

  it('canal INSTAGRAM não mostra botões de mídia', () => {
    const conv = makeConv({ canal: 'INSTAGRAM' });
    render(<Composer {...defaultProps({ conv })} />);
    expect(screen.queryByTestId('inbox-attach-image')).toBeNull();
    expect(screen.queryByTestId('inbox-record-mic')).toBeNull();
    expect(screen.queryByTestId('inbox-attach-file')).toBeNull();
  });

  it('canal EMAIL não mostra botões de mídia', () => {
    const conv = makeConv({ canal: 'EMAIL' });
    render(<Composer {...defaultProps({ conv })} />);
    expect(screen.queryByTestId('inbox-attach-image')).toBeNull();
  });

  it('botões de imagem/mic/attach desabilitados quando sending=true', () => {
    const envio = makeEnvio({ sending: true });
    render(<Composer {...defaultProps({ envio })} />);
    expect((screen.getByTestId('inbox-attach-image') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId('inbox-record-mic') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId('inbox-attach-file') as HTMLButtonElement).disabled).toBe(true);
  });

  it('botões de imagem/attach desabilitados quando recording != idle', () => {
    const gravacao = makeGravacao({ recording: 'recording' });
    render(<Composer {...defaultProps({ gravacao })} />);
    expect((screen.getByTestId('inbox-attach-image') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId('inbox-attach-file') as HTMLButtonElement).disabled).toBe(true);
  });

  // ── Preview "respondendo a…" ─────────────────────────────────────────────

  it('respondendoA nulo: sem preview de resposta', () => {
    render(<Composer {...defaultProps({ respondendoA: null })} />);
    expect(screen.queryByTestId('inbox-reply-preview')).toBeNull();
  });

  it('respondendoA preenchido: preview aparece com conteúdo e botão cancelar', () => {
    const msg = makeMensagem({ conteudo: 'Mensagem de teste', direction: 'INBOUND' });
    render(<Composer {...defaultProps({ respondendoA: msg })} />);
    const preview = screen.getByTestId('inbox-reply-preview');
    expect(preview).toBeTruthy();
    expect(within(preview).getByText('Mensagem de teste')).toBeTruthy();
    expect(screen.getByTestId('inbox-reply-cancel')).toBeTruthy();
  });

  it('clicar no cancelar da resposta chama setRespondendoA(null)', () => {
    const setRespondendoA = vi.fn();
    const msg = makeMensagem();
    render(<Composer {...defaultProps({ respondendoA: msg, setRespondendoA })} />);
    fireEvent.click(screen.getByTestId('inbox-reply-cancel'));
    expect(setRespondendoA).toHaveBeenCalledWith(null);
  });

  it('respondendoA OUTBOUND mostra "você mesmo"', () => {
    const msg = makeMensagem({ direction: 'OUTBOUND' });
    render(<Composer {...defaultProps({ respondendoA: msg })} />);
    expect(screen.getByText(/você mesmo/i)).toBeTruthy();
  });

  it('respondendoA sem conteúdo mostra [tipo]', () => {
    const msg = makeMensagem({ conteudo: null, tipo: 'IMAGE' });
    render(<Composer {...defaultProps({ respondendoA: msg })} />);
    const preview = screen.getByTestId('inbox-reply-preview');
    expect(within(preview).getByText('[image]')).toBeTruthy();
  });

  // ── Banner de gravação ──────────────────────────────────────────────────

  it('recording=idle: banner de gravação ausente', () => {
    render(<Composer {...defaultProps()} />);
    expect(screen.queryByTestId('recording-active')).toBeNull();
  });

  it('recording=recording: banner aparece com estado "Gravando"', () => {
    const gravacao = makeGravacao({ recording: 'recording', recordSeconds: 65 });
    render(<Composer {...defaultProps({ gravacao })} />);
    const banner = screen.getByTestId('recording-active');
    expect(banner).toBeTruthy();
    // Deve mostrar "Gravando — 1:05"
    expect(within(banner).getByText(/Gravando/)).toBeTruthy();
    expect(within(banner).getByText(/1:05/)).toBeTruthy();
  });

  it('recording=paused: banner aparece com estado "Pausado"', () => {
    const gravacao = makeGravacao({ recording: 'paused', recordSeconds: 30 });
    render(<Composer {...defaultProps({ gravacao })} />);
    const banner = screen.getByTestId('recording-active');
    expect(within(banner).getByText(/Pausado/)).toBeTruthy();
  });

  it('recording=recording: botão Pausar visível, Continuar ausente', () => {
    const gravacao = makeGravacao({ recording: 'recording' });
    render(<Composer {...defaultProps({ gravacao })} />);
    expect(screen.getByTestId('inbox-record-pause')).toBeTruthy();
    expect(screen.queryByTestId('inbox-record-resume')).toBeNull();
  });

  it('recording=paused: botão Continuar visível, Pausar ausente', () => {
    const gravacao = makeGravacao({ recording: 'paused' });
    render(<Composer {...defaultProps({ gravacao })} />);
    expect(screen.getByTestId('inbox-record-resume')).toBeTruthy();
    expect(screen.queryByTestId('inbox-record-pause')).toBeNull();
  });

  it('clicar Cancelar chama cancelRecording', () => {
    const gravacao = makeGravacao({ recording: 'recording' });
    render(<Composer {...defaultProps({ gravacao })} />);
    fireEvent.click(screen.getByTestId('inbox-record-cancel'));
    expect(gravacao.cancelRecording).toHaveBeenCalledTimes(1);
  });

  it('clicar Pausar chama pauseRecording', () => {
    const gravacao = makeGravacao({ recording: 'recording' });
    render(<Composer {...defaultProps({ gravacao })} />);
    fireEvent.click(screen.getByTestId('inbox-record-pause'));
    expect(gravacao.pauseRecording).toHaveBeenCalledTimes(1);
  });

  it('clicar Continuar chama resumeRecording', () => {
    const gravacao = makeGravacao({ recording: 'paused' });
    render(<Composer {...defaultProps({ gravacao })} />);
    fireEvent.click(screen.getByTestId('inbox-record-resume'));
    expect(gravacao.resumeRecording).toHaveBeenCalledTimes(1);
  });

  it('clicar Enviar no banner chama stopRecording', () => {
    const gravacao = makeGravacao({ recording: 'recording' });
    render(<Composer {...defaultProps({ gravacao })} />);
    fireEvent.click(screen.getByTestId('inbox-record-stop'));
    expect(gravacao.stopRecording).toHaveBeenCalledTimes(1);
  });

  // ── Botão Mic inicia gravação ───────────────────────────────────────────

  it('clicar Mic (idle) chama startRecording', () => {
    const gravacao = makeGravacao({ recording: 'idle' });
    render(<Composer {...defaultProps({ gravacao })} />);
    fireEvent.click(screen.getByTestId('inbox-record-mic'));
    expect(gravacao.startRecording).toHaveBeenCalledTimes(1);
  });

  it('clicar Mic quando recording=recording NÃO chama startRecording novamente', () => {
    const gravacao = makeGravacao({ recording: 'recording' });
    render(<Composer {...defaultProps({ gravacao })} />);
    // O botão está desabilitado quando recording!=idle
    const mic = screen.getByTestId('inbox-record-mic') as HTMLButtonElement;
    expect(mic.disabled).toBe(true);
    fireEvent.click(mic);
    expect(gravacao.startRecording).not.toHaveBeenCalled();
  });

  // ── Emoji picker ────────────────────────────────────────────────────────

  it('emojiAberto=false: picker fechado', () => {
    render(<Composer {...defaultProps({ emojiAberto: false })} />);
    expect(screen.queryByLabelText('Fechar emojis')).toBeNull();
  });

  it('emojiAberto=true: picker aberto (backdrop e emojis visíveis)', () => {
    render(<Composer {...defaultProps({ emojiAberto: true })} />);
    // Backdrop tem aria-label "Fechar emojis"
    expect(screen.getByLabelText('Fechar emojis')).toBeTruthy();
  });

  it('clicar no botão emoji chama setEmojiAberto com toggler', () => {
    const setEmojiAberto = vi.fn();
    render(<Composer {...defaultProps({ setEmojiAberto })} />);
    fireEvent.click(screen.getByTestId('inbox-emoji-btn'));
    expect(setEmojiAberto).toHaveBeenCalledTimes(1);
    // O argumento é uma função toggler — verifica que é função
    const arg = setEmojiAberto.mock.calls[0][0];
    expect(typeof arg).toBe('function');
  });

  it('clicar no backdrop fecha o emoji picker (chama setEmojiAberto(false))', () => {
    const setEmojiAberto = vi.fn();
    render(<Composer {...defaultProps({ emojiAberto: true, setEmojiAberto })} />);
    fireEvent.click(screen.getByLabelText('Fechar emojis'));
    expect(setEmojiAberto).toHaveBeenCalledWith(false);
  });

  it('clicar num emoji chama setResposta com o emoji inserido', () => {
    const setResposta = vi.fn();
    render(<Composer {...defaultProps({ resposta: 'oi', emojiAberto: true, setResposta })} />);
    // Pega o primeiro botão do picker (primeiro emoji da lista EMOJIS)
    // O grid está dentro do absolute depois do backdrop
    const allButtons = screen.getAllByRole('button');
    // O backdrop é o primeiro após o botão emoji; os emojis vêm logo depois.
    // Procura botão cujo textContent seja um dos emojis conhecidos (😀).
    const emojiBtn = allButtons.find((b) => b.textContent === '😀');
    expect(emojiBtn).toBeTruthy();
    fireEvent.click(emojiBtn!);
    expect(setResposta).toHaveBeenCalledTimes(1);
    // jsdom define selectionStart/End como 0 na textarea; a lógica de inserção é
    // resposta.slice(0, 0) + emoji + resposta.slice(0) = emoji + resposta.
    // O contrato que verificamos: setResposta foi chamado com um valor que CONTÉM
    // tanto o emoji quanto o texto original.
    const novoValor = setResposta.mock.calls[0][0] as string;
    expect(novoValor).toContain('😀');
    expect(novoValor).toContain('oi');
  });

  // ── Dropdown de templates ──────────────────────────────────────────────

  it('resposta não começa com "/": dropdown ausente', () => {
    const t = makeTemplate();
    render(<Composer {...defaultProps({ resposta: 'ola', templates: makeTemplatesQuery([t]) })} />);
    expect(screen.queryByTestId('template-t1')).toBeNull();
  });

  it('resposta="/" com templates disponíveis: dropdown aparece', () => {
    const t = makeTemplate({ id: 't1', atalho: '/ola', titulo: 'Saudação' });
    render(<Composer {...defaultProps({ resposta: '/', templates: makeTemplatesQuery([t]) })} />);
    expect(screen.getByTestId('template-t1')).toBeTruthy();
  });

  it('resposta="/ " (com espaço): dropdown NÃO aparece', () => {
    const t = makeTemplate({ id: 't1' });
    render(<Composer {...defaultProps({ resposta: '/ ', templates: makeTemplatesQuery([t]) })} />);
    expect(screen.queryByTestId('template-t1')).toBeNull();
  });

  it('clicar num template chama inserirTemplate com o objeto correto', () => {
    const inserirTemplate = vi.fn();
    const t = makeTemplate({ id: 't1', atalho: '/ola', titulo: 'Saudação' });
    render(
      <Composer
        {...defaultProps({ resposta: '/', templates: makeTemplatesQuery([t]), inserirTemplate })}
      />,
    );
    fireEvent.click(screen.getByTestId('template-t1'));
    expect(inserirTemplate).toHaveBeenCalledTimes(1);
    expect(inserirTemplate).toHaveBeenCalledWith(t);
  });

  it('Escape com dropdown aberto chama setResposta("")', () => {
    const setResposta = vi.fn();
    const t = makeTemplate({ id: 't1' });
    render(
      <Composer
        {...defaultProps({ resposta: '/', templates: makeTemplatesQuery([t]), setResposta })}
      />,
    );
    fireEvent.keyDown(screen.getByTestId('inbox-compose'), { key: 'Escape' });
    expect(setResposta).toHaveBeenCalledWith('');
  });

  it('Ctrl+/ chama setResposta("/")', () => {
    const setResposta = vi.fn();
    render(<Composer {...defaultProps({ resposta: 'oi', setResposta })} />);
    fireEvent.keyDown(screen.getByTestId('inbox-compose'), { key: '/', ctrlKey: true });
    expect(setResposta).toHaveBeenCalledWith('/');
  });

  it('filtro de template por atalho: "/sau" filtra pra templates com "sau" no atalho', () => {
    const t1 = makeTemplate({ id: 't1', atalho: '/ola', titulo: 'Ola' });
    const t2 = makeTemplate({ id: 't2', atalho: '/saudacao', titulo: 'Saudação' });
    render(
      <Composer
        {...defaultProps({ resposta: '/sau', templates: makeTemplatesQuery([t1, t2]) })}
      />,
    );
    expect(screen.queryByTestId('template-t1')).toBeNull();
    expect(screen.getByTestId('template-t2')).toBeTruthy();
  });

  // ── sendError / contador ─────────────────────────────────────────────────

  it('sendError nulo: mostra dica de atalho (Ctrl+Enter)', () => {
    render(<Composer {...defaultProps()} />);
    expect(screen.getByText(/Ctrl \+ Enter/i)).toBeTruthy();
  });

  it('sendError preenchido: mostra a mensagem de erro', () => {
    const envio = makeEnvio({ sendError: 'Falha ao enviar' });
    render(<Composer {...defaultProps({ envio })} />);
    expect(screen.getByText(/Falha ao enviar/)).toBeTruthy();
  });

  it('sendError com "pareado" mostra link de reconexão', () => {
    const envio = makeEnvio({ sendError: 'Não pareado com o dispositivo' });
    render(<Composer {...defaultProps({ envio })} />);
    expect(screen.getByText(/reconectar agora/i)).toBeTruthy();
  });

  it('sendError com "connection closed" mostra link de reconexão (case-insensitive)', () => {
    const envio = makeEnvio({ sendError: 'Connection Closed pelo servidor' });
    render(<Composer {...defaultProps({ envio })} />);
    expect(screen.getByText(/reconectar agora/i)).toBeTruthy();
  });

  it('sendError genérico (sem keyword) NÃO mostra link de reconexão', () => {
    const envio = makeEnvio({ sendError: 'Erro desconhecido' });
    render(<Composer {...defaultProps({ envio })} />);
    expect(screen.queryByText(/reconectar agora/i)).toBeNull();
  });

  it('contador de caracteres reflete resposta.length/4096', () => {
    render(<Composer {...defaultProps({ resposta: 'oi' })} />);
    expect(screen.getByText('2/4096')).toBeTruthy();
  });

  it('contador zero quando resposta vazia', () => {
    render(<Composer {...defaultProps({ resposta: '' })} />);
    expect(screen.getByText('0/4096')).toBeTruthy();
  });

  // ── Inputs de arquivo ocultos ─────────────────────────────────────────

  it('inputs de arquivo image e attach estão presentes no DOM (hidden)', () => {
    render(<Composer {...defaultProps()} />);
    expect(screen.getByTestId('inbox-file-image')).toBeTruthy();
    expect(screen.getByTestId('inbox-file-attach')).toBeTruthy();
  });
});
