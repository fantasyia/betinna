import { useState } from 'react';
import { AlertTriangle, CheckCircle2, Mail, Send, XCircle } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useApiQuery } from '@/hooks/useApiQuery';
import { useRole } from '@/hooks/usePermission';
import { useToast } from '@/components/toast';
import { Button, Card } from '@/components/ui';

/**
 * EmailTransacionalCard — gestão pela UI do e-mail transacional (Resend).
 *
 * O Resend é SISTÊMICO (configurado por env RESEND_API_KEY/RESEND_FROM_EMAIL),
 * então aqui não há "conectar" — mostra se está configurado, o remetente
 * (mascarado) e o semáforo de saúde, e permite disparar um e-mail de TESTE pro
 * próprio usuário (DIRECTOR/ADMIN) pra validar o envio na hora.
 */

interface EmailStatus {
  configurado: boolean;
  fromEmail: string | null;
  fromName: string;
  status: string; // ATIVA | DEGRADADA | CAIDA | DESCONECTADA
  ultimoErro: string | null;
  ultimoErroEm: string | null;
}

export function EmailTransacionalCard() {
  const toast = useToast();
  const role = useRole();
  const podeTestar = role === 'DIRECTOR' || role === 'ADMIN';
  const { data, refetch } = useApiQuery<EmailStatus>('/integracoes/email/status');
  const [testando, setTestando] = useState(false);

  const st = data ?? null;

  async function testar() {
    setTestando(true);
    try {
      const r = await api.post<{ ok: boolean; para: string }>('/integracoes/email/teste', {});
      toast.success('E-mail de teste enviado', `Confira a caixa de ${r.para}.`);
      refetch();
    } catch (err) {
      toast.error('Falha no envio de teste', err instanceof ApiError ? err.message : undefined);
      refetch();
    } finally {
      setTestando(false);
    }
  }

  const saudavel = st?.status === 'ATIVA' || st?.status === 'DEGRADADA';

  return (
    <Card padding="md" data-testid="email-transacional-card">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2.5">
          <div className="h-9 w-9 rounded-md bg-primary/10 text-primary flex items-center justify-center">
            <Mail className="h-4.5 w-4.5" />
          </div>
          <div>
            <h3 className="m-0 text-[15px] font-semibold">E-mail transacional</h3>
            <p className="m-0 text-xs text-muted">
              Convites, alertas e notificações por e-mail (via Resend).
            </p>
          </div>
        </div>
        {st &&
          (st.configurado && saudavel ? (
            <span
              className="inline-flex items-center gap-1 rounded-full bg-success/15 text-success text-[11px] font-semibold px-2 py-0.5"
              data-testid="email-status-badge"
            >
              <CheckCircle2 className="h-3 w-3" /> Ativo
            </span>
          ) : (
            <span
              className="inline-flex items-center gap-1 rounded-full bg-danger/15 text-danger text-[11px] font-semibold px-2 py-0.5"
              data-testid="email-status-badge"
            >
              <XCircle className="h-3 w-3" /> {st.configurado ? 'Com falha' : 'Não configurado'}
            </span>
          ))}
      </div>

      <div className="mt-3 flex flex-col gap-1.5 text-[13px]">
        {st?.configurado ? (
          <div className="flex items-center gap-2">
            <span className="text-muted">Remetente:</span>
            <span className="tabular text-text">
              {st.fromName} &lt;{st.fromEmail ?? '—'}&gt;
            </span>
          </div>
        ) : (
          <p className="m-0 text-xs text-muted">
            Defina <code>RESEND_API_KEY</code> e <code>RESEND_FROM_EMAIL</code> no ambiente
            (Railway) pra ativar o envio de e-mails.
          </p>
        )}

        {st?.ultimoErro && (
          <div className="flex items-start gap-1.5 text-[12px] text-danger mt-1">
            <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <span>Último erro: {st.ultimoErro}</span>
          </div>
        )}
      </div>

      {podeTestar && st?.configurado && (
        <div className="mt-3">
          <Button
            size="sm"
            variant="secondary"
            loading={testando}
            onClick={() => void testar()}
            leftIcon={<Send className="h-3.5 w-3.5" />}
            data-testid="email-testar-btn"
          >
            Enviar e-mail de teste
          </Button>
          <p className="m-0 mt-1.5 text-[11px] text-muted">
            Envia uma mensagem de teste pro seu próprio e-mail pra confirmar que está funcionando.
          </p>
        </div>
      )}
    </Card>
  );
}
