import { useMemo, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useApiQuery } from '@/hooks/useApiQuery';
import { PageLayout } from '@/components/PageLayout';
import { StateView } from '@/components/StateView';
import { Modal } from '@/components/Modal';
import { FormField, Input, Select, Textarea } from '@/components/FormField';
import { AsyncCombobox } from '@/components/AsyncCombobox';
import { badge, btn, btnDanger, btnSecondary, card, colors } from '@/components/styles';

type AgendaTipo = 'VISITA' | 'LIGACAO' | 'REUNIAO' | 'ENTREGA' | 'TAREFA';

interface AgendaItem {
  id: string;
  titulo: string;
  data: string;
  duracao: number;
  tipo: AgendaTipo;
  observacao?: string | null;
  cliente?: { id: string; nome: string } | null;
  googleEventId?: string | null;
}

interface ClienteOpt {
  id: string;
  nome: string;
}

const TIPOS: AgendaTipo[] = ['VISITA', 'LIGACAO', 'REUNIAO', 'ENTREGA', 'TAREFA'];

const TIPO_COLOR: Record<AgendaTipo, string> = {
  VISITA: '#2563eb',
  LIGACAO: '#0891b2',
  REUNIAO: '#7c3aed',
  ENTREGA: colors.warning,
  TAREFA: colors.muted,
};
const TIPO_ICON: Record<AgendaTipo, string> = {
  VISITA: '🚗',
  LIGACAO: '📞',
  REUNIAO: '🤝',
  ENTREGA: '📦',
  TAREFA: '✓',
};

function startOfWeek(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  const dow = x.getDay(); // 0 = dom
  x.setDate(x.getDate() - dow);
  return x;
}
function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
function fmtDay(d: Date) {
  return d.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' });
}
function fmtTime(s: string) {
  try {
    return new Date(s).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return s;
  }
}
function toLocalIso(d: Date) {
  // YYYY-MM-DDTHH:mm pra <input type="datetime-local">
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function sameDay(a: Date, b: Date) {
  return a.toDateString() === b.toDateString();
}

export default function AgendaPage() {
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const [filtroTipo, setFiltroTipo] = useState('');
  const [creating, setCreating] = useState<Date | null>(null);
  const [editing, setEditing] = useState<AgendaItem | null>(null);

  const weekEnd = addDays(weekStart, 7);
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  const listPath = useMemo(() => {
    const qs = new URLSearchParams({
      inicio: weekStart.toISOString(),
      fim: weekEnd.toISOString(),
    });
    if (filtroTipo) qs.set('tipo', filtroTipo);
    return `/agenda?${qs.toString()}`;
  }, [weekStart, weekEnd, filtroTipo]);

  const { data: items, loading, error, refetch } = useApiQuery<AgendaItem[]>(listPath);

  const itemsByDay = useMemo(() => {
    const map = new Map<string, AgendaItem[]>();
    if (items) {
      for (const it of items) {
        const key = new Date(it.data).toDateString();
        const arr = map.get(key) ?? [];
        arr.push(it);
        map.set(key, arr);
      }
      // Ordena cada dia por hora
      for (const arr of map.values()) {
        arr.sort((a, b) => new Date(a.data).getTime() - new Date(b.data).getTime());
      }
    }
    return map;
  }, [items]);

  const today = new Date();

  return (
    <PageLayout
      title="Agenda"
      actions={
        <button
          type="button"
          data-testid="agenda-new-btn"
          onClick={() => setCreating(new Date())}
          style={btn}
        >
          + Novo compromisso
        </button>
      }
    >
      <div style={card}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: '1rem',
            gap: '0.5rem',
            flexWrap: 'wrap',
          }}
        >
          <div style={{ display: 'flex', gap: 4 }}>
            <button
              type="button"
              data-testid="agenda-prev-week"
              onClick={() => setWeekStart(addDays(weekStart, -7))}
              style={btnSecondary}
            >
              ‹ Semana anterior
            </button>
            <button
              type="button"
              data-testid="agenda-today"
              onClick={() => setWeekStart(startOfWeek(new Date()))}
              style={btnSecondary}
            >
              Hoje
            </button>
            <button
              type="button"
              data-testid="agenda-next-week"
              onClick={() => setWeekStart(addDays(weekStart, 7))}
              style={btnSecondary}
            >
              Próxima semana ›
            </button>
          </div>
          <div style={{ fontSize: 13, color: colors.muted }}>
            Semana de {weekStart.toLocaleDateString('pt-BR')} a{' '}
            {addDays(weekStart, 6).toLocaleDateString('pt-BR')}
          </div>
          <Select
            data-testid="agenda-filter-tipo"
            value={filtroTipo}
            onChange={(e) => setFiltroTipo(e.target.value)}
            style={{ maxWidth: 180 }}
          >
            <option value="">Todos os tipos</option>
            {TIPOS.map((t) => (
              <option key={t} value={t}>
                {TIPO_ICON[t]} {t}
              </option>
            ))}
          </Select>
        </div>

        <StateView loading={loading} error={error} onRetry={refetch}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(7, minmax(140px, 1fr))',
              gap: '0.5rem',
              overflowX: 'auto',
            }}
          >
            {days.map((d) => {
              const dayItems = itemsByDay.get(d.toDateString()) ?? [];
              const isToday = sameDay(d, today);
              return (
                <div
                  key={d.toDateString()}
                  data-testid={`agenda-day-${d.getDate()}`}
                  style={{
                    background: isToday ? colors.primary + '08' : '#fafbfc',
                    border: `1px solid ${isToday ? colors.primary : colors.border}`,
                    borderRadius: 6,
                    padding: '0.5rem',
                    minHeight: 200,
                  }}
                >
                  <header
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      marginBottom: '0.5rem',
                      fontSize: 12,
                      fontWeight: 600,
                      color: isToday ? colors.primary : colors.text,
                    }}
                  >
                    <span>{fmtDay(d)}</span>
                    <button
                      type="button"
                      onClick={() => {
                        const at = new Date(d);
                        at.setHours(9, 0, 0, 0);
                        setCreating(at);
                      }}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: colors.muted,
                        cursor: 'pointer',
                        fontSize: 16,
                        lineHeight: 1,
                        padding: 0,
                      }}
                      aria-label="Adicionar compromisso"
                      title="Adicionar compromisso"
                    >
                      +
                    </button>
                  </header>
                  {dayItems.length === 0 && (
                    <p style={{ fontSize: 11, color: colors.muted, margin: 0, textAlign: 'center', padding: '0.5rem 0' }}>
                      Livre
                    </p>
                  )}
                  <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {dayItems.map((it) => (
                      <li key={it.id}>
                        <button
                          type="button"
                          data-testid={`agenda-item-${it.id}`}
                          onClick={() => setEditing(it)}
                          style={{
                            display: 'block',
                            width: '100%',
                            textAlign: 'left',
                            padding: '0.375rem 0.5rem',
                            background: colors.surface,
                            border: `1px solid ${colors.border}`,
                            borderLeft: `3px solid ${TIPO_COLOR[it.tipo]}`,
                            borderRadius: 4,
                            cursor: 'pointer',
                            fontFamily: 'inherit',
                            color: colors.text,
                            fontSize: 12,
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            <strong>{fmtTime(it.data)}</strong>
                            <span style={{ color: colors.muted }}>· {it.duracao}min</span>
                            {it.googleEventId && (
                              <span title="Espelhado no Google Calendar" style={{ marginLeft: 'auto', fontSize: 10 }}>
                                📅
                              </span>
                            )}
                          </div>
                          <div style={{ fontWeight: 500, marginTop: 2 }}>{it.titulo}</div>
                          {it.cliente?.nome && (
                            <div style={{ fontSize: 11, color: colors.muted, marginTop: 2 }}>
                              {it.cliente.nome}
                            </div>
                          )}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        </StateView>
      </div>

      {creating !== null && (
        <AgendaFormModal
          initialDate={creating}
          onClose={() => setCreating(null)}
          onSaved={() => {
            setCreating(null);
            refetch();
          }}
        />
      )}
      {editing && (
        <AgendaFormModal
          item={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            refetch();
          }}
        />
      )}
    </PageLayout>
  );
}

// ─── Form ─────────────────────────────────────────────────────────────

function AgendaFormModal({
  item,
  initialDate,
  onClose,
  onSaved,
}: {
  item?: AgendaItem;
  initialDate?: Date;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = Boolean(item);
  const [titulo, setTitulo] = useState(item?.titulo ?? '');
  const [data, setData] = useState(toLocalIso(item ? new Date(item.data) : initialDate ?? new Date()));
  const [duracao, setDuracao] = useState(item?.duracao ?? 60);
  const [tipo, setTipo] = useState<AgendaTipo>(item?.tipo ?? 'VISITA');
  const [observacao, setObservacao] = useState(item?.observacao ?? '');
  const [cliente, setCliente] = useState<ClienteOpt | null>(
    item?.cliente ? { id: item.cliente.id, nome: item.cliente.nome } : null,
  );
  const [espelharGoogle, setEspelharGoogle] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDel, setConfirmDel] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (titulo.trim().length === 0) {
      setError('Informe um título pra o compromisso.');
      return;
    }
    if (!data) {
      setError('Informe data e hora.');
      return;
    }
    if (duracao <= 0) {
      setError('Duração precisa ser maior que zero.');
      return;
    }
    setBusy(true);
    setError(null);
    const payload: Record<string, unknown> = {
      titulo: titulo.trim(),
      data: new Date(data).toISOString(),
      duracao,
      tipo,
      espelharGoogle,
    };
    if (observacao.trim()) payload.observacao = observacao.trim();
    if (cliente) payload.clienteId = cliente.id;
    try {
      if (isEdit && item) {
        await api.patch(`/agenda/${item.id}`, payload);
      } else {
        await api.post('/agenda', payload);
      }
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Falha ao salvar');
    } finally {
      setBusy(false);
    }
  }

  async function doDelete() {
    if (!item) return;
    setBusy(true);
    setError(null);
    try {
      await api.delete(`/agenda/${item.id}`);
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Falha ao excluir');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={isEdit ? 'Editar compromisso' : 'Novo compromisso'}
      footer={
        <>
          <button type="button" onClick={onClose} style={btnSecondary}>
            Cancelar
          </button>
          {isEdit && !confirmDel && (
            <button
              type="button"
              data-testid="agenda-delete"
              onClick={() => setConfirmDel(true)}
              style={btnDanger}
            >
              Excluir
            </button>
          )}
          {isEdit && confirmDel && (
            <>
              <button type="button" onClick={() => setConfirmDel(false)} style={btnSecondary}>
                Voltar
              </button>
              <button
                type="button"
                data-testid="agenda-delete-confirm"
                disabled={busy}
                onClick={doDelete}
                style={btnDanger}
              >
                {busy ? '…' : 'Confirmar'}
              </button>
            </>
          )}
          {!confirmDel && (
            <button
              type="submit"
              form="agenda-form"
              data-testid="agenda-save-btn"
              disabled={busy}
              style={{ ...btn, opacity: busy ? 0.6 : 1 }}
            >
              {busy ? 'Salvando…' : 'Salvar'}
            </button>
          )}
        </>
      }
    >
      <form id="agenda-form" onSubmit={submit}>
        <FormField label="Título" htmlFor="ag-tit" required>
          <Input
            id="ag-tit"
            data-testid="agenda-titulo-input"
            value={titulo}
            onChange={(e) => setTitulo(e.target.value)}
            minLength={1}
            maxLength={200}
            required
            autoFocus
          />
        </FormField>
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: '0.75rem' }}>
          <FormField label="Quando" htmlFor="ag-data" required>
            <Input
              id="ag-data"
              type="datetime-local"
              data-testid="agenda-data-input"
              value={data}
              onChange={(e) => setData(e.target.value)}
              required
            />
          </FormField>
          <FormField label="Duração (min)" htmlFor="ag-dur">
            <Input
              id="ag-dur"
              type="number"
              min={1}
              max={1440}
              value={duracao}
              onChange={(e) => setDuracao(Number(e.target.value))}
            />
          </FormField>
          <FormField label="Tipo" htmlFor="ag-tipo">
            <Select id="ag-tipo" value={tipo} onChange={(e) => setTipo(e.target.value as AgendaTipo)}>
              {TIPOS.map((t) => (
                <option key={t} value={t}>
                  {TIPO_ICON[t]} {t}
                </option>
              ))}
            </Select>
          </FormField>
        </div>
        <FormField label="Cliente (opcional)">
          <AsyncCombobox<ClienteOpt>
            testId="cliente-picker"
            endpoint="/clientes"
            placeholder="Buscar cliente…"
            getLabel={(c) => c.nome}
            getId={(c) => c.id}
            value={cliente}
            onChange={setCliente}
          />
        </FormField>
        <FormField label="Observação" htmlFor="ag-obs">
          <Textarea
            id="ag-obs"
            value={observacao}
            onChange={(e) => setObservacao(e.target.value)}
            maxLength={2000}
            placeholder="Pauta da visita, contexto, lembretes…"
          />
        </FormField>
        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            fontSize: 13,
            color: colors.muted,
            marginTop: '0.5rem',
          }}
        >
          <input
            type="checkbox"
            data-testid="agenda-google-checkbox"
            checked={espelharGoogle}
            onChange={(e) => setEspelharGoogle(e.target.checked)}
          />
          Espelhar no Google Calendar (se conectado)
        </label>
        {item?.googleEventId && (
          <p style={{ fontSize: 12, color: colors.muted, marginTop: 4 }}>
            <span style={badge(colors.success)}>📅 Já espelhado</span>
          </p>
        )}
        {error && (
          <p data-testid="form-error" style={{ color: colors.danger, fontSize: 13 }}>
            {error}
          </p>
        )}
      </form>
    </Modal>
  );
}
