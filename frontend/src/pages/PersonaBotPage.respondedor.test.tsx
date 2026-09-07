import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

/**
 * O interruptor do RESPONDEDOR GERAL não pode sumir da tela.
 *
 * Ele ficava atrás de um `botWhatsappAtivo &&`, com o comentário dizendo que sem
 * a automação "não há respondedor nenhum pra separar". A premissa é falsa: quem
 * manda em cada conversa é `Conversation.botLigado`, que VENCE a flag da
 * empresa — com a automação desligada, toda conversa religada no botão (e as da
 * bateria de teste) continua sendo respondida pelo respondedor geral.
 *
 * Resultado medido em 07/09: a Somatec está com `botWhatsappAtivo: false` desde
 * 29/08, o botão nunca apareceu, e a decisão de desligar o respondedor geral
 * (tomada em 21/08 e repetida em 29/08) nunca pôde ser executada — `botGeralAtivo`
 * seguia `true`. Interruptor que some justamente quando o risco existe não é
 * interruptor.
 */

let botWhatsappAtivo = false;

vi.mock('react-router-dom', () => ({
  Link: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  useNavigate: () => vi.fn(),
  useLocation: () => ({ pathname: '/persona', search: '' }),
}));

vi.mock('@/hooks/usePermission', () => ({
  usePermission: () => true,
  useRole: () => 'DIRECTOR',
  hasPermission: () => true,
}));

vi.mock('@/components/toast', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));

vi.mock('@/lib/api', () => ({
  api: { get: vi.fn().mockResolvedValue({}), patch: vi.fn(), put: vi.fn() },
  ApiError: class extends Error {},
}));

vi.mock('@/hooks/useApiQuery', () => ({
  useApiQuery: (path: string | null) => {
    const vazio = { data: null, loading: false, error: null, refetch: vi.fn() };
    if (path === null) return vazio;
    if (path.includes('/empresas/atual'))
      return {
        data: { id: 'emp-1', botWhatsappAtivo, botGeralAtivo: true },
        loading: false,
        error: null,
        refetch: vi.fn(),
      };
    if (path.includes('/mullerbot/persona'))
      return {
        data: {
          id: 'p-1',
          empresaId: 'emp-1',
          nome: 'SomaBOT',
          promptCustom: 'oi',
          ativo: true,
          limiteTokensDiaIn: 100,
          limiteTokensDiaOut: 100,
        },
        loading: false,
        error: null,
        refetch: vi.fn(),
      };
    if (path.includes('/usuario/integracoes'))
      return { data: [], loading: false, error: null, refetch: vi.fn() };
    return vazio;
  },
}));

const { default: PersonaBotPage } = await import('./PersonaBotPage');

afterEach(cleanup);

describe('PersonaBotPage — interruptor do respondedor geral', () => {
  it('aparece com a resposta automática DESLIGADA — é o estado em que ele ainda fala', () => {
    botWhatsappAtivo = false;

    render(<PersonaBotPage />);

    expect(screen.getByTestId('switch-respondedor-geral')).toBeTruthy();
  });

  it('e avisa que conversa religada no botão continua sendo respondida', () => {
    botWhatsappAtivo = false;

    render(<PersonaBotPage />);

    expect(screen.getByText(/religou o bot no botão/i)).toBeTruthy();
  });

  it('com a resposta automática ligada, segue aparecendo (sem o aviso)', () => {
    botWhatsappAtivo = true;

    render(<PersonaBotPage />);

    expect(screen.getByTestId('switch-respondedor-geral')).toBeTruthy();
    expect(screen.queryByText(/religou o bot no botão/i)).toBeNull();
  });
});
