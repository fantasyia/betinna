import { useState } from 'react';
import {
  Check,
  Copy,
  KeyRound,
  Plus,
  SlidersHorizontal,
  Trash2,
} from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';
import { useApiQuery } from '@/hooks/useApiQuery';
import { useToast } from '@/components/toast';
import { PageLayout } from '@/components/PageLayout';
import { SistemaTabs } from '@/components/SistemaTabs';
import { StateView } from '@/components/StateView';
import { Badge, Button, Card, Checkbox, Dialog, Field, IconButton, Input } from '@/components/ui';
import { useConfirm } from '@/hooks/useConfirm';

interface ApiToken {
  id: string;
  nome: string;
  escopo: string[];
  ultimoUso: string | null;
  revogado: boolean;
  criadoEm: string;
}

/**
 * Escopos que um token pode ter, com o rótulo que aparece na tela.
 *
 * Lista única (em vez de um booleano por módulo) porque escopo novo entra quase
 * todo mês — com um estado por checkbox, cada novo módulo mexia em 6 lugares e
 * era fácil esquecer um.
 */
const ESCOPOS: Array<{ key: string; label: string; badge: string }> = [
  { key: 'fluxos', label: 'Fluxos de automação', badge: 'Fluxos' },
  { key: 'funis', label: 'Funis e etapas', badge: 'Funis' },
  { key: 'contatos', label: 'Contatos (somente leitura · dados pessoais)', badge: 'Contatos' },
  { key: 'crm', label: 'CRM — escrita (tags e mover etapa de lead)', badge: 'CRM (escrita)' },
  { key: 'prompts', label: 'Prompts da IA — escrita (criar/editar prompts do bot)', badge: 'Prompts (IA)' },
  { key: 'usuarios', label: 'Usuários (somente leitura · id/nome/email/papel)', badge: 'Usuários (leitura)' },
  {
    key: 'conhecimento',
    label: 'Base de conhecimento — escrita (documentos e trechos do RAG)',
    badge: 'Conhecimento',
  },
  { key: 'tags', label: 'Etiquetas de lead (ler e criar)', badge: 'Etiquetas' },
  {
    key: 'inbox',
    label: 'Inbox (somente leitura · CONVERSA DE CLIENTE)',
    badge: 'Inbox (leitura)',
  },
];

const rotuloEscopo = (key: string) =>
  ESCOPOS.find((e) => e.key === key)?.badge ?? (key === 'kanban' ? 'Quadros' : key);

/**
 * Tokens de API do Kanban (pro MCP server / Claude Code).
 * O VALOR do token aparece UMA única vez na criação — copie na hora.
 */
export default function TokensApiPage() {
  const toast = useToast();
  const [confirm, confirmDialog] = useConfirm();

  const { data: tokens, loading, error, refetch } = useApiQuery<ApiToken[]>('/kanban/api-tokens');

  const [dialogAberto, setDialogAberto] = useState(false);
  const [nome, setNome] = useState('');
  const [escopos, setEscopos] = useState<string[]>([]);
  /** Token cujo ACESSO está sendo editado (null = ninguém). */
  const [editandoEscopo, setEditandoEscopo] = useState<ApiToken | null>(null);
  const [salvando, setSalvando] = useState(false);
  /** Token recém-criado — única chance de copiar. */
  const [novoToken, setNovoToken] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);

  async function criar() {
    if (!nome.trim()) {
      toast.error('Dê um nome ao token (ex: "Claude Code - PC do Léo")');
      return;
    }
    setSalvando(true);
    try {
      // Kanban sempre incluso; demais módulos opcionais (PAT de plataforma).
      const escopo = ['kanban', ...escopos];
      const criado = await api.post<ApiToken & { token: string }>('/kanban/api-tokens', {
        nome: nome.trim(),
        escopo,
      });
      setNovoToken(criado.token);
      setNome('');
      setEscopos([]);
      refetch();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setSalvando(false);
    }
  }

  async function copiar() {
    if (!novoToken) return;
    try {
      await navigator.clipboard.writeText(novoToken);
      setCopiado(true);
      toast.success('Token copiado');
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      // contexto não-seguro ou permissão negada — não deixa rejeitar sem tratar
      toast.error('Não foi possível copiar. Selecione o token e copie manualmente.');
    }
  }

  /**
   * Salva o acesso de um token JÁ existente.
   *
   * Sem isto, escopo novo (ex: "conhecimento") obrigava a REGERAR o token — e
   * regerar significa reconfigurar o MCP em toda máquina que usa. O valor do
   * token não muda: só o que ele alcança.
   */
  async function salvarEscopo() {
    if (!editandoEscopo) return;
    setSalvando(true);
    try {
      await api.patch(`/kanban/api-tokens/${editandoEscopo.id}`, {
        escopo: ['kanban', ...escopos],
      });
      toast.success('Acesso do token atualizado', 'O valor do token continua o mesmo.');
      setEditandoEscopo(null);
      setEscopos([]);
      refetch();
    } catch (err) {
      toast.error('Falha ao atualizar', apiErrorMessage(err));
    } finally {
      setSalvando(false);
    }
  }

  async function revogar(token: ApiToken) {
    const ok = await confirm({
      title: 'Revogar token?',
      message: `"${token.nome}" vai parar de funcionar imediatamente (o MCP que o usa recebe 401).`,
      confirmLabel: 'Revogar',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      await api.delete(`/kanban/api-tokens/${token.id}`);
      toast.success('Token revogado');
      refetch();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    }
  }

  function fecharDialog() {
    setDialogAberto(false);
    setNovoToken(null);
  }

  return (
    <PageLayout
      title="Tokens de API (MCP)"
      description="Conectam o Claude Code aos dados desta empresa. Cada token só alcança os módulos que você marcar."
      actions={
        <div className="flex gap-2">
          <Button
            leftIcon={<Plus className="h-4 w-4" />}
            onClick={() => setDialogAberto(true)}
            data-testid="token-criar"
          >
            Gerar token
          </Button>
        </div>
      }
    >
      <SistemaTabs />
      <StateView
        loading={loading}
        error={error}
        onRetry={refetch}
        empty={(tokens ?? []).length === 0}
        emptyMessage="Nenhum token ainda. Gere um pra conectar o Claude Code."
      >
        <Card padding="none" className="overflow-hidden">
          <ul className="divide-y divide-border">
            {(tokens ?? []).map((t) => (
              <li key={t.id} className="flex items-center gap-3 px-4 py-3">
                <KeyRound className="h-4 w-4 text-muted shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-text truncate flex items-center gap-1.5">
                    {t.nome}
                    <span className="flex gap-1">
                      {(t.escopo ?? ['kanban']).map((e) => (
                        <Badge key={e} variant="neutral" size="sm">
                          {rotuloEscopo(e)}
                        </Badge>
                      ))}
                    </span>
                  </div>
                  <div className="text-[11px] text-muted">
                    criado em {new Date(t.criadoEm).toLocaleDateString('pt-BR')}
                    {' · '}
                    {t.ultimoUso
                      ? `último uso ${new Date(t.ultimoUso).toLocaleString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}`
                      : 'nunca usado'}
                  </div>
                </div>
                {t.revogado ? (
                  <Badge variant="danger">revogado</Badge>
                ) : (
                  <>
                    <Badge variant="success">ativo</Badge>
                    <IconButton
                      aria-label="Editar acesso do token"
                      title="Editar acesso (sem trocar o valor do token)"
                      variant="ghost"
                      icon={<SlidersHorizontal className="h-4 w-4" />}
                      onClick={() => {
                        setEditandoEscopo(t);
                        setEscopos((t.escopo ?? []).filter((e) => e !== 'kanban'));
                      }}
                      data-testid={`token-editar-${t.id}`}
                    />
                    <IconButton
                      aria-label="Revogar token"
                      variant="ghost"
                      icon={<Trash2 className="h-4 w-4" />}
                      onClick={() => void revogar(t)}
                      data-testid={`token-revogar-${t.id}`}
                    />
                  </>
                )}
              </li>
            ))}
          </ul>
        </Card>
      </StateView>

      <Dialog
        open={dialogAberto}
        onClose={fecharDialog}
        title={novoToken ? 'Token gerado — copie AGORA' : 'Gerar token de API'}
        footer={
          novoToken ? (
            <Button onClick={fecharDialog}>Concluir</Button>
          ) : (
            <>
              <Button variant="ghost" onClick={fecharDialog}>
                Cancelar
              </Button>
              <Button onClick={() => void criar()} loading={salvando} data-testid="token-salvar">
                Gerar
              </Button>
            </>
          )
        }
      >
        {novoToken ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-muted m-0">
              Este valor <strong className="text-text">não será mostrado de novo</strong>. Guarde num
              lugar seguro (env do MCP).
            </p>
            <div className="flex items-center gap-2">
              <code
                className="flex-1 text-xs bg-surface-elevated border border-border rounded-[8px] px-3 py-2 break-all select-all"
                data-testid="token-valor"
              >
                {novoToken}
              </code>
              <IconButton
                aria-label="Copiar token"
                icon={copiado ? <Check className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
                onClick={() => void copiar()}
                data-testid="token-copiar"
              />
            </div>
            <p className="text-xs text-muted m-0">
              Uso: <code>claude mcp add betinna-kanban --env BETINNA_API_TOKEN=&lt;token&gt; …</code>
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <Field label="Nome do token" required hint="Identifica onde ele é usado">
              <Input
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                placeholder='Ex: "Claude Code - PC do Léo"'
                autoFocus
                data-testid="token-nome"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void criar();
                }}
              />
            </Field>
            <Field label="Acesso do token" hint="Quadros vem sempre; marque os módulos extras que o token pode ler/operar">
              <div className="flex flex-col gap-1.5">
                <Checkbox label="Quadros (Kanban)" checked disabled />
                {ESCOPOS.map((e) => (
                  <Checkbox
                    key={e.key}
                    label={e.label}
                    checked={escopos.includes(e.key)}
                    onChange={(ev) =>
                      setEscopos((atual) =>
                        ev.target.checked
                          ? [...atual, e.key]
                          : atual.filter((k) => k !== e.key),
                      )
                    }
                    data-testid={`token-escopo-${e.key}`}
                  />
                ))}
              </div>
            </Field>
          </div>
        )}
      </Dialog>

      {/* Editar ACESSO de um token existente — sem trocar o valor. */}
      <Dialog
        open={editandoEscopo !== null}
        onClose={() => setEditandoEscopo(null)}
        title={`Acesso de "${editandoEscopo?.nome ?? ''}"`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditandoEscopo(null)}>
              Cancelar
            </Button>
            <Button
              onClick={() => void salvarEscopo()}
              loading={salvando}
              data-testid="token-escopo-salvar"
            >
              Salvar acesso
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <p className="text-xs text-muted m-0">
            O <strong>valor do token não muda</strong> — quem já está conectado continua
            funcionando, só passa a alcançar mais (ou menos) módulos.
          </p>
          <Field label="Acesso do token" hint="Quadros vem sempre">
            <div className="flex flex-col gap-1.5">
              <Checkbox label="Quadros (Kanban)" checked disabled />
              {ESCOPOS.map((e) => (
                <Checkbox
                  key={e.key}
                  label={e.label}
                  checked={escopos.includes(e.key)}
                  onChange={(ev) =>
                    setEscopos((atual) =>
                      ev.target.checked ? [...atual, e.key] : atual.filter((k) => k !== e.key),
                    )
                  }
                  data-testid={`token-editar-escopo-${e.key}`}
                />
              ))}
            </div>
          </Field>
        </div>
      </Dialog>
      {confirmDialog}
    </PageLayout>
  );
}
