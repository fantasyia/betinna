import { useState } from 'react';
import { Check, Copy, Globe, KeyRound, Power, RefreshCcw } from 'lucide-react';
import { api, publicApiUrl } from '@/lib/api';
import { useApiQuery } from '@/hooks/useApiQuery';
import { useToast } from '@/components/toast';
import { Button, Card } from '@/components/ui';

/**
 * LeadCaptureCard — chave de API pra formulários do SITE criarem leads.
 *
 * Fica na página de Integrações. A chave (`blc_…`) aparece UMA vez ao
 * gerar/rotacionar; depois só o prefixo. Inclui snippet pronto de fetch pro
 * dev do site colar.
 */

interface CaptureStatus {
  configurada: boolean;
  ativo: boolean;
  prefixo: string | null;
  criadoEm: string | null;
  ultimoUsoEm: string | null;
}

export function LeadCaptureCard() {
  const toast = useToast();
  const { data, refetch } = useApiQuery<CaptureStatus>('/leads-capture/chave');
  const [busy, setBusy] = useState(false);
  /** Chave em claro — só existe em memória logo após gerar (mostrada 1x). */
  const [chaveNova, setChaveNova] = useState<string | null>(null);
  const [copiado, setCopiado] = useState<'chave' | 'snippet' | null>(null);

  const st = data ?? null;

  async function gerar() {
    setBusy(true);
    try {
      const r = await api.post<{ chave: string }>('/leads-capture/chave/gerar', {});
      setChaveNova(r.chave);
      toast.success(st?.configurada ? 'Chave rotacionada' : 'Chave gerada');
      refetch();
    } catch {
      toast.error('Falha ao gerar chave');
    } finally {
      setBusy(false);
    }
  }

  async function desativar() {
    setBusy(true);
    try {
      await api.post('/leads-capture/chave/desativar', {});
      setChaveNova(null);
      toast.success('Chave desativada — formulários param de criar leads');
      refetch();
    } catch {
      toast.error('Falha ao desativar');
    } finally {
      setBusy(false);
    }
  }

  function copiar(texto: string, qual: 'chave' | 'snippet') {
    void navigator.clipboard?.writeText(texto).then(() => {
      setCopiado(qual);
      setTimeout(() => setCopiado(null), 1600);
    });
  }

  const url = publicApiUrl('/public/leads');
  const snippet = `fetch('${url}', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-api-key': '${chaveNova ?? 'SUA_CHAVE_AQUI'}',
  },
  body: JSON.stringify({
    nome: form.nome,          // obrigatório
    telefone: form.telefone,  // telefone OU email — pelo menos um
    email: form.email,
    mensagem: form.mensagem,  // opcional → observações do lead
    origem: 'site-institucional', // opcional (identifica a página)
    // funilId / funilEtapaId opcionais — sem eles cai no funil padrão
  }),
});`;

  return (
    <Card padding="md" data-testid="lead-capture-card">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2.5">
          <div className="h-9 w-9 rounded-md bg-primary/10 text-primary flex items-center justify-center">
            <Globe className="h-4.5 w-4.5" />
          </div>
          <div>
            <h3 className="m-0 text-[15px] font-semibold">Captura de leads do site</h3>
            <p className="m-0 text-xs text-muted">
              Formulários do seu site criam leads direto num funil (API pública com chave).
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {st?.configurada && st.ativo && (
            <Button
              variant="secondary"
              size="sm"
              disabled={busy}
              onClick={() => void desativar()}
              leftIcon={<Power className="h-3.5 w-3.5" />}
              data-testid="leadcap-desativar"
            >
              Desativar
            </Button>
          )}
          <Button
            size="sm"
            disabled={busy}
            onClick={() => void gerar()}
            leftIcon={
              st?.configurada ? (
                <RefreshCcw className="h-3.5 w-3.5" />
              ) : (
                <KeyRound className="h-3.5 w-3.5" />
              )
            }
            data-testid="leadcap-gerar"
          >
            {st?.configurada ? 'Rotacionar chave' : 'Gerar chave'}
          </Button>
        </div>
      </div>

      {/* Status atual */}
      {st?.configurada && !chaveNova && (
        <p className="text-xs text-muted mt-3 mb-0">
          Chave <code className="text-text">{st.prefixo}</code>{' '}
          {st.ativo ? '· ativa' : '· DESATIVADA'}
          {st.ultimoUsoEm
            ? ` · último uso ${new Date(st.ultimoUsoEm).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}`
            : ' · nunca usada'}
        </p>
      )}

      {/* Chave nova — mostrada UMA vez */}
      {chaveNova && (
        <div className="mt-3 px-3 py-2 rounded-md bg-warning/10 border border-warning/30">
          <p className="m-0 text-xs font-semibold text-warning">
            Copie agora — a chave não aparece de novo:
          </p>
          <div className="flex items-center gap-2 mt-1">
            <code
              data-testid="leadcap-chave"
              className="text-[12px] break-all text-text bg-surface px-2 py-1 rounded border border-border flex-1"
            >
              {chaveNova}
            </code>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => copiar(chaveNova, 'chave')}
              leftIcon={
                copiado === 'chave' ? (
                  <Check className="h-3.5 w-3.5 text-success" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )
              }
            >
              {copiado === 'chave' ? 'Copiado' : 'Copiar'}
            </Button>
          </div>
        </div>
      )}

      {/* Snippet pro site */}
      {(st?.configurada || chaveNova) && (
        <details className="mt-3">
          <summary className="text-xs font-medium text-primary cursor-pointer select-none">
            Como usar no site (exemplo de código)
          </summary>
          <div className="relative mt-2">
            <pre className="m-0 text-[11px] leading-relaxed bg-bg-alt border border-border rounded-md p-3 overflow-x-auto">
              {snippet}
            </pre>
            <Button
              variant="secondary"
              size="sm"
              className="absolute top-2 right-2"
              onClick={() => copiar(snippet, 'snippet')}
              leftIcon={
                copiado === 'snippet' ? (
                  <Check className="h-3.5 w-3.5 text-success" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )
              }
            >
              {copiado === 'snippet' ? 'Copiado' : 'Copiar'}
            </Button>
          </div>
          <p className="text-[11px] text-muted mt-1.5 mb-0">
            Envio duplicado (mesmo telefone/e-mail com lead aberto) NÃO cria outro lead — a API
            devolve o existente com <code>duplicado: true</code>. Limite: 60 envios/min.
          </p>
        </details>
      )}
    </Card>
  );
}
