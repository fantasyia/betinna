import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageLayout } from '@/components/PageLayout';
import { Select } from '@/components/FormField';
import { api, ApiError } from '@/lib/api';
import { badge, btn, btnSecondary, card, colors } from '@/components/styles';

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
  GENERICO: 'Notificação',
};

const PRIORIDADE_COLOR: Record<Notificacao['prioridade'], string> = {
  BAIXA: colors.muted,
  NORMAL: colors.primary,
  ALTA: colors.warning,
  URGENTE: colors.danger,
};

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
    if (!confirm('Apagar esta notificação?')) return;
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
          <button
            type="button"
            data-testid="mark-all-page"
            onClick={marcarTodas}
            style={btnSecondary}
          >
            Marcar todas como lidas
          </button>
        ) : undefined
      }
    >
      <div
        style={{
          ...card,
          marginBottom: '1rem',
          display: 'flex',
          gap: 12,
          alignItems: 'center',
          flexWrap: 'wrap',
        }}
      >
        <label style={{ fontSize: 12, color: colors.muted }}>Filtro:</label>
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
        <div
          style={{
            ...card,
            background: '#fef2f2',
            borderColor: '#fecaca',
            color: '#991b1b',
            marginBottom: '1rem',
          }}
        >
          {err}
        </div>
      )}

      {loading ? (
        <div style={card}>Carregando…</div>
      ) : data.length === 0 ? (
        <div style={{ ...card, textAlign: 'center', color: colors.muted, padding: '2rem' }}>
          Nenhuma notificação encontrada com esses filtros.
        </div>
      ) : (
        <div style={{ ...card, padding: 0 }}>
          {data.map((n) => (
            <div
              key={n.id}
              data-testid={`notif-row-${n.id}`}
              style={{
                display: 'flex',
                gap: 12,
                padding: '12px 16px',
                borderBottom: `1px solid ${colors.border}`,
                background: n.lidaEm ? '#fff' : '#f0f9ff',
                cursor: n.link ? 'pointer' : 'default',
              }}
              onClick={() => onClick(n)}
            >
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 4,
                  background: PRIORIDADE_COLOR[n.prioridade],
                  marginTop: 6,
                  flexShrink: 0,
                }}
                aria-hidden
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    display: 'flex',
                    gap: 8,
                    alignItems: 'center',
                    marginBottom: 2,
                    flexWrap: 'wrap',
                  }}
                >
                  <strong style={{ fontSize: 14, fontWeight: n.lidaEm ? 500 : 700 }}>
                    {n.titulo}
                  </strong>
                  <span style={badge(PRIORIDADE_COLOR[n.prioridade])}>
                    {TIPO_LABEL[n.tipo] ?? n.tipo}
                  </span>
                </div>
                <div style={{ fontSize: 13, color: colors.muted }}>{n.mensagem}</div>
                <div style={{ fontSize: 11, color: colors.muted, marginTop: 4 }}>
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
                style={{
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  color: colors.muted,
                  fontSize: 16,
                  alignSelf: 'flex-start',
                }}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <div
          style={{
            display: 'flex',
            justifyContent: 'center',
            gap: 8,
            alignItems: 'center',
            marginTop: '1rem',
          }}
        >
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => load(page - 1)}
            style={btnSecondary}
          >
            ‹
          </button>
          <span style={{ fontSize: 12, color: colors.muted }}>
            Página {page} de {totalPages}
          </span>
          <button
            type="button"
            disabled={page >= totalPages}
            onClick={() => load(page + 1)}
            style={btn}
          >
            ›
          </button>
        </div>
      )}
    </PageLayout>
  );
}
