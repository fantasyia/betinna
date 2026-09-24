import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

/**
 * Tela de auditoria legível (pedido do Léo, 24/09): quem, sobre o quê, de
 * onde veio e o que mudou — em vez de UUID e cuid.
 */

let linhas: unknown[] = [];
vi.mock('@/hooks/useApiQuery', () => ({
  useApiQuery: (path: string) =>
    path.startsWith('/audit/recursos')
      ? { data: ['fluxo'], loading: false, error: null, refetch: vi.fn() }
      : {
          data: { data: linhas, pagination: { page: 1, limit: 20, total: linhas.length, totalPages: 1 } },
          loading: false,
          error: null,
          refetch: vi.fn(),
        },
}));

const { AuditLogSection } = await import('./AdminPage');

const linha = (over: Record<string, unknown>) => ({
  id: 'l1',
  usuarioId: '10fb0fca-5af3-4c11-9d2b-000000000000',
  empresaId: 'emp-1',
  acao: 'update',
  recurso: 'fluxo',
  recursoId: 'cmtvasp1f0030o2abcdef',
  ip: null,
  criadoEm: '2026-09-24T07:12:56Z',
  detalhes: { via: 'api_token', apiTokenNome: 'MCP master', campos: ['nome'] },
  usuarioNome: 'Leonardo Beltran',
  recursoNome: 'R2 · Liberação de lote',
  ...over,
});

afterEach(() => cleanup());

describe('AuditLogSection', () => {
  it('mostra NOME de quem fez, NOME do fluxo, de onde veio e o que mudou', () => {
    linhas = [linha({})];
    render(<AuditLogSection />);
    expect(screen.getByTestId('audit-usuario').textContent).toBe('Leonardo Beltran');
    expect(screen.getByTestId('audit-origem').textContent).toBe('via token · MCP master');
    expect(screen.getByTestId('audit-recurso-nome').textContent).toBe('R2 · Liberação de lote');
    expect(screen.getByTestId('audit-campos').textContent).toBe('nome');
  });

  it('pela tela aparece "via tela"; grafo trocado mostra os campos do grafo', () => {
    linhas = [linha({ detalhes: { via: 'sessao', campos: ['arestas', 'nos'] } })];
    render(<AuditLogSection />);
    expect(screen.getByTestId('audit-origem').textContent).toBe('via tela');
    expect(screen.getByTestId('audit-campos').textContent).toBe('arestas, nos');
  });

  it('registro antigo (sem via/campos) e sem nome resolvido não quebra — cai no id curto', () => {
    linhas = [linha({ detalhes: null, usuarioNome: null, recursoNome: null })];
    render(<AuditLogSection />);
    expect(screen.getByTestId('audit-usuario').textContent).toBe('10fb0fca…');
    expect(screen.queryByTestId('audit-origem')).toBeNull();
    expect(screen.getByTestId('audit-campos').textContent).toBe('—');
  });

  it('ação do sistema (sem usuário) aparece como "(sistema)"', () => {
    linhas = [linha({ usuarioId: null, usuarioNome: null })];
    render(<AuditLogSection />);
    expect(screen.getByTestId('audit-usuario').textContent).toBe('(sistema)');
  });
});
