import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageLayout } from '@/components/PageLayout';
import { Select } from '@/components/FormField';
import { useConfirm } from '@/hooks/useConfirm';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';

interface Notificacao {
  id: string;
  tipo: string;
  prioridade: 'BAIXA' | 'NORMAL' | 'ALTA' | 'URGENTE';
  titulo: string;
  mensagem: string;
  link: string | null;
  lidaEm: string | null;
  criadoEm: string;
}

interface ListResp {
  data: Notificacao[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
  naoLidas: number;
}

const TIPO_LABEL: Record<string, string> = {
  APROVACAO_PENDENTE: 'Aprovação pendente',
  APROVACAO_RESOLVIDA: 'Aprovação resolvida',
  OCORRENCIA_ABERTA: 'Ocorrência aberta',
  OCORRENCIA_RESOLVIDA: 'Ocorrência resolvida',
  PEDIDO_APROVADO: 'Pedido aprovado',
  COMISSAO_FECHADA: 'Comissão fechada',
  COMISSAO_PAGA: 'Comissão paga',
  MENSAGEM_INBOX: 'Mensagem inbox',
  AMOSTRA_FOLLOWUP: 'Amostra follow-up',
  LEAD_INATIVO: 'Lead inativo',
  CLIENTE_BLOQUEADO: 'Cliente bloqueado',
  ESTOQUE_ZERADO: 'Estoque zerado',
  GENERICO: 'Notificação',
};

// Cor da prioridade (CSS vars — respeitam o dark mode). Usada no dot + na badge.
const PRIORIDADE_COLOR: Record<Notificacao['prioridade'], string> = {
  BAIXA: 'var(--muted)',
  NORMAL: 'var(--primary)',
  ALTA: 'var(--warning)',
  URGENTE: 'var(--danger)',
};

// Equivalentes Tailwind pixel-idênticos dos objetos legados btn/btnSecondary/card.
const BTN = 'bg-primary text-primary-contrast rounded-md px-4 py-2 text-[13px] font-semibold cursor-pointer tracking-[-0.1px]';
const BTN_SEC =
  'bg-surface text-text border border-border-strong rounded-md px-4 py-2 text-[13px] font-medium cursor-pointer tracking-[-0.1px]';
const CARD = 'bg-surface border border-border rounded-[10px] p-6';

function fmt(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

export default function NotificacoesPage() {
  const navigate = useNavigate();
  const [data, setData] = useState<Notificacao[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [naoLidas, setNaoLidas] = useState(0);
  const [filtroLidas, setFiltroLidas] = useState<'todas' | 'naoLidas'>('todas');
  const [filtroPrioridade, setFiltroPrioridade] = useState<Notificacao['prioridade'] | ''>('');
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [confirmAsync, ConfirmDialog] = useConfirm();

  const load = useCallback(
    async (p = 1) => {
      setLoading(true);
      setErr(null);
      try {
        const qs = new URLSearchParams();
        qs.set('page', String(p));
        qs.set('limit', '30');
        if (filtroLidas === 'naoLidas') qs.set('apenasNaoLidas', 'true');
        if (filtroPrioridade) qs.set('prioridade', filtroPrioridade);
        const r = await api.get<ListResp>(`/notificacoes?${qs.toString()}`);
        setData(r.data);
        setPage(r.pagination.page);
        setTotalPages(r.pagination.totalPages);
        setNaoLidas(r.naoLidas);
      } catch (e) {
        setErr(e instanceof ApiError ? e.message : 'Falha ao carregar');
      } finally {
        setLoading(false);
      }
    },
    [filtroLidas, filtroPrioridade],
  );

  useEffect(() => {
    void load(1);
  }, [load]);

  async function marcarLida(id: string) {
    try {
      await api.patch(`/notificacoes/${id}/ler`);
      setData((prev) =>
        prev.map((n) => (n.id === id ? { ...n, lidaEm: new Date().toISOString() } : n)),
      );
      setNaoLidas((c) => Math.max(0, c - 1));
    } catch {
      /* ignore */
    }
  }

  async function marcarTodas() {
    try {
      await api.patch('/notificacoes/ler-todas');
      void load(page);
    } catch {
      /* ignore */
    }
  }

  async function deletar(id: string) {
    const ok = await confirmAsync({
      title: 'Apagar esta notificação?',
      message: 'Não fica no histórico depois de apagada.',
      confirmLabel: 'Apagar',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      await api.delete(`/notificacoes/${id}`);
      void load(page);
    } catch {
      /* ignore */
    }
  }

  function onClick(n: Notificacao) {
    if (!n.lidaEm) void marcarLida(n.id);
    if (n.link) navigate(n.link);
  }

  return (
    <PageLayout
      title={`Notificações${naoLidas > 0 ? ` (${naoLidas} não lidas)` : ''}`}
      actions={
        naoLidas > 0 ? (
          <button type="button" data-testid="mark-all-page" onClick={marcarTodas} className={BTN_SEC}>
            Marcar todas como lidas
          </button>
        ) : undefined
      }
    >
      <div className={cn(CARD, 'mb-4 flex items-center gap-3 flex-wrap')}>
        <label className="text-xs text-muted">Filtro:</label>
        <Select
          value={filtroLidas}
          onChange={(e) => setFiltroLidas(e.target.value as 'todas' | 'naoLidas')}
        >
          <option value="todas">Todas</option>
          <option value="naoLidas">Apenas não lidas</option>
        </Select>
        <Select
          value={filtroPrioridade}
          onChange={(e) =>
            setFiltroPrioridade(e.target.value as Notificacao['prioridade'] | '')
          }
        >
          <option value="">Toda prioridade</option>
          <option value="URGENTE">Urgente</option>
          <option value="ALTA">Alta</option>
          <option value="NORMAL">Normal</option>
          <option value="BAIXA">Baixa</option>
        </Select>
      </div>

      {err && (
        <div className="rounded-[10px] border border-[#fecaca] bg-[#fef2f2] p-6 text-[#991b1b] mb-4">
          {err}
        </div>
      )}

      {loading ? (
        <div className={CARD}>Carregando…</div>
      ) : data.length === 0 ? (
        <div className="bg-surface border border-border rounded-[10px] p-8 text-center text-muted">
          Nenhuma notificação encontrada com esses filtros.
        </div>
      ) : (
        <div className="bg-surface border border-border rounded-[10px]">
          {data.map((n) => (
            <div
              key={n.id}
              data-testid={`notif-row-${n.id}`}
              className={cn(
                'flex gap-3 px-4 py-3 border-b border-border',
                n.lidaEm ? 'bg-[#fff]' : 'bg-[#f0f9ff]',
                n.link ? 'cursor-pointer' : 'cursor-default',
              )}
              onClick={() => onClick(n)}
            >
              <span
                className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: PRIORIDADE_COLOR[n.prioridade] }}
                aria-hidden
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                  <strong className={cn('text-base', n.lidaEm ? 'font-medium' : 'font-bold')}>
                    {n.titulo}
                  </strong>
                  <span
                    className="inline-flex items-center rounded-full px-[9px] py-0.5 text-[11px] font-semibold leading-[1.6] tracking-[0.2px]"
                    style={{
                      backgroundColor: `color-mix(in srgb, ${PRIORIDADE_COLOR[n.prioridade]} 12%, transparent)`,
                      color: PRIORIDADE_COLOR[n.prioridade],
                      border: `1px solid color-mix(in srgb, ${PRIORIDADE_COLOR[n.prioridade]} 19%, transparent)`,
                    }}
                  >
                    {TIPO_LABEL[n.tipo] ?? n.tipo}
                  </span>
                </div>
                <div className="text-sm text-muted">{n.mensagem}</div>
                <div className="text-[11px] text-muted mt-1">
                  {fmt(n.criadoEm)}
                  {n.lidaEm && ` · lida ${fmt(n.lidaEm)}`}
                </div>
              </div>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  void deletar(n.id);
                }}
                aria-label="Apagar"
                className="bg-transparent border-none cursor-pointer text-muted text-lg self-start"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 mt-4">
          <button type="button" disabled={page <= 1} onClick={() => load(page - 1)} className={BTN_SEC}>
            ‹
          </button>
          <span className="text-xs text-muted">
            Página {page} de {totalPages}
          </span>
          <button
            type="button"
            disabled={page >= totalPages}
            onClick={() => load(page + 1)}
            className={BTN}
          >
            ›
          </button>
        </div>
      )}
      {ConfirmDialog}
    </PageLayout>
  );
}
