import { useState, type ReactNode } from 'react';
import { Search, FileSignature, Download } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useApiQuery, type PaginatedResponse } from '@/hooks/useApiQuery';
import { useToast } from '@/components/toast';
import { PageLayout } from '@/components/PageLayout';
import { VendasTabs } from '@/components/VendasTabs';
import { StateView } from '@/components/StateView';
import { Avatar, Badge, Button, Card, EmptyState, Input, Select } from '@/components/ui';
import { cn } from '@/lib/cn';
import { formatMoeda, formatNumero } from '@/lib/masks';

type ContratoStatus =
  'RASCUNHO' | 'AGUARDANDO_ASSINATURA' | 'ASSINADO' | 'ATIVO' | 'ENCERRADO' | 'CANCELADO';

interface Contrato {
  id: string;
  status: ContratoStatus;
  valorMensal: number;
  prazoMeses: number;
  diaVencimento: number;
  assinadoEm: string | null;
  documentoUrl: string | null;
  contratoErpId: string | null;
  criadoEm: string;
  cliente: { id: string; nome: string; cnpj: string | null } | null;
  proposta: { id: string; numero: string; modalidade: string } | null;
  representante: { id: string; nome: string } | null;
}

const LABEL: Record<ContratoStatus, string> = {
  RASCUNHO: 'Rascunho',
  AGUARDANDO_ASSINATURA: 'Aguardando assinatura',
  ASSINADO: 'Assinado',
  ATIVO: 'Ativo',
  ENCERRADO: 'Encerrado',
  CANCELADO: 'Cancelado',
};
const VARIANT: Record<ContratoStatus, 'neutral' | 'success' | 'warning' | 'danger' | 'info'> = {
  RASCUNHO: 'neutral',
  AGUARDANDO_ASSINATURA: 'warning',
  ASSINADO: 'success',
  ATIVO: 'success',
  ENCERRADO: 'neutral',
  CANCELADO: 'danger',
};

function fmtData(d: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('pt-BR');
}

/**
 * Contratos de locação.
 *
 * Só leitura: contrato não se cria nem se edita aqui. Ele nasce do aceite da
 * proposta e muda de estado pelo que acontece fora — a assinatura eletrônica e
 * a liberação no ERP. O que o representante precisa é **abrir o que o cliente
 * dele assinou**, sem pedir pra ninguém.
 */
export default function ContratosPage() {
  const [status, setStatus] = useState('');
  const [busca, setBusca] = useState('');
  const [baixando, setBaixando] = useState<string | null>(null);
  const toast = useToast();

  const params = new URLSearchParams({ page: '1', limit: '50' });
  if (status) params.set('status', status);
  if (busca.trim()) params.set('search', busca.trim());
  const { data, loading, error, refetch } = useApiQuery<PaginatedResponse<Contrato>>(
    `/contratos?${params.toString()}`,
  );

  async function baixar(c: Contrato) {
    setBaixando(c.id);
    try {
      // O bucket é privado: o backend devolve uma URL assinada de 1h, e o
      // navegador abre ela. Guardar esse link não adianta — e é essa a ideia.
      const r = await api.get<{ url: string }>(`/contratos/${c.id}/pdf`);
      window.open(r.url, '_blank', 'noopener');
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Não consegui abrir o contrato.');
    } finally {
      setBaixando(null);
    }
  }

  return (
    <PageLayout
      title="Contratos"
      description={
        data?.pagination ? `${formatNumero(data.pagination.total)} contratos` : undefined
      }
    >
      <VendasTabs />
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-border p-4">
          <Input
            size="sm"
            placeholder="Cliente ou número da proposta"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            leftIcon={<Search className="h-3.5 w-3.5" />}
            className="max-w-xs"
            data-testid="contratos-busca"
          />
          <Select
            size="sm"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="max-w-[220px]"
            data-testid="contratos-status"
          >
            <option value="">Todos os status</option>
            {Object.entries(LABEL).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </Select>
        </div>

        <StateView loading={loading} error={error} onRetry={refetch}>
          {data && data.data.length === 0 && (
            <EmptyState
              icon={<FileSignature />}
              title="Nenhum contrato ainda"
              description="O contrato nasce quando o cliente aceita uma proposta de locação e assina."
              className="m-6 border-0"
            />
          )}
          {data && data.data.length > 0 && (
            <div className="scroll-x-hint">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border bg-bg-alt">
                    <Th>Cliente</Th>
                    <Th>Proposta</Th>
                    <Th align="right">Mensalidade</Th>
                    <Th>Prazo</Th>
                    <Th>Status</Th>
                    <Th>Assinado em</Th>
                    <Th>Representante</Th>
                    <th className="w-32" />
                  </tr>
                </thead>
                <tbody>
                  {data.data.map((c) => (
                    <tr
                      key={c.id}
                      className="border-b border-border last:border-b-0 hover:bg-surface-hover/60"
                      data-testid={`contrato-row-${c.id}`}
                    >
                      <Td>
                        <div className="flex items-center gap-2 min-w-0">
                          <Avatar name={c.cliente?.nome ?? '—'} size="sm" />
                          <div className="min-w-0">
                            <div className="truncate text-sm text-text">
                              {c.cliente?.nome ?? '—'}
                            </div>
                            {c.cliente?.cnpj && (
                              <div className="text-xs text-muted tabular">{c.cliente.cnpj}</div>
                            )}
                          </div>
                        </div>
                      </Td>
                      <Td>
                        <span className="text-sm tabular text-text-subtle">
                          {c.proposta?.numero ?? '—'}
                        </span>
                      </Td>
                      <Td align="right">
                        <span className="text-sm font-semibold tabular text-text">
                          {formatMoeda(c.valorMensal)}
                        </span>
                      </Td>
                      <Td>
                        <span className="text-sm text-text-subtle">
                          {c.prazoMeses} meses · venc. dia {c.diaVencimento}
                        </span>
                      </Td>
                      <Td>
                        <Badge variant={VARIANT[c.status]}>{LABEL[c.status]}</Badge>
                      </Td>
                      <Td>
                        <span className="text-sm tabular text-text-subtle">
                          {fmtData(c.assinadoEm)}
                        </span>
                      </Td>
                      <Td>
                        <span className="text-sm text-text-subtle">
                          {c.representante?.nome ?? '—'}
                        </span>
                      </Td>
                      <Td align="right">
                        {c.documentoUrl ? (
                          <Button
                            size="sm"
                            variant="secondary"
                            loading={baixando === c.id}
                            onClick={() => void baixar(c)}
                            leftIcon={<Download className="h-3.5 w-3.5" />}
                            data-testid={`contrato-baixar-${c.id}`}
                          >
                            Contrato
                          </Button>
                        ) : (
                          <span className="text-xs text-muted-light italic">sem PDF</span>
                        )}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </StateView>
      </Card>
    </PageLayout>
  );
}

function Th({ children, align }: { children: ReactNode; align?: 'left' | 'right' }) {
  return (
    <th
      className={cn(
        'px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted',
        align === 'right' ? 'text-right' : 'text-left',
      )}
    >
      {children}
    </th>
  );
}

function Td({ children, align }: { children: ReactNode; align?: 'left' | 'right' }) {
  return (
    <td className={cn('px-4 py-2.5 align-middle', align === 'right' ? 'text-right' : 'text-left')}>
      {children}
    </td>
  );
}
