import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ThreadHeader } from './ThreadHeader';
import type { Conversation } from '../lib/types';

afterEach(() => cleanup());

// Conversa mínima válida pra maioria dos testes
function fakeConv(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: 'conv-1',
    canal: 'WHATSAPP',
    status: 'ABERTA',
    peerId: '5511988887777@s.whatsapp.net',
    ...overrides,
  };
}

// Props base reutilizáveis
function defaultAcoes() {
  return {
    mudarStatus: vi.fn(),
    alternarBot: vi.fn(),
    definirBotLigado: vi.fn(),
    zerarConversa: vi.fn(),
  };
}

function montarHeader(
  conv: Conversation | null | undefined,
  opts: {
    role?: 'ADMIN' | 'DIRECTOR' | 'GERENTE' | 'SAC' | 'REP' | null;
    botGlobalAtivo?: boolean;
    onBack?: () => void;
    onAbrirCliente?: () => void;
    onAbrirNotas?: () => void;
    onAtribuir?: () => void;
    onCriarPedido?: () => void;
    acoes?: ReturnType<typeof defaultAcoes>;
  } = {},
) {
  const acoes = opts.acoes ?? defaultAcoes();
  const onAbrirCliente = opts.onAbrirCliente ?? vi.fn();
  const onAbrirNotas = opts.onAbrirNotas ?? vi.fn();
  const onAtribuir = opts.onAtribuir ?? vi.fn();
  const onCriarPedido = opts.onCriarPedido ?? vi.fn();

  return {
    ...render(
      <ThreadHeader
        conv={conv}
        botGlobalAtivo={opts.botGlobalAtivo ?? false}
        role={opts.role ?? null}
        onBack={opts.onBack}
        acoes={acoes}
        onAbrirCliente={onAbrirCliente}
        onAbrirNotas={onAbrirNotas}
        onAtribuir={onAtribuir}
        onCriarPedido={onCriarPedido}
      />,
    ),
    acoes,
    onAbrirCliente,
    onAbrirNotas,
    onAtribuir,
    onCriarPedido,
  };
}

describe('ThreadHeader — estado sem conversa', () => {
  it('mostra "Carregando…" quando conv é null', () => {
    montarHeader(null);
    const el = screen.getByText('Carregando…');
    expect(el).toBeTruthy();
  });

  it('mostra "Carregando…" quando conv é undefined', () => {
    montarHeader(undefined);
    const el = screen.getByText('Carregando…');
    expect(el).toBeTruthy();
  });
});

describe('ThreadHeader — renderização com conversa', () => {
  it('mostra o nome do peerNome quando não há cliente', () => {
    const conv = fakeConv({ peerNome: 'João Silva', canal: 'WHATSAPP' });
    montarHeader(conv);
    const el = screen.getByText('João Silva');
    expect(el).toBeTruthy();
  });

  it('prefere cliente.nome sobre peerNome', () => {
    const conv = fakeConv({
      peerNome: 'Peer Name',
      cliente: { id: 'c1', nome: 'Empresa ABC' },
    });
    montarHeader(conv);
    // cliente.nome deve aparecer
    const el = screen.getByText('Empresa ABC');
    expect(el).toBeTruthy();
  });

  it('mostra o peer-testid com canal label quando não há nome nem telefone', () => {
    // peerId LID → fmtPeer retorna '' → mostra CANAL_LABEL
    const conv = fakeConv({
      peerId: '123456789@lid',
      peerNome: null,
      cliente: null,
    });
    montarHeader(conv);
    const peer = screen.getByTestId('inbox-thread-peer');
    // Deve mostrar o label do canal "WhatsApp"
    expect(peer.textContent).toBe('WhatsApp');
  });

  it('renderiza botão Notas sempre que há conversa', () => {
    montarHeader(fakeConv());
    const btn = screen.getByTestId('inbox-notas-btn');
    expect(btn).toBeTruthy();
  });

  it('renderiza botão Atribuir quando conv está presente', () => {
    montarHeader(fakeConv());
    const btn = screen.getByTestId('inbox-atribuir-btn');
    expect(btn).toBeTruthy();
  });

  it('mostra nome do atribuído no botão quando conv.atribuido está preenchido', () => {
    const conv = fakeConv({ atribuido: { id: 'u1', nome: 'Ana Costa' } });
    montarHeader(conv);
    const btn = screen.getByTestId('inbox-atribuir-btn');
    expect(btn.textContent).toContain('Ana Costa');
  });

  it('mostra "Atribuir" quando conv.atribuido é null', () => {
    const conv = fakeConv({ atribuido: null });
    montarHeader(conv);
    const btn = screen.getByTestId('inbox-atribuir-btn');
    expect(btn.textContent).toContain('Atribuir');
  });

  it('NÃO exibe botões Cliente/Pedido quando conv não tem cliente', () => {
    const conv = fakeConv({ cliente: null });
    montarHeader(conv);
    expect(screen.queryByTestId('inbox-cliente-btn')).toBeNull();
    expect(screen.queryByTestId('inbox-criar-pedido-btn')).toBeNull();
  });

  it('exibe botões Cliente e Pedido quando conv tem cliente.id', () => {
    const conv = fakeConv({ cliente: { id: 'c1', nome: 'Empresa ABC' } });
    montarHeader(conv);
    expect(screen.getByTestId('inbox-cliente-btn')).toBeTruthy();
    expect(screen.getByTestId('inbox-criar-pedido-btn')).toBeTruthy();
  });

  it('NÃO exibe botão Voltar quando onBack não é passado', () => {
    montarHeader(fakeConv(), { onBack: undefined });
    expect(screen.queryByTestId('inbox-back-btn')).toBeNull();
  });

  it('exibe botão Voltar quando onBack é passado', () => {
    montarHeader(fakeConv(), { onBack: vi.fn() });
    expect(screen.getByTestId('inbox-back-btn')).toBeTruthy();
  });

  it('EXIBE botão Zerar pra role SAC (equipe de atendimento gerencia o inbox)', () => {
    montarHeader(fakeConv(), { role: 'SAC' });
    expect(screen.getByTestId('inbox-zerar-conversa-btn')).toBeTruthy();
  });

  it('NÃO exibe botão Zerar pra role REP', () => {
    montarHeader(fakeConv(), { role: 'REP' });
    expect(screen.queryByTestId('inbox-zerar-conversa-btn')).toBeNull();
  });

  it('exibe botão Zerar pra role ADMIN', () => {
    montarHeader(fakeConv(), { role: 'ADMIN' });
    expect(screen.getByTestId('inbox-zerar-conversa-btn')).toBeTruthy();
  });

  it('exibe botão Zerar pra role DIRECTOR', () => {
    montarHeader(fakeConv(), { role: 'DIRECTOR' });
    expect(screen.getByTestId('inbox-zerar-conversa-btn')).toBeTruthy();
  });

  it('renderiza o select de status com o valor atual da conversa', () => {
    const conv = fakeConv({ status: 'PENDENTE' });
    montarHeader(conv);
    const sel = screen.getByTestId('inbox-status-select') as HTMLSelectElement;
    expect(sel.value).toBe('PENDENTE');
  });
});

describe('ThreadHeader — callbacks de ação', () => {
  it('onBack é chamado ao clicar no botão Voltar', () => {
    const onBack = vi.fn();
    montarHeader(fakeConv(), { onBack });
    fireEvent.click(screen.getByTestId('inbox-back-btn'));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('onAbrirNotas é chamado ao clicar em Notas', () => {
    const onAbrirNotas = vi.fn();
    montarHeader(fakeConv(), { onAbrirNotas });
    fireEvent.click(screen.getByTestId('inbox-notas-btn'));
    expect(onAbrirNotas).toHaveBeenCalledTimes(1);
  });

  it('onAtribuir é chamado ao clicar em Atribuir', () => {
    const onAtribuir = vi.fn();
    montarHeader(fakeConv(), { onAtribuir });
    fireEvent.click(screen.getByTestId('inbox-atribuir-btn'));
    expect(onAtribuir).toHaveBeenCalledTimes(1);
  });

  it('onAbrirCliente é chamado ao clicar em Cliente', () => {
    const onAbrirCliente = vi.fn();
    const conv = fakeConv({ cliente: { id: 'c1', nome: 'X' } });
    montarHeader(conv, { onAbrirCliente });
    fireEvent.click(screen.getByTestId('inbox-cliente-btn'));
    expect(onAbrirCliente).toHaveBeenCalledTimes(1);
  });

  it('onCriarPedido é chamado ao clicar em Pedido', () => {
    const onCriarPedido = vi.fn();
    const conv = fakeConv({ cliente: { id: 'c1', nome: 'X' } });
    montarHeader(conv, { onCriarPedido });
    fireEvent.click(screen.getByTestId('inbox-criar-pedido-btn'));
    expect(onCriarPedido).toHaveBeenCalledTimes(1);
  });

  it('mudarStatus é chamado com o valor selecionado ao trocar o select', () => {
    const acoes = defaultAcoes();
    montarHeader(fakeConv({ status: 'ABERTA' }), { acoes });
    fireEvent.change(screen.getByTestId('inbox-status-select'), {
      target: { value: 'RESOLVIDA' },
    });
    expect(acoes.mudarStatus).toHaveBeenCalledWith('RESOLVIDA');
  });
});

describe('ThreadHeader — botão Zerar (2 cliques)', () => {
  it('primeiro clique muda label para "Confirmar?" (sem chamar zerarConversa)', () => {
    const acoes = defaultAcoes();
    montarHeader(fakeConv(), { role: 'ADMIN', acoes });
    const btn = screen.getByTestId('inbox-zerar-conversa-btn');
    expect(btn.textContent).toContain('Zerar');
    fireEvent.click(btn);
    expect(btn.textContent).toContain('Confirmar?');
    expect(acoes.zerarConversa).not.toHaveBeenCalled();
  });

  it('segundo clique chama zerarConversa', () => {
    const acoes = defaultAcoes();
    montarHeader(fakeConv(), { role: 'ADMIN', acoes });
    const btn = screen.getByTestId('inbox-zerar-conversa-btn');
    fireEvent.click(btn); // 1º — entra em confirmação
    fireEvent.click(btn); // 2º — confirma
    expect(acoes.zerarConversa).toHaveBeenCalledTimes(1);
  });
});

describe('ThreadHeader — controles do bot (WHATSAPP)', () => {
  it('exibe o select de override do bot em conversas WhatsApp', () => {
    montarHeader(fakeConv({ canal: 'WHATSAPP', botLigado: null }));
    expect(screen.getByTestId('inbox-bot-override')).toBeTruthy();
  });

  it('NÃO exibe select de override em canal não-WhatsApp', () => {
    montarHeader(fakeConv({ canal: 'INSTAGRAM' }));
    expect(screen.queryByTestId('inbox-bot-override')).toBeNull();
  });

  it('select de override reflete botLigado=true → valor "on"', () => {
    const conv = fakeConv({ canal: 'WHATSAPP', botLigado: true });
    montarHeader(conv);
    const sel = screen.getByTestId('inbox-bot-override') as HTMLSelectElement;
    expect(sel.value).toBe('on');
  });

  it('select de override reflete botLigado=false → valor "off"', () => {
    const conv = fakeConv({ canal: 'WHATSAPP', botLigado: false });
    montarHeader(conv);
    const sel = screen.getByTestId('inbox-bot-override') as HTMLSelectElement;
    expect(sel.value).toBe('off');
  });

  it('select de override reflete botLigado=null → valor "auto"', () => {
    const conv = fakeConv({ canal: 'WHATSAPP', botLigado: null });
    montarHeader(conv);
    const sel = screen.getByTestId('inbox-bot-override') as HTMLSelectElement;
    expect(sel.value).toBe('auto');
  });

  it('definirBotLigado(true) chamado ao selecionar "on"', () => {
    const acoes = defaultAcoes();
    montarHeader(fakeConv({ canal: 'WHATSAPP', botLigado: null }), { acoes });
    fireEvent.change(screen.getByTestId('inbox-bot-override'), {
      target: { value: 'on' },
    });
    expect(acoes.definirBotLigado).toHaveBeenCalledWith(true);
  });

  it('definirBotLigado(null) chamado ao selecionar "auto"', () => {
    const acoes = defaultAcoes();
    montarHeader(fakeConv({ canal: 'WHATSAPP', botLigado: true }), { acoes });
    fireEvent.change(screen.getByTestId('inbox-bot-override'), {
      target: { value: 'auto' },
    });
    expect(acoes.definirBotLigado).toHaveBeenCalledWith(null);
  });

  it('mostra botão Pausar bot quando bot está efetivamente on e não pausado', () => {
    // botLigado=null (auto) + botGlobalAtivo=true → efetivamente on
    const conv = fakeConv({
      canal: 'WHATSAPP',
      botLigado: null,
      botPausadoAte: null,
      precisaHumano: false,
    });
    montarHeader(conv, { botGlobalAtivo: true });
    expect(screen.getByTestId('inbox-bot-btn')).toBeTruthy();
  });

  it('NÃO mostra botão Pausar bot quando bot está efetivamente off', () => {
    // botLigado=null + botGlobalAtivo=false → efetivamente off
    const conv = fakeConv({
      canal: 'WHATSAPP',
      botLigado: null,
      precisaHumano: false,
    });
    montarHeader(conv, { botGlobalAtivo: false });
    expect(screen.queryByTestId('inbox-bot-btn')).toBeNull();
  });

  it('mostra botão Religar quando precisaHumano=true', () => {
    const conv = fakeConv({
      canal: 'WHATSAPP',
      botLigado: null,
      precisaHumano: true,
    });
    montarHeader(conv, { botGlobalAtivo: true });
    expect(screen.getByTestId('inbox-bot-religar')).toBeTruthy();
  });

  it('alternarBot("pausar") chamado ao clicar em Pausar bot', () => {
    const acoes = defaultAcoes();
    const conv = fakeConv({
      canal: 'WHATSAPP',
      botLigado: null,
      botPausadoAte: null,
      precisaHumano: false,
    });
    montarHeader(conv, { botGlobalAtivo: true, acoes });
    fireEvent.click(screen.getByTestId('inbox-bot-btn'));
    expect(acoes.alternarBot).toHaveBeenCalledWith('pausar');
  });

  it('alternarBot("religar") chamado ao clicar em Religar bot', () => {
    const acoes = defaultAcoes();
    const conv = fakeConv({
      canal: 'WHATSAPP',
      botLigado: null,
      precisaHumano: true,
    });
    montarHeader(conv, { botGlobalAtivo: true, acoes });
    fireEvent.click(screen.getByTestId('inbox-bot-religar'));
    expect(acoes.alternarBot).toHaveBeenCalledWith('religar');
  });
});
