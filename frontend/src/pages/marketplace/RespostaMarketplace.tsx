import { useState } from 'react';
import { useApiQuery } from '@/hooks/useApiQuery';
import { api, apiErrorMessage } from '@/lib/api';
import { Button, Textarea } from '@/components/ui';
import { cn } from '@/lib/cn';

/**
 * Responder no próprio card da aba Marketplaces, sem abrir a Inbox (Léo,
 * 29/09). Lê as mensagens da conversa e envia por `/inbox/:id/responder` — o
 * mesmo caminho da Inbox, que já roteia pro canal certo (pergunta, reclamação).
 */
export interface MensagemMkt {
  id: string;
  direction: 'INBOUND' | 'OUTBOUND';
  tipo?: string;
  conteudo: string;
  status?: string;
  criadoEm: string;
  meta?: { erro?: string; ml_sender_role?: string } | null;
}

export function useMensagensMkt(conversationId: string | null | undefined) {
  const r = useApiQuery<MensagemMkt[]>(
    conversationId ? `/inbox/${conversationId}/mensagens?limit=50` : null,
  );
  // A API devolve da mais nova pra mais antiga; a tela lê em ordem.
  const lista = [...(r.data ?? [])].reverse();
  return { ...r, lista };
}

export function hora(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export function CampoResposta({
  conversationId,
  placeholder,
  onEnviada,
  testId,
}: {
  conversationId: string;
  placeholder: string;
  onEnviada: () => void;
  testId: string;
}) {
  const [texto, setTexto] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const enviar = async () => {
    if (!texto.trim() || enviando) return;
    setEnviando(true);
    setErro(null);
    try {
      await api.post(`/inbox/${conversationId}/responder`, { texto: texto.trim() });
      setTexto('');
      onEnviada();
    } catch (err) {
      setErro(apiErrorMessage(err));
      // a tentativa falha também fica gravada — recarrega pra não sumir
      onEnviada();
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="mt-2">
      <div className="flex items-end gap-2">
        <Textarea
          data-testid={`${testId}-texto`}
          rows={2}
          value={texto}
          placeholder={placeholder}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void enviar();
          }}
          className="text-[13px] min-h-0"
        />
        <Button
          data-testid={`${testId}-enviar`}
          size="sm"
          disabled={!texto.trim() || enviando}
          onClick={() => void enviar()}
        >
          {enviando ? 'Enviando…' : 'Responder'}
        </Button>
      </div>
      {erro && (
        <p data-testid={`${testId}-erro`} className="text-[12px] text-danger mt-1">
          {erro}
        </p>
      )}
    </div>
  );
}

/** Balão pequeno de resposta enviada (ou que falhou). */
export function RespostaEnviada({ m }: { m: MensagemMkt }) {
  const falhou = m.status === 'FAILED';
  return (
    <div
      data-testid="mkt-resposta"
      className={cn(
        'mt-2 rounded-md border px-3 py-1.5 text-[13px]',
        falhou ? 'border-danger' : 'border-border bg-bg-alt',
      )}
    >
      <div className="flex items-center justify-between gap-2 text-[11px] text-muted">
        <span>{falhou ? '⚠ Não enviada' : 'Sua resposta'}</span>
        <span>{hora(m.criadoEm)}</span>
      </div>
      <div className="whitespace-pre-wrap text-text">{m.conteudo}</div>
    </div>
  );
}
