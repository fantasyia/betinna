import { Undo2, Redo2, Play, Save, X as XIcon } from 'lucide-react';
import { Button, Badge, IconButton, Input } from '@/components/ui';
import type { FluxoEditorApi } from '@/pages/fluxo/hooks/useFluxoEditor';

/**
 * FluxoToolbar — a barra superior do editor de fluxos.
 *
 * Nome do fluxo, badge de status, badge "alterações não salvas", toggles dos
 * drawers mobile, grupo undo/redo (desktop) e os botões Testar/Cancelar/Salvar.
 * JSX movido verbatim do FluxoEditorInner.
 */
export function FluxoToolbar({
  editor,
  status,
  onClose,
  onTestar,
  onMobilePanel,
}: {
  editor: FluxoEditorApi;
  status: string;
  onClose: () => void;
  onTestar: () => void;
  onMobilePanel: (p: 'palette' | 'inspector' | null) => void;
}) {
  return (
    <header className="flex items-center gap-3 px-4 h-[56px] border-b border-border bg-bg-alt shrink-0">
      <IconButton
        aria-label="Fechar editor"
        variant="ghost"
        icon={<XIcon />}
        onClick={() => {
          // CAÇADA-BUG #45: fechar com alterações não salvas descartava tudo silenciosamente (sem
          // confirmação nem beforeunload) — 20 min de fluxo montado sumiam num clique no X.
          if (
            editor.dirty &&
            !window.confirm('Você tem alterações não salvas. Descartar e sair do editor?')
          ) {
            return;
          }
          onClose();
        }}
      />
      <div className="flex-1 min-w-0 flex items-center gap-3">
        <Input
          value={editor.name}
          onChange={(e) => {
            editor.setName(e.target.value);
            editor.setDirty(true);
          }}
          className="max-w-md font-semibold"
          placeholder="Nome do fluxo"
        />
        <Badge
          variant={status === 'ATIVO' ? 'success' : 'neutral'}
          className="hidden sm:inline-flex"
        >
          {status}
        </Badge>
        {editor.dirty && (
          <Badge variant="warning" size="sm">
            Alterações não salvas
          </Badge>
        )}
      </div>
      <div className="flex items-center gap-2">
        {/* Mobile: toggles dos painéis (viram drawers). Escondidos no desktop. */}
        <div className="flex items-center gap-1 md:hidden">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onMobilePanel('palette')}
            data-testid="fluxo-mobile-blocos"
          >
            Blocos
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onMobilePanel('inspector')}
            data-testid="fluxo-mobile-editar"
          >
            Editar
          </Button>
          <div className="w-px h-6 bg-border mx-1" />
        </div>
        {/* v1.5.0 — Undo/Redo (desktop; no mobile some pra ganhar espaço) */}
        <div className="hidden md:flex items-center gap-2">
          <IconButton
            aria-label="Desfazer (Cmd+Z)"
            title="Desfazer (Cmd/Ctrl+Z)"
            variant="ghost"
            icon={<Undo2 className="h-4 w-4" />}
            onClick={editor.undo}
            disabled={!editor.canUndo}
            data-testid="fluxo-undo"
          />
          <IconButton
            aria-label="Refazer (Cmd+Shift+Z)"
            title="Refazer (Cmd/Ctrl+Shift+Z ou Cmd/Ctrl+Y)"
            variant="ghost"
            icon={<Redo2 className="h-4 w-4" />}
            onClick={editor.redo}
            disabled={!editor.canRedo}
            data-testid="fluxo-redo"
          />
          <div className="w-px h-6 bg-border mx-1" />
        </div>
        <Button
          variant="secondary"
          className="hidden md:inline-flex"
          onClick={onTestar}
          leftIcon={<Play className="h-3.5 w-3.5" />}
          data-testid="fluxo-testar"
          title="Dispara o fluxo agora (do nó gatilho), sem esperar o cron/evento"
        >
          Testar
        </Button>
        <Button variant="ghost" className="hidden md:inline-flex" onClick={onClose}>
          Cancelar
        </Button>
        <Button
          onClick={editor.handleSave}
          loading={editor.saving}
          disabled={!editor.dirty}
          leftIcon={<Save className="h-3.5 w-3.5" />}
        >
          Salvar
        </Button>
      </div>
    </header>
  );
}
