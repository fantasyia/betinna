import { useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useApiQuery } from '@/hooks/useApiQuery';
import { useToast } from '@/components/toast';
import { Button, Input } from '@/components/ui';

/**
 * WebhookTriggerConfig — config do gatilho "Webhook recebido". Cria/remove
 * webhooks e mostra a URL pública pra colar no sistema externo. Autocontido.
 */
export function WebhookTriggerConfig() {
  const toast = useToast();
  const { data: webhooks, refetch } = useApiQuery<
    Array<{ id: string; nome: string; token: string }>
  >('/orquestracao/webhooks');
  const [nome, setNome] = useState('');
  const [busy, setBusy] = useState(false);
  const apiBase = (import.meta.env.VITE_API_URL as string | undefined) ?? '';

  async function criar() {
    if (!nome.trim()) return;
    setBusy(true);
    try {
      await api.post('/orquestracao/webhooks', { nome: nome.trim() });
      setNome('');
      refetch();
    } catch (err) {
      toast.error('Falha ao criar webhook', err instanceof ApiError ? err.message : undefined);
    } finally {
      setBusy(false);
    }
  }
  async function remover(id: string) {
    try {
      await api.delete(`/orquestracao/webhooks/${id}`);
      refetch();
    } catch (err) {
      toast.error('Falha ao remover', err instanceof ApiError ? err.message : undefined);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-[11px] text-muted">
        Crie um webhook e cole a URL no sistema externo. Cada POST dispara este fluxo — o
        corpo do request vira <code className="text-text">{'{{custom.*}}'}</code>.
      </p>
      <div className="flex gap-1.5">
        <Input
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          placeholder="Nome do webhook"
        />
        <Button size="sm" loading={busy} disabled={!nome.trim()} onClick={() => void criar()}>
          Criar
        </Button>
      </div>
      {(webhooks ?? []).map((w) => {
        const url = `${apiBase}/webhooks/fluxo/${w.token}`;
        return (
          <div key={w.id} className="rounded-md border border-border p-2 text-[11px]">
            <div className="flex items-center justify-between">
              <span className="font-medium text-text">{w.nome}</span>
              <button
                type="button"
                onClick={() => void remover(w.id)}
                className="text-danger hover:underline"
              >
                remover
              </button>
            </div>
            <div className="flex items-center gap-1 mt-1">
              <code className="flex-1 truncate text-muted">{url}</code>
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard?.writeText(url);
                  toast.success('URL copiada');
                }}
                className="text-primary hover:underline shrink-0"
              >
                copiar
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
