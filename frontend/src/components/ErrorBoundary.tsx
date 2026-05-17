import { Component, type ErrorInfo, type ReactNode } from 'react';
import { captureError } from '@/lib/sentry';

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
