import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Check, Copy, KeyRound, Plus, Trash2 } from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';
import { useApiQuery } from '@/hooks/useApiQuery';
import { useToast } from '@/components/toast';
import { PageLayout } from '@/components/PageLayout';
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
 * Tokens de API do Kanban (pro MCP server / Claude Code).
 * O VALOR do token aparece UMA única vez na criação — copie na hora.
 */
export default function KanbanTokensPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const [confirm, confirmDialog] = useConfirm();

  const { data: tokens, loading, error, refetch } = useApiQuery<ApiToken[]>('/kanban/api-tokens');

  const [dialogAberto, setDialogAberto] = useState(false);
  const [nome, setNome] = useState('');
  const [incluirFluxos, setIncluirFluxos] = useState(false);
  const [incluirFunis, setIncluirFunis] = useState(false);
  const [incluirContatos, setIncluirContatos] = useState(false);
  const [incluirCrm, setIncluirCrm] = useState(false);
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
      const escopo = ['kanban'];
      if (incluirFluxos) escopo.push('fluxos');
      if (incluirFunis) escopo.push('funis');
      if (incluirContatos) escopo.push('contatos');
      if (incluirCrm) escopo.push('crm');
      const criado = await api.post<ApiToken & { token: string }>('/kanban/api-tokens', {
        nome: nome.trim(),
        escopo,
      });
      setNovoToken(criado.token);
      setNome('');
      setIncluirFluxos(false);
      setIncluirFunis(false);
      setIncluirContatos(false);
      setIncluirCrm(false);
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
      title="Tokens de API — Quadros"
      description="Conectam o Claude Code (MCP) aos seus quadros. O token só acessa rotas do Kanban."
      actions={
        <div className="flex gap-2">
          <Button
            variant="ghost"
            leftIcon={<ArrowLeft className="h-4 w-4" />}
            onClick={() => navigate('/kanban')}
          >
            Quadros
          </Button>
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
                          {e === 'fluxos'
                            ? 'Fluxos'
                            : e === 'funis'
                              ? 'Funis'
                              : e === 'contatos'
                                ? 'Contatos'
                                : e === 'crm'
                                  ? 'CRM (escrita)'
                                  : 'Quadros'}
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
                <Checkbox
                  label="Fluxos de automação"
                  checked={incluirFluxos}
                  onChange={(e) => setIncluirFluxos(e.target.checked)}
                  data-testid="token-escopo-fluxos"
                />
                <Checkbox
                  label="Funis (somente leitura)"
                  checked={incluirFunis}
                  onChange={(e) => setIncluirFunis(e.target.checked)}
                  data-testid="token-escopo-funis"
                />
                <Checkbox
                  label="Contatos (somente leitura · dados pessoais)"
                  checked={incluirContatos}
                  onChange={(e) => setIncluirContatos(e.target.checked)}
                  data-testid="token-escopo-contatos"
                />
                <Checkbox
                  label="CRM — escrita (tags e mover etapa de lead)"
                  checked={incluirCrm}
                  onChange={(e) => setIncluirCrm(e.target.checked)}
                  data-testid="token-escopo-crm"
                />
              </div>
            </Field>
          </div>
        )}
      </Dialog>
      {confirmDialog}
    </PageLayout>
  );
}
