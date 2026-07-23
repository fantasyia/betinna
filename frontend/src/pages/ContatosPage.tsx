import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search,
  Users,
  ExternalLink,
  MessageSquare,
  Target,
  AlertTriangle,
  Tag as TagIcon,
  Trash2,
  ArrowRightLeft,
  X,
  Upload,
  Target as TargetIcon,
  Briefcase,
  ChevronDown,
  GitMerge,
} from 'lucide-react';
import { useApiQuery, type PaginatedResponse } from '@/hooks/useApiQuery';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { usePermission } from '@/hooks/usePermission';
import { PageLayout, useIsMobile } from '@/components/PageLayout';
import { CrmTabs } from '@/components/CrmTabs';
import { ImportLeadsModal } from '@/components/ImportLeadsModal';
import { ImportClientesModal } from '@/components/ImportClientesModal';
import { DuplicatasModal } from '@/components/DuplicatasModal';
import { VincularClienteDialog } from '@/components/VincularClienteDialog';
import { StateView } from '@/components/StateView';
import { useToast } from '@/components/toast';
import { api, apiErrorMessage } from '@/lib/api';
import { formatNumero } from '@/lib/masks';
import { formatTelefone } from '@/lib/phone';
import {
  Avatar,
  Badge,
  Button,
  Card,
  Checkbox,
  Dialog,
  Drawer,
  EmptyState,
  Field,
  IconButton,
  Input,
  Select,
} from '@/components/ui';
import { cn } from '@/lib/cn';

type ContatoTipo = 'LEAD' | 'CLIENTE' | 'CONVERSA';

interface Contato {
  chave: string;
  nome: string;
  telefone: string | null;
  email: string | null;
  cidade: string | null;
  uf: string | null;
  tipos: ContatoTipo[];
  tags: { id: string; nome: string; cor: string }[];
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

type FunilLite = {
  id: string;
  nome: string;
  isPadrao: boolean;
  ativo: boolean;
  etapas: Array<{ id: string; nome: string; tipo: 'ATIVA' | 'GANHO' | 'PERDIDO' }>;
};

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
  const [tagFiltro, setTagFiltro] = useState<string[]>([]);
  const [detail, setDetail] = useState<Contato | null>(null);
  const canEdit = usePermission('clientes.edit');
  const [selected, setSelected] = useState<Map<string, Contato>>(new Map());
  const [bulk, setBulk] = useState<'tag' | 'mover' | 'add-funil' | 'excluir' | null>(null);
  const [importKind, setImportKind] = useState<'choose' | 'leads' | 'clientes' | null>(null);
  const [verDuplicatas, setVerDuplicatas] = useState(false);

  function toggle(c: Contato) {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(c.chave)) next.delete(c.chave);
      else next.set(c.chave, c);
      return next;
    });
  }
  function clearSel() {
    setSelected(new Map());
  }

  useEffect(() => {
    setPage(1);
    // #16: limpa a seleção ao trocar filtro — senão uma ação em lote (excluir/mover/tag) atingiria
    // contatos que não estão mais visíveis na tela.
    setSelected(new Map());
  }, [buscaDebounced, tipo, tagFiltro]);

  const tagFiltroKey = tagFiltro.join(',');
  const listPath = useMemo(() => {
    const qs = new URLSearchParams({ page: String(page), limit: '30' });
    if (buscaDebounced.trim()) qs.set('search', buscaDebounced.trim());
    if (tipo) qs.set('tipo', tipo);
    if (tagFiltroKey) qs.set('tagIds', tagFiltroKey);
    return `/contatos?${qs.toString()}`;
  }, [page, buscaDebounced, tipo, tagFiltroKey]);

  const { data, loading, error, refetch } = useApiQuery<ContatosResp>(listPath);
  // Tags disponíveis pro filtro (chips clicáveis).
  const { data: tagsDisponiveis } = useApiQuery<Array<{ id: string; nome: string; cor: string }>>(
    '/tags',
  );
  function toggleTagFiltro(id: string) {
    setTagFiltro((prev) => (prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]));
  }
  // Funis só carregam quando o import abre (pro modal de leads).
  const { data: funis } = useApiQuery<FunilLite[]>(importKind ? '/funis' : null);

  const pageRows = data?.data ?? [];
  const allPageSel = pageRows.length > 0 && pageRows.every((c) => selected.has(c.chave));
  function toggleAllPage() {
    setSelected((prev) => {
      const next = new Map(prev);
      if (allPageSel) for (const c of pageRows) next.delete(c.chave);
      else for (const c of pageRows) next.set(c.chave, c);
      return next;
    });
  }

  const selArr = [...selected.values()];
  const ids = {
    leadIds: selArr.flatMap((c) => (c.leadId ? [c.leadId] : [])),
    clienteIds: selArr.flatMap((c) => (c.clienteId ? [c.clienteId] : [])),
    conversaIds: selArr.flatMap((c) => (c.conversaId ? [c.conversaId] : [])),
  };
  const nLeads = selArr.filter((c) => c.tipos.includes('LEAD')).length;
  // Contatos que ainda NÃO são lead — candidatos a "Adicionar ao funil".
  const semLead = selArr.filter((c) => !c.leadId);
  async function afterAcao() {
    clearSel();
    setBulk(null);
    refetch();
  }

  return (
    <PageLayout
      title="Contatos"
      description={
        data?.pagination
          ? `${formatNumero(data.pagination.total)} contato${data.pagination.total === 1 ? '' : 's'} — Leads, Clientes e conversas, em um só lugar`
          : 'Leads, Clientes e conversas do Inbox, unificados'
      }
      actions={
        canEdit ? (
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              onClick={() => setVerDuplicatas(true)}
              leftIcon={<GitMerge className="h-3.5 w-3.5" />}
              data-testid="contatos-duplicatas-btn"
            >
              Duplicatas
            </Button>
            <Button
              onClick={() => setImportKind('choose')}
              leftIcon={<Upload className="h-3.5 w-3.5" />}
              data-testid="contatos-importar-btn"
            >
              Importar
            </Button>
          </div>
        ) : undefined
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
          <TagFilterSelect
            tags={tagsDisponiveis ?? []}
            selecionadas={tagFiltro}
            onToggle={toggleTagFiltro}
            onLimpar={() => setTagFiltro([])}
          />
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
                      {canEdit && (
                        <th className="w-10 px-4 py-2.5">
                          <Checkbox
                            checked={allPageSel}
                            onChange={toggleAllPage}
                            aria-label="Selecionar todos da página"
                          />
                        </th>
                      )}
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
                        {canEdit && (
                          <td className="px-4 py-2.5" onClick={(e) => e.stopPropagation()}>
                            <Checkbox
                              checked={selected.has(c.chave)}
                              onChange={() => toggle(c)}
                            />
                          </td>
                        )}
                        <Td>
                          <div className="flex items-center gap-2.5 min-w-0">
                            <Avatar name={c.nome} size="sm" />
                            <div className="min-w-0">
                              <div className="text-sm font-medium text-text truncate">{c.nome}</div>
                              <div className="text-xs text-muted truncate">
                                {c.telefone ? formatTelefone(c.telefone) : (c.email ?? '—')}
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
                            {(c.tags ?? []).map((tag) => (
                              <TagChip key={tag.id} nome={tag.nome} cor={tag.cor} />
                            ))}
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

      {importKind === 'choose' && (
        <Dialog
          open
          onClose={() => setImportKind(null)}
          title="Importar contatos"
          size="sm"
          footer={
            <Button variant="secondary" onClick={() => setImportKind(null)}>
              Cancelar
            </Button>
          }
        >
          <p className="text-sm text-text-subtle mb-4">O que você quer importar de uma planilha?</p>
          <div className="flex flex-col gap-2">
            <Button
              variant="secondary"
              onClick={() => setImportKind('leads')}
              leftIcon={<TargetIcon className="h-4 w-4" />}
            >
              Importar leads (entram no funil)
            </Button>
            <Button
              variant="secondary"
              onClick={() => setImportKind('clientes')}
              leftIcon={<Briefcase className="h-4 w-4" />}
            >
              Importar clientes
            </Button>
          </div>
        </Dialog>
      )}
      {importKind === 'leads' && (
        <ImportLeadsModal
          funis={funis ?? []}
          onClose={() => setImportKind(null)}
          onDone={() => {
            setImportKind(null);
            refetch();
          }}
        />
      )}
      {importKind === 'clientes' && (
        <ImportClientesModal
          onClose={() => setImportKind(null)}
          onDone={() => {
            setImportKind(null);
            refetch();
          }}
        />
      )}

      {canEdit && selected.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex flex-wrap items-center gap-2 px-3 py-2 max-w-[calc(100vw-1rem)] bg-surface-elevated border border-border-strong rounded-full shadow-xl">
          <span className="text-sm text-text pl-2 pr-1">
            <strong className="text-primary">{selected.size}</strong> selecionado
            {selected.size === 1 ? '' : 's'}
          </span>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setBulk('tag')}
            leftIcon={<TagIcon className="h-3.5 w-3.5" />}
          >
            Tag
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={nLeads === 0}
            onClick={() => setBulk('mover')}
            leftIcon={<ArrowRightLeft className="h-3.5 w-3.5" />}
          >
            Mover etapa
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={semLead.length === 0}
            onClick={() => setBulk('add-funil')}
            leftIcon={<Target className="h-3.5 w-3.5" />}
          >
            Adicionar ao funil
          </Button>
          <Button
            size="sm"
            variant="danger"
            onClick={() => setBulk('excluir')}
            leftIcon={<Trash2 className="h-3.5 w-3.5" />}
          >
            Excluir
          </Button>
          <IconButton
            aria-label="Limpar seleção"
            variant="ghost"
            size="sm"
            icon={<X />}
            onClick={clearSel}
          />
        </div>
      )}

      {bulk === 'tag' && <BulkTagModal ids={ids} onClose={() => setBulk(null)} onDone={afterAcao} />}
      {bulk === 'mover' && (
        <BulkMoveModal
          leadIds={ids.leadIds}
          nLeads={nLeads}
          onClose={() => setBulk(null)}
          onDone={afterAcao}
        />
      )}
      {bulk === 'add-funil' && (
        <BulkAddFunilModal contatos={semLead} onClose={() => setBulk(null)} onDone={afterAcao} />
      )}
      {bulk === 'excluir' && (
        <BulkDeleteModal
          ids={ids}
          count={selected.size}
          onClose={() => setBulk(null)}
          onDone={afterAcao}
        />
      )}

      {verDuplicatas && (
        <DuplicatasModal onClose={() => setVerDuplicatas(false)} onMerged={refetch} />
      )}

      {detail && (
        <ContatoDrawer
          contato={detail}
          canEdit={canEdit}
          onClose={() => setDetail(null)}
          onNavigate={(to) => {
            setDetail(null);
            navigate(to);
          }}
          onChanged={() => {
            setDetail(null);
            refetch();
          }}
          isMobile={isMobile}
        />
      )}
    </PageLayout>
  );
}

function ContatoDrawer({
  contato,
  canEdit,
  onClose,
  onNavigate,
  onChanged,
  isMobile,
}: {
  contato: Contato;
  canEdit: boolean;
  onClose: () => void;
  onNavigate: (to: string) => void;
  onChanged: () => void;
  isMobile: boolean;
}) {
  const c = contato;
  const [vinculando, setVinculando] = useState(false);
  return (
    <Drawer
      open
      onClose={onClose}
      title={c.nome}
      description={c.telefone ? formatTelefone(c.telefone) : (c.email ?? undefined)}
      width={isMobile ? 'sm' : 'md'}
    >
      <div className="flex flex-col gap-5">
        <div className="flex flex-wrap items-center gap-1.5">
          {c.tipos.map((t) => (
            <Badge key={t} variant={TIPO_BADGE[t].variant}>
              {TIPO_BADGE[t].label}
            </Badge>
          ))}
          {(c.tags ?? []).map((tag) => (
            <TagChip key={tag.id} nome={tag.nome} cor={tag.cor} />
          ))}
        </div>

        <div className="flex flex-col gap-3">
          <DetailRow label="Telefone" value={c.telefone ? formatTelefone(c.telefone) : null} />
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
          {/* Lead que ainda não está ligado a um cliente: oferece o vínculo. É o
              caso "essa pessoa também é meu cliente" — liga sem fundir. */}
          {canEdit && c.leadId && !c.clienteId && (
            <Button
              variant="secondary"
              onClick={() => setVinculando(true)}
              leftIcon={<GitMerge className="h-3.5 w-3.5" />}
              data-testid="vincular-cliente-btn"
            >
              Vincular a um cliente
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

      {vinculando && c.leadId && (
        <VincularClienteDialog
          leadId={c.leadId}
          onClose={() => setVinculando(false)}
          onDone={() => {
            setVinculando(false);
            onChanged();
          }}
        />
      )}
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

/** Caixa selecionadora de tags pro filtro (multi-seleção com checkboxes). */
function TagFilterSelect({
  tags,
  selecionadas,
  onToggle,
  onLimpar,
}: {
  tags: { id: string; nome: string; cor: string }[];
  selecionadas: string[];
  onToggle: (id: string) => void;
  onLimpar: () => void;
}) {
  const [aberto, setAberto] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!aberto) return;
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setAberto(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [aberto]);

  const n = selecionadas.length;
  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        disabled={tags.length === 0}
        className={cn(
          'inline-flex items-center gap-1.5 h-9 px-3 rounded-[10px] border text-sm transition-colors disabled:opacity-50',
          n > 0
            ? 'border-primary/40 bg-primary/8 text-text'
            : 'border-border bg-surface text-text-subtle hover:bg-surface-elevated',
        )}
        data-testid="contatos-tag-filtro-btn"
      >
        <TagIcon className="h-3.5 w-3.5" />
        <span>{n > 0 ? `${n} tag${n > 1 ? 's' : ''}` : 'Filtrar por tags'}</span>
        <ChevronDown className="h-3.5 w-3.5 text-muted" />
      </button>
      {aberto && (
        <div className="absolute z-20 mt-1 w-64 max-h-72 overflow-auto rounded-[10px] border border-border bg-surface shadow-lg p-1.5">
          {tags.map((t) => (
            <label
              key={t.id}
              className="flex items-center gap-2 px-2 py-1.5 rounded-[8px] hover:bg-surface-elevated cursor-pointer"
              data-testid={`contatos-tag-filtro-opt-${t.id}`}
            >
              <Checkbox checked={selecionadas.includes(t.id)} onChange={() => onToggle(t.id)} />
              <TagChip nome={t.nome} cor={t.cor} />
            </label>
          ))}
          {n > 0 && (
            <button
              type="button"
              onClick={onLimpar}
              className="w-full text-left text-[11px] text-muted underline px-2 py-1.5 mt-0.5 hover:text-text"
            >
              limpar seleção
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** Chip de tag do contato (cor da tag com fundo suave). */
function TagChip({ nome, cor }: { nome: string; cor: string }) {
  return (
    <span
      className="text-[10px] px-1.5 py-0.5 rounded-[5px] font-medium whitespace-nowrap"
      style={{ backgroundColor: `${cor}22`, color: cor }}
      title={nome}
    >
      {nome}
    </span>
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

type Ids = { leadIds: string[]; clienteIds: string[]; conversaIds: string[] };
type AcaoResult = { afetados: number; falhas: Array<{ id: string; erro: string }> };

function BulkTagModal({ ids, onClose, onDone }: { ids: Ids; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const { data: tags } = useApiQuery<Array<{ id: string; nome: string; cor: string }>>('/tags');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [modo, setModo] = useState<'adicionar' | 'remover'>('adicionar');
  const [busy, setBusy] = useState(false);
  const alvos = ids.leadIds.length + ids.clienteIds.length;

  async function submit() {
    if (picked.size === 0) return;
    setBusy(true);
    try {
      const r = await api.post<AcaoResult>('/contatos/acao-massa', {
        acao: 'tag',
        leadIds: ids.leadIds,
        clienteIds: ids.clienteIds,
        conversaIds: [],
        tagIds: [...picked],
        modo,
      });
      toast.success('Tags aplicadas', `${(r.afetados ?? 0)} contato(s)`);
      onDone();
    } catch (err) {
      toast.error('Falha ao aplicar tags', apiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="Aplicar / remover tag"
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={() => void submit()} loading={busy} disabled={picked.size === 0}>
            Aplicar
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Ação">
          <Select value={modo} onChange={(e) => setModo(e.target.value as 'adicionar' | 'remover')}>
            <option value="adicionar">Adicionar tag(s)</option>
            <option value="remover">Remover tag(s)</option>
          </Select>
        </Field>
        <Field label="Tags">
          <div className="flex flex-wrap gap-1.5">
            {(tags ?? []).map((t) => {
              const on = picked.has(t.id);
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() =>
                    setPicked((p) => {
                      const n = new Set(p);
                      if (n.has(t.id)) n.delete(t.id);
                      else n.add(t.id);
                      return n;
                    })
                  }
                  className={cn(
                    'px-2.5 py-1 rounded-full text-[12px] border cursor-pointer',
                    on
                      ? 'bg-primary/12 border-primary text-primary'
                      : 'bg-surface border-border text-text-subtle hover:border-border-strong',
                  )}
                >
                  {t.nome}
                </button>
              );
            })}
            {(tags ?? []).length === 0 && (
              <span className="text-sm text-muted">Nenhuma tag cadastrada (crie em CRM → Tags).</span>
            )}
          </div>
        </Field>
        <p className="text-xs text-muted">
          Aplica nos {alvos} contato(s) que são Lead ou Cliente. Conversas soltas não recebem tag.
        </p>
      </div>
    </Dialog>
  );
}

function BulkMoveModal({
  leadIds,
  nLeads,
  onClose,
  onDone,
}: {
  leadIds: string[];
  nLeads: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const { data: funis } = useApiQuery<
    Array<{ id: string; nome: string; etapas: Array<{ id: string; nome: string; tipo: string }> }>
  >('/funis');
  const [funilId, setFunilId] = useState('');
  const [etapaId, setEtapaId] = useState('');
  const [motivo, setMotivo] = useState('');
  const [busy, setBusy] = useState(false);
  const funil = (funis ?? []).find((f) => f.id === funilId) ?? null;
  const etapas = funil?.etapas ?? [];
  const etapaSel = etapas.find((e) => e.id === etapaId) ?? null;
  const terminal = etapaSel?.tipo === 'GANHO' || etapaSel?.tipo === 'PERDIDO';

  async function submit() {
    if (!etapaId) return;
    if (terminal && !motivo.trim()) {
      toast.error('Informe o motivo (etapa de Ganho/Perdido)');
      return;
    }
    setBusy(true);
    try {
      const r = await api.post<AcaoResult>('/contatos/acao-massa', {
        acao: 'mover-etapa',
        leadIds,
        clienteIds: [],
        conversaIds: [],
        funilEtapaId: etapaId,
        motivo: motivo.trim() || undefined,
      });
      toast.success(
        'Leads movidos',
        `${(r.afetados ?? 0)} de ${leadIds.length}${(r.falhas?.length ?? 0) ? ` · ${(r.falhas?.length ?? 0)} falha(s)` : ''}`,
      );
      onDone();
    } catch (err) {
      toast.error('Falha ao mover', apiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={`Mover ${nLeads} lead(s) de etapa`}
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={() => void submit()} loading={busy} disabled={!etapaId}>
            Mover
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Funil">
          <Select
            value={funilId}
            onChange={(e) => {
              setFunilId(e.target.value);
              setEtapaId('');
            }}
          >
            <option value="">Escolha o funil…</option>
            {(funis ?? []).map((f) => (
              <option key={f.id} value={f.id}>
                {f.nome}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Etapa de destino">
          <Select value={etapaId} disabled={!funil} onChange={(e) => setEtapaId(e.target.value)}>
            <option value="">Escolha a etapa…</option>
            {etapas.map((e) => (
              <option key={e.id} value={e.id}>
                {e.nome}
              </option>
            ))}
          </Select>
        </Field>
        {terminal && (
          <Field label="Motivo (obrigatório p/ Ganho ou Perdido)">
            <Input
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Ex.: fechou negócio / sem interesse"
            />
          </Field>
        )}
        <p className="text-xs text-muted">
          Só os {nLeads} contato(s) que são Lead serão movidos. Clientes e conversas na seleção são
          ignorados.
        </p>
      </div>
    </Dialog>
  );
}

function BulkAddFunilModal({
  contatos,
  onClose,
  onDone,
}: {
  contatos: Contato[];
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const { data: funis } = useApiQuery<FunilLite[]>('/funis');
  const [funilId, setFunilId] = useState('');
  const [etapaId, setEtapaId] = useState('');
  const [busy, setBusy] = useState(false);
  const funil = (funis ?? []).find((f) => f.id === funilId) ?? null;
  const etapas = funil?.etapas ?? [];

  async function submit() {
    setBusy(true);
    try {
      const r = await api.post<AcaoResult & { jaEramLead?: number }>('/contatos/criar-leads', {
        funilId: funilId || undefined,
        funilEtapaId: etapaId || undefined,
        contatos: contatos.map((c) => ({
          nome: c.nome,
          telefone: c.telefone || undefined,
          email: c.email || undefined,
          cidade: c.cidade || undefined,
          uf: c.uf || undefined,
          representanteId: c.representante?.id,
        })),
      });
      const ja = (r.jaEramLead ?? 0) ? ` · ${(r.jaEramLead ?? 0)} já era(m) lead` : '';
      const falhou = (r.falhas?.length ?? 0) ? ` · ${(r.falhas?.length ?? 0)} falha(s)` : '';
      toast.success(
        'Contatos adicionados ao funil',
        `${(r.afetados ?? 0)} de ${contatos.length} criado(s)${ja}${falhou}`,
      );
      onDone();
    } catch (err) {
      toast.error('Falha ao adicionar ao funil', apiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={`Adicionar ${contatos.length} contato(s) ao funil`}
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={() => void submit()} loading={busy}>
            Adicionar
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Funil">
          <Select
            value={funilId}
            onChange={(e) => {
              setFunilId(e.target.value);
              setEtapaId('');
            }}
          >
            <option value="">Funil padrão da empresa</option>
            {(funis ?? []).map((f) => (
              <option key={f.id} value={f.id}>
                {f.nome}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Etapa inicial">
          <Select value={etapaId} disabled={!funil} onChange={(e) => setEtapaId(e.target.value)}>
            <option value="">Primeira etapa do funil</option>
            {etapas.map((e) => (
              <option key={e.id} value={e.id}>
                {e.nome}
              </option>
            ))}
          </Select>
        </Field>
        <p className="text-xs text-muted">
          Cria um lead pra cada contato que ainda não é lead. Quem já tem lead com o mesmo telefone é
          pulado.
        </p>
      </div>
    </Dialog>
  );
}

function BulkDeleteModal({
  ids,
  count,
  onClose,
  onDone,
}: {
  ids: Ids;
  count: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      const r = await api.post<AcaoResult>('/contatos/acao-massa', {
        acao: 'excluir',
        leadIds: ids.leadIds,
        clienteIds: ids.clienteIds,
        conversaIds: ids.conversaIds,
      });
      toast.success(
        'Excluídos',
        `${(r.afetados ?? 0)} registro(s)${(r.falhas?.length ?? 0) ? ` · ${(r.falhas?.length ?? 0)} não puderam ser excluídos` : ''}`,
      );
      onDone();
    } catch (err) {
      toast.error('Falha ao excluir', apiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={`Excluir ${count} contato(s)?`}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="danger" onClick={() => void submit()} loading={busy}>
            Excluir
          </Button>
        </>
      }
    >
      <p className="text-sm text-text-subtle">
        Apaga os registros subjacentes (Lead, Cliente e/ou Conversa) de cada contato selecionado.
        Clientes com pedidos/propostas não podem ser excluídos (serão reportados). Esta ação não pode
        ser desfeita.
      </p>
    </Dialog>
  );
}
