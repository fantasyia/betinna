import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AtSign, MessageSquare, Send } from 'lucide-react';
import { Badge, Button, Card, CardHeader, CardTitle, CardDescription, Input } from '@/components/ui';
import { useToast } from '@/components/toast';
import { api, apiErrorMessage } from '@/lib/api';
import { getSession } from '@/lib/auth-store';
import { cn } from '@/lib/cn';
import { tempoDesde, type MensagemInterna } from './types';

/** Marca d'água local de leitura (sem modelo de "lida" no banco — barato e honesto). */
function lastSeenKey(): string {
  return `betinna:dash-msgs:${getSession()?.user?.id ?? 'anon'}`;
}
function getLastSeen(): number {
  try {
    return Number(localStorage.getItem(lastSeenKey()) ?? 0);
  } catch {
    return 0;
  }
}

/**
 * M4 — Mensagens internas (base do trilho): feed de comentários dos quadros.
 * Menções pra mim destacadas; não-lidas (desde a última visita) marcadas; e um
 * composer inline pra responder no card SEM sair do dashboard.
 */
export function MensagensInternas({ mensagens }: { mensagens: MensagemInterna[] }) {
  const toast = useToast();
  // lastSeen congelado na montagem: as mensagens ficam marcadas durante a visita
  // e só "envelhecem" na próxima (senão sumiriam do destaque na hora).
  const lastSeen = useMemo(() => {
    const v = getLastSeen();
    try {
      localStorage.setItem(lastSeenKey(), String(Date.now()));
    } catch {
      // modo privado / quota — segue sem persistir
    }
    return v;
  }, []);

  const [respondendo, setRespondendo] = useState<string | null>(null);
  const [texto, setTexto] = useState('');
  const [busy, setBusy] = useState(false);

  async function responder(m: MensagemInterna) {
    if (!texto.trim()) return;
    setBusy(true);
    try {
      await api.post(`/kanban/cards/${m.cardId}/comentarios`, { texto: texto.trim() });
      toast.success('Resposta publicada no card');
      setRespondendo(null);
      setTexto('');
    } catch (err) {
      toast.error('Falha ao responder', apiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card padding="md" data-testid="mensagens-internas">
      <CardHeader>
        <CardTitle>Mensagens internas</CardTitle>
        <CardDescription>Comentários recentes dos quadros</CardDescription>
      </CardHeader>

      {mensagens.length === 0 ? (
        <div className="flex items-center gap-2 py-3 text-sm text-muted">
          <MessageSquare className="h-4 w-4" aria-hidden />
          Nenhum comentário recente.
        </div>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {mensagens.map((m) => {
            const naoLida = new Date(m.criadoEm).getTime() > lastSeen;
            return (
              <li key={m.id} className="py-2" data-testid="mensagem-item">
                <div className="flex items-start gap-2">
                  {/* Não-lida: ponto + negrito (nunca só cor). */}
                  <span
                    className={cn(
                      'mt-1.5 h-1.5 w-1.5 rounded-full shrink-0',
                      naoLida ? 'bg-primary' : 'bg-transparent',
                    )}
                    aria-label={naoLida ? 'não lida' : undefined}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <span className={cn('text-sm text-text', naoLida && 'font-semibold')}>
                        {m.autorNome}
                      </span>
                      {m.mencionaMim && (
                        <Badge variant="primary">
                          <AtSign className="h-3 w-3 mr-0.5" aria-hidden />
                          menção
                        </Badge>
                      )}
                      <span className="text-[11px] text-muted tabular">{tempoDesde(m.criadoEm)}</span>
                    </div>
                    <p className="text-xs text-text-subtle leading-snug line-clamp-2">{m.texto}</p>
                    <div className="mt-1 flex items-center gap-2">
                      <Link
                        to={`/kanban/${m.boardId}`}
                        className="text-[11px] text-primary hover:underline truncate max-w-[180px]"
                      >
                        {m.cardTitulo}
                      </Link>
                      <button
                        type="button"
                        className="text-[11px] text-muted hover:text-text"
                        onClick={() => {
                          setRespondendo(respondendo === m.id ? null : m.id);
                          setTexto('');
                        }}
                        data-testid="mensagem-responder"
                      >
                        Responder
                      </button>
                    </div>
                    {respondendo === m.id && (
                      <div className="mt-1.5 flex items-center gap-1.5">
                        <Input
                          size="sm"
                          value={texto}
                          onChange={(e) => setTexto(e.target.value)}
                          placeholder="Responder no card…"
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) void responder(m);
                          }}
                          data-testid="mensagem-composer"
                        />
                        <Button
                          size="sm"
                          loading={busy}
                          onClick={() => void responder(m)}
                          aria-label="Enviar resposta"
                          leftIcon={<Send className="h-3.5 w-3.5" />}
                        >
                          Enviar
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
