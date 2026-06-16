import { useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { getSession } from '@/lib/auth-store';
import { useApiQuery } from '@/hooks/useApiQuery';
import { StateView } from '@/components/StateView';
import { useToast } from '@/components/toast';
import { Avatar, Button, Drawer, Textarea } from '@/components/ui';
import type { NotaInterna } from '../lib/types';
import { fmtTime } from '../lib/format';

/**
 * Drawer de notas internas (anotações da equipe; o cliente NÃO vê).
 * Espelha o estilo do `ClienteContextDrawer`. Lista as notas (mais recentes
 * primeiro), permite adicionar, editar e excluir. Só o autor (ou ADMIN) edita
 * a própria — o backend devolve 403 nos demais (tratado com toast).
 */
export function NotasInternasDrawer({
  conversaId,
  onClose,
}: {
  conversaId: string;
  onClose: () => void;
}) {
  const toast = useToast();
  const { data, loading, error, refetch } = useApiQuery<NotaInterna[]>(
    `/inbox/${conversaId}/notas`,
  );
  // Usuário atual — pra decidir quem vê os botões editar/excluir (UX).
  // O backend é a fonte da verdade (403); aqui é só pra não mostrar botão inútil.
  const sess = getSession();
  const meuId = sess?.user?.id ?? null;
  const souAdmin = sess?.user?.role === 'ADMIN';

  const [novaNota, setNovaNota] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [editTexto, setEditTexto] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const notas = data ?? [];

  async function adicionar() {
    const texto = novaNota.trim();
    if (!texto) return;
    setSalvando(true);
    try {
      await api.post(`/inbox/${conversaId}/notas`, { texto });
      setNovaNota('');
      refetch();
    } catch (err) {
      toast.error('Falha ao adicionar nota', err instanceof ApiError ? err.message : undefined);
    } finally {
      setSalvando(false);
    }
  }

  async function salvarEdicao(notaId: string) {
    const texto = editTexto.trim();
    if (!texto) return;
    setBusyId(notaId);
    try {
      await api.patch(`/inbox/${conversaId}/notas/${notaId}`, { texto });
      setEditandoId(null);
      setEditTexto('');
      refetch();
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        toast.error('Você só pode editar suas próprias notas');
      } else {
        toast.error('Falha ao editar nota', err instanceof ApiError ? err.message : undefined);
      }
    } finally {
      setBusyId(null);
    }
  }

  async function excluir(notaId: string) {
    setBusyId(notaId);
    try {
      await api.delete(`/inbox/${conversaId}/notas/${notaId}`);
      refetch();
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        toast.error('Você só pode excluir suas próprias notas');
      } else {
        toast.error('Falha ao excluir nota', err instanceof ApiError ? err.message : undefined);
      }
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title="Notas internas"
      description="Só a equipe vê — o cliente não recebe."
      width="sm"
    >
      <div className="flex flex-col gap-4">
        {/* Compositor de nova nota */}
        <div className="flex flex-col gap-2">
          <Textarea
            data-testid="inbox-nota-input"
            placeholder="Escreva uma anotação interna…"
            value={novaNota}
            onChange={(e) => setNovaNota(e.target.value)}
            className="min-h-[72px] max-h-40 resize-none w-full"
            maxLength={2000}
          />
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-muted tabular">{novaNota.length}/2000</span>
            <Button
              type="button"
              size="sm"
              data-testid="inbox-nota-add-btn"
              disabled={salvando || novaNota.trim().length === 0}
              loading={salvando}
              onClick={() => void adicionar()}
              leftIcon={!salvando ? <Plus className="h-3.5 w-3.5" /> : undefined}
            >
              Adicionar nota
            </Button>
          </div>
        </div>

        {/* Lista de notas */}
        <StateView
          loading={loading && !data}
          error={error}
          empty={!loading && !error && notas.length === 0}
          emptyMessage="Nenhuma nota interna ainda."
          onRetry={refetch}
        >
          <ul className="flex flex-col gap-2.5">
            {notas.map((n) => {
              const podeEditar = souAdmin || (meuId !== null && n.usuarioId === meuId);
              const editando = editandoId === n.id;
              return (
                <li
                  key={n.id}
                  data-testid={`inbox-nota-${n.id}`}
                  className="rounded-md border border-border bg-surface px-3 py-2.5 flex flex-col gap-1.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <Avatar name={n.usuario?.nome ?? '?'} size="sm" />
                      <span className="text-xs font-medium text-text truncate">
                        {n.usuario?.nome ?? 'Usuário'}
                      </span>
                    </div>
                    <span className="text-[10px] text-muted tabular shrink-0" title={fmtTime(n.criadoEm)}>
                      {fmtTime(n.criadoEm)}
                    </span>
                  </div>

                  {editando ? (
                    <div className="flex flex-col gap-1.5">
                      <Textarea
                        data-testid={`inbox-nota-edit-input-${n.id}`}
                        value={editTexto}
                        onChange={(e) => setEditTexto(e.target.value)}
                        className="min-h-[60px] max-h-40 resize-none w-full"
                        maxLength={2000}
                      />
                      <div className="flex items-center gap-2 justify-end">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          data-testid={`inbox-nota-edit-cancel-${n.id}`}
                          onClick={() => {
                            setEditandoId(null);
                            setEditTexto('');
                          }}
                        >
                          Cancelar
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          data-testid={`inbox-nota-edit-save-${n.id}`}
                          disabled={busyId === n.id || editTexto.trim().length === 0}
                          loading={busyId === n.id}
                          onClick={() => void salvarEdicao(n.id)}
                        >
                          Salvar
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <p className="m-0 text-sm text-text whitespace-pre-wrap break-words">{n.texto}</p>
                  )}

                  {podeEditar && !editando && (
                    <div className="flex items-center gap-1 justify-end">
                      <button
                        type="button"
                        data-testid={`inbox-nota-editar-${n.id}`}
                        disabled={busyId === n.id}
                        onClick={() => {
                          setEditandoId(n.id);
                          setEditTexto(n.texto);
                        }}
                        className="inline-flex items-center gap-1 text-[11px] px-1.5 py-1 rounded text-muted hover:text-text hover:bg-surface-hover disabled:opacity-40"
                      >
                        <Pencil className="h-3 w-3" />
                        Editar
                      </button>
                      <button
                        type="button"
                        data-testid={`inbox-nota-excluir-${n.id}`}
                        disabled={busyId === n.id}
                        onClick={() => void excluir(n.id)}
                        className="inline-flex items-center gap-1 text-[11px] px-1.5 py-1 rounded text-danger hover:bg-danger/10 disabled:opacity-40"
                      >
                        <Trash2 className="h-3 w-3" />
                        Excluir
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </StateView>
      </div>
    </Drawer>
  );
}
