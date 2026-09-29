import { useEffect, useState } from 'react';
import { api, apiErrorMessage } from '@/lib/api';
import { useApiQuery } from '@/hooks/useApiQuery';
import { Button, Dialog } from '@/components/ui';

/**
 * Meta — duas peças da tela de Integrações (card 📣, 29/09):
 *  - `EscolherPaginaMeta`: quando a conta do login administra mais de uma
 *    Página, o backend NÃO conecta nenhuma e guarda a lista; aqui o admin escolhe.
 *  - `AssinaturaPaginaMeta`: se a Página está assinada no app com `leadgen`
 *    (sem isso o Lead Ads não chega), com botão pra tentar de novo.
 */

interface PaginaPendente {
  id: string;
  name: string;
}

export function EscolherPaginaMeta({ onConectada }: { onConectada: () => void }) {
  const { data, refetch } = useApiQuery<PaginaPendente[]>('/integracoes/meta/paginas-pendentes');
  const [salvando, setSalvando] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [fechado, setFechado] = useState(false);

  // O popup do login avisa quando fecha; a janela também recarrega ao voltar o foco.
  useEffect(() => {
    const aoMsg = (e: MessageEvent) => {
      if ((e.data as { type?: string } | null)?.type === 'meta-oauth') {
        setFechado(false);
        refetch();
      }
    };
    const aoFoco = () => refetch();
    window.addEventListener('message', aoMsg);
    window.addEventListener('focus', aoFoco);
    return () => {
      window.removeEventListener('message', aoMsg);
      window.removeEventListener('focus', aoFoco);
    };
  }, [refetch]);

  const paginas = data ?? [];
  if (!paginas.length || fechado) return null;

  const escolher = async (pageId: string) => {
    setSalvando(pageId);
    setErro(null);
    try {
      await api.post('/integracoes/meta/escolher-pagina', { pageId });
      refetch();
      onConectada();
    } catch (err) {
      setErro(apiErrorMessage(err));
    } finally {
      setSalvando(null);
    }
  };

  return (
    <Dialog open onClose={() => setFechado(true)} title="Qual Página conectar?">
      <p className="mt-0 text-[14px]">
        Sua conta da Meta administra {paginas.length} Páginas. Escolha a que esta empresa usa —
        mensagens do Messenger/Instagram e os formulários do Lead Ads virão dela.
      </p>
      <ul className="m-0 p-0 list-none flex flex-col gap-2" data-testid="meta-paginas">
        {paginas.map((p) => (
          <li key={p.id}>
            <Button
              variant="secondary"
              fullWidth
              data-testid={`meta-pagina-${p.id}`}
              disabled={salvando !== null}
              onClick={() => void escolher(p.id)}
            >
              {salvando === p.id ? 'Conectando…' : p.name}
            </Button>
          </li>
        ))}
      </ul>
      {erro && <p className="text-[12px] text-danger mt-2">{erro}</p>}
    </Dialog>
  );
}

interface Assinatura {
  leadgen: boolean;
  campos: string[];
  em: string;
  erro?: string;
  pageName: string;
}

export function AssinaturaPaginaMeta() {
  const { data, loading, refetch } = useApiQuery<Assinatura | null>(
    '/integracoes/meta/assinatura',
  );
  const [refazendo, setRefazendo] = useState(false);
  if (loading || !data) return null;

  const refazer = async () => {
    setRefazendo(true);
    try {
      await api.post('/integracoes/meta/assinatura/refazer');
    } finally {
      setRefazendo(false);
      refetch();
    }
  };

  return (
    <div className="text-[11px]" data-testid="meta-assinatura">
      {data.leadgen ? (
        <span className="text-success">✓ Lead Ads ativo na Página {data.pageName}</span>
      ) : (
        <span className="text-danger">
          ✗ Página {data.pageName} sem Lead Ads{data.erro ? ` — ${data.erro}` : ''}
        </span>
      )}
      {!data.leadgen && (
        <button
          type="button"
          className="ml-2 text-primary underline cursor-pointer"
          disabled={refazendo}
          onClick={() => void refazer()}
          data-testid="meta-assinatura-refazer"
        >
          {refazendo ? 'tentando…' : 'tentar de novo'}
        </button>
      )}
    </div>
  );
}
