import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, Circle, X } from 'lucide-react';
import { useApiQuery } from '@/hooks/useApiQuery';
import { useRole } from '@/hooks/usePermission';
import { getSession } from '@/lib/auth-store';

/**
 * #26 — "Primeiros passos" do representante (checklist acionável no Dashboard).
 *
 * Complementa o tour guiado (OnboardingTour): em vez de só mostrar onde estão as
 * coisas, lista o que o rep precisa CONECTAR pra usar o sistema no dia a dia,
 * com status ao vivo (✓/○) e atalho. Some sozinho quando o essencial (WhatsApp +
 * OpenAI) está conectado, ou via "dispensar". Só aparece pra REP.
 */

interface Conexao {
  servico: string;
  ativo: boolean;
}

const dismissKey = (uid: string): string => `primeiros-passos:dismiss:${uid}`;

export function PrimeirosPassosRep() {
  const role = useRole();
  const userId = getSession()?.user?.id ?? '';
  const [dismissed, setDismissed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(dismissKey(userId)) === '1';
    } catch {
      return false;
    }
  });

  const enabled = role === 'REP' && !dismissed;
  const { data } = useApiQuery<Conexao[] | { data: Conexao[] }>(
    enabled ? '/usuario/integracoes' : null,
  );

  if (!enabled) return null;

  const conexoes: Conexao[] = Array.isArray(data) ? data : (data?.data ?? []);
  const ativo = (s: string): boolean => conexoes.some((c) => c.servico === s && c.ativo);

  const whatsappOk = ativo('whatsapp');
  const openaiOk = ativo('openai');
  const calendarOk = ativo('google_calendar');

  // Essencial conectado → não polui o Dashboard.
  if (whatsappOk && openaiOk) return null;

  const itens = [
    {
      key: 'whatsapp',
      done: whatsappOk,
      opcional: false,
      titulo: 'Conecte seu WhatsApp',
      desc: 'Pra suas conversas com clientes aparecerem no Inbox.',
    },
    {
      key: 'openai',
      done: openaiOk,
      opcional: false,
      titulo: 'Adicione sua chave OpenAI',
      desc: 'Pra usar o MullerBot e tirar dúvidas sobre os produtos.',
    },
    {
      key: 'calendar',
      done: calendarOk,
      opcional: true,
      titulo: 'Conecte o Google Calendar',
      desc: 'Opcional — sincroniza sua agenda de visitas.',
    },
  ];
  const feitos = itens.filter((i) => i.done).length;

  function dispensar(): void {
    try {
      localStorage.setItem(dismissKey(userId), '1');
    } catch {
      /* ignore */
    }
    setDismissed(true);
  }

  return (
    <div
      data-testid="primeiros-passos"
      className="rounded-lg border border-border bg-surface p-4 mb-4"
    >
      <div className="flex items-start justify-between gap-2 mb-3">
        <div>
          <h3 className="text-sm font-semibold text-text">🚀 Primeiros passos</h3>
          <p className="text-xs text-muted">
            Conecte suas ferramentas pra aproveitar tudo. {feitos}/{itens.length} concluídos.
          </p>
        </div>
        <button
          type="button"
          aria-label="Dispensar"
          onClick={dispensar}
          className="text-muted hover:text-text shrink-0"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <ul className="flex flex-col gap-2.5">
        {itens.map((i) => (
          <li key={i.key} className="flex items-center gap-3">
            {i.done ? (
              <Check className="h-5 w-5 text-success shrink-0" />
            ) : (
              <Circle className="h-5 w-5 text-muted shrink-0" />
            )}
            <div className="flex-1 min-w-0">
              <div className="text-sm text-text">
                {i.titulo}
                {i.opcional && <span className="text-muted"> (opcional)</span>}
              </div>
              <div className="text-xs text-muted">{i.desc}</div>
            </div>
            {!i.done && (
              <Link
                to="/minhas-integracoes"
                data-testid={`primeiros-passos-${i.key}`}
                className="text-xs font-semibold text-primary hover:underline shrink-0"
              >
                Conectar →
              </Link>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
