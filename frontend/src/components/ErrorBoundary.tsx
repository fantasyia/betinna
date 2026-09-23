import { Component, type ErrorInfo, type ReactNode } from 'react';
import { captureError } from '@/lib/sentry';
import { ehErroDeChunk, jaRecarregouPorChunk } from '@/lib/lazy-com-retry';

/**
 * ErrorBoundary — captura erros de render em sub-tree React.
 *
 * Reporta ao Sentry via `captureError` (que redacta PII antes de enviar).
 * Quando DSN não configurado, cai pra log estruturado no console.
 *
 * Uso:
 *   <ErrorBoundary>
 *     <ProtectedRoute>...</ProtectedRoute>
 *   </ErrorBoundary>
 */

interface ErrorBoundaryProps {
  children: ReactNode;
  /** Fallback custom; default = mensagem genérica + botão retry */
  fallback?: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    captureError(error, {
      source: 'react-error-boundary',
      componentStack: errorInfo.componentStack,
    });
  }

  retry = (): void => {
    this.setState({ hasError: false, error: undefined });
  };

  render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      // Versão nova publicada com a aba aberta: o chunk que a rota pediu não
      // existe mais no servidor. Duas coisas mudam aqui, e as duas importam.
      //
      // 1. O TEXTO: "algo deu errado" faz a pessoa achar que quebrou e chamar o
      //    suporte. Não quebrou nada — saiu versão nova.
      // 2. O BOTÃO: o retry normal só reseta o state, e o import volta a buscar
      //    o MESMO chunk morto. Aqui ele precisa recarregar a página, que é o
      //    que traz o index.html com os hashes novos.
      //
      // Chega aqui quem falhou duas vezes, ou quem tinha alteração não salva
      // (o `lazyComRetry` não recarrega por cima de rascunho) — por isso o
      // aviso de salvar antes.
      if (ehErroDeChunk(this.state.error) || jaRecarregouPorChunk()) {
        return (
          <div
            data-testid="error-boundary-versao-nova"
            style={{
              padding: '2rem',
              maxWidth: '480px',
              margin: '4rem auto',
              textAlign: 'center',
              fontFamily: 'system-ui, sans-serif',
            }}
          >
            <h1 style={{ fontSize: '1.5rem', marginBottom: '1rem' }}>
              Saiu uma versão nova
            </h1>
            <p style={{ color: '#666', marginBottom: '1.5rem' }}>
              Esta aba está rodando a versão anterior do app. Recarregue para
              continuar — se tiver algo não salvo em outra tela, salve antes.
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              data-testid="error-recarregar-btn"
              style={{
                padding: '0.5rem 1.5rem',
                fontSize: '1rem',
                cursor: 'pointer',
                border: '1px solid #7c3aed',
                background: '#7c3aed',
                color: 'white',
                borderRadius: '4px',
              }}
            >
              Recarregar
            </button>
          </div>
        );
      }

      return (
        <div
          data-testid="error-boundary-fallback"
          style={{
            padding: '2rem',
            maxWidth: '480px',
            margin: '4rem auto',
            textAlign: 'center',
            fontFamily: 'system-ui, sans-serif',
          }}
        >
          <h1 style={{ fontSize: '1.5rem', marginBottom: '1rem' }}>
            Algo deu errado
          </h1>
          <p style={{ color: '#666', marginBottom: '1.5rem' }}>
            Encontramos um erro inesperado. Tente novamente — se persistir,
            avise o suporte com o ID da página.
          </p>
          <button
            type="button"
            onClick={this.retry}
            data-testid="error-retry-btn"
            style={{
              padding: '0.5rem 1.5rem',
              fontSize: '1rem',
              cursor: 'pointer',
              border: '1px solid #7c3aed',
              background: '#7c3aed',
              color: 'white',
              borderRadius: '4px',
            }}
          >
            Tentar novamente
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
