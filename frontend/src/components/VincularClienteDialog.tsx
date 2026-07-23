import { useState } from 'react';
import { Link2, Search } from 'lucide-react';
import { Button, Dialog, Input, Spinner } from '@/components/ui';
import { useApiQuery, type PaginatedResponse } from '@/hooks/useApiQuery';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useToast } from '@/components/toast';
import { api, apiErrorMessage } from '@/lib/api';
import { formatTelefone } from '@/lib/phone';

type ClienteLite = { id: string; nome: string; telefone: string | null; cidade: string | null };

/**
 * Liga um Lead a um Cliente existente. NÃO funde: o Cliente vira a cara do
 * contato, o Lead segue guardando a história de aquisição (campanha, etapas, IA).
 * É o desenho certo pro caso "esse lead ganhou e virou cliente" e pro cliente que
 * volta a ser lead numa recompra.
 */
export function VincularClienteDialog({
  leadId,
  onClose,
  onDone,
}: {
  leadId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const [busca, setBusca] = useState('');
  const buscaDeb = useDebouncedValue(busca, 300);
  const [busy, setBusy] = useState<string | null>(null);

  const qs = new URLSearchParams({ page: '1', limit: '8' });
  if (buscaDeb.trim()) qs.set('search', buscaDeb.trim());
  const { data, loading } = useApiQuery<PaginatedResponse<ClienteLite>>(
    `/clientes?${qs.toString()}`,
  );

  async function vincular(clienteId: string) {
    setBusy(clienteId);
    try {
      await api.post('/contatos/vincular-cliente', { leadId, clienteId });
      toast.success('Lead vinculado ao cliente');
      onDone();
    } catch (err) {
      toast.error('Falha ao vincular', apiErrorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="Vincular a um cliente"
      size="sm"
      footer={
        <Button variant="secondary" onClick={onClose}>
          Cancelar
        </Button>
      }
    >
      <p className="text-sm text-text-subtle mb-3">
        Ligue este lead ao cliente que é a mesma pessoa. Nada é apagado — o lead
        continua guardando a campanha e o histórico.
      </p>
      <Input
        leftIcon={<Search />}
        placeholder="Buscar cliente por nome, telefone…"
        value={busca}
        onChange={(e) => setBusca(e.target.value)}
        autoFocus
        data-testid="vincular-busca"
      />
      <div className="mt-3 flex flex-col gap-1.5">
        {loading && (
          <div className="flex items-center gap-2 py-3 text-sm text-muted">
            <Spinner /> Buscando…
          </div>
        )}
        {data && data.data.length === 0 && (
          <p className="py-3 text-sm text-muted">Nenhum cliente encontrado.</p>
        )}
        {data?.data.map((cli) => (
          <div
            key={cli.id}
            className="flex items-center justify-between gap-3 rounded-md bg-bg-alt px-3 py-2"
          >
            <div className="min-w-0">
              <div className="text-sm font-medium text-text truncate">{cli.nome}</div>
              <div className="text-xs text-muted truncate">
                {cli.telefone ? formatTelefone(cli.telefone) : (cli.cidade ?? '—')}
              </div>
            </div>
            <Button
              size="sm"
              variant="secondary"
              loading={busy === cli.id}
              leftIcon={<Link2 className="h-3.5 w-3.5" />}
              onClick={() => void vincular(cli.id)}
              data-testid="vincular-btn"
            >
              Vincular
            </Button>
          </div>
        ))}
      </div>
    </Dialog>
  );
}
