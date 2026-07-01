import { useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useApiQuery } from '@/hooks/useApiQuery';
import { useToast } from '@/components/toast';
import { Button, Input, Select, Field } from '@/components/ui';
import type { NodePayload } from '@/pages/fluxo/lib/types';

interface Webhook {
  id: string;
  nome: string;
  token: string;
}
interface Revelado {
  nome: string;
  url: string;
  secret: string;
}

/**
 * WebhookTriggerConfig — gatilho "Webhook recebido".
 * CRUD de webhooks (mostra URL + secret HMAC UMA vez, estilo Stripe) + config do
 * nó (qual webhook dispara + filtro opcional por campo do payload).
 */
export function WebhookTriggerConfig({
  data,
  onUpdate,
}: {
  data: NodePayload;
  onUpdate: (updater: (data: NodePayload) => NodePayload) => void;
}) {
  const toast = useToast();
  const { data: webhooks, refetch } = useApiQuery<Webhook[]>('/orquestracao/webhooks');
  const [nome, setNome] = useState('');
  const [busy, setBusy] = useState(false);
  const [revelado, setRevelado] = useState<Revelado | null>(null);
  const apiBase = (import.meta.env.VITE_API_URL as string | undefined) ?? '';

  const cfg = data.config as {
    webhookId?: string;
    filtroPayload?: { caminho?: string; operador?: string; valor?: string };
  };
  const filtro = cfg.filtroPayload ?? {};

  async function criar() {
    if (!nome.trim()) return;
    setBusy(true);
    try {
      const r = await api.post<Webhook & { secret: string }>('/orquestracao/webhooks', {
        nome: nome.trim(),
      });
      setRevelado({ nome: r.nome, url: `${apiBase}/webhooks/fluxo/${r.token}`, secret: r.secret });
      setNome('');
      refetch();
    } catch (err) {
      toast.error('Falha ao criar webhook', err instanceof ApiError ? err.message : undefined);
    } finally {
      setBusy(false);
    }
  }

  async function rotacionar(w: Webhook) {
    try {
      const r = await api.post<{ secret: string }>(
        `/orquestracao/webhooks/${w.id}/rotacionar-secret`,
      );
      setRevelado({ nome: w.nome, url: `${apiBase}/webhooks/fluxo/${w.token}`, secret: r.secret });
      toast.success('Novo secret gerado');
    } catch (err) {
      toast.error('Falha ao rotacionar', err instanceof ApiError ? err.message : undefined);
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

  function setFiltro(patch: Partial<{ caminho: string; operador: string; valor: string }>) {
    onUpdate((d) => {
      const atual = (d.config.filtroPayload as Record<string, string> | undefined) ?? {};
      const novo = { ...atual, ...patch };
      // Sem caminho = sem filtro (não grava objeto vazio).
      const limpo = novo.caminho?.trim()
        ? { caminho: novo.caminho, operador: novo.operador ?? 'eq', valor: novo.valor ?? '' }
        : undefined;
      return { ...d, config: { ...d.config, filtroPayload: limpo } };
    });
  }

  function copiar(txt: string, msg: string) {
    void navigator.clipboard?.writeText(txt);
    toast.success(msg);
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[11px] text-muted">
        Cada POST na URL do webhook dispara este fluxo. Autenticação por{' '}
        <strong>HMAC-SHA256</strong> — o corpo vira{' '}
        <code className="text-text">{'{{payload.*}}'}</code> nas ações.
      </p>

      {/* Reveal do secret — mostrado UMA vez após criar/rotacionar. */}
      {revelado && (
        <div className="rounded-md border border-warning bg-warning/10 p-2 text-[11px] flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-text">Secret de “{revelado.nome}”</span>
            <button
              type="button"
              onClick={() => setRevelado(null)}
              className="text-muted hover:underline"
            >
              já guardei
            </button>
          </div>
          <p className="text-warning-strong">
            Copie agora — o secret <strong>não será mostrado de novo</strong>.
          </p>
          <div className="flex items-center gap-1">
            <code className="flex-1 truncate text-text">{revelado.secret}</code>
            <button
              type="button"
              onClick={() => copiar(revelado.secret, 'Secret copiado')}
              className="text-primary hover:underline shrink-0"
            >
              copiar
            </button>
          </div>
          <p className="text-muted">
            Header: <code className="text-text">x-betinna-webhook-signature</code> ={' '}
            <code className="text-text">HMAC_SHA256(corpo, secret)</code> em hex.
          </p>
        </div>
      )}

      {/* Criar novo webhook */}
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

      {/* Lista de webhooks */}
      {(webhooks ?? []).map((w) => {
        const url = `${apiBase}/webhooks/fluxo/${w.token}`;
        return (
          <div key={w.id} className="rounded-md border border-border p-2 text-[11px]">
            <div className="flex items-center justify-between">
              <span className="font-medium text-text">{w.nome}</span>
              <div className="flex gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => void rotacionar(w)}
                  className="text-primary hover:underline"
                >
                  rotacionar secret
                </button>
                <button
                  type="button"
                  onClick={() => void remover(w.id)}
                  className="text-danger hover:underline"
                >
                  remover
                </button>
              </div>
            </div>
            <div className="flex items-center gap-1 mt-1">
              <code className="flex-1 truncate text-muted">{url}</code>
              <button
                type="button"
                onClick={() => copiar(url, 'URL copiada')}
                className="text-primary hover:underline shrink-0"
              >
                copiar
              </button>
            </div>
          </div>
        );
      })}

      {/* Config do nó: qual webhook dispara + filtro de payload */}
      <Field label="Disparar por qual webhook" hint="Vazio = qualquer webhook da empresa">
        <Select
          size="sm"
          value={cfg.webhookId ?? ''}
          onChange={(e) =>
            onUpdate((d) => ({
              ...d,
              config: { ...d.config, webhookId: e.target.value || undefined },
            }))
          }
        >
          <option value="">Qualquer webhook</option>
          {(webhooks ?? []).map((w) => (
            <option key={w.id} value={w.id}>
              {w.nome}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="Filtro de payload (opcional)" hint="Ex: só dispara se evento = lead_gerado">
        <div className="flex gap-1.5">
          <Input
            value={filtro.caminho ?? ''}
            onChange={(e) => setFiltro({ caminho: e.target.value })}
            placeholder="campo (ex: evento)"
          />
          <Select
            size="sm"
            value={filtro.operador ?? 'eq'}
            disabled={!filtro.caminho?.trim()}
            onChange={(e) => setFiltro({ operador: e.target.value })}
          >
            <option value="eq">=</option>
            <option value="neq">≠</option>
            <option value="contains">contém</option>
          </Select>
          <Input
            value={filtro.valor ?? ''}
            disabled={!filtro.caminho?.trim()}
            onChange={(e) => setFiltro({ valor: e.target.value })}
            placeholder="valor"
          />
        </div>
      </Field>
    </div>
  );
}
