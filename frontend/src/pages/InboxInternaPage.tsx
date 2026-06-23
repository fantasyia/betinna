import { useMemo, useState } from 'react';
import { api, apiErrorMessage } from '@/lib/api';
import { useApiQuery, type PaginatedResponse } from '@/hooks/useApiQuery';
import { useRole } from '@/hooks/usePermission';
import { PageLayout } from '@/components/PageLayout';
import { StateView } from '@/components/StateView';
import { FilterBar } from '@/components/FilterBar';
import { Dialog } from '@/components/ui';
import { FormField, Input, Select, Textarea } from '@/components/FormField';
import { useToast } from '@/components/toast';

type ThreadStatus = 'ABERTA' | 'RESPONDIDA' | 'RESOLVIDA';

interface Mensagem {
  id: string;
  autorNome: string;
  ladoEmpresa: boolean;
  texto: string;
  isSistema: boolean;
  criadoEm: string;
}

interface Thread {
  id: string;
  numero: string;
  tipo: string;
  assunto: string;
  status: ThreadStatus;
  prioridade: string;
  criadoPorNome?: string | null;
  slaRespostaEm?: string | null;
  ultimaMsgEm: string;
  mensagens: Mensagem[];
}

interface TipoCanal {
  key: string;
  nome: string;
  permiteResposta: boolean;
}

const DEFAULT_TIPOS: TipoCanal[] = [
  { key: 'diretor_comercial', nome: 'Direto com Diretor Comercial', permiteResposta: true },
  { key: 'suporte_pedidos', nome: 'Suporte Pedidos', permiteResposta: true },
  { key: 'avisos', nome: 'Avisos', permiteResposta: false },
];

const STATUS_LABEL: Record<ThreadStatus, string> = {
  ABERTA: 'Aguardando empresa',
  RESPONDIDA: 'Respondida',
  RESOLVIDA: 'Resolvida',
};
const STATUS_COLOR: Record<ThreadStatus, string> = {
  ABERTA: 'var(--warning)',
  RESPONDIDA: 'var(--info)',
  RESOLVIDA: 'var(--success)',
};
const BADGE = 'inline-block rounded-md px-2 py-0.5 text-[11px] font-semibold text-white';

const fmtDataHora = (s?: string | null) =>
  s ? new Date(s).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—';

export default function InboxInternaPage() {
  const [status, setStatus] = useState('');
  const [criando, setCriando] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);

  const { data: cfg } = useApiQuery<Record<string, unknown>>('/empresas/config');
  const tipos = useMemo<TipoCanal[]>(() => {
    const t = (cfg?.inboxInterna as { tipos?: TipoCanal[] } | undefined)?.tipos;
    return t && t.length > 0 ? t : DEFAULT_TIPOS;
  }, [cfg]);
  const tipoNome = (k: string) => tipos.find((t) => t.key === k)?.nome ?? k;

  const listPath = useMemo(() => {
    const p = new URLSearchParams({ page: '1', limit: '50' });
    if (status) p.set('status', status);
    return `/inbox-interna?${p.toString()}`;
  }, [status]);
  const { data: resp, loading, error, refetch } = useApiQuery<PaginatedResponse<Thread>>(listPath);

  return (
    <PageLayout
      title="Mensagens internas"
      actions={
        <button
          type="button"
          data-testid="thread-new-btn"
          onClick={() => setCriando(true)}
          className="bg-primary text-primary-contrast rounded-md px-4 py-2 text-[13px] font-semibold cursor-pointer"
        >
          + Nova conversa
        </button>
      }
    >
      <div className="bg-surface border border-border rounded-[10px] p-6">
        <FilterBar>
          <Select value={status} onChange={(e) => setStatus(e.target.value)} data-testid="filter-status">
            <option value="">Todos os status</option>
            {(Object.keys(STATUS_LABEL) as ThreadStatus[]).map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </Select>
        </FilterBar>

        <StateView
          loading={loading}
          error={error}
          empty={!resp || resp.data.length === 0}
          emptyMessage="Nenhuma conversa interna ainda."
          onRetry={refetch}
        >
          <div className="flex flex-col gap-2">
            {resp?.data.map((t) => (
              <button
                key={t.id}
                type="button"
                data-testid={`thread-open-${t.id}`}
                onClick={() => setSelected(t.id)}
                className="text-left bg-surface border border-border rounded-[10px] p-3 cursor-pointer hover:border-border-strong flex items-center gap-3"
              >
                <div className="flex-1 min-w-0">
                  <div className="font-semibold truncate">
                    {t.assunto} <span className="text-[11px] text-muted">· {t.numero}</span>
                  </div>
                  <div className="text-[11px] text-muted">
                    {tipoNome(t.tipo)} · {t.criadoPorNome ?? '—'} · {fmtDataHora(t.ultimaMsgEm)}
                  </div>
                </div>
                <span className={BADGE} style={{ backgroundColor: STATUS_COLOR[t.status] }}>
                  {STATUS_LABEL[t.status]}
                </span>
              </button>
            ))}
          </div>
        </StateView>
      </div>

      {criando && (
        <NovaConversaDialog
          tipos={tipos}
          onClose={() => setCriando(false)}
          onCreated={() => {
            setCriando(false);
            refetch();
          }}
        />
      )}
      {selected && (
        <ThreadDialog
          id={selected}
          tipoNome={tipoNome}
          onClose={() => setSelected(null)}
          onChanged={refetch}
        />
      )}
    </PageLayout>
  );
}

function NovaConversaDialog({
  tipos,
  onClose,
  onCreated,
}: {
  tipos: TipoCanal[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const toast = useToast();
  const role = useRole();
  // REP não pode abrir em canais somente-leitura (avisos).
  const tiposDisponiveis = tipos.filter((t) => t.permiteResposta || role !== 'REP');
  const [tipo, setTipo] = useState(tiposDisponiveis[0]?.key ?? 'suporte_pedidos');
  const [assunto, setAssunto] = useState('');
  const [mensagem, setMensagem] = useState('');
  const [busy, setBusy] = useState(false);

  async function salvar() {
    if (assunto.trim().length < 2 || mensagem.trim().length < 1) {
      toast.error('Preencha assunto e mensagem');
      return;
    }
    setBusy(true);
    try {
      await api.post('/inbox-interna', {
        tipo,
        assunto: assunto.trim(),
        mensagem: mensagem.trim(),
      });
      toast.success('Conversa criada');
      onCreated();
    } catch (err) {
      toast.error('Falha ao criar', apiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="Nova conversa"
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="bg-surface text-text border border-border-strong rounded-md px-4 py-2 text-[13px] font-medium cursor-pointer"
          >
            Cancelar
          </button>
          <button
            type="button"
            data-testid="thread-criar-confirm"
            disabled={busy}
            onClick={salvar}
            className="bg-primary text-primary-contrast rounded-md px-4 py-2 text-[13px] font-semibold cursor-pointer disabled:opacity-60"
          >
            {busy ? 'Enviando…' : 'Enviar'}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <FormField label="Canal" htmlFor="th-tipo">
          <Select id="th-tipo" value={tipo} onChange={(e) => setTipo(e.target.value)}>
            {tiposDisponiveis.map((t) => (
              <option key={t.key} value={t.key}>
                {t.nome}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label="Assunto" htmlFor="th-assunto" required>
          <Input id="th-assunto" value={assunto} onChange={(e) => setAssunto(e.target.value)} />
        </FormField>
        <FormField label="Mensagem" htmlFor="th-msg" required>
          <Textarea id="th-msg" value={mensagem} onChange={(e) => setMensagem(e.target.value)} />
        </FormField>
      </div>
    </Dialog>
  );
}

function ThreadDialog({
  id,
  tipoNome,
  onClose,
  onChanged,
}: {
  id: string;
  tipoNome: (k: string) => string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const toast = useToast();
  const { data, loading, error, refetch } = useApiQuery<Thread>(`/inbox-interna/${id}`);
  const [texto, setTexto] = useState('');
  const [busy, setBusy] = useState(false);

  async function responder() {
    if (texto.trim().length < 1) return;
    setBusy(true);
    try {
      await api.post(`/inbox-interna/${id}/responder`, { texto: texto.trim() });
      setTexto('');
      refetch();
      onChanged();
    } catch (err) {
      toast.error('Falha ao responder', apiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function resolver() {
    setBusy(true);
    try {
      await api.post(`/inbox-interna/${id}/resolver`);
      toast.success('Conversa resolvida');
      refetch();
      onChanged();
    } catch (err) {
      toast.error('Falha ao resolver', apiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const resolvida = data?.status === 'RESOLVIDA';

  return (
    <Dialog
      open
      onClose={onClose}
      title={data ? `${data.assunto} · ${data.numero}` : 'Conversa'}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="bg-surface text-text border border-border-strong rounded-md px-4 py-2 text-[13px] font-medium cursor-pointer"
          >
            Fechar
          </button>
          {data && !resolvida && (
            <button
              type="button"
              data-testid="thread-resolver"
              disabled={busy}
              onClick={resolver}
              className="bg-success text-white rounded-md px-4 py-2 text-[13px] font-semibold cursor-pointer disabled:opacity-60"
            >
              Resolver
            </button>
          )}
        </>
      }
    >
      <StateView loading={loading} error={error} onRetry={refetch}>
        {data && (
          <div>
            <div className="text-[11px] text-muted mb-3">
              {tipoNome(data.tipo)} · aberta por {data.criadoPorNome ?? '—'}
              {data.slaRespostaEm ? ` · SLA: ${fmtDataHora(data.slaRespostaEm)}` : ''}
            </div>
            <div className="flex flex-col gap-2 max-h-[360px] overflow-y-auto mb-3">
              {data.mensagens.map((m) => (
                <div
                  key={m.id}
                  className={`max-w-[80%] rounded-[10px] p-2.5 text-sm text-text ${
                    m.ladoEmpresa
                      ? 'self-start bg-[var(--blue-light)] border border-info'
                      : 'self-end bg-surface border border-border-strong'
                  }`}
                >
                  <div className="text-[11px] text-muted mb-0.5">
                    {m.autorNome} · {fmtDataHora(m.criadoEm)}
                  </div>
                  <div className="whitespace-pre-wrap">{m.texto}</div>
                </div>
              ))}
            </div>
            {resolvida ? (
              <p className="text-[12px] text-muted">Conversa resolvida.</p>
            ) : (
              <div className="flex flex-col gap-2">
                <Textarea
                  data-testid="thread-reply-input"
                  value={texto}
                  onChange={(e) => setTexto(e.target.value)}
                  placeholder="Escreva uma resposta…"
                />
                <button
                  type="button"
                  data-testid="thread-reply-send"
                  disabled={busy || texto.trim().length < 1}
                  onClick={responder}
                  className="bg-primary text-primary-contrast rounded-md px-4 py-2 text-[13px] font-semibold cursor-pointer self-end disabled:opacity-60"
                >
                  {busy ? 'Enviando…' : 'Responder'}
                </button>
              </div>
            )}
          </div>
        )}
      </StateView>
    </Dialog>
  );
}
