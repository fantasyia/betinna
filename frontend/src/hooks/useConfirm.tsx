import { useCallback, useRef, useState, type ReactNode } from 'react';
import { Button, Dialog } from '@/components/ui';
import { AlertTriangle } from 'lucide-react';

/**
 * useConfirm — substitui `window.confirm()` por dialog do design system.
 *
 * Uso:
 *   const [confirm, ConfirmDialog] = useConfirm();
 *   async function deletar() {
 *     const ok = await confirm({
 *       title: 'Excluir nota?',
 *       message: 'Essa ação não pode ser desfeita.',
 *       confirmLabel: 'Excluir',
 *       variant: 'danger',
 *     });
 *     if (!ok) return;
 *     // segue...
 *   }
 *   return <>
 *     ...
 *     {ConfirmDialog}
 *   </>;
 *
 * Por quê não inline:
 *  - Estado por item dá explosão de useStates
 *  - Promise-style mantém o código de delete linear e legível
 *  - Renderiza UM dialog reutilizado pra todos os confirms da página
 */

interface ConfirmOptions {
  title: ReactNode;
  message?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'primary' | 'danger';
}

interface PendingConfirm extends ConfirmOptions {
  resolve: (ok: boolean) => void;
}

export function useConfirm(): [
  (opts: ConfirmOptions) => Promise<boolean>,
  ReactNode,
] {
  const [pending, setPending] = useState<PendingConfirm | null>(null);
  const pendingRef = useRef<PendingConfirm | null>(null);
  pendingRef.current = pending;

  const confirm = useCallback((opts: ConfirmOptions): Promise<boolean> => {
    return new Promise<boolean>((resolve) => {
      // Se já existe um confirm pendente, fecha rejeitando (boa prática: 1 modal por vez)
      if (pendingRef.current) {
        pendingRef.current.resolve(false);
      }
      setPending({ ...opts, resolve });
    });
  }, []);

  function handleClose(result: boolean) {
    if (pending) {
      pending.resolve(result);
      setPending(null);
    }
  }

  const dialog = (
    <Dialog
      open={!!pending}
      onClose={() => handleClose(false)}
      title={
        pending?.variant === 'danger' ? (
          <span className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-danger" />
            {pending?.title}
          </span>
        ) : (
          pending?.title
        )
      }
      description={pending?.message}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={() => handleClose(false)}>
            {pending?.cancelLabel ?? 'Cancelar'}
          </Button>
          <Button
            variant={pending?.variant === 'danger' ? 'danger' : 'primary'}
            onClick={() => handleClose(true)}
            data-testid="confirm-ok"
            autoFocus
          >
            {pending?.confirmLabel ?? 'Confirmar'}
          </Button>
        </>
      }
    />
  );

  return [confirm, dialog];
}
