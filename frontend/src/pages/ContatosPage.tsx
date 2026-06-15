import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search,
  Users,
  ExternalLink,
  MessageSquare,
  Target,
  AlertTriangle,
} from 'lucide-react';
import { useApiQuery, type PaginatedResponse } from '@/hooks/useApiQuery';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { PageLayout, useIsMobile } from '@/components/PageLayout';
import { CrmTabs } from '@/components/CrmTabs';
import { StateView } from '@/components/StateView';
import { formatNumero, maskTelefone } from '@/lib/masks';
import {
  Avatar,
  Badge,
  Button,
  Card,
  Drawer,
  EmptyState,
  IconButton,
  Input,
  Select,
} from '@/components/ui';

type ContatoTipo = 'LEAD' | 'CLIENTE' | 'CONVERSA';

interface Contato {
  chave: string;
  nome: string;
  telefone: string | null;
  email: string | null;
  cidade: string | null;
  uf: string | null;
  tipos: ContatoTipo[];
  representante: { id: string; nome: string } | null;
  leadId: string | null;
  leadEtapa: string | null;
  clienteId: string | null;
  clienteStatus: string | null;
  clienteOmieStatus: string | null;
  conversaId: string | null;
  canal: string | null;
  ultimaInteracaoEm: string | null;
  criadoEm: string;
}

type ContatosResp = PaginatedResponse<Contato> & { truncado?: boolean };

const TIPO_BADGE: Record<ContatoTipo, { label: string; variant: 'primary' | 'success' | 'info' }> =
  {
    LEAD: { label: 'Lead', variant: 'primary' },
    CLIENTE: { label: 'Cliente', variant: 'success' },
    CONVERSA: { label: 'Conversa', variant: 'info' },
  };

const ETAPA_LABEL: Record<string, string> = {
  NOVO: 'Novo',
  QUALIFICANDO: 'Qualificando',
  PROPOSTA: 'Proposta',
  NEGOCIACAO: 'Negociação',
  GANHO: 'Ganho',
  PERDIDO: 'Perdido',
};

export default function ContatosPage() {
  const navigate = useNavigate();
  const isMobile = useIsMobile();

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const buscaDebounced = useDebouncedValue(search, 300);
  const [tipo, setTipo] = useState('');
  const [detail, setDetail] = useState<Contato | null>(null);

  useEffect(() => {
    setPage(1);
  }, [buscaDebounced, tipo]);

  const listPath = useMemo(() => {
    const qs = new URLSearchParams({ page: String(page), limit: '30' });
    if (buscaDebounced.trim()) qs.set('search', buscaDebounced.trim());
    if (tipo) qs.set('tipo', tipo);
    return `/contatos?${qs.toString()}`;
  }, [page, buscaDebounced, tipo]);

  const { data, loading, error, refetch } = useApiQuery<ContatosResp>(listPath);

  return (
    <PageLayout
      title="Contatos"
      description={
        data?.pagination
          ? `${formatNumero(data.pagination.total)} contato${data.pagination.total === 1 ? '' : 's'} — Leads, Clientes e conversas, em um só lugar`
          : 'Leads, Clientes e conversas do Inbox, unificados'
      }
    >
      <CrmTabs />
      <Card padding="none" className="overflow-hidden">
        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-border">
          <Input
            leftIcon={<Search />}
            placeholder="Buscar por nome, telefone, e-mail…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="max-w-md flex-1"
            data-testid="contatos-search"
          />
          <Select
            value={tipo}
            onChange={(e) => setTipo(e.target.value)}
            data-testid="contatos-filter-tipo"
          >
            <option value="">Todos os tipos</option>
            <option value="LEAD">Leads</option>
            <option value="CLIENTE">Clientes</option>
            <option value="CONVERSA">Conversas</option>
          </Select>
        </div>

        {data?.truncado && (
          <div className="flex items-center gap-2 px-4 py-2 bg-warning/12 border-b border-warning/19 text-[13px] text-warning">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            Muitos contatos — mostrando uma parte. Refine pela busca pra encontrar alguém específico.
          </div>
        )}

        <StateView loading={loading} error={error} onRetry={refetch}>
          {data && data.data.length === 0 && (
            <EmptyState
              icon={<Users />}
              title="Nenhum contato encontrado"
              description="Importe leads (CRM → Funil → Importar), cadastre clientes ou converse no Inbox — tudo aparece aqui."
              className="m-6 border-0 bg-transparent"
            />
          )}
          {data && data.data.length > 0 && (
            <>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-border bg-bg-alt">
                      <Th>Contato</Th>
                      <Th>Tipo</Th>
                      <Th>Local</Th>
                      <Th>Responsável</Th>
                      <th className="w-10" />
                    </tr>
                  </thead>
                  <tbody>
                    {data.data.map((c) => (
                      <tr
                        key={c.chave}
                        className="border-b border-border last:border-b-0 cursor-pointer hover:bg-surface-hover/60 transition-colors"
                        onClick={() => setDetail(c)}
                        data-testid="contato-row"
                      >
                        <Td>
                          <div className="flex items-center gap-2.5 min-w-0">
                            <Avatar name={c.nome} size="sm" />
                            <div className="min-w-0">
                              <div className="text-sm font-medium text-text truncate">{c.nome}</div>
                              <div className="text-xs text-muted truncate">
                                {c.telefone ? maskTelefone(c.telefone) : (c.email ?? '—')}
                              </div>
                            </div>
                          </div>
                        </Td>
                        <Td>
                          <div className="flex flex-wrap items-center gap-1">
                            {c.tipos.map((t) => (
                              <Badge key={t} variant={TIPO_BADGE[t].variant}>
                                {TIPO_BADGE[t].label}
                              </Badge>
                            ))}
                            {c.leadEtapa && c.tipos.includes('LEAD') && (
                              <span className="text-xs text-muted">
                                {ETAPA_LABEL[c.leadEtapa] ?? c.leadEtapa}
                              </span>
                            )}
                          </div>
                        </Td>
                        <Td>
                          <span className="text-sm text-text-subtle">
                            {c.cidade ? `${c.cidade}${c.uf ? '/' + c.uf : ''}` : '—'}
                          </span>
                        </Td>
                        <Td>
                          <span className="text-sm text-text-subtle">
                            {c.representante?.nome ?? '—'}
                          </span>
                        </Td>
                        <Td onClick={(e) => e.stopPropagation()}>
                          <IconButton
                            aria-label="Ver detalhes"
                            variant="ghost"
                            size="sm"
                            icon={<ExternalLink />}
                            onClick={() => setDetail(c)}
                          />
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {data.pagination.totalPages > 1 && (
                <div className="flex items-center justify-between px-4 py-3 border-t border-border bg-bg-alt">
                  <span className="text-xs text-muted tabular">
                    Página {data.pagination.page} de {data.pagination.totalPages} ·{' '}
                    {formatNumero(data.pagination.total)} no total
                  </span>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={page <= 1}
                      onClick={() => setPage((p) => p - 1)}
                    >
                      Anterior
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={page >= data.pagination.totalPages}
                      onClick={() => setPage((p) => p + 1)}
                    >
                      Próxima
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </StateView>
      </Card>

      {detail && (
        <ContatoDrawer
          contato={detail}
          onClose={() => setDetail(null)}
          onNavigate={(to) => {
            setDetail(null);
            navigate(to);
          }}
          isMobile={isMobile}
        />
      )}
    </PageLayout>
  );
}

function ContatoDrawer({
  contato,
  onClose,
  onNavigate,
  isMobile,
}: {
  contato: Contato;
  onClose: () => void;
  onNavigate: (to: string) => void;
  isMobile: boolean;
}) {
  const c = contato;
  return (
    <Drawer
      open
      onClose={onClose}
      title={c.nome}
      description={c.telefone ? maskTelefone(c.telefone) : (c.email ?? undefined)}
      width={isMobile ? 'sm' : 'md'}
    >
      <div className="flex flex-col gap-5">
        <div className="flex flex-wrap items-center gap-1.5">
          {c.tipos.map((t) => (
            <Badge key={t} variant={TIPO_BADGE[t].variant}>
              {TIPO_BADGE[t].label}
            </Badge>
          ))}
        </div>

        <div className="flex flex-col gap-3">
          <DetailRow label="Telefone" value={c.telefone ? maskTelefone(c.telefone) : null} />
          <DetailRow label="E-mail" value={c.email} />
          <DetailRow
            label="Local"
            value={c.cidade ? `${c.cidade}${c.uf ? '/' + c.uf : ''}` : null}
          />
          <DetailRow label="Responsável" value={c.representante?.nome ?? null} />
          {c.tipos.includes('LEAD') && c.leadEtapa && (
            <DetailRow label="Etapa do funil" value={ETAPA_LABEL[c.leadEtapa] ?? c.leadEtapa} />
          )}
          {c.tipos.includes('CLIENTE') && c.clienteStatus && (
            <DetailRow label="Status do cliente" value={c.clienteStatus} />
          )}
        </div>

        {/* Ações contextuais — abrir o registro certo */}
        <div className="flex flex-col gap-2 pt-2 border-t border-border">
          {c.clienteId && (
            <Button
              variant="secondary"
              onClick={() => onNavigate(`/clientes/${c.clienteId}`)}
              leftIcon={<ExternalLink className="h-3.5 w-3.5" />}
            >
              Abrir cliente
            </Button>
          )}
          {c.leadId && (
            <Button
              variant="secondary"
              onClick={() => onNavigate('/leads')}
              leftIcon={<Target className="h-3.5 w-3.5" />}
            >
              Ver no funil
            </Button>
          )}
          {c.conversaId && (
            <Button
              variant="secondary"
              onClick={() => onNavigate('/inbox')}
              leftIcon={<MessageSquare className="h-3.5 w-3.5" />}
            >
              Abrir no Inbox
            </Button>
          )}
        </div>
      </div>
    </Drawer>
  );
}

function Th({ children }: { children: ReactNode }) {
  return (
    <th className="px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted text-left">
      {children}
    </th>
  );
}

function Td({ children, onClick }: { children: ReactNode; onClick?: (e: React.MouseEvent) => void }) {
  return (
    <td onClick={onClick} className="px-4 py-2.5 align-middle">
      {children}
    </td>
  );
}

function DetailRow({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">{label}</span>
      <span className="text-sm text-text">{value}</span>
    </div>
  );
}
