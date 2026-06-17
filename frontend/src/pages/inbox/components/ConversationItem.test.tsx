/**
 * Testes de render para ConversationItem.
 *
 * Observáveis cobertos:
 *  - nome do contato (cliente.nome > peerNome > fmtPeer > CANAL_LABEL)
 *  - preview da última mensagem (e fallback "sem mensagens")
 *  - horário formatado via fmtRelative (roda de verdade — função pura)
 *  - badge de não-lidas: count > 1 aparece; count = 0 some
 *  - indicador de "não lida" (span aria-label) quando naoLidas = 1
 *  - indicador de estado ativo (span aria-hidden diferente do inativo)
 *  - clicar no item chama onClick com o id correto
 *  - badge de SLA (inbox-sla-badge) aparece/some conforme aguardandoDesde
 *  - badge "Precisa de humano" quando precisaHumano=true
 *  - badge "Bot pausado" quando bot efetivo on + botPausadoAte no futuro
 *  - badge de status (PENDENTE, RESOLVIDA, ARQUIVADA) quando != ABERTA
 *  - nome do atribuído aparece na linha de badges
 */

import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { ConversationItem } from './ConversationItem';
import type { Conversation } from '../lib/types';

afterEach(() => cleanup());

// ─── factory ──────────────────────────────────────────────────────────────────

function makeConv(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: 'c1',
    canal: 'WHATSAPP',
    status: 'ABERTA',
    peerId: '5511999990001@s.whatsapp.net',
    naoLidas: 0,
    ultimaMsgPreview: 'Olá tudo bem',
    ultimaMsgEm: new Date(Date.now() - 5 * 60 * 1000).toISOString(), // 5 min atrás
    ...overrides,
  };
}

// ─── nome do contato ──────────────────────────────────────────────────────────

describe('nome do contato', () => {
  it('usa cliente.nome quando presente', () => {
    const conv = makeConv({ cliente: { id: 'u1', nome: 'João Silva' } });
    render(<ConversationItem conv={conv} active={false} botGlobalAtivo={false} onClick={vi.fn()} />);
    const btn = screen.getByTestId('conv-card-c1');
    expect(btn.querySelector('strong')?.textContent).toBe('João Silva');
  });

  it('usa peerNome quando não há cliente', () => {
    const conv = makeConv({ peerNome: 'Maria Souza' });
    render(<ConversationItem conv={conv} active={false} botGlobalAtivo={false} onClick={vi.fn()} />);
    expect(screen.getByTestId('conv-card-c1').querySelector('strong')?.textContent).toBe('Maria Souza');
  });

  it('usa fmtPeer (telefone br) quando nem cliente nem peerNome', () => {
    // peerId = número BR 13 dígitos (55 + DDD 11 + 9 dígitos)
    // fmtPeer: ddd=11, num=999990001 (9 dígitos) → "+55 (11) 99999-0001"
    const conv = makeConv({ peerId: '5511999990001@s.whatsapp.net' });
    render(<ConversationItem conv={conv} active={false} botGlobalAtivo={false} onClick={vi.fn()} />);
    const text = screen.getByTestId('conv-card-c1').querySelector('strong')?.textContent ?? '';
    expect(text).toBe('+55 (11) 99999-0001');
  });

  it('cai para CANAL_LABEL quando peer não formata', () => {
    // LID — fmtPeer retorna ''
    const conv = makeConv({ peerId: '123456789@lid', peerNome: null, cliente: null });
    render(<ConversationItem conv={conv} active={false} botGlobalAtivo={false} onClick={vi.fn()} />);
    const text = screen.getByTestId('conv-card-c1').querySelector('strong')?.textContent ?? '';
    expect(text).toBe('WhatsApp');
  });
});

// ─── preview da mensagem ─────────────────────────────────────────────────────

describe('preview da mensagem', () => {
  it('mostra o texto do preview quando presente', () => {
    const conv = makeConv({ ultimaMsgPreview: 'Quero pedir um orçamento' });
    render(<ConversationItem conv={conv} active={false} botGlobalAtivo={false} onClick={vi.fn()} />);
    const btn = screen.getByTestId('conv-card-c1');
    expect(btn.textContent).toContain('Quero pedir um orçamento');
  });

  it('mostra "sem mensagens" quando ultimaMsgPreview é null', () => {
    const conv = makeConv({ ultimaMsgPreview: null });
    render(<ConversationItem conv={conv} active={false} botGlobalAtivo={false} onClick={vi.fn()} />);
    expect(screen.getByTestId('conv-card-c1').textContent).toContain('sem mensagens');
  });
});

// ─── horário formatado ────────────────────────────────────────────────────────

describe('horário formatado (fmtRelative — função pura)', () => {
  it('mostra "agora" para mensagem enviada há < 60s', () => {
    const conv = makeConv({ ultimaMsgEm: new Date(Date.now() - 10_000).toISOString() });
    render(<ConversationItem conv={conv} active={false} botGlobalAtivo={false} onClick={vi.fn()} />);
    expect(screen.getByTestId('conv-card-c1').textContent).toContain('agora');
  });

  it('mostra "Xmin" para mensagem enviada há alguns minutos', () => {
    const conv = makeConv({ ultimaMsgEm: new Date(Date.now() - 5 * 60_000).toISOString() });
    render(<ConversationItem conv={conv} active={false} botGlobalAtivo={false} onClick={vi.fn()} />);
    expect(screen.getByTestId('conv-card-c1').textContent).toContain('5min');
  });

  it('retorna string vazia quando ultimaMsgEm é null', () => {
    const conv = makeConv({ ultimaMsgEm: null });
    render(<ConversationItem conv={conv} active={false} botGlobalAtivo={false} onClick={vi.fn()} />);
    // Não deve lançar erro — componente renderiza sem horário
    expect(screen.getByTestId('conv-card-c1')).toBeTruthy();
  });
});

// ─── badge de não-lidas (count) ──────────────────────────────────────────────

describe('badge de não-lidas (contador)', () => {
  it('NÃO renderiza badge de contagem quando naoLidas = 0', () => {
    const conv = makeConv({ naoLidas: 0 });
    render(<ConversationItem conv={conv} active={false} botGlobalAtivo={false} onClick={vi.fn()} />);
    expect(screen.queryByTestId('conv-unread-c1')).toBeNull();
  });

  it('NÃO renderiza badge de contagem quando naoLidas = 1 (exibe ponto, não contador)', () => {
    const conv = makeConv({ naoLidas: 1 });
    render(<ConversationItem conv={conv} active={false} botGlobalAtivo={false} onClick={vi.fn()} />);
    expect(screen.queryByTestId('conv-unread-c1')).toBeNull();
  });

  it('renderiza badge de contagem quando naoLidas > 1', () => {
    const conv = makeConv({ naoLidas: 5 });
    render(<ConversationItem conv={conv} active={false} botGlobalAtivo={false} onClick={vi.fn()} />);
    const badge = screen.getByTestId('conv-unread-c1');
    expect(badge).toBeTruthy();
    expect(badge.textContent).toBe('5');
  });

  it('mostra o número correto de não-lidas', () => {
    const conv = makeConv({ naoLidas: 23 });
    render(<ConversationItem conv={conv} active={false} botGlobalAtivo={false} onClick={vi.fn()} />);
    expect(screen.getByTestId('conv-unread-c1').textContent).toBe('23');
  });
});

// ─── indicador de não-lida (ponto / ping) ────────────────────────────────────

describe('indicador de não-lida (ponto/ping)', () => {
  it('NÃO mostra span "Não lida" / "Mensagem nova" quando naoLidas = 0', () => {
    const conv = makeConv({ naoLidas: 0 });
    render(<ConversationItem conv={conv} active={false} botGlobalAtivo={false} onClick={vi.fn()} />);
    expect(screen.queryByLabelText('Não lida')).toBeNull();
    expect(screen.queryByLabelText('Mensagem nova')).toBeNull();
  });

  it('mostra indicador de não-lida quando naoLidas = 1 (msg não recente → ponto estático)', () => {
    // ultimaMsgEm mais de 30s atrás → ponto estático aria-label="Não lida"
    const conv = makeConv({
      naoLidas: 1,
      ultimaMsgEm: new Date(Date.now() - 60_000).toISOString(),
    });
    render(<ConversationItem conv={conv} active={false} botGlobalAtivo={false} onClick={vi.fn()} />);
    expect(screen.getByLabelText('Não lida')).toBeTruthy();
  });

  it('mostra indicador "Mensagem nova" (ping) quando recente < 30s', () => {
    const conv = makeConv({
      naoLidas: 1,
      ultimaMsgEm: new Date(Date.now() - 5_000).toISOString(),
    });
    render(<ConversationItem conv={conv} active={false} botGlobalAtivo={false} onClick={vi.fn()} />);
    expect(screen.getByLabelText('Mensagem nova')).toBeTruthy();
  });
});

// ─── estado ativo ─────────────────────────────────────────────────────────────

describe('estado ativo (selecionado)', () => {
  it('renderiza span de indicador ativo quando active=true', () => {
    const conv = makeConv();
    const { container } = render(
      <ConversationItem conv={conv} active={true} botGlobalAtivo={false} onClick={vi.fn()} />,
    );
    // Span com classe bg-primary (indicador lateral azul) só existe quando active
    const indicator = container.querySelector('.bg-primary');
    expect(indicator).toBeTruthy();
  });

  it('NÃO renderiza indicador ativo quando active=false', () => {
    const conv = makeConv();
    const { container } = render(
      <ConversationItem conv={conv} active={false} botGlobalAtivo={false} onClick={vi.fn()} />,
    );
    // A classe bg-primary aparece apenas no indicador lateral ativo
    // (o badge de não-lidas usa bg-primary mas só com naoLidas>1 — aqui=0)
    // span de indicador lateral tem classe rounded-r bg-primary — específico
    const lateralIndicator = container.querySelector('.rounded-r.bg-primary');
    expect(lateralIndicator).toBeNull();
  });

  it('aplica bg-surface-hover ao botão quando active=true', () => {
    const conv = makeConv();
    const { container } = render(
      <ConversationItem conv={conv} active={true} botGlobalAtivo={false} onClick={vi.fn()} />,
    );
    const btn = container.querySelector('button');
    expect(btn?.className).toContain('bg-surface-hover');
  });
});

// ─── callback onClick ─────────────────────────────────────────────────────────

describe('callback onClick', () => {
  it('chama onClick com o id correto ao clicar', () => {
    const onClick = vi.fn();
    const conv = makeConv({ id: 'xyz-123' });
    render(<ConversationItem conv={conv} active={false} botGlobalAtivo={false} onClick={onClick} />);
    fireEvent.click(screen.getByTestId('conv-card-xyz-123'));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onClick).toHaveBeenCalledWith('xyz-123');
  });

  it('chama onClick sempre com o id da conversa renderizada', () => {
    const onClick = vi.fn();
    const conv = makeConv({ id: 'abc' });
    render(<ConversationItem conv={conv} active={false} botGlobalAtivo={false} onClick={onClick} />);
    fireEvent.click(screen.getByTestId('conv-card-abc'));
    expect(onClick).toHaveBeenCalledWith('abc');
  });
});

// ─── badge de SLA ─────────────────────────────────────────────────────────────

describe('badge de SLA', () => {
  it('NÃO renderiza badge de SLA quando aguardandoDesde é null', () => {
    const conv = makeConv({ aguardandoDesde: null });
    render(<ConversationItem conv={conv} active={false} botGlobalAtivo={false} onClick={vi.fn()} />);
    expect(screen.queryByTestId('inbox-sla-badge')).toBeNull();
  });

  it('renderiza badge de SLA quando aguardandoDesde está preenchido', () => {
    // Aguardando há 10 min → texto "aguardando há 10min"
    const conv = makeConv({
      aguardandoDesde: new Date(Date.now() - 10 * 60_000).toISOString(),
    });
    render(<ConversationItem conv={conv} active={false} botGlobalAtivo={false} onClick={vi.fn()} />);
    const badge = screen.getByTestId('inbox-sla-badge');
    expect(badge).toBeTruthy();
    expect(badge.textContent).toContain('aguardando há 10min');
  });
});

// ─── badge "Precisa de humano" ────────────────────────────────────────────────

describe('badge precisaHumano', () => {
  it('NÃO mostra badge quando precisaHumano = false', () => {
    const conv = makeConv({ precisaHumano: false });
    render(<ConversationItem conv={conv} active={false} botGlobalAtivo={false} onClick={vi.fn()} />);
    expect(screen.queryByText(/Precisa de humano/)).toBeNull();
  });

  it('mostra badge quando precisaHumano = true', () => {
    const conv = makeConv({ precisaHumano: true });
    render(<ConversationItem conv={conv} active={false} botGlobalAtivo={false} onClick={vi.fn()} />);
    expect(screen.getByText(/Precisa de humano/)).toBeTruthy();
  });
});

// ─── badge "Bot pausado" ──────────────────────────────────────────────────────

describe('badge botPausado', () => {
  it('NÃO mostra "Bot pausado" quando bot está desligado nesta conversa', () => {
    const conv = makeConv({
      botLigado: false,
      botPausadoAte: new Date(Date.now() + 60_000).toISOString(),
    });
    render(<ConversationItem conv={conv} active={false} botGlobalAtivo={true} onClick={vi.fn()} />);
    expect(screen.queryByText(/Bot pausado/)).toBeNull();
  });

  it('NÃO mostra "Bot pausado" quando botPausadoAte é null', () => {
    const conv = makeConv({ botLigado: true, botPausadoAte: null });
    render(<ConversationItem conv={conv} active={false} botGlobalAtivo={true} onClick={vi.fn()} />);
    expect(screen.queryByText(/Bot pausado/)).toBeNull();
  });

  it('mostra "Bot pausado" quando bot efetivo on e pausadoAte no futuro', () => {
    const conv = makeConv({
      botLigado: true,
      botPausadoAte: new Date(Date.now() + 60_000).toISOString(),
    });
    render(<ConversationItem conv={conv} active={false} botGlobalAtivo={false} onClick={vi.fn()} />);
    expect(screen.getByText(/Bot pausado/)).toBeTruthy();
  });

  it('mostra "Bot pausado" quando botLigado=null e botGlobalAtivo=true', () => {
    const conv = makeConv({
      botLigado: null,
      botPausadoAte: new Date(Date.now() + 60_000).toISOString(),
    });
    render(<ConversationItem conv={conv} active={false} botGlobalAtivo={true} onClick={vi.fn()} />);
    expect(screen.getByText(/Bot pausado/)).toBeTruthy();
  });

  it('NÃO mostra "Bot pausado" quando botPausadoAte já passou', () => {
    const conv = makeConv({
      botLigado: true,
      botPausadoAte: new Date(Date.now() - 60_000).toISOString(),
    });
    render(<ConversationItem conv={conv} active={false} botGlobalAtivo={false} onClick={vi.fn()} />);
    expect(screen.queryByText(/Bot pausado/)).toBeNull();
  });
});

// ─── badge de status ─────────────────────────────────────────────────────────

describe('badge de status', () => {
  it('NÃO mostra badge de status quando status = ABERTA', () => {
    const conv = makeConv({ status: 'ABERTA' });
    render(<ConversationItem conv={conv} active={false} botGlobalAtivo={false} onClick={vi.fn()} />);
    expect(screen.queryByText('Aberta')).toBeNull();
  });

  it('mostra badge "Pendente" quando status = PENDENTE', () => {
    const conv = makeConv({ status: 'PENDENTE' });
    render(<ConversationItem conv={conv} active={false} botGlobalAtivo={false} onClick={vi.fn()} />);
    expect(screen.getByText('Pendente')).toBeTruthy();
  });

  it('mostra badge "Resolvida" quando status = RESOLVIDA', () => {
    const conv = makeConv({ status: 'RESOLVIDA' });
    render(<ConversationItem conv={conv} active={false} botGlobalAtivo={false} onClick={vi.fn()} />);
    expect(screen.getByText('Resolvida')).toBeTruthy();
  });

  it('mostra badge "Arquivada" quando status = ARQUIVADA', () => {
    const conv = makeConv({ status: 'ARQUIVADA' });
    render(<ConversationItem conv={conv} active={false} botGlobalAtivo={false} onClick={vi.fn()} />);
    expect(screen.getByText('Arquivada')).toBeTruthy();
  });
});

// ─── atribuído ────────────────────────────────────────────────────────────────

describe('atribuído', () => {
  it('NÃO mostra nome do atribuído quando atribuido é null', () => {
    const conv = makeConv({ atribuido: null });
    render(<ConversationItem conv={conv} active={false} botGlobalAtivo={false} onClick={vi.fn()} />);
    expect(screen.queryByText(/·/)).toBeNull();
  });

  it('mostra nome do atribuído quando presente', () => {
    const conv = makeConv({ atribuido: { id: 'u2', nome: 'Carlos Atendente' } });
    render(<ConversationItem conv={conv} active={false} botGlobalAtivo={false} onClick={vi.fn()} />);
    expect(screen.getByText(/Carlos Atendente/)).toBeTruthy();
  });
});
