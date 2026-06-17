import { Play } from 'lucide-react';
import { Button, Input } from '@/components/ui';

/**
 * TestarFluxoModal — modal inline de teste manual do fluxo.
 *
 * Overlay fixo (z-[120]) montado no shell — NÃO usa o Dialog de @/components/ui
 * (mantido inline verbatim do FluxoEditorInner). Dispara editor.runTeste via
 * onRodar (que fecha o modal em sucesso).
 */
export function TestarFluxoModal({
  aberto,
  onClose,
  testLeadId,
  setTestLeadId,
  testando,
  onRodar,
}: {
  aberto: boolean;
  onClose: () => void;
  testLeadId: string;
  setTestLeadId: (v: string) => void;
  testando: boolean;
  onRodar: () => void;
}) {
  if (!aberto) return null;
  return (
    <div
      className="fixed inset-0 z-[120] bg-black/50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-bg-alt border border-border rounded-lg shadow-xl w-full max-w-sm p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-sm font-bold text-text mb-1">Testar fluxo</h3>
        <p className="text-[11px] text-muted mb-3">
          Dispara o fluxo <strong>agora</strong> (a partir do nó gatilho), sem esperar o
          cron/evento. Salva o fluxo antes, se houver mudanças.
        </p>
        <label className="text-xs text-muted">ID do lead (opcional)</label>
        <Input
          value={testLeadId}
          onChange={(e) => setTestLeadId(e.target.value)}
          placeholder="cole o ID do lead aqui"
          data-testid="fluxo-test-lead"
        />
        <p className="text-[10px] text-muted mt-1">
          Vazio = fluxo sem lead (ex: webhook). Pegue o ID na tela de Leads.
        </p>
        <div className="flex justify-end gap-2 mt-4">
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            onClick={onRodar}
            loading={testando}
            leftIcon={<Play className="h-3.5 w-3.5" />}
          >
            Rodar teste
          </Button>
        </div>
      </div>
    </div>
  );
}
