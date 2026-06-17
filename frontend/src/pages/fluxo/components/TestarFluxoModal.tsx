import { Play } from 'lucide-react';
import { Button, Dialog, Input } from '@/components/ui';

/**
 * TestarFluxoModal — teste manual do fluxo, no Dialog oficial (@/components/ui).
 *
 * Dispara editor.runTeste via onRodar (que fecha o modal em sucesso). Fecha no
 * backdrop (closeOnBackdrop, preservando o overlay anterior) e no Escape
 * (cortesia do Dialog). O Dialog já trata `open=false` (não renderiza).
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
  return (
    <Dialog
      open={aberto}
      onClose={onClose}
      size="sm"
      closeOnBackdrop
      title="Testar fluxo"
      description={
        <>
          Dispara o fluxo <strong>agora</strong> (a partir do nó gatilho), sem esperar o
          cron/evento. Salva o fluxo antes, se houver mudanças.
        </>
      }
      footer={
        <>
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
        </>
      }
    >
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
    </Dialog>
  );
}
