import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Check, Copy, KeyRound, Plus, Trash2 } from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';
import { useApiQuery } from '@/hooks/useApiQuery';
import { useToast } from '@/components/toast';
import { PageLayout } from '@/components/PageLayout';
import { StateView } from '@/components/StateView';
import { Badge, Button, Card, Dialog, Field, IconButton, Input } from '@/components/ui';
import { useConfirm } from '@/hooks/useConfirm';

interface ApiToken {
  id: string;
  nome: string;
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
      const criado = await api.post<ApiToken & { token: string }>('/kanban/api-tokens', {
        nome: nome.trim(),
      });
      setNovoToken(criado.token);
      setNome('');
      refetch();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setSalvando(false);
    }
  }

  async function copiar() {
    if (!novoToken) return;
    await navigator.clipboard.writeText(novoToken);
    setCopiado(true);
    toast.success('Token copiado');
    setTimeout(() => setCopiado(false), 2000);
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
                  <div className="text-sm font-medium text-text truncate">{t.nome}</div>
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
        )}
      </Dialog>
      {confirmDialog}
    </PageLayout>
  );
}
