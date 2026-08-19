import { useState } from 'react';
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
  onRodar: (opts: { conversationId: string; enviarDeVerdade: boolean }) => void;
}) {
  // Conversa real: sem ela, fluxo de WhatsApp com CRIAR_LEAD/TRANSFERIR morre no
  // primeiro nó (o teste não inventa conversa) — o T1 era intestável por isso.
  const [conversationId, setConversationId] = useState('');
  // Enviar de verdade é OPT-IN: testar contra conversa real significa que do
  // outro lado tem uma pessoa. Mensagem enviada não volta.
  const [enviarDeVerdade, setEnviarDeVerdade] = useState(false);
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
            onClick={() => onRodar({ conversationId, enviarDeVerdade })}
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

      <label className="text-xs text-muted mt-3 block">ID da conversa (opcional)</label>
      <Input
        value={conversationId}
        onChange={(e) => setConversationId(e.target.value)}
        placeholder="cole o ID de uma conversa do Inbox"
        data-testid="fluxo-test-conversa"
      />
      <p className="text-[10px] text-muted mt-1">
        Obrigatório pra fluxo de WhatsApp que cria lead ou transfere atendimento — esses nós agem
        sobre uma conversa, e o teste não inventa uma. Com a conversa, o fluxo roda de ponta a
        ponta.
      </p>

      <label className="flex items-start gap-2 mt-3 text-xs" style={{ color: 'var(--text)' }}>
        <input
          type="checkbox"
          checked={enviarDeVerdade}
          onChange={(e) => setEnviarDeVerdade(e.target.checked)}
          data-testid="fluxo-test-enviar"
          className="mt-0.5"
        />
        <span>
          Mandar as mensagens <strong>de verdade</strong>
          <span className="block text-[10px] text-muted mt-0.5">
            Desmarcado (padrão), o fluxo roda inteiro e os envios ficam registrados como{' '}
            <strong>simulados</strong> — dá pra ver o texto que sairia. Marcado, a pessoa do outro
            lado da conversa recebe mensagem de verdade, e não tem desfazer.
          </span>
        </span>
      </label>
    </Dialog>
  );
}
