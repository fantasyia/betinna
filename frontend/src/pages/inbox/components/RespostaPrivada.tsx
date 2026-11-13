import { useState } from 'react';
import { Lock } from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';
import { useToast } from '@/components/toast';
import { Button, Dialog, Textarea } from '@/components/ui';

/**
 * Comentário de FB/IG (13/11): manda uma DM pra quem comentou ("resposta
 * privada"). A Meta deixa UMA por comentário, até 7 dias depois dele — por isso
 * o aviso no diálogo. A resposta pública continua pelo composer normal.
 */
export function RespostaPrivada({
  conversationId,
  onEnviada,
}: {
  conversationId: string;
  onEnviada?: () => void;
}) {
  const toast = useToast();
  const [aberto, setAberto] = useState(false);
  const [texto, setTexto] = useState('');
  const [enviando, setEnviando] = useState(false);

  async function enviar() {
    setEnviando(true);
    try {
      await api.post(`/inbox/${conversationId}/responder-privado`, { texto: texto.trim() });
      toast.success('Resposta enviada no privado');
      setAberto(false);
      setTexto('');
      onEnviada?.();
    } catch (err) {
      toast.error('Não foi possível enviar no privado', apiErrorMessage(err));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        data-testid="inbox-responder-privado-btn"
        onClick={() => setAberto(true)}
        leftIcon={<Lock className="h-3.5 w-3.5" />}
      >
        Responder no privado
      </Button>
      <Dialog
        open={aberto}
        onClose={() => setAberto(false)}
        title="Responder no privado"
        description="Vai como mensagem direta pra quem comentou. A Meta deixa só uma por comentário, até 7 dias depois dele."
        footer={
          <>
            <Button variant="ghost" onClick={() => setAberto(false)}>
              Cancelar
            </Button>
            <Button
              onClick={enviar}
              disabled={enviando || !texto.trim()}
              data-testid="inbox-responder-privado-enviar"
            >
              {enviando ? 'Enviando…' : 'Enviar'}
            </Button>
          </>
        }
      >
        <Textarea
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          maxLength={1000}
          rows={4}
          placeholder="Oi! Vi seu comentário…"
          data-testid="inbox-responder-privado-texto"
        />
      </Dialog>
    </>
  );
}
