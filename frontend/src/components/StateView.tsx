import type { ReactNode } from 'react';
import { colors } from './styles';

/**
 * Encapsula os 3 estados de qualquer fetch:
 *  - loading: skeleton
 *  - error: mensagem + retry
 *  - empty: mensagem
 * Quando nenhum aplica, renderiza `children`.
 *
 * Uso:
 *   <StateView loading={loading} error={error} empty={data.length === 0} onRetry={refetch}>
 *     <Table ... />
 *   </StateView>
 */
export interface StateViewProps {
  loading?: boolean;
  error?: string | null;
  empty?: boolean;
  emptyMessage?: string;
  onRetry?: () => void;
  children: ReactNode;
}

export function StateView({
  loading,
  error,
  empty,
  emptyMessage = 'Sem registros pra exibir.',
  onRetry,
  children,
}: StateViewProps) {
  if (loading) {
    return (
      <div data-testid="state-loading" style={{ padding: '2rem 0' }}>
        <div
          style={{
            height: 16,
            background: colors.surfaceHover,
            borderRadius: 4,
            marginBottom: 12,
            width: '40%',
          }}
        />
        <div
          style={{ height: 16, background: colors.surfaceHover, borderRadius: 4, marginBottom: 12 }}
        />
        <div
          style={{
            height: 16,
            background: colors.surfaceHover,
            borderRadius: 4,
            width: '70%',
          }}
        />
      </div>
    );
  }

  if (error) {
    return (
      <div data-testid="state-error" style={{ padding: '2rem 0', textAlign: 'center' }}>
        <p style={{ color: colors.danger, marginBottom: 12 }}>{error}</p>
        {onRetry && (
          <button
            type="button"
            data-testid="state-retry"
            onClick={onRetry}
            className="bg-surface text-text border border-border-strong rounded-md px-4 py-2 text-[13px] font-medium cursor-pointer tracking-[-0.1px]"
          >
            Tentar novamente
          </button>
        )}
      </div>
    );
  }

  if (empty) {
    return (
      <div data-testid="state-empty" style={{ padding: '2rem 0', textAlign: 'center' }}>
        <p style={{ color: colors.muted }}>{emptyMessage}</p>
      </div>
    );
  }

  return <>{children}</>;
}
