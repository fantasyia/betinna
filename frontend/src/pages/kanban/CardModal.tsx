import { useEffect, useMemo, useState } from 'react';
import {
  Archive,
  ArchiveRestore,
  Calendar,
  CheckSquare,
  MessageSquare,
  Palette,
  Send,
  SlidersHorizontal,
  Tag,
  Trash2,
  UserPlus,
  Users,
} from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';
import { getSession } from '@/lib/auth-store';
import { useApiQuery } from '@/hooks/useApiQuery';
import { useRole } from '@/hooks/usePermission';
import { useToast } from '@/components/toast';
import {
  Avatar,
  Button,
  Checkbox,
  Dialog,
  IconButton,
  Input,
  Select,
  Textarea,
} from '@/components/ui';
import { cn } from '@/lib/cn';
import {
  BOARD_CORES,
  descreverAtividade,
  statusPrazo,
  type KBoardCompleto,
  type KCampoBoard,
  type KCardCompleto,
  type KChecklist,
  type KChecklistItem,
} from './kanban-types';

/**
 * Modal do card (estilo Trello) — Batch 8 da spec.
 *
 * Título/descrição editáveis, sidebar de ações (membros, etiquetas com
 * criação inline, datas, capa, mover, arquivar), CHECKLISTS AVANÇADOS ★
 * (barra de progresso + prazo 📅 e responsável 👤 POR ITEM), campos
 * personalizados ★ com edição inline por tipo, comentários e atividade.
 */
export function CardModal({
  cardId,
  board,
  onClose,
  onMudou,
}: {
  cardId: string;
  board: KBoardCompleto;
  onClose: () => void;
  onMudou: () => void;
}) {
  const toast = useToast();
  const role = useRole();
  const meuId = getSession()?.user.id;

  const { data: card, refetch } = useApiQuery<KCardCompleto>(`/kanban/cards/${cardId}`);

  /** Executa mutação + refresh do modal e do board, com toast de erro. */
  async function mut(fn: () => Promise<unknown>) {
    try {
      await fn();
      refetch();
      onMudou();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    }
  }

  // ─── Título / descrição editáveis ───────────────────────────────────
  const [titulo, setTitulo] = useState('');
  const [descricao, setDescricao] = useState('');
  useEffect(() => {
    if (card) {
      setTitulo(card.titulo);
      setDescricao(card.descricao ?? '');
    }
  }, [card]);

  const [secao, setSecao] = useState<string | null>(null);

  const membrosDoCard = useMemo(() => new Set(card?.membros.map((m) => m.usuario.id)), [card]);
  const etiquetasDoCard = useMemo(() => new Set(card?.etiquetas.map((e) => e.etiqueta.id)), [card]);

  if (!card) {
    return (
      <Dialog open onClose={onClose} size="xl" title="Carregando…">
        <div className="h-40" />
      </Dialog>
    );
  }

  return (
    <Dialog open onClose={onClose} size="xl">
      {card.corCapa && (
        <div className="h-2 rounded-full mb-3 -mt-1" style={{ background: card.corCapa }} />
      )}

      {/* Título editável + lista atual */}
      <div className="mb-1">
        <Input
          value={titulo}
          onChange={(e) => setTitulo(e.target.value)}
          onBlur={() => {
            const v = titulo.trim();
            if (v && v !== card.titulo) void mut(() => api.patch(`/kanban/cards/${card.id}`, { titulo: v }));
          }}
          className="font-semibold text-base"
          data-testid="card-modal-titulo"
        />
        <div className="text-xs text-muted mt-1 px-1">
          na lista <span className="font-medium text-text">{card.lista.nome}</span>
          {card.concluido && <span className="ml-2 text-emerald-500">✓ concluído</span>}
          {card.arquivado && <span className="ml-2 text-amber-500">(arquivado)</span>}
        </div>
      </div>

      <div className="flex flex-col md:flex-row gap-4 mt-3">
        {/* ─── Coluna principal ─── */}
        <div className="flex-1 min-w-0 flex flex-col gap-5">
          {/* Descrição */}
          <section>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted mb-1.5">
              Descrição
            </h4>
            <Textarea
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              rows={3}
              placeholder="Adicione uma descrição…"
              data-testid="card-modal-descricao"
            />
            {descricao !== (card.descricao ?? '') && (
              <div className="mt-1.5 flex gap-2">
                <Button
                  size="sm"
                  onClick={() =>
                    void mut(() =>
                      api.patch(`/kanban/cards/${card.id}`, { descricao: descricao || null }),
                    )
                  }
                >
                  Salvar
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setDescricao(card.descricao ?? '')}>
                  Descartar
                </Button>
              </div>
            )}
          </section>

          {/* Checklists AVANÇADOS ★ */}
          {card.checklists.map((ck) => (
            <ChecklistSection
              key={ck.id}
              checklist={ck}
              board={board}
              onMut={mut}
            />
          ))}

          {/* Campos personalizados ★ */}
          {board.campos.length > 0 && (
            <section>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted mb-1.5 inline-flex items-center gap-1">
                <SlidersHorizontal className="h-3.5 w-3.5" /> Campos
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {board.campos.map((campo) => (
                  <CampoInline key={campo.id} campo={campo} card={card} onMut={mut} />
                ))}
              </div>
            </section>
          )}

          {/* Comentários */}
          <ComentariosSection
            card={card}
            meuId={meuId}
            isAdmin={role === 'ADMIN'}
            onMut={mut}
          />

          {/* Atividade */}
          <section>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted mb-1.5">
              Atividade
            </h4>
            <ul className="flex flex-col gap-1.5">
              {card.atividades.map((a) => (
                <li key={a.id} className="text-xs text-muted flex items-start gap-2">
                  <Avatar name={a.usuario.nome} src={a.usuario.avatar} size="xs" />
                  <span className="leading-snug">
                    <span className="font-medium text-text">{a.usuario.nome}</span>{' '}
                    {descreverAtividade(a)}
                    <span className="ml-1 opacity-70">
                      · {new Date(a.criadoEm).toLocaleString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </div>

        {/* ─── Sidebar de ações ─── */}
        <aside className="w-full md:w-52 shrink-0 flex flex-col gap-1.5">
          <SidebarBotao
            icon={<Users className="h-3.5 w-3.5" />}
            label="Membros"
            ativo={secao === 'membros'}
            onClick={() => setSecao(secao === 'membros' ? null : 'membros')}
          />
          {secao === 'membros' && (
            <div className="rounded-[8px] border border-border p-2 flex flex-col gap-1">
              {board.membros.map(({ usuario }) => {
                const atribuido = membrosDoCard.has(usuario.id);
                return (
                  <button
                    key={usuario.id}
                    type="button"
                    className={cn(
                      'flex items-center gap-2 px-1.5 py-1 rounded-[6px] text-xs text-left hover:bg-surface-elevated',
                      atribuido && 'bg-surface-elevated',
                    )}
                    onClick={() =>
                      void mut(() =>
                        atribuido
                          ? api.delete(`/kanban/cards/${card.id}/membros/${usuario.id}`)
                          : api.post(`/kanban/cards/${card.id}/membros/${usuario.id}`),
                      )
                    }
                  >
                    <Avatar name={usuario.nome} src={usuario.avatar} size="xs" />
                    <span className="flex-1 truncate">{usuario.nome}</span>
                    {atribuido && <span className="text-emerald-500">✓</span>}
                  </button>
                );
              })}
            </div>
          )}

          <SidebarBotao
            icon={<Tag className="h-3.5 w-3.5" />}
            label="Etiquetas"
            ativo={secao === 'etiquetas'}
            onClick={() => setSecao(secao === 'etiquetas' ? null : 'etiquetas')}
          />
          {secao === 'etiquetas' && (
            <EtiquetasPanel card={card} board={board} etiquetasDoCard={etiquetasDoCard} onMut={mut} />
          )}

          <SidebarBotao
            icon={<CheckSquare className="h-3.5 w-3.5" />}
            label="Checklist"
            ativo={secao === 'checklist'}
            onClick={() => setSecao(secao === 'checklist' ? null : 'checklist')}
          />
          {secao === 'checklist' && (
            <NovoChecklistPanel
              onCriar={(t) => {
                void mut(() => api.post(`/kanban/cards/${card.id}/checklists`, { titulo: t }));
                setSecao(null);
              }}
            />
          )}

          <SidebarBotao
            icon={<Calendar className="h-3.5 w-3.5" />}
            label="Datas"
            ativo={secao === 'datas'}
            onClick={() => setSecao(secao === 'datas' ? null : 'datas')}
          />
          {secao === 'datas' && <DatasPanel card={card} onMut={mut} />}

          <SidebarBotao
            icon={<Palette className="h-3.5 w-3.5" />}
            label="Capa"
            ativo={secao === 'capa'}
            onClick={() => setSecao(secao === 'capa' ? null : 'capa')}
          />
          {secao === 'capa' && (
            <div className="rounded-[8px] border border-border p-2">
              <div className="flex flex-wrap gap-1.5">
                {BOARD_CORES.map((cor) => (
                  <button
                    key={cor}
                    type="button"
                    aria-label={`Capa ${cor}`}
                    className={cn(
                      'h-6 w-9 rounded-[4px]',
                      card.corCapa === cor && 'ring-2 ring-offset-1 ring-primary',
                    )}
                    style={{ background: cor }}
                    onClick={() => void mut(() => api.patch(`/kanban/cards/${card.id}`, { corCapa: cor }))}
                  />
                ))}
              </div>
              {card.corCapa && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="mt-1.5 w-full"
                  onClick={() => void mut(() => api.patch(`/kanban/cards/${card.id}`, { corCapa: null }))}
                >
                  Remover capa
                </Button>
              )}
            </div>
          )}

          <SidebarBotao
            icon={<Send className="h-3.5 w-3.5" />}
            label="Mover"
            ativo={secao === 'mover'}
            onClick={() => setSecao(secao === 'mover' ? null : 'mover')}
          />
          {secao === 'mover' && (
            <Select
              value={card.listaId}
              data-testid="card-modal-mover"
              onChange={(e) => {
                const destino = board.listas.find((l) => l.id === e.target.value);
                if (!destino || destino.id === card.listaId) return;
                const ultima = destino.cards[destino.cards.length - 1];
                const posicao = (ultima?.posicao ?? 0) + 1024;
                void mut(() =>
                  api.patch(`/kanban/cards/${card.id}/mover`, { listaId: destino.id, posicao }),
                );
                setSecao(null);
              }}
            >
              {board.listas.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.nome}
                </option>
              ))}
            </Select>
          )}

          <SidebarBotao
            icon={
              card.arquivado ? (
                <ArchiveRestore className="h-3.5 w-3.5" />
              ) : (
                <Archive className="h-3.5 w-3.5" />
              )
            }
            label={card.arquivado ? 'Restaurar' : 'Arquivar'}
            onClick={() =>
              void mut(() => api.patch(`/kanban/cards/${card.id}`, { arquivado: !card.arquivado }))
            }
          />
        </aside>
      </div>
    </Dialog>
  );
}

// ─── Sidebar ────────────────────────────────────────────────────────────

function SidebarBotao({
  icon,
  label,
  ativo,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  ativo?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={`card-modal-acao-${label.toLowerCase()}`}
      className={cn(
        'inline-flex items-center gap-2 px-2.5 py-1.5 rounded-[8px] text-xs font-medium text-left',
        'bg-surface-elevated border border-border hover:border-primary/40 transition-colors',
        ativo && 'border-primary/60',
      )}
    >
      {icon} {label}
    </button>
  );
}

function EtiquetasPanel({
  card,
  board,
  etiquetasDoCard,
  onMut,
}: {
  card: KCardCompleto;
  board: KBoardCompleto;
  etiquetasDoCard: Set<string>;
  onMut: (fn: () => Promise<unknown>) => Promise<void>;
}) {
  const [criando, setCriando] = useState(false);
  const [nome, setNome] = useState('');
  const [cor, setCor] = useState<string>(BOARD_CORES[5]);

  return (
    <div className="rounded-[8px] border border-border p-2 flex flex-col gap-1">
      {board.etiquetas.map((et) => {
        const aplicada = etiquetasDoCard.has(et.id);
        return (
          <button
            key={et.id}
            type="button"
            className="flex items-center gap-2 text-xs"
            onClick={() =>
              void onMut(() =>
                aplicada
                  ? api.delete(`/kanban/cards/${card.id}/etiquetas/${et.id}`)
                  : api.post(`/kanban/cards/${card.id}/etiquetas/${et.id}`),
              )
            }
          >
            <span
              className="h-6 flex-1 rounded-[6px] px-2 inline-flex items-center text-white text-[10px] font-medium"
              style={{ background: et.cor }}
            >
              {et.nome ?? ''}
            </span>
            {aplicada && <span className="text-emerald-500">✓</span>}
          </button>
        );
      })}
      {criando ? (
        <div className="flex flex-col gap-1.5 mt-1">
          <Input
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            placeholder="Nome (opcional)"
            autoFocus
          />
          <div className="flex flex-wrap gap-1">
            {BOARD_CORES.slice(0, 8).map((c) => (
              <button
                key={c}
                type="button"
                aria-label={`Cor ${c}`}
                className={cn('h-5 w-7 rounded-[4px]', cor === c && 'ring-2 ring-primary')}
                style={{ background: c }}
                onClick={() => setCor(c)}
              />
            ))}
          </div>
          <Button
            size="sm"
            onClick={() => {
              void onMut(async () => {
                const nova = await api.post<{ id: string }>(`/kanban/boards/${board.id}/etiquetas`, {
                  nome: nome.trim() || null,
                  cor,
                });
                await api.post(`/kanban/cards/${card.id}/etiquetas/${nova.id}`);
              });
              setCriando(false);
              setNome('');
            }}
          >
            Criar e aplicar
          </Button>
        </div>
      ) : (
        <Button size="sm" variant="ghost" onClick={() => setCriando(true)}>
          + Nova etiqueta
        </Button>
      )}
    </div>
  );
}

function NovoChecklistPanel({ onCriar }: { onCriar: (titulo: string) => void }) {
  const [titulo, setTitulo] = useState('Checklist');
  return (
    <div className="rounded-[8px] border border-border p-2 flex flex-col gap-1.5">
      <Input
        value={titulo}
        onChange={(e) => setTitulo(e.target.value)}
        autoFocus
        data-testid="card-modal-novo-checklist"
        onKeyDown={(e) => {
          if (e.key === 'Enter' && titulo.trim()) onCriar(titulo.trim());
        }}
      />
      <Button size="sm" onClick={() => titulo.trim() && onCriar(titulo.trim())}>
        Adicionar
      </Button>
    </div>
  );
}

/**
 * Date input (YYYY-MM-DD) → ISO ao MEIO-DIA UTC. Evita o off-by-one clássico:
 * meia-noite UTC vira "dia anterior" em UTC-3 na exibição local.
 */
function dateInputParaIso(v: string): string | null {
  return v ? `${v}T12:00:00.000Z` : null;
}

function DatasPanel({
  card,
  onMut,
}: {
  card: KCardCompleto;
  onMut: (fn: () => Promise<unknown>) => Promise<void>;
}) {
  const paraInputDate = (iso: string | null) => (iso ? iso.slice(0, 10) : '');
  return (
    <div className="rounded-[8px] border border-border p-2 flex flex-col gap-2 text-xs">
      <label className="flex flex-col gap-1">
        <span className="text-muted">Início</span>
        <Input
          type="date"
          value={paraInputDate(card.dataInicio)}
          onChange={(e) =>
            void onMut(() =>
              api.patch(`/kanban/cards/${card.id}`, { dataInicio: dateInputParaIso(e.target.value) }),
            )
          }
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-muted">Entrega</span>
        <Input
          type="date"
          value={paraInputDate(card.dataEntrega)}
          data-testid="card-modal-data-entrega"
          onChange={(e) =>
            void onMut(() =>
              api.patch(`/kanban/cards/${card.id}`, { dataEntrega: dateInputParaIso(e.target.value) }),
            )
          }
        />
      </label>
      <Checkbox
        label="Concluído"
        checked={card.concluido}
        onChange={(e) =>
          void onMut(() => api.patch(`/kanban/cards/${card.id}`, { concluido: e.target.checked }))
        }
      />
    </div>
  );
}

// ─── Checklist ★ ────────────────────────────────────────────────────────

function ChecklistSection({
  checklist,
  board,
  onMut,
}: {
  checklist: KChecklist;
  board: KBoardCompleto;
  onMut: (fn: () => Promise<unknown>) => Promise<void>;
}) {
  const [novoItem, setNovoItem] = useState('');
  const total = checklist.itens.length;
  const feitos = checklist.itens.filter((i) => i.concluido).length;
  const pct = total > 0 ? Math.round((feitos / total) * 100) : 0;

  return (
    <section data-testid={`card-modal-checklist-${checklist.id}`}>
      <div className="flex items-center justify-between mb-1">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted inline-flex items-center gap-1">
          <CheckSquare className="h-3.5 w-3.5" /> {checklist.titulo}
        </h4>
        <IconButton
          aria-label="Excluir checklist"
          size="sm"
          variant="ghost"
          icon={<Trash2 className="h-3.5 w-3.5" />}
          onClick={() => void onMut(() => api.delete(`/kanban/checklists/${checklist.id}`))}
        />
      </div>

      {/* Barra de progresso */}
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[10px] text-muted w-8">{pct}%</span>
        <div className="flex-1 h-1.5 rounded-full bg-surface-elevated overflow-hidden">
          <div
            className={cn('h-full transition-all', pct === 100 ? 'bg-emerald-500' : 'bg-primary')}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      <ul className="flex flex-col gap-1">
        {checklist.itens.map((item) => (
          <ChecklistItemRow key={item.id} item={item} board={board} onMut={onMut} />
        ))}
      </ul>

      <div className="mt-1.5">
        <Input
          value={novoItem}
          onChange={(e) => setNovoItem(e.target.value)}
          placeholder="+ Adicionar item (Enter)"
          data-testid={`card-modal-add-item-${checklist.id}`}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && novoItem.trim()) {
              void onMut(() =>
                api.post(`/kanban/checklists/${checklist.id}/itens`, { texto: novoItem.trim() }),
              );
              setNovoItem('');
            }
          }}
        />
      </div>
    </section>
  );
}

/** Item de checklist com os dois botões do Trello pago: 📅 prazo e 👤 responsável. */
function ChecklistItemRow({
  item,
  board,
  onMut,
}: {
  item: KChecklistItem;
  board: KBoardCompleto;
  onMut: (fn: () => Promise<unknown>) => Promise<void>;
}) {
  const [editor, setEditor] = useState<'prazo' | 'responsavel' | null>(null);
  const prazo = statusPrazo(item.dataEntrega, item.concluido);

  return (
    <li className="group rounded-[8px] hover:bg-surface-elevated px-1.5 py-1">
      <div className="flex items-center gap-2">
        <Checkbox
          checked={item.concluido}
          onChange={(e) =>
            void onMut(() =>
              api.patch(`/kanban/checklist-itens/${item.id}`, { concluido: e.target.checked }),
            )
          }
        />
        <span
          className={cn('flex-1 text-sm', item.concluido && 'line-through text-muted')}
        >
          {item.texto}
        </span>

        {item.dataEntrega && (
          <span
            className={cn(
              'text-[10px] px-1.5 py-0.5 rounded-[5px] font-medium',
              prazo === 'vencido' && 'bg-red-500/15 text-red-500',
              prazo === 'proximo' && 'bg-amber-500/15 text-amber-500',
              (prazo === 'normal' || prazo === 'concluido') && 'bg-surface-elevated text-muted',
            )}
          >
            {new Date(item.dataEntrega).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}
          </span>
        )}
        {item.responsavel && (
          <span title={item.responsavel.nome}>
            <Avatar name={item.responsavel.nome} src={item.responsavel.avatar} size="xs" />
          </span>
        )}

        <span className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <IconButton
            aria-label="Prazo do item"
            size="sm"
            variant="ghost"
            icon={<Calendar className="h-3.5 w-3.5" />}
            onClick={() => setEditor(editor === 'prazo' ? null : 'prazo')}
          />
          <IconButton
            aria-label="Responsável do item"
            size="sm"
            variant="ghost"
            icon={<UserPlus className="h-3.5 w-3.5" />}
            onClick={() => setEditor(editor === 'responsavel' ? null : 'responsavel')}
          />
          <IconButton
            aria-label="Excluir item"
            size="sm"
            variant="ghost"
            icon={<Trash2 className="h-3.5 w-3.5" />}
            onClick={() => void onMut(() => api.delete(`/kanban/checklist-itens/${item.id}`))}
          />
        </span>
      </div>

      {editor === 'prazo' && (
        <div className="mt-1 ml-7 flex items-center gap-1.5">
          <Input
            type="date"
            value={item.dataEntrega ? item.dataEntrega.slice(0, 10) : ''}
            onChange={(e) => {
              void onMut(() =>
                api.patch(`/kanban/checklist-itens/${item.id}`, {
                  dataEntrega: dateInputParaIso(e.target.value),
                }),
              );
              setEditor(null);
            }}
          />
        </div>
      )}
      {editor === 'responsavel' && (
        <div className="mt-1 ml-7">
          <Select
            value={item.responsavelId ?? ''}
            onChange={(e) => {
              void onMut(() =>
                api.patch(`/kanban/checklist-itens/${item.id}`, {
                  responsavelId: e.target.value || null,
                }),
              );
              setEditor(null);
            }}
          >
            <option value="">— sem responsável —</option>
            {board.membros.map(({ usuario }) => (
              <option key={usuario.id} value={usuario.id}>
                {usuario.nome}
              </option>
            ))}
          </Select>
        </div>
      )}
    </li>
  );
}

// ─── Campos personalizados ★ ────────────────────────────────────────────

/** Edição inline do valor de um campo, com input adequado ao tipo. */
function CampoInline({
  campo,
  card,
  onMut,
}: {
  campo: KCampoBoard;
  card: KCardCompleto;
  onMut: (fn: () => Promise<unknown>) => Promise<void>;
}) {
  const valorAtual = card.campoValores.find((v) => v.campoId === campo.id)?.valor ?? null;
  const [rascunho, setRascunho] = useState<string>(
    valorAtual === null ? '' : String(valorAtual),
  );
  useEffect(() => {
    setRascunho(valorAtual === null ? '' : String(valorAtual));
  }, [valorAtual]);

  function salvar(valor: string | number | boolean | null) {
    void onMut(() => api.put(`/kanban/cards/${card.id}/campos/${campo.id}`, { valor }));
  }

  const label = (
    <span className="text-[10px] uppercase tracking-wider text-muted">{campo.nome}</span>
  );

  if (campo.tipo === 'checkbox') {
    return (
      <label className="flex flex-col gap-1">
        {label}
        <Checkbox
          checked={valorAtual === true}
          onChange={(e) => salvar(e.target.checked)}
        />
      </label>
    );
  }
  if (campo.tipo === 'lista_opcoes') {
    return (
      <label className="flex flex-col gap-1">
        {label}
        <Select
          value={valorAtual === null ? '' : String(valorAtual)}
          onChange={(e) => salvar(e.target.value === '' ? null : e.target.value)}
        >
          <option value="">—</option>
          {(campo.opcoes ?? []).map((op) => (
            <option key={op} value={op}>
              {op}
            </option>
          ))}
        </Select>
      </label>
    );
  }
  if (campo.tipo === 'data') {
    return (
      <label className="flex flex-col gap-1">
        {label}
        <Input
          type="date"
          value={typeof valorAtual === 'string' ? valorAtual.slice(0, 10) : ''}
          onChange={(e) => salvar(e.target.value === '' ? null : e.target.value)}
        />
      </label>
    );
  }
  // texto / numero: edita local, salva no blur (evita PUT a cada tecla)
  return (
    <label className="flex flex-col gap-1">
      {label}
      <Input
        type={campo.tipo === 'numero' ? 'number' : 'text'}
        value={rascunho}
        onChange={(e) => setRascunho(e.target.value)}
        onBlur={() => {
          const atual = valorAtual === null ? '' : String(valorAtual);
          if (rascunho === atual) return;
          if (rascunho === '') salvar(null);
          else salvar(campo.tipo === 'numero' ? Number(rascunho) : rascunho);
        }}
      />
    </label>
  );
}

// ─── Comentários ────────────────────────────────────────────────────────

function ComentariosSection({
  card,
  meuId,
  isAdmin,
  onMut,
}: {
  card: KCardCompleto;
  meuId: string | undefined;
  isAdmin: boolean;
  onMut: (fn: () => Promise<unknown>) => Promise<void>;
}) {
  const [texto, setTexto] = useState('');

  function enviar() {
    const v = texto.trim();
    if (!v) return;
    void onMut(() => api.post(`/kanban/cards/${card.id}/comentarios`, { texto: v }));
    setTexto('');
  }

  return (
    <section>
      <h4 className="text-xs font-semibold uppercase tracking-wider text-muted mb-1.5 inline-flex items-center gap-1">
        <MessageSquare className="h-3.5 w-3.5" /> Comentários
      </h4>
      <div className="flex items-start gap-2 mb-2">
        <Textarea
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          rows={2}
          placeholder="Escreva um comentário…"
          data-testid="card-modal-comentario-input"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) enviar();
          }}
        />
        <Button size="sm" onClick={enviar} data-testid="card-modal-comentar">
          Enviar
        </Button>
      </div>
      <ul className="flex flex-col gap-2">
        {card.comentarios.map((cm) => (
          <li key={cm.id} className="flex items-start gap-2">
            <Avatar name={cm.autor.nome} src={cm.autor.avatar} size="sm" />
            <div className="flex-1 min-w-0">
              <div className="text-xs">
                <span className="font-medium text-text">{cm.autor.nome}</span>
                <span className="text-muted ml-1.5">
                  {new Date(cm.criadoEm).toLocaleString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
              <div className="text-sm text-text bg-surface-elevated rounded-[8px] px-2.5 py-1.5 mt-0.5 whitespace-pre-wrap break-words">
                {cm.texto}
              </div>
            </div>
            {(cm.autorId === meuId || isAdmin) && (
              <IconButton
                aria-label="Excluir comentário"
                size="sm"
                variant="ghost"
                icon={<Trash2 className="h-3.5 w-3.5" />}
                onClick={() => void onMut(() => api.delete(`/kanban/comentarios/${cm.id}`))}
              />
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
