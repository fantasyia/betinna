import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Download, ExternalLink, Flag } from 'lucide-react';
import { ApiError, downloadFile } from '@/lib/api';
import { useApiQuery } from '@/hooks/useApiQuery';
import { useToast } from '@/components/toast';
import { PageLayout } from '@/components/PageLayout';
import { AtendimentoTabs } from '@/components/AtendimentoTabs';
import { StateView } from '@/components/StateView';
import { Button, Card, Field, Select } from '@/components/ui';
import { badge, colors } from '@/components/styles';
import { formatNumero } from '@/lib/masks';

type StatusBot = 'OK' | 'FALLBACK' | 'SEM_RESPOSTA';

interface BotResposta {
  id: string;
  conversationId?: string | null;
  pergunta: string;
  resposta?: string | null;
  tokensIn: number;
  tokensOut: number;
  tempoMs?: number | null;
  modelo?: string | null;
  status: StatusBot;
  marcadaRevisao: boolean;
  motivoRevisao?: string | null;
  criadoEm: string;
}

interface ListaResp {
  data: BotResposta[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

const STATUS_META: Record<StatusBot, { label: string; color: string }> = {
  OK: { label: 'Respondido', color: colors.success },
  FALLBACK: { label: 'Fallback', color: colors.warning },
  SEM_RESPOSTA: { label: 'Sem resposta', color: colors.muted },
};

function fmtData(d: string) {
  return new Date(d).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

export default function BotAuditoriaPage() {
  const toast = useToast();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [soRevisar, setSoRevisar] = useState(false);
  const [de, setDe] = useState('');
  const [ate, setAte] = useState('');
  const [exporting, setExporting] = useState(false);

  // Monta a query string dos filtros (e zera a página quando muda).
  const filtrosQs = useMemo(() => {
    const p = new URLSearchParams();
    if (status) p.set('status', status);
    if (soRevisar) p.set('marcadaRevisao', 'true');
    if (de) p.set('de', new Date(de).toISOString());
    if (ate) p.set('ate', new Date(`${ate}T23:59:59`).toISOString());
    return p.toString();
  }, [status, soRevisar, de, ate]);

  const path = `/mullerbot/auditoria?page=${page}&limit=20${filtrosQs ? `&${filtrosQs}` : ''}`;
  const { data, loading, error, refetch } = useApiQuery<ListaResp>(path);

  function aplicarFiltro<T>(setter: (v: T) => void) {
    return (v: T) => {
      setter(v);
      setPage(1);
    };
  }

  async function exportar() {
    setExporting(true);
    try {
      await downloadFile(`/mullerbot/auditoria/export${filtrosQs ? `?${filtrosQs}` : ''}`, 'auditoria-bot.csv');
    } catch (err) {
      toast.error('Falha ao exportar', err instanceof ApiError ? err.message : undefined);
    } finally {
      setExporting(false);
    }
  }

  const rows = data?.data ?? [];
  const pag = data?.pagination;

  return (
    <PageLayout
      title="Auditoria do bot"
      description="Tudo que o Muller respondeu. Respostas que citam preço/estoque/prazo vêm marcadas 🚩 pra você revisar."
      actions={
        <Button
          variant="secondary"
          onClick={() => void exportar()}
          loading={exporting}
          leftIcon={<Download className="h-3.5 w-3.5" />}
        >
          Exportar CSV
        </Button>
      }
    >
      <AtendimentoTabs />

      {/* Filtros */}
      <Card padding="md" className="mb-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <Field label="Status">
            <Select value={status} onChange={(e) => aplicarFiltro(setStatus)(e.target.value)}>
              <option value="">Todos</option>
              <option value="OK">Respondido</option>
              <option value="FALLBACK">Fallback</option>
              <option value="SEM_RESPOSTA">Sem resposta</option>
            </Select>
          </Field>
          <Field label="De">
            <input
              type="date"
              value={de}
              onChange={(e) => aplicarFiltro(setDe)(e.target.value)}
              className="w-full rounded-md border border-border-strong bg-surface px-3 py-2 text-sm"
            />
          </Field>
          <Field label="Até">
            <input
              type="date"
              value={ate}
              onChange={(e) => aplicarFiltro(setAte)(e.target.value)}
              className="w-full rounded-md border border-border-strong bg-surface px-3 py-2 text-sm"
            />
          </Field>
          <Field label="Revisão">
            <label className="flex items-center gap-2 text-sm h-[38px]">
              <input
                type="checkbox"
                checked={soRevisar}
                onChange={(e) => aplicarFiltro(setSoRevisar)(e.target.checked)}
              />
              Só marcadas 🚩
            </label>
          </Field>
        </div>
      </Card>

      <StateView
        loading={loading}
        error={error}
        onRetry={refetch}
        empty={rows.length === 0}
        emptyMessage="Nenhuma resposta do bot ainda (ou nenhum resultado pro filtro)."
      >
        <Card padding="none">
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-border text-left text-muted">
                  <th className="p-2 font-semibold">Quando</th>
                  <th className="p-2 font-semibold">Cliente / Bot</th>
                  <th className="p-2 font-semibold">Status</th>
                  <th className="p-2 font-semibold text-right">Tokens</th>
                  <th className="p-2 font-semibold text-right">Tempo</th>
                  <th className="p-2 font-semibold"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-border align-top">
                    <td className="p-2 whitespace-nowrap text-muted">{fmtData(r.criadoEm)}</td>
                    <td className="p-2 max-w-[460px]">
                      <div className="text-text-subtle">
                        <strong className="text-muted">Cliente:</strong> {r.pergunta}
                      </div>
                      {r.resposta && (
                        <div className="mt-0.5">
                          <strong className="text-muted">Bot:</strong> {r.resposta}
                        </div>
                      )}
                      {r.marcadaRevisao && (
                        <span
                          style={{ ...badge(colors.danger), fontSize: 10, marginTop: 4 }}
                          title={r.motivoRevisao ?? 'Revisar'}
                        >
                          <Flag className="inline h-3 w-3 mr-0.5" /> revisar
                        </span>
                      )}
                    </td>
                    <td className="p-2 whitespace-nowrap">
                      <span style={badge(STATUS_META[r.status].color)}>{STATUS_META[r.status].label}</span>
                    </td>
                    <td className="p-2 whitespace-nowrap text-right tabular text-muted">
                      {formatNumero(r.tokensIn + r.tokensOut)}
                    </td>
                    <td className="p-2 whitespace-nowrap text-right tabular text-muted">
                      {r.tempoMs != null ? `${(r.tempoMs / 1000).toFixed(1)}s` : '—'}
                    </td>
                    <td className="p-2 whitespace-nowrap">
                      {r.conversationId && (
                        <Link
                          to="/inbox"
                          className="text-info hover:underline inline-flex items-center gap-1 text-xs"
                        >
                          Abrir conversa <ExternalLink className="h-3 w-3" />
                        </Link>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        {/* Paginação */}
        {pag && pag.totalPages > 1 && (
          <div className="flex items-center justify-between mt-3 text-sm text-muted">
            <span>
              {pag.total} resposta{pag.total === 1 ? '' : 's'} · página {pag.page}/{pag.totalPages}
            </span>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Anterior
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={page >= pag.totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Próxima
              </Button>
            </div>
          </div>
        )}
      </StateView>
    </PageLayout>
  );
}
