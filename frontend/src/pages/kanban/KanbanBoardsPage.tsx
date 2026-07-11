import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckSquare, KanbanSquare, KeyRound, Plus, Users } from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';
import { getSession } from '@/lib/auth-store';
import { useApiQuery } from '@/hooks/useApiQuery';
import { useRole } from '@/hooks/usePermission';
import { useToast } from '@/components/toast';
import { PageLayout } from '@/components/PageLayout';
import { StateView } from '@/components/StateView';
import { Button, Dialog, Field, Input, Textarea, Tooltip } from '@/components/ui';
import { cn } from '@/lib/cn';
import { BOARD_CORES, type KBoardResumo } from './kanban-types';

/**
 * Home dos Quadros (estilo home do Trello): grade de cartões coloridos.
 * Regra dura: REPRESENTANTE pode criar no máximo 1 quadro — o backend
 * bloqueia; aqui o botão desabilita com tooltip explicando.
 */
export default function KanbanBoardsPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const role = useRole();
  const meuId = getSession()?.user.id;

  const { data: boards, loading, error, refetch } = useApiQuery<KBoardResumo[]>('/kanban/boards');

  const [dialogAberto, setDialogAberto] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [nome, setNome] = useState('');
  const [descricao, setDescricao] = useState('');
  const [corFundo, setCorFundo] = useState<string>(BOARD_CORES[0]);

  const repNoLimite = useMemo(
    () => role === 'REP' && (boards ?? []).some((b) => b.criadoPorId === meuId),
    [role, boards, meuId],
  );

  async function criarBoard() {
    if (!nome.trim()) {
      toast.error('Dê um nome ao quadro');
      return;
    }
    setSalvando(true);
    try {
      const criado = await api.post<KBoardResumo>('/kanban/boards', {
        nome: nome.trim(),
        descricao: descricao.trim() || undefined,
        corFundo,
      });
      setDialogAberto(false);
      setNome('');
      setDescricao('');
      toast.success('Quadro criado');
      navigate(`/kanban/${criado.id}`);
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setSalvando(false);
    }
  }

  const botaoCriar = (
    <Button
      leftIcon={<Plus className="h-4 w-4" />}
      onClick={() => setDialogAberto(true)}
      disabled={repNoLimite}
      data-testid="kanban-criar-quadro"
    >
      Criar quadro
    </Button>
  );

  return (
    <PageLayout
      title="Quadros"
      description="Acompanhe projetos em quadros estilo Trello — o Claude move os cards via MCP"
      actions={
        <div className="flex gap-2">
          <Button
            variant="ghost"
            leftIcon={<CheckSquare className="h-4 w-4" />}
            onClick={() => navigate('/kanban/meus-itens')}
            data-testid="kanban-ir-meus-itens"
          >
            Meus itens
          </Button>
          <Button
            variant="ghost"
            leftIcon={<KeyRound className="h-4 w-4" />}
            onClick={() => navigate('/kanban/tokens')}
            data-testid="kanban-ir-tokens"
          >
            Tokens de API
          </Button>
          {repNoLimite ? (
            <Tooltip content="Representante pode ter apenas 1 quadro. Arquive o atual para criar outro.">
              <span>{botaoCriar}</span>
            </Tooltip>
          ) : (
            botaoCriar
          )}
        </div>
      }
    >
      <StateView
        loading={loading}
        error={error}
        onRetry={refetch}
        empty={(boards ?? []).length === 0}
        emptyMessage="Nenhum quadro ainda. Crie o primeiro!"
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {(boards ?? []).map((board) => (
            <button
              key={board.id}
              type="button"
              onClick={() => navigate(`/kanban/${board.id}`)}
              data-testid={`kanban-board-${board.id}`}
              className={cn(
                'relative h-28 rounded-[10px] p-3 text-left text-white overflow-hidden',
                'transition-transform hover:scale-[1.02] focus-visible:outline focus-visible:outline-2',
              )}
              style={{
                // cor sempre presente como fallback (signed URL expira em 24h)
                backgroundColor: board.corFundo,
                ...(board.imagemFundoUrl
                  ? {
                      backgroundImage: `url(${board.imagemFundoUrl})`,
                      backgroundSize: 'cover',
                      backgroundPosition: 'center',
                    }
                  : {}),
              }}
            >
              {/* véu pra garantir contraste do texto em cores claras */}
              <div className="absolute inset-0 bg-black/25" aria-hidden />
              <div className="relative flex h-full flex-col justify-between">
                <div className="font-semibold text-sm leading-tight line-clamp-2 drop-shadow">
                  {board.nome}
                </div>
                <div className="flex items-center justify-between text-[11px] opacity-90">
                  <span className="flex items-center gap-1">
                    <KanbanSquare className="h-3.5 w-3.5" />
                    {board._count?.listas ?? 0} lista{(board._count?.listas ?? 0) === 1 ? '' : 's'}
                  </span>
                  <span className="flex items-center gap-1">
                    <Users className="h-3.5 w-3.5" />
                    {board.membros.length}
                  </span>
                </div>
              </div>
            </button>
          ))}
        </div>
      </StateView>

      <Dialog
        open={dialogAberto}
        onClose={() => setDialogAberto(false)}
        title="Criar quadro"
        footer={
          <>
            <Button variant="ghost" onClick={() => setDialogAberto(false)}>
              Cancelar
            </Button>
            <Button onClick={() => void criarBoard()} loading={salvando} data-testid="kanban-salvar-quadro">
              Criar
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <Field label="Nome" required>
            <Input
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              placeholder='Ex: "Correções Revisão de Código"'
              autoFocus
              data-testid="kanban-nome-quadro"
              onKeyDown={(e) => {
                if (e.key === 'Enter') void criarBoard();
              }}
            />
          </Field>
          <Field label="Descrição">
            <Textarea
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              rows={2}
              placeholder="Opcional"
            />
          </Field>
          <Field label="Cor de fundo">
            <div className="flex flex-wrap gap-2">
              {BOARD_CORES.map((cor) => (
                <button
                  key={cor}
                  type="button"
                  aria-label={`Cor ${cor}`}
                  onClick={() => setCorFundo(cor)}
                  className={cn(
                    'h-8 w-12 rounded-[6px] transition-transform',
                    corFundo === cor
                      ? 'ring-2 ring-offset-2 ring-[var(--color-primary,#201554)] scale-105'
                      : 'hover:scale-105',
                  )}
                  style={{ background: cor }}
                />
              ))}
            </div>
          </Field>
        </div>
      </Dialog>
    </PageLayout>
  );
}
