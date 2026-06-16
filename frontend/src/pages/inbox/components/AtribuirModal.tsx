import { useState } from 'react';
import { Search, Filter } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useApiQuery, type PaginatedResponse } from '@/hooks/useApiQuery';
import { useToast } from '@/components/toast';
import { Avatar, Badge, Dialog, Input } from '@/components/ui';
import { cn } from '@/lib/cn';
import type { UsuarioMinimo } from '../lib/types';

export function AtribuirModal({
  conversaId,
  atribuidoAtual,
  onClose,
  onDone,
}: {
  conversaId: string;
  atribuidoAtual: { id: string; nome: string } | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const { data: usersResp } = useApiQuery<PaginatedResponse<UsuarioMinimo>>(
    '/users?limit=100&status=ATIVO',
  );
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState('');

  async function atribuir(userId: string | null) {
    setBusy(true);
    try {
      await api.patch(`/inbox/${conversaId}/atribuir`, { atribuidoId: userId });
      toast.success(userId ? 'Conversa atribuída' : 'Atribuição removida');
      onDone();
    } catch (err) {
      toast.error('Falha ao atribuir', err instanceof ApiError ? err.message : undefined);
    } finally {
      setBusy(false);
    }
  }

  const users = (usersResp?.data ?? []).filter((u) =>
    u.nome.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <Dialog open onClose={onClose} title="Atribuir conversa" size="sm">
      <div className="flex flex-col gap-3">
        <Input
          leftIcon={<Search />}
          placeholder="Buscar usuário…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="flex flex-col gap-1.5 max-h-[300px] overflow-y-auto">
          {atribuidoAtual && (
            <button
              type="button"
              data-testid="atribuir-ninguem"
              disabled={busy}
              onClick={() => atribuir(null)}
              className={cn(
                'flex items-center gap-3 px-3 py-2 rounded-md text-left',
                'bg-surface border border-border text-danger',
                'hover:bg-danger/10 hover:border-danger/30 transition-colors',
              )}
            >
              <Filter className="h-3.5 w-3.5" />
              Remover atribuição
            </button>
          )}
          {users.map((u) => {
            const isCurrent = u.id === atribuidoAtual?.id;
            return (
              <button
                key={u.id}
                type="button"
                data-testid={`atribuir-user-${u.id}`}
                disabled={busy || isCurrent}
                onClick={() => atribuir(u.id)}
                className={cn(
                  'flex items-center gap-3 px-3 py-2 rounded-md text-left',
                  'bg-surface border border-border',
                  'hover:bg-surface-hover hover:border-border-strong transition-colors',
                  isCurrent && 'opacity-60 cursor-not-allowed',
                )}
              >
                <Avatar name={u.nome} size="sm" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-text truncate">{u.nome}</div>
                  <div className="text-[11px] text-muted">{u.role}</div>
                </div>
                {isCurrent && <Badge variant="success" size="sm">Atual</Badge>}
              </button>
            );
          })}
          {users.length === 0 && (
            <p className="text-muted text-sm m-0 py-4 text-center">
              {usersResp ? 'Nenhum usuário encontrado.' : 'Carregando usuários…'}
            </p>
          )}
        </div>
      </div>
    </Dialog>
  );
}
