import { memo, useEffect, useRef, useState } from 'react';
import { useSensoresDnd } from '@/lib/dnd-sensors';
import { Link, useNavigate } from 'react-router-dom';
import {
  DndContext,
  DragOverlay,
  useDraggable,
  useDroppable,
  closestCenter,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import {
  Plus,
  MapPin,
  Briefcase,
  Sparkles,
  ShieldCheck,
  User,
  ArrowRight,
  Target,
  AlertCircle,
  Trash2,
  TrendingUp,
  ExternalLink,
  Settings,
  UserCog,
  CalendarPlus,
  Building2,
  Upload,
  X,
  Tag as TagIcon,
  Phone,
  ChevronDown,
  LogIn,
} from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';
import { useApiQuery } from '@/hooks/useApiQuery';
import { useRole } from '@/hooks/usePermission';
import { useToast } from '@/components/toast';
import { ImportLeadsModal } from '@/components/ImportLeadsModal';
import { PageLayout } from '@/components/PageLayout';
import { CrmTabs } from '@/components/CrmTabs';
import { StateView } from '@/components/StateView';
import { AsyncCombobox } from '@/components/AsyncCombobox';
import { formatMoeda as fmtBRL, formatMoedaCompacta as fmtBRLCompact } from '@/lib/masks';
import { rotuloFormulario, rotuloOrigem } from '@/lib/origem-lead';
import { getSession } from '@/lib/auth-store';
import { PhoneInput } from '@/components/PhoneInput';
import { UfSelect, CidadeSelect } from '@/components/LocalidadeSelects';
import {
  Avatar,
  Badge,
  Button,
  Dialog,
  Drawer,
  Field,
  Input,
  Select,
  Textarea,
} from '@/components/ui';
import { cn } from '@/lib/cn';

/**
 * LeadsPage v2 — Kanban visual com drag-drop entre etapas.
 *
 * - Colunas droppables (NOVO/QUALIFICANDO/PROPOSTA/NEGOCIACAO/GANHO/PERDIDO)
 * - Cards draggables com handle visual (cursor grab)
 * - Drop em GANHO/PERDIDO abre dialog pedindo motivo antes de confirmar
 * - Click no card abre detail drawer
 * - Header com filtros + métricas + botão novo lead
 */

type LeadEtapa = 'NOVO' | 'QUALIFICANDO' | 'PROPOSTA' | 'NEGOCIACAO' | 'GANHO' | 'PERDIDO';
type CanalOrigem =
  | 'WHATSAPP'
  | 'INSTAGRAM'
  | 'FACEBOOK'
  | 'FORMULARIO'
  | 'SITE'
  | 'EMAIL'
  | 'TELEFONE'
  | 'INDICACAO'
  | 'OUTRO';

interface Lead {
  id: string;
  nome: string;
  contatoNome?: string | null;
  contatoTelefone?: string | null;
  cidade?: string | null;
  uf?: string | null;
  segmento?: string | null;
  valorEstimado: number;
  canalOrigem: CanalOrigem;
  etapa: LeadEtapa;
  funilId?: string | null;
  funilEtapaId?: string | null;
  score: number;
  proximaAcao?: string | null;
  observacoes?: string | null;
  /** Campos flexíveis (IA/fluxos + captura do site: empresa, cargo, regiao, LGPD…). */
  variaveis?: Record<string, unknown> | null;
  representante?: { id: string; nome: string } | null;
  cliente?: { id: string; nome: string } | null;
  funil?: { id: string; nome: string; cor: string } | null;
  funilEtapa?: {
    id: string;
    nome: string;
    cor: string;
    ordem: number;
    tipo: FunilEtapaTipo;
    probabilidade: number;
  } | null;
  tags?: LeadTagRef[];
  criadoEm: string;
  etapaDesde?: string;
  /** Por qual porta o lead entrou (site, whatsapp, importacao…). */
  origemCadastro?: string | null;
  /** Formulário do site que converteu, quando a origem foi o site. */
  formularioOrigem?: string | null;
}

interface LeadTagRef {
  tag: { id: string; nome: string; cor: string; categoria?: string | null };
}

type FunilEtapaTipo = 'ATIVA' | 'GANHO' | 'PERDIDO';

interface FunilEtapaLite {
  id: string;
  nome: string;
  cor: string;
  ordem: number;
  tipo: FunilEtapaTipo;
  probabilidade: number;
}

interface KanbanResponse {
  funil: {
    id: string | null;
    nome: string;
    cor: string;
    etapas: FunilEtapaLite[];
  };
  /** Mapa etapaId → leads (etapaId = FunilEtapa.id ou enum name no fallback) */
  grupos: Record<string, Lead[]>;
  /**
   * Total REAL por etapa (#19b) — inclui o que ficou fora do teto. Sem isto a
   * coluna mostrava só a contagem do que veio e parecia que tinha acabado.
   */
  totaisPorEtapa?: Record<string, number>;
  /** true quando alguma coluna bateu o teto por etapa — a UI avisa que há mais. */
  truncado?: boolean;
}

/** Teto POR ETAPA no backend (KANBAN_CAP_POR_ETAPA). Só pra mensagem. */
const KANBAN_CAP_POR_ETAPA = 100;

interface FunilListItem {
  id: string;
  nome: string;
  descricao?: string | null;
  cor: string;
  ordem: number;
  ativo: boolean;
  isPadrao: boolean;
  etapas: FunilEtapaLite[];
  _count?: { leads: number };
}

const ETAPA_LABEL: Record<LeadEtapa, string> = {
  NOVO: 'Novo',
  QUALIFICANDO: 'Qualificando',
  PROPOSTA: 'Proposta',
  NEGOCIACAO: 'Negociação',
  GANHO: 'Ganho',
  PERDIDO: 'Perdido',
};

const ETAPA_VARIANT: Record<
  LeadEtapa,
  'info' | 'primary' | 'warning' | 'warning' | 'success' | 'danger'
> = {
  NOVO: 'info',
  QUALIFICANDO: 'primary',
  PROPOSTA: 'warning',
  NEGOCIACAO: 'warning',
  GANHO: 'success',
  PERDIDO: 'danger',
};

const CANAIS: CanalOrigem[] = [
  'WHATSAPP',
  'INSTAGRAM',
  'FACEBOOK',
  'FORMULARIO',
  'SITE',
  'EMAIL',
  'TELEFONE',
  'INDICACAO',
  'OUTRO',
];

/**
 * Funis visíveis ao mesmo tempo — preferência por USUÁRIO e por dispositivo.
 *
 * A chave leva o id do usuário: máquina compartilhada (ou troca de login) não
 * pode fazer um herdar a seleção do outro — funil que o outro vê pode nem ser
 * visível pro papel de quem entrou depois.
 */
const FUNIS_VISIVEIS_KEY = 'betinna:funis-visiveis';

function chaveFunis(): string {
  return `${FUNIS_VISIVEIS_KEY}:${getSession()?.user?.id ?? 'anon'}`;
}

function lerFunisSalvos(): string[] {
  try {
    const raw = localStorage.getItem(chaveFunis());
    const v = raw ? (JSON.parse(raw) as unknown) : null;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function salvarFunis(ids: string[]): void {
  try {
    localStorage.setItem(chaveFunis(), JSON.stringify(ids));
  } catch {
    // Modo privado / quota cheia não pode impedir de trocar de funil.
  }
}

const CANAL_LABEL: Record<CanalOrigem, string> = {
  WHATSAPP: 'WhatsApp',
  INSTAGRAM: 'Instagram',
  FACEBOOK: 'Facebook',
  FORMULARIO: 'Formulário',
  SITE: 'Site',
  EMAIL: 'E-mail',
  TELEFONE: 'Telefone',
  INDICACAO: 'Indicação',
  OUTRO: 'Outro',
};

/** Chip de tag colorido (fundo translúcido na cor da tag). */
function TagChip({ nome, cor, onRemove }: { nome: string; cor: string; onRemove?: () => void }) {
  return (
    <span
      className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full leading-none"
      style={{ background: `${cor}1f`, color: cor, border: `1px solid ${cor}40` }}
    >
      <span className="truncate max-w-[120px]">{nome}</span>
      {onRemove && (
        <button
          type="button"
          aria-label={`Remover tag ${nome}`}
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="hover:opacity-70"
        >
          <X className="h-2.5 w-2.5" />
        </button>
      )}
    </span>
  );
}

// ─── Page principal ────────────────────────────────────────────────

export default function LeadsPage() {
  // Lista de funis pro seletor
  const { data: funis } = useApiQuery<FunilListItem[]>('/funis');

  /**
   * Funis VISÍVEIS ao mesmo tempo (pedido do Léo 21/08: "ver vários funis,
   * só rolando a página pra baixo"). Cada um vira um <FunilBoard> autônomo —
   * fetch, estado otimista e drag próprios. Arrastar ENTRE funis não existe de
   * propósito: mudar de funil é outra operação, não um drag de etapa.
   *
   * A ordem de exibição é a do `/funis` (campo `ordem`, reordenável na tela de
   * Funis) — não a ordem em que a pessoa clicou.
   */
  const [visiveis, setVisiveis] = useState<string[]>(lerFunisSalvos);
  const [menuFunis, setMenuFunis] = useState(false);
  // Bumped quando algo fora dos boards muda leads (criar/importar): cada board
  // observa e refaz o fetch. Evita plumbing de refs pra N boards.
  const [versao, setVersao] = useState(0);
  // Totais somados dos boards visíveis (o header mostra o conjunto).
  const [totaisPorFunil, setTotaisPorFunil] = useState<
    Record<string, { totalLeads: number; totalAtivos: number }>
  >({});

  // Sem seleção salva: abre no funil PADRÃO (comportamento de sempre).
  //
  // Também limpa id de funil que não existe mais (apagado/desativado depois de
  // salvo) — senão a tela abriria vazia sem explicar por quê. Se sobrar nenhum
  // válido, cai no padrão como se fosse a primeira visita.
  useEffect(() => {
    if (!funis || funis.length === 0) return;
    const validos = visiveis.filter((id) => funis.some((f) => f.id === id));
    if (validos.length > 0) {
      if (validos.length !== visiveis.length) setVisiveis(validos);
      return;
    }
    const padrao =
      funis.find((f) => f.isPadrao && f.ativo) ?? funis.find((f) => f.ativo) ?? funis[0];
    if (padrao) setVisiveis([padrao.id]);
  }, [funis, visiveis]);

  const role = useRole();
  const canImport = role === 'ADMIN' || role === 'DIRECTOR' || role === 'GERENTE';
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);

  // Renderiza na ordem do /funis, não na ordem de clique.
  const funisVisiveis = (funis ?? []).filter((f) => visiveis.includes(f.id));
  const primeiro = funisVisiveis[0] ?? null;
  const multi = funisVisiveis.length > 1;

  const totals = funisVisiveis.reduce(
    (acc, f) => {
      const t = totaisPorFunil[f.id];
      return t
        ? {
            totalLeads: acc.totalLeads + t.totalLeads,
            totalAtivos: acc.totalAtivos + t.totalAtivos,
          }
        : acc;
    },
    { totalLeads: 0, totalAtivos: 0 },
  );

  function alternarFunil(id: string) {
    setVisiveis((cur) => {
      // Nunca deixa a tela sem funil nenhum: desmarcar o último é no-op.
      const nova = cur.includes(id)
        ? cur.length === 1
          ? cur
          : cur.filter((x) => x !== id)
        : [...cur, id];
      salvarFunis(nova);
      return nova;
    });
  }

  return (
    <PageLayout
      title="Funil"
      description={`${totals.totalLeads} leads · ${fmtBRLCompact(totals.totalAtivos)} em ativo${
        multi ? ` · ${funisVisiveis.length} funis` : ''
      }`}
      actions={
        // `flex-wrap`: no celular os 4 controles não cabem numa linha e o
        // botão "Novo lead" ficava cortado fora da tela (+64px de estouro).
        <div className="flex items-center gap-2 flex-wrap">
          {funis && funis.length > 1 && (
            <div className="relative">
              <Button
                variant="secondary"
                data-testid="funil-selector"
                onClick={() => setMenuFunis((v) => !v)}
                aria-expanded={menuFunis}
              >
                {multi ? `${funisVisiveis.length} funis` : (primeiro?.nome ?? 'Funil')}
                <ChevronDown className="h-3.5 w-3.5 ml-1.5" />
              </Button>
              {menuFunis && (
                <>
                  {/* Clique fora fecha — sem lib de popover. */}
                  <div
                    className="fixed inset-0 z-40"
                    aria-hidden
                    onClick={() => setMenuFunis(false)}
                  />
                  <div className="absolute right-0 z-50 mt-1 w-64 rounded-md border border-border bg-surface shadow-lg p-1">
                    <div className="px-2 py-1.5 text-[10px] uppercase tracking-wider text-muted font-semibold">
                      Funis visíveis ao mesmo tempo
                    </div>
                    {funis.map((f) => {
                      const marcado = visiveis.includes(f.id);
                      return (
                        <label
                          key={f.id}
                          className="flex items-center gap-2 px-2 py-1.5 rounded-md text-sm cursor-pointer hover:bg-surface-hover"
                          data-testid={`funil-opt-${f.id}`}
                        >
                          <input
                            type="checkbox"
                            checked={marcado}
                            onChange={() => alternarFunil(f.id)}
                          />
                          <span
                            className="h-2 w-2 rounded-full shrink-0"
                            style={{ background: f.cor }}
                            aria-hidden
                          />
                          <span className="flex-1 truncate">{f.nome}</span>
                          {f.isPadrao && (
                            <Badge variant="primary" size="sm">
                              padrão
                            </Badge>
                          )}
                        </label>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          )}
          <Link
            to="/funis"
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md text-sm font-medium text-text-subtle hover:text-primary hover:bg-surface-hover transition-colors"
            data-testid="funis-manage-link"
          >
            <Settings className="h-3.5 w-3.5" />
            Funis
          </Link>
          {canImport && (
            <Button
              variant="secondary"
              data-testid="lead-import-btn"
              onClick={() => setImporting(true)}
              leftIcon={<Upload className="h-3.5 w-3.5" />}
            >
              Importar
            </Button>
          )}
          <Button
            data-testid="lead-new-btn"
            onClick={() => setCreating(true)}
            leftIcon={<Plus className="h-3.5 w-3.5" />}
          >
            Novo lead
          </Button>
        </div>
      }
    >
      <CrmTabs />

      {/* Um board por funil visível, empilhados. */}
      <div className="flex flex-col gap-6">
        {funisVisiveis.map((f) => (
          <FunilBoard
            key={f.id}
            funilId={f.id}
            nome={f.nome}
            cor={f.cor}
            mostrarTitulo={multi}
            versao={versao}
            onTotals={(t) => setTotaisPorFunil((cur) => ({ ...cur, [f.id]: t }))}
          />
        ))}
      </div>

      {creating && (
        <LeadFormModal
          funilSelecionado={primeiro ? { id: primeiro.id, etapas: primeiro.etapas } : null}
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            setVersao((v) => v + 1);
          }}
        />
      )}

      {importing && (
        <ImportLeadsModal
          funis={funis ?? []}
          defaultFunilId={primeiro?.id ?? null}
          onClose={() => setImporting(false)}
          onDone={() => {
            setImporting(false);
            setVersao((v) => v + 1);
          }}
        />
      )}
    </PageLayout>
  );
}

/**
 * UM funil no kanban: fetch, estado otimista, drag-and-drop e o drawer do lead.
 *
 * Extraído da LeadsPage (21/08) pra a página poder empilhar VÁRIOS. Cada board
 * é autônomo — dois funis na tela não compartilham estado nem DndContext, então
 * um drag num deles não mexe no outro. Continua no MESMO arquivo de propósito:
 * ele usa KanbanColumn/LeadCardInner/ReasonDialog/LeadDetailDrawer, que vivem
 * logo abaixo.
 */
function FunilBoard({
  funilId,
  nome,
  cor,
  mostrarTitulo,
  versao,
  onTotals,
}: {
  funilId: string;
  nome: string;
  cor: string;
  /** Com um funil só, o nome já está no seletor do header — não repete. */
  mostrarTitulo: boolean;
  /** Muda quando a página cria/importa lead: força refetch. */
  versao: number;
  onTotals: (t: { totalLeads: number; totalAtivos: number }) => void;
}) {
  const toast = useToast();
  const { data, loading, error, refetch } = useApiQuery<KanbanResponse>(
    `/leads/kanban?funilId=${funilId}`,
  );
  const [selected, setSelected] = useState<Lead | null>(null);

  // Optimistic state pra mover durante drag
  const [optimistic, setOptimistic] = useState<KanbanResponse | null>(null);
  // #49: # de moves sendo persistidos. Enquanto > 0 (ou durante um drag), NÃO sincroniza o optimistic
  // com `data` — senão um poll EM VOO (iniciado antes do drop) que resolve no meio do move traz o
  // estado ANTIGO e o card volta pra coluna anterior por ~1s e depois pula de novo.
  const movendoRef = useRef(0);

  // Drag state
  const [activeLead, setActiveLead] = useState<Lead | null>(null);
  const activeLeadRef = useRef<Lead | null>(null);
  activeLeadRef.current = activeLead;

  useEffect(() => {
    if (movendoRef.current > 0 || activeLeadRef.current) return; // #49: não atropela o move otimista
    setOptimistic(data ?? null);
  }, [data]);

  // Criar/importar lead acontece FORA do board — a página avisa por `versao`.
  const primeiraVersao = useRef(versao);
  useEffect(() => {
    if (versao === primeiraVersao.current) return;
    primeiraVersao.current = versao;
    refetch();
  }, [versao, refetch]);

  // Atualiza o board em BACKGROUND — fluxos/bot movem leads no backend, então
  // sem isso só dava pra ver a mudança com F5. Refetch ao focar a aba + a cada
  // 20s; pula durante um drag (não atropela o optimistic). Poll via refetch()
  // (queryKey = URL), NUNCA cache-buster — ver memória de polling TanStack.
  useEffect(() => {
    function atualizar() {
      if (
        document.visibilityState !== 'visible' ||
        activeLeadRef.current ||
        movendoRef.current > 0
      ) {
        return;
      }
      refetch();
    }
    document.addEventListener('visibilitychange', atualizar);
    const id = window.setInterval(atualizar, 20_000);
    return () => {
      document.removeEventListener('visibilitychange', atualizar);
      clearInterval(id);
    };
  }, [refetch]);

  // Reason dialog quando dropa em etapa terminal (GANHO/PERDIDO)
  const [reasonDialog, setReasonDialog] = useState<{
    lead: Lead;
    targetEtapaId: string;
    targetEtapaNome: string;
    targetTipo: FunilEtapaTipo;
    sourceEtapaId: string;
  } | null>(null);

  const sensors = useSensoresDnd(6);

  function handleDragStart(event: DragStartEvent) {
    const id = String(event.active.id);
    if (!optimistic) return;
    for (const etapaId of Object.keys(optimistic.grupos)) {
      const found = optimistic.grupos[etapaId]?.find((l) => l.id === id);
      if (found) {
        setActiveLead(found);
        return;
      }
    }
  }

  async function handleDragEnd(event: DragEndEvent) {
    setActiveLead(null);
    const { active, over } = event;
    if (!over || !optimistic) return;
    const leadId = String(active.id);
    const targetEtapaId = String(over.id);

    const targetEtapa = optimistic.funil.etapas.find((e) => e.id === targetEtapaId);
    if (!targetEtapa) return;

    // Encontra lead na grupos atual
    let lead: Lead | undefined;
    let sourceEtapaId: string | undefined;
    for (const etapaId of Object.keys(optimistic.grupos)) {
      const found = optimistic.grupos[etapaId]?.find((l) => l.id === leadId);
      if (found) {
        lead = found;
        sourceEtapaId = etapaId;
        break;
      }
    }
    if (!lead || !sourceEtapaId) return;
    if (sourceEtapaId === targetEtapaId) return;

    // Terminais (GANHO/PERDIDO) abrem dialog pedindo motivo
    if (targetEtapa.tipo === 'GANHO' || targetEtapa.tipo === 'PERDIDO') {
      setReasonDialog({
        lead,
        targetEtapaId,
        targetEtapaNome: targetEtapa.nome,
        targetTipo: targetEtapa.tipo,
        sourceEtapaId,
      });
      return;
    }

    moveLeadLocal(leadId, sourceEtapaId, targetEtapaId, lead);
    await persistMove(leadId, targetEtapaId, targetEtapa.nome);
  }

  function moveLeadLocal(leadId: string, fromEtapaId: string, toEtapaId: string, lead: Lead) {
    setOptimistic((cur) => {
      if (!cur) return cur;
      const grupos = { ...cur.grupos };
      grupos[fromEtapaId] = (grupos[fromEtapaId] ?? []).filter((l) => l.id !== leadId);
      grupos[toEtapaId] = [lead, ...(grupos[toEtapaId] ?? [])];
      return { ...cur, grupos };
    });
  }

  async function persistMove(leadId: string, etapaId: string, etapaNome: string, motivo?: string) {
    movendoRef.current++; // #49: segura a sync do optimistic enquanto o PUT está em voo
    try {
      // Se etapaId é um cuid (funil customizado), envia funilEtapaId.
      // Senão, é o nome do enum legado.
      const isFunilEtapa = optimistic?.funil.id !== null;
      const payload: Record<string, unknown> = isFunilEtapa
        ? { funilEtapaId: etapaId }
        : { etapa: etapaId };
      if (motivo) payload.motivo = motivo;
      await api.put(`/leads/${leadId}/etapa`, payload);
      toast.success(`Movido para ${etapaNome}`);
    } catch (err) {
      toast.error('Falha ao mover lead', apiErrorMessage(err));
      // REVERTE o move otimista: o backend não mudou, então o refetch abaixo volta um estado
      // deep-equal ao cache → o structural sharing do TanStack preserva a MESMA referência de `data`
      // → o effect [data] NÃO re-dispara e o card ficava travado na coluna errada até um F5. Aqui
      // ressincronizamos o optimistic com a verdade do servidor (pré-move) na mão.
      setOptimistic(data ?? null);
    } finally {
      // Libera a sync ANTES do refetch: o GET novo (pós-move) traz o estado correto e o optimistic
      // sincroniza sem pulo. Um poll velho que resolvia no meio do move foi ignorado (contador > 0).
      movendoRef.current = Math.max(0, movendoRef.current - 1);
      refetch();
    }
  }

  async function confirmMoveWithReason(motivo: string) {
    if (!reasonDialog) return;
    const { lead, targetEtapaId, targetEtapaNome, sourceEtapaId } = reasonDialog;
    setReasonDialog(null);
    moveLeadLocal(lead.id, sourceEtapaId, targetEtapaId, lead);
    await persistMove(lead.id, targetEtapaId, targetEtapaNome, motivo);
  }

  // Reporta os totais pro header da página (que soma os funis visíveis).
  useEffect(() => {
    if (!optimistic) return;
    let totalLeads = 0;
    let totalAtivos = 0;
    for (const e of optimistic.funil.etapas) {
      const leads = optimistic.grupos[e.id] ?? [];
      totalLeads += leads.length;
      if (e.tipo === 'ATIVA') totalAtivos += leads.reduce((s, l) => s + l.valorEstimado, 0);
    }
    onTotals({ totalLeads, totalAtivos });
    // `onTotals` é recriado a cada render da página — fora das deps de propósito
    // (com ele aqui, o efeito rodaria em loop).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [optimistic]);

  const cols = optimistic?.funil.etapas.length ?? 6;

  return (
    <section data-testid={`funil-board-${funilId}`}>
      {mostrarTitulo && (
        <div className="flex items-center gap-2 mb-2">
          <span
            className="h-2.5 w-2.5 rounded-full shrink-0"
            style={{ background: cor }}
            aria-hidden
          />
          <h2 className="text-sm font-semibold text-text">{nome}</h2>
          <span className="text-[11px] text-muted tabular">
            {optimistic
              ? `${Object.values(optimistic.grupos).reduce((s, g) => s + g.length, 0)} leads`
              : '—'}
          </span>
        </div>
      )}
      <StateView loading={loading && !optimistic} error={error} onRetry={refetch}>
        {optimistic?.truncado && (
          <div
            data-testid="kanban-truncado-aviso"
            className="mb-3 px-3 py-2 rounded-md bg-warning/10 border border-warning/30 text-warning text-sm flex items-start gap-2"
          >
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            <span>
              Alguma coluna passou de {KANBAN_CAP_POR_ETAPA} leads — o quadro mostra os mais
              recentes de cada etapa. O número no topo da coluna é o total de verdade; pra chegar
              nos demais, use os filtros ou a busca em Contatos.
            </span>
          </div>
        )}
        {optimistic && (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            onDragCancel={() => setActiveLead(null)}
          >
            <div
              className="grid gap-3 overflow-x-auto pb-2 -mx-1 px-1"
              style={{
                gridTemplateColumns: `repeat(${cols}, minmax(260px, 1fr))`,
              }}
            >
              {optimistic.funil.etapas.map((etapa) => (
                <KanbanColumn
                  key={etapa.id}
                  etapa={etapa}
                  leads={optimistic.grupos[etapa.id] ?? []}
                  totalReal={optimistic.totaisPorEtapa?.[etapa.id]}
                  onCardClick={setSelected}
                />
              ))}
            </div>
            <DragOverlay>
              {activeLead && (
                <div className="rotate-2 shadow-xl border border-primary/40 bg-surface rounded-md p-2.5">
                  <LeadCardInner lead={activeLead} dragging />
                </div>
              )}
            </DragOverlay>
          </DndContext>
        )}
      </StateView>

      {selected && (
        <LeadDetailDrawer
          lead={selected}
          etapas={optimistic?.funil.etapas ?? []}
          onClose={() => setSelected(null)}
          onChanged={() => {
            setSelected(null);
            refetch();
          }}
          onMutated={refetch}
        />
      )}

      {reasonDialog && (
        <ReasonDialog
          targetTipo={reasonDialog.targetTipo}
          targetNome={reasonDialog.targetEtapaNome}
          leadNome={reasonDialog.lead.nome}
          onCancel={() => setReasonDialog(null)}
          onConfirm={confirmMoveWithReason}
        />
      )}
    </section>
  );
}

// ─── Kanban column (droppable) ──────────────────────────────────

function KanbanColumn({
  etapa,
  leads,
  totalReal,
  onCardClick,
}: {
  etapa: FunilEtapaLite;
  leads: Lead[];
  /** Total de verdade da etapa (#19b) — pode ser maior que `leads.length`. */
  totalReal?: number;
  onCardClick: (l: Lead) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: etapa.id });
  const total = leads.reduce((s, l) => s + l.valorEstimado, 0);
  // #19b: quando a coluna bateu o teto, o contador tem que dizer o total REAL —
  // senão o vendedor lê "100" e acha que a etapa acabou ali.
  const cortada = typeof totalReal === 'number' && totalReal > leads.length;

  return (
    <div
      data-testid={`kanban-col-${etapa.id}`}
      ref={setNodeRef}
      className={cn(
        'flex flex-col gap-2 rounded-lg p-2 min-h-[300px]',
        'bg-bg-alt border border-border',
        'transition-colors duration-100',
        isOver && 'bg-surface-hover border-border-strong',
      )}
    >
      <header className="flex items-center justify-between px-1 py-1 sticky top-0 z-10 bg-bg-alt rounded">
        <div className="flex items-center gap-1.5">
          <span
            className="h-1.5 w-1.5 rounded-full shrink-0"
            style={{ background: etapa.cor }}
            aria-hidden
          />
          <span
            className="text-sm font-semibold text-text tracking-tight truncate"
            title={etapa.nome}
          >
            {etapa.nome}
          </span>
          <span
            className="text-[10px] text-muted tabular bg-surface px-1.5 py-0.5 rounded-full border border-border"
            title={
              cortada ? `Mostrando ${leads.length} dos ${totalReal} leads desta etapa` : undefined
            }
          >
            {cortada ? `${leads.length} de ${totalReal}` : leads.length}
          </span>
        </div>
        {total > 0 && (
          <span className="text-[11px] text-muted tabular">{fmtBRLCompact(total)}</span>
        )}
      </header>

      {leads.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-6 text-center">
          <Target className="h-4 w-4 text-muted-light mb-1" />
          <span className="text-[11px] text-muted-light">Solte um lead aqui</span>
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          {leads.map((l) => (
            <DraggableLeadCard key={l.id} lead={l} onClick={onCardClick} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Draggable card ────────────────────────────────────────────

/**
 * Card inteiro é o "handle" de drag. O usuário pressiona o card e arrasta.
 * Para abrir o detalhe sem arrastar, há um botão "Abrir" no canto superior
 * direito (não conflita com drag — pointerdown nele para a propagação).
 *
 * dnd-kit's PointerSensor com distance=6 garante que cliques curtos não
 * disparam drag, então um click rápido em outra parte do card também
 * abre o detail.
 */
// PERF: memoizado — com TanStack fazendo structural sharing e onClick (setSelected) estável, o
// poll de 20s não re-renderiza nem re-registra os draggables dos cards que não mudaram (antes
// travava ao arrastar no celular em funil grande).
const DraggableLeadCard = memo(function DraggableLeadCard({
  lead,
  onClick,
}: {
  lead: Lead;
  onClick: (l: Lead) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: lead.id,
  });

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      data-testid={`lead-card-${lead.id}`}
      role="button"
      tabIndex={0}
      onClick={(e) => {
        // Se foi marcado como vindo do botão "Abrir", deixa passar.
        // Senão, abre detail por click curto no card (drag não disparou).
        if (!(e.target as HTMLElement).closest('[data-no-drag]')) {
          onClick(lead);
        }
      }}
      className={cn(
        'group relative bg-surface border border-border rounded-md p-2.5',
        'hover:border-border-strong hover:bg-surface-hover transition-colors',
        'cursor-grab active:cursor-grabbing touch-none select-none',
        'focus:outline-none focus:ring-2 focus:ring-primary/30',
        isDragging && 'opacity-30',
      )}
    >
      <LeadCardInner lead={lead} onOpenDetail={() => onClick(lead)} />
    </div>
  );
});

function LeadCardInner({
  lead,
  onOpenDetail,
  dragging,
}: {
  lead: Lead;
  onOpenDetail?: () => void;
  dragging?: boolean;
}) {
  return (
    <div className={cn('relative', dragging && 'shadow-xl')}>
      {/* Botão "Abrir" no canto — único elemento que NÃO dispara drag */}
      {onOpenDetail && (
        <button
          type="button"
          aria-label="Abrir detalhes"
          data-no-drag
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onOpenDetail();
          }}
          className={cn(
            'absolute top-0 right-0 p-1 rounded-md text-muted-light',
            'opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity',
            'hover:text-primary hover:bg-surface-hover',
            'focus:opacity-100 focus:outline-none focus:ring-1 focus:ring-primary/40',
          )}
        >
          <ExternalLink className="h-3 w-3" />
        </button>
      )}

      <div className="flex items-start gap-2 mb-1.5 pr-5">
        <Avatar name={lead.nome} size="xs" />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-text leading-tight truncate">{lead.nome}</div>
          {lead.contatoNome && (
            <div className="text-[10px] text-muted truncate">{lead.contatoNome}</div>
          )}
        </div>
      </div>

      <div className="flex items-center gap-1.5 mb-1.5 flex-wrap">
        {lead.cidade && (
          <span className="inline-flex items-center gap-0.5 text-[10px] text-muted">
            <MapPin className="h-2.5 w-2.5" />
            {lead.cidade}
            {lead.uf ? `/${lead.uf}` : ''}
          </span>
        )}
        {lead.segmento && (
          <span className="inline-flex items-center gap-0.5 text-[10px] text-muted">
            <Briefcase className="h-2.5 w-2.5" />
            {lead.segmento}
          </span>
        )}
        {/* Por onde entrou. Sem tag espelho: o campo já existe no lead, e tag de
            origem poluiria a régua de etiquetas (que roteia fluxo). */}
        {rotuloOrigem(lead.origemCadastro) && (
          <span
            className="inline-flex items-center gap-0.5 text-[10px] text-muted"
            title={
              rotuloFormulario(lead.formularioOrigem)
                ? `Origem: ${rotuloOrigem(lead.origemCadastro)} — ${rotuloFormulario(lead.formularioOrigem)}`
                : `Origem: ${rotuloOrigem(lead.origemCadastro)}`
            }
            data-testid="lead-card-origem"
          >
            <LogIn className="h-2.5 w-2.5" />
            {rotuloFormulario(lead.formularioOrigem) ?? rotuloOrigem(lead.origemCadastro)}
          </span>
        )}
      </div>

      {lead.tags && lead.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-1.5">
          {lead.tags.slice(0, 4).map((t) => (
            <TagChip key={t.tag.id} nome={t.tag.nome} cor={t.tag.cor} />
          ))}
          {lead.tags.length > 4 && (
            <span className="text-[10px] text-muted-light">+{lead.tags.length - 4}</span>
          )}
        </div>
      )}

      <div className="flex items-center justify-between">
        {/* Só mostra valor em quem TEM. Base importada entra com 0 e um "R$ 0,00"
            em cada card virava ruído sem informação. */}
        {lead.valorEstimado > 0 ? (
          <span className="text-sm font-semibold text-text tabular tracking-tight">
            {fmtBRLCompact(lead.valorEstimado)}
          </span>
        ) : (
          <span />
        )}
        {lead.representante ? (
          <Avatar name={lead.representante.nome} size="xs" />
        ) : (
          <Badge variant="neutral" size="sm">
            sem rep
          </Badge>
        )}
      </div>
    </div>
  );
}

// ─── Detail drawer ─────────────────────────────────────────────

interface RepOpt {
  id: string;
  nome: string;
  email?: string;
}

function LeadDetailDrawer({
  lead,
  etapas,
  onClose,
  onChanged,
  onMutated,
}: {
  lead: Lead;
  etapas: FunilEtapaLite[];
  onClose: () => void;
  onChanged: () => void;
  /** Refaz a busca do board SEM fechar o drawer (ex: editar tags). */
  onMutated: () => void;
}) {
  const toast = useToast();
  const navigate = useNavigate();
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [rep, setRep] = useState<RepOpt | null>(lead.representante ?? null);
  const [proximaAcao, setProximaAcao] = useState(lead.proximaAcao ?? '');
  const [observacoes, setObservacoes] = useState(lead.observacoes ?? '');
  const [terminal, setTerminal] = useState<FunilEtapaLite | null>(null);
  const [motivo, setMotivo] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);

  const fechado = lead.etapa === 'GANHO' || lead.etapa === 'PERDIDO';
  const etapaAtualId = lead.funilEtapaId ?? lead.etapa;
  const repMudou = (rep?.id ?? null) !== (lead.representante?.id ?? null);
  const notasMudaram =
    proximaAcao.trim() !== (lead.proximaAcao ?? '') ||
    observacoes.trim() !== (lead.observacoes ?? '');

  function apiMsg(err: unknown): string {
    return apiErrorMessage(err);
  }
  function etapaPayload(etapa: FunilEtapaLite, motivoArg?: string) {
    const isEnum = Object.prototype.hasOwnProperty.call(ETAPA_LABEL, etapa.id);
    const p: Record<string, unknown> = isEnum ? { etapa: etapa.id } : { funilEtapaId: etapa.id };
    if (motivoArg) p.motivo = motivoArg;
    return p;
  }

  async function mudarEtapa(etapa: FunilEtapaLite, motivoArg?: string) {
    setBusy('etapa');
    setActionError(null);
    try {
      await api.put(`/leads/${lead.id}/etapa`, etapaPayload(etapa, motivoArg));
      toast.success(`Movido para ${etapa.nome}`);
      onChanged();
    } catch (err) {
      setActionError(apiMsg(err));
    } finally {
      setBusy(null);
    }
  }
  function onClickEtapa(etapa: FunilEtapaLite) {
    if (etapa.id === etapaAtualId) return;
    if (etapa.tipo === 'GANHO' || etapa.tipo === 'PERDIDO') {
      setMotivo('');
      setTerminal(etapa);
      return;
    }
    void mudarEtapa(etapa);
  }

  async function salvarRep() {
    setBusy('rep');
    setActionError(null);
    try {
      await api.put(`/leads/${lead.id}/representante`, { representanteId: rep?.id ?? null });
      toast.success(rep ? `Atribuído a ${rep.nome}` : 'Representante removido');
      onChanged();
    } catch (err) {
      setActionError(apiMsg(err));
    } finally {
      setBusy(null);
    }
  }

  async function salvarNotas() {
    setBusy('notas');
    setActionError(null);
    try {
      await api.patch(`/leads/${lead.id}`, {
        proximaAcao: proximaAcao.trim() || undefined,
        observacoes: observacoes.trim() || undefined,
      });
      toast.success('Lead atualizado');
      onChanged();
    } catch (err) {
      setActionError(apiMsg(err));
    } finally {
      setBusy(null);
    }
  }

  async function callDelete() {
    setBusy('delete');
    try {
      await api.delete(`/leads/${lead.id}`);
      toast.success('Lead excluído');
      onChanged();
    } catch (err) {
      toast.error('Falha ao excluir', apiMsg(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title={lead.nome}
      description={lead.contatoNome ?? undefined}
      width="md"
      footer={
        confirmDelete ? (
          <>
            <Button variant="secondary" onClick={() => setConfirmDelete(false)}>
              Cancelar
            </Button>
            <Button
              variant="danger"
              onClick={callDelete}
              loading={busy === 'delete'}
              leftIcon={<Trash2 className="h-3.5 w-3.5" />}
            >
              Confirmar exclusão
            </Button>
          </>
        ) : (
          <Button
            variant="danger"
            size="sm"
            onClick={() => setConfirmDelete(true)}
            leftIcon={<Trash2 className="h-3.5 w-3.5" />}
          >
            Excluir lead
          </Button>
        )
      }
    >
      <div className="flex flex-col gap-5">
        {/* Header */}
        <div className="flex items-center gap-3">
          <Avatar name={lead.nome} size="xl" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant={ETAPA_VARIANT[lead.etapa]}>{ETAPA_LABEL[lead.etapa]}</Badge>
              <Badge variant="neutral" size="sm">
                Score {lead.score}
              </Badge>
            </div>
            {lead.valorEstimado > 0 && (
              <>
                <div className="text-2xl font-semibold text-text mt-2 tabular tracking-tight">
                  {fmtBRL(lead.valorEstimado)}
                </div>
                <div className="text-[11px] text-muted">valor estimado</div>
              </>
            )}
          </div>
        </div>

        {/* F2 — Ações rápidas */}
        <div className="flex flex-wrap gap-2">
          {lead.cliente && (
            <Button
              variant="secondary"
              size="sm"
              data-testid="lead-abrir-cliente"
              onClick={() => navigate(`/clientes/${lead.cliente!.id}`)}
              leftIcon={<Building2 className="h-3.5 w-3.5" />}
            >
              Abrir cliente
            </Button>
          )}
          <Button
            variant="secondary"
            size="sm"
            data-testid="lead-agendar"
            onClick={() => navigate('/agenda')}
            leftIcon={<CalendarPlus className="h-3.5 w-3.5" />}
          >
            Agendar visita
          </Button>
        </div>

        {/* F2 — Mudar etapa */}
        <section>
          <h4 className="text-[10px] font-semibold uppercase tracking-wider text-muted mb-2">
            Mover etapa
          </h4>
          {terminal ? (
            <div className="flex flex-col gap-2">
              <p className="text-sm text-text m-0">
                Motivo pra marcar como <strong>{terminal.nome}</strong>:
              </p>
              <Textarea
                data-testid="lead-etapa-motivo"
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                rows={2}
                placeholder="Ex: Cliente fechou / escolheu concorrente…"
              />
              <div className="flex gap-2">
                <Button variant="secondary" size="sm" onClick={() => setTerminal(null)}>
                  Cancelar
                </Button>
                <Button
                  size="sm"
                  variant={terminal.tipo === 'GANHO' ? 'primary' : 'danger'}
                  disabled={motivo.trim().length === 0}
                  loading={busy === 'etapa'}
                  onClick={() => void mudarEtapa(terminal, motivo.trim())}
                >
                  Confirmar {terminal.nome}
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {etapas.map((e) => {
                const atual = e.id === etapaAtualId;
                return (
                  <button
                    key={e.id}
                    type="button"
                    data-testid={`lead-etapa-${e.id}`}
                    disabled={atual || busy === 'etapa'}
                    onClick={() => onClickEtapa(e)}
                    className={cn(
                      'px-2.5 py-1 rounded-full text-xs font-medium border transition-colors',
                      atual
                        ? 'border-primary bg-primary/10 text-primary cursor-default'
                        : 'border-border text-text-subtle hover:border-primary hover:text-primary',
                    )}
                  >
                    {e.nome}
                  </button>
                );
              })}
            </div>
          )}
        </section>

        {/* Mover para OUTRO funil (via PUT /etapa — dispara SLA + gatilho do funil destino) */}
        {!fechado && (
          <MoverFunilSection lead={lead} onChanged={onChanged} busyOther={busy !== null} />
        )}

        {/* F2 — Representante */}
        <section>
          <h4 className="text-[10px] font-semibold uppercase tracking-wider text-muted mb-2">
            Representante
          </h4>
          <AsyncCombobox<RepOpt>
            testId="lead-rep-picker"
            endpoint="/users"
            placeholder="Buscar representante…"
            getLabel={(r) => r.nome}
            getSubLabel={(r) => r.email ?? null}
            getId={(r) => r.id}
            value={rep}
            onChange={setRep}
            extraQuery={{ role: 'REP' }}
          />
          {repMudou && (
            <Button
              size="sm"
              className="mt-2"
              data-testid="lead-rep-salvar"
              loading={busy === 'rep'}
              onClick={() => void salvarRep()}
              leftIcon={<UserCog className="h-3.5 w-3.5" />}
            >
              {rep ? 'Atribuir representante' : 'Remover representante'}
            </Button>
          )}
        </section>

        {/* Tags (orquestração) */}
        <LeadTagsSection lead={lead} onMutated={onMutated} />

        {/* F2 — Próxima ação + observações (registrar contato/nota) */}
        <section>
          <h4 className="text-[10px] font-semibold uppercase tracking-wider text-muted mb-2">
            Próxima ação & observações
          </h4>
          {fechado && (
            <p className="text-[11px] text-warning mb-1.5">
              Lead fechado — reabra (mova pra uma etapa ativa) pra editar texto.
            </p>
          )}
          <div className="flex flex-col gap-2">
            <Input
              data-testid="lead-proxima-acao"
              value={proximaAcao}
              onChange={(e) => setProximaAcao(e.target.value)}
              placeholder="Próxima ação — ex: ligar amanhã 10h"
              disabled={fechado}
            />
            <Textarea
              data-testid="lead-observacoes"
              value={observacoes}
              onChange={(e) => setObservacoes(e.target.value)}
              rows={3}
              placeholder="Observações / anotações do contato…"
              disabled={fechado}
            />
            {notasMudaram && !fechado && (
              <Button
                size="sm"
                className="self-start"
                data-testid="lead-notas-salvar"
                loading={busy === 'notas'}
                onClick={() => void salvarNotas()}
              >
                Salvar
              </Button>
            )}
          </div>
        </section>

        {/* Contexto */}
        <section>
          <h4 className="text-[10px] font-semibold uppercase tracking-wider text-muted mb-2">
            Contexto
          </h4>
          <div className="grid grid-cols-2 gap-2.5 text-sm">
            <InfoCell icon={<MapPin />} label="Localização">
              {lead.cidade ? `${lead.cidade}${lead.uf ? '/' + lead.uf : ''}` : '—'}
            </InfoCell>
            <InfoCell icon={<Briefcase />} label="Segmento">
              {lead.segmento ?? '—'}
            </InfoCell>
            <InfoCell icon={<TrendingUp />} label="Canal de origem">
              {CANAL_LABEL[lead.canalOrigem]}
            </InfoCell>
            {/* `canalOrigem` é a classificação comercial (enum, editável); `origemCadastro`
                é por qual PORTA técnica ele entrou — quem gravou o lead. São coisas
                diferentes e o time confunde quando só uma aparece. */}
            <InfoCell icon={<LogIn />} label="Entrou por">
              {rotuloOrigem(lead.origemCadastro) ?? '—'}
            </InfoCell>
            {rotuloFormulario(lead.formularioOrigem) && (
              <InfoCell icon={<Target />} label="Formulário">
                {rotuloFormulario(lead.formularioOrigem)}
              </InfoCell>
            )}
            <InfoCell icon={<User />} label="Contato">
              {lead.contatoNome ?? '—'}
            </InfoCell>
            <InfoCell icon={<Phone />} label="WhatsApp">
              {lead.contatoTelefone ? (
                lead.contatoTelefone
              ) : (
                <span className="text-danger font-medium">
                  sem número — não recebe abordagem da IA
                </span>
              )}
            </InfoCell>
          </div>
        </section>

        <DadosCapturaSection variaveis={lead.variaveis} />

        {actionError && (
          <div
            data-testid="lead-action-error"
            className="px-3 py-2 rounded-md bg-danger/10 border border-danger/30 text-danger text-sm flex items-start gap-2"
          >
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            {actionError}
          </div>
        )}
      </div>
    </Drawer>
  );
}

function InfoCell({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-md border border-border bg-bg-alt px-3 py-2">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted mb-1 [&>svg]:h-3 [&>svg]:w-3">
        {icon}
        <span>{label}</span>
      </div>
      <div className="text-sm text-text truncate">{children}</div>
    </div>
  );
}

/**
 * Dados estruturados que vieram da captura do site (Lead.variaveis): empresa,
 * cargo, região, experiência, página de origem, origem e consentimento LGPD.
 * Só renderiza quando há ao menos um campo de captura.
 */
function DadosCapturaSection({ variaveis }: { variaveis?: Record<string, unknown> | null }) {
  const v = variaveis ?? {};
  const str = (k: string): string | null => (typeof v[k] === 'string' ? (v[k] as string) : null);
  const lgpd = (v.consentimentoLgpd ?? null) as {
    aceito?: boolean;
    timestamp?: string;
    versaoTexto?: string;
  } | null;
  const meta = (v.metadados ?? null) as { referer?: string; userAgent?: string } | null;

  const campos: Array<{ label: string; valor: string | null }> = [
    { label: 'Empresa', valor: str('empresa') },
    { label: 'Cargo', valor: str('cargo') },
    { label: 'Região', valor: str('regiao') },
    { label: 'Experiência', valor: str('experiencia') },
    { label: 'Página de origem', valor: str('paginaOrigem') },
    { label: 'Origem', valor: str('origem') },
  ].filter((c) => c.valor);

  if (campos.length === 0 && !lgpd && !meta) return null;

  return (
    <section data-testid="lead-dados-captura">
      <h4 className="text-[10px] font-semibold uppercase tracking-wider text-muted mb-2">
        Dados da captura (site)
      </h4>
      <div className="grid grid-cols-2 gap-2.5 text-sm">
        {campos.map((c) => (
          <InfoCell key={c.label} icon={<Sparkles />} label={c.label}>
            {c.valor}
          </InfoCell>
        ))}
        {lgpd && (
          <InfoCell icon={<ShieldCheck />} label="Consentimento LGPD">
            {lgpd.aceito ? 'Aceito' : 'Não aceito'}
            {lgpd.versaoTexto ? ` · ${lgpd.versaoTexto}` : ''}
            {lgpd.timestamp ? ` · ${lgpd.timestamp}` : ''}
          </InfoCell>
        )}
        {meta?.referer && (
          <InfoCell icon={<TrendingUp />} label="Referer">
            {meta.referer}
          </InfoCell>
        )}
      </div>
    </section>
  );
}

// ─── Mover lead para outro funil ───────────────────────────────

function MoverFunilSection({
  lead,
  onChanged,
  busyOther,
}: {
  lead: Lead;
  onChanged: () => void;
  busyOther: boolean;
}) {
  const toast = useToast();
  const { data: funis } = useApiQuery<FunilListItem[]>('/funis');
  const [funilDestinoId, setFunilDestinoId] = useState('');
  const [etapaDestinoId, setEtapaDestinoId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Só outros funis ativos — mover pro mesmo funil é o "Mover etapa" acima.
  const destinos = (funis ?? []).filter((f) => f.ativo && f.id !== (lead.funilId ?? ''));
  const funilDestino = destinos.find((f) => f.id === funilDestinoId) ?? null;
  // Entrada padrão: etapas não-terminais primeiro (mover de funil ≠ ganhar/perder).
  const etapasDestino = (funilDestino?.etapas ?? []).filter(
    (e) => e.tipo !== 'GANHO' && e.tipo !== 'PERDIDO',
  );

  if (destinos.length === 0) return null;

  async function mover() {
    if (!funilDestino || !etapaDestinoId) return;
    setBusy(true);
    setError(null);
    try {
      // Usa o PUT /etapa (moverEtapa) — NÃO o PATCH genérico: só ele grava
      // etapaDesde, recalcula o SLA da etapa de destino e dispara o gatilho
      // LEAD_ETAPA_MUDOU (o fluxo de entrada do funil de destino roda). O backend
      // deriva o funilId da própria etapa, então basta o funilEtapaId.
      await api.put(`/leads/${lead.id}/etapa`, { funilEtapaId: etapaDestinoId });
      const etapaNome = etapasDestino.find((e) => e.id === etapaDestinoId)?.nome ?? '';
      toast.success(`Movido pra ${funilDestino.nome}${etapaNome ? ` · ${etapaNome}` : ''}`);
      onChanged();
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <h4 className="text-[10px] font-semibold uppercase tracking-wider text-muted mb-2">
        Mover pra outro funil
      </h4>
      <div className="flex flex-wrap items-center gap-2">
        <Select
          data-testid="lead-mover-funil"
          value={funilDestinoId}
          onChange={(e) => {
            setFunilDestinoId(e.target.value);
            setEtapaDestinoId('');
          }}
          className="min-w-[160px]"
        >
          <option value="">Escolher funil…</option>
          {destinos.map((f) => (
            <option key={f.id} value={f.id}>
              {f.nome}
            </option>
          ))}
        </Select>
        {funilDestino && (
          <Select
            data-testid="lead-mover-etapa"
            value={etapaDestinoId}
            onChange={(e) => setEtapaDestinoId(e.target.value)}
            className="min-w-[150px]"
          >
            <option value="">Etapa de entrada…</option>
            {etapasDestino.map((e) => (
              <option key={e.id} value={e.id}>
                {e.nome}
              </option>
            ))}
          </Select>
        )}
        <Button
          size="sm"
          data-testid="lead-mover-confirmar"
          disabled={!funilDestino || !etapaDestinoId || busyOther}
          loading={busy}
          onClick={() => void mover()}
        >
          Mover
        </Button>
      </div>
      {error && <p className="text-danger text-xs mt-2 m-0">{error}</p>}
    </section>
  );
}

// ─── Tags do lead (orquestração) ───────────────────────────────

interface TagOpt {
  id: string;
  nome: string;
  cor: string;
  categoria?: string | null;
}

function LeadTagsSection({ lead, onMutated }: { lead: Lead; onMutated: () => void }) {
  const toast = useToast();
  const { data: todasTags } = useApiQuery<TagOpt[]>('/tags');
  const [tags, setTags] = useState<LeadTagRef[]>(lead.tags ?? []);
  const [busy, setBusy] = useState(false);

  const aplicadasIds = new Set(tags.map((t) => t.tag.id));
  const disponiveis = (todasTags ?? []).filter((t) => !aplicadasIds.has(t.id));

  async function add(tagId: string) {
    if (!tagId) return;
    setBusy(true);
    try {
      const r = await api.post<Lead>(`/leads/${lead.id}/tags`, { tagId });
      setTags(r.tags ?? []);
      onMutated();
    } catch (err) {
      toast.error('Falha ao aplicar tag', apiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove(tagId: string) {
    setBusy(true);
    try {
      const r = await api.delete<Lead>(`/leads/${lead.id}/tags/${tagId}`);
      setTags(r.tags ?? []);
      onMutated();
    } catch (err) {
      toast.error('Falha ao remover tag', apiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <h4 className="text-[10px] font-semibold uppercase tracking-wider text-muted mb-2 flex items-center gap-1.5">
        <TagIcon className="h-3 w-3" /> Tags
      </h4>
      {tags.length > 0 ? (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {tags.map((t) => (
            <TagChip
              key={t.tag.id}
              nome={t.tag.nome}
              cor={t.tag.cor}
              onRemove={() => void remove(t.tag.id)}
            />
          ))}
        </div>
      ) : (
        <p className="text-[11px] text-muted-light mb-2">Nenhuma tag aplicada.</p>
      )}
      <Select
        data-testid="lead-tag-add"
        value=""
        disabled={busy || disponiveis.length === 0}
        onChange={(e) => void add(e.target.value)}
      >
        <option value="">
          {disponiveis.length === 0 ? 'Sem tags disponíveis' : 'Adicionar tag…'}
        </option>
        {disponiveis.map((t) => (
          <option key={t.id} value={t.id}>
            {t.nome}
          </option>
        ))}
      </Select>
      <Link to="/tags" className="text-[11px] text-primary hover:underline mt-1.5 inline-block">
        Gerenciar tags →
      </Link>
    </section>
  );
}

// ─── Reason dialog (GANHO/PERDIDO) ─────────────────────────────

function ReasonDialog({
  targetTipo,
  targetNome,
  leadNome,
  onCancel,
  onConfirm,
}: {
  targetTipo: FunilEtapaTipo;
  targetNome: string;
  leadNome: string;
  onCancel: () => void;
  onConfirm: (motivo: string) => void;
}) {
  const [motivo, setMotivo] = useState('');
  const isGanho = targetTipo === 'GANHO';

  return (
    <Dialog
      open
      onClose={onCancel}
      title={`Marcar como ${targetNome}?`}
      description={`${leadNome} — informe o motivo pra registrar no histórico.`}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onCancel}>
            Cancelar
          </Button>
          <Button
            disabled={motivo.trim().length === 0}
            onClick={() => onConfirm(motivo.trim())}
            variant={isGanho ? 'primary' : 'danger'}
          >
            Confirmar
          </Button>
        </>
      }
    >
      <Field label="Motivo" required>
        <Textarea
          autoFocus
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          placeholder={
            isGanho
              ? 'Ex: Cliente fechou pedido após 3 reuniões. Decisor convencido pelo prazo.'
              : 'Ex: Cliente escolheu concorrente por preço.'
          }
          rows={4}
        />
      </Field>
    </Dialog>
  );
}

// ─── Form modal (Novo lead) ────────────────────────────────────

function LeadFormModal({
  funilSelecionado,
  onClose,
  onSaved,
}: {
  /** Funil selecionado no kanban — usa pra criar o lead no funil correto. */
  funilSelecionado: { id: string; etapas: FunilEtapaLite[] } | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    nome: '',
    cidade: '',
    uf: '',
    segmento: '',
    contatoNome: '',
    contatoEmail: '',
    contatoTelefone: '',
    valorEstimado: 0,
    canalOrigem: 'WHATSAPP' as CanalOrigem,
    proximaAcao: '',
    observacoes: '',
    score: 50,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  function setF<K extends keyof typeof form>(k: K, v: (typeof form)[K]) {
    setForm((s) => ({ ...s, [k]: v }));
    // Limpa erro do campo conforme o user digita
    if (fieldErrors[k as string]) {
      setFieldErrors((errs) => {
        const next = { ...errs };
        delete next[k as string];
        return next;
      });
    }
  }

  /**
   * Validação client-side antes do submit. Espelho do createLeadSchema
   * do backend — falhar aqui dá feedback imediato sem perder o roundtrip.
   */
  function validar(): Record<string, string> {
    const errs: Record<string, string> = {};
    const nome = form.nome.trim();
    if (nome.length === 0) errs.nome = 'Nome é obrigatório';
    else if (nome.length < 2) errs.nome = 'Nome precisa ter no mínimo 2 caracteres';
    else if (nome.length > 200) errs.nome = 'Nome não pode passar de 200 caracteres';

    if (form.uf && form.uf.trim().length !== 0 && form.uf.trim().length !== 2) {
      errs.uf = 'UF precisa ter 2 caracteres';
    }
    if (form.contatoEmail.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.contatoEmail.trim())) {
      errs.contatoEmail = 'E-mail inválido';
    }
    if (form.valorEstimado < 0) {
      errs.valorEstimado = 'Valor não pode ser negativo';
    }
    if (form.score < 0 || form.score > 100) {
      errs.score = 'Score deve estar entre 0 e 100';
    }
    return errs;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const errs = validar();
    if (Object.keys(errs).length > 0) {
      setFieldErrors(errs);
      // Foca o primeiro campo com erro
      const first = document.querySelector<HTMLInputElement>(
        `[data-testid="lead-${Object.keys(errs)[0]}-input"]`,
      );
      first?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    setFieldErrors({});
    const payload: Record<string, unknown> = {
      nome: form.nome.trim(),
      canalOrigem: form.canalOrigem,
      valorEstimado: form.valorEstimado,
      score: form.score,
    };
    // Cria no funil selecionado, na 1ª etapa ATIVA (se disponível)
    if (funilSelecionado) {
      payload.funilId = funilSelecionado.id;
      const primeiraAtiva = funilSelecionado.etapas.find((e) => e.tipo === 'ATIVA');
      if (primeiraAtiva) payload.funilEtapaId = primeiraAtiva.id;
    }
    for (const k of [
      'cidade',
      'uf',
      'segmento',
      'contatoNome',
      'contatoEmail',
      'contatoTelefone',
      'proximaAcao',
      'observacoes',
    ] as const) {
      const v = form[k].trim();
      if (v) payload[k] = v;
    }
    try {
      await api.post('/leads', payload);
      onSaved();
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="Novo lead"
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="lead-form" data-testid="lead-save-btn" loading={busy}>
            Criar lead
          </Button>
        </>
      }
    >
      <form id="lead-form" onSubmit={submit} className="flex flex-col gap-3" noValidate>
        <Field label="Nome / Empresa" required error={fieldErrors.nome}>
          <Input
            data-testid="lead-nome-input"
            value={form.nome}
            onChange={(e) => setF('nome', e.target.value)}
            maxLength={200}
            placeholder="Razão social ou nome do prospect"
            autoFocus
          />
        </Field>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="UF" error={fieldErrors.uf}>
            <UfSelect
              testId="lead-uf-select"
              value={form.uf}
              onChange={(uf) => setForm((s) => ({ ...s, uf, cidade: '' }))}
            />
          </Field>
          <Field label="Cidade">
            <CidadeSelect
              testId="lead-cidade-select"
              uf={form.uf}
              value={form.cidade}
              onChange={(cidade) => setF('cidade', cidade)}
            />
          </Field>
          <Field label="Segmento">
            <Input value={form.segmento} onChange={(e) => setF('segmento', e.target.value)} />
          </Field>
          <Field label="Canal de origem">
            <Select
              value={form.canalOrigem}
              onChange={(e) => setF('canalOrigem', e.target.value as CanalOrigem)}
            >
              {CANAIS.map((c) => (
                <option key={c} value={c}>
                  {CANAL_LABEL[c]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Contato (nome)">
            <Input value={form.contatoNome} onChange={(e) => setF('contatoNome', e.target.value)} />
          </Field>
          <Field label="Telefone">
            <PhoneInput
              testId="lead-telefone"
              value={form.contatoTelefone}
              onChange={(e164) => setF('contatoTelefone', e164)}
            />
          </Field>
          <Field label="E-mail" error={fieldErrors.contatoEmail}>
            <Input
              data-testid="lead-contatoEmail-input"
              type="email"
              value={form.contatoEmail}
              onChange={(e) => setF('contatoEmail', e.target.value)}
            />
          </Field>
          <Field label="Valor estimado" error={fieldErrors.valorEstimado}>
            <Input
              data-testid="lead-valorEstimado-input"
              type="number"
              min={0}
              step="0.01"
              value={form.valorEstimado}
              onChange={(e) => setF('valorEstimado', Number(e.target.value))}
            />
          </Field>
          <Field label="Score (0–100)" error={fieldErrors.score}>
            <Input
              data-testid="lead-score-input"
              type="number"
              min={0}
              max={100}
              value={form.score}
              onChange={(e) => setF('score', Number(e.target.value))}
            />
          </Field>
        </div>

        <Field label="Próxima ação" hint="Ex: ligar amanhã às 10h">
          <Input value={form.proximaAcao} onChange={(e) => setF('proximaAcao', e.target.value)} />
        </Field>
        <Field label="Observações">
          <Textarea
            value={form.observacoes}
            onChange={(e) => setF('observacoes', e.target.value)}
            rows={3}
          />
        </Field>

        {error && (
          <div className="px-3 py-2 rounded-md bg-danger/10 border border-danger/30 text-danger text-sm flex items-start gap-2">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            {error}
          </div>
        )}
      </form>
    </Dialog>
  );
}

// Tiny exports pra typescript não reclamar de unused
export type { Lead, LeadEtapa };
export { ArrowRight as _ArrowRight };
