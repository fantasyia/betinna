import { UserCheck } from 'lucide-react';

/**
 * Item #25 fatia 4 — aviso de presença: outro(s) atendente(s) estão nesta
 * conversa agora. Não bloqueia — só avisa (a confirmação de envio mora em
 * enviar()). Tom warning do design system. Renderiza null quando não há outros.
 */
export function AvisoPresenca({ outros }: { outros: Array<{ id: string; nome: string }> }) {
  if (outros.length === 0) return null;

  return (
    <div
      data-testid="inbox-presenca-aviso"
      className="px-4 py-2 border-t border-warning/40 bg-warning/10 flex items-center gap-2 text-sm text-warning"
    >
      <UserCheck className="h-4 w-4 shrink-0" />
      <span>
        👤{' '}
        <strong>{outros.map((o) => o.nome).join(', ')}</strong>{' '}
        {outros.length > 1 ? 'estão' : 'está'} nesta conversa agora
      </span>
    </div>
  );
}
