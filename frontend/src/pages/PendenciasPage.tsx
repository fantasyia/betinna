import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, apiErrorMessage } from '@/lib/api';
import { useApiQuery } from '@/hooks/useApiQuery';
import { PageLayout } from '@/components/PageLayout';
import { StateView } from '@/components/StateView';
import { Button } from '@/components/ui';
import { useToast } from '@/components/toast';
import { AtivarPush } from '@/components/AtivarPush';

/**
 * Pendências dos marketplaces (Léo, 24/10; card cmvly8hf1). O que espera a
 * LOJA, de todos os marketplaces conectados: perguntas e mensagens sem
 * resposta, reclamações e devoluções. A rotina confere de hora em hora e avisa
 * por push; aqui é onde se vê e se trata.
 */
interface Pendencia {
  id: string;
  canal: string;
  tipo: 'PERGUNTA' | 'MENSAGEM' | 'RECLAMACAO' | 'DEVOLUCAO';
  chave: string;
  titulo: string;
  detalhe: string | null;
  link: string | null;
  desde: string | null;
  prazo: string | null;
}

const CANAL: Record<string, string> = {
  MARKETPLACE_ML: 'Mercado Livre',
  MARKETPLACE_SHOPEE: 'Shopee',
  MARKETPLACE_SHEIN: 'Shein',
};

const GRUPOS: Array<{ titulo: string; tipos: Pendencia['tipo'][] }> = [
  { titulo: 'Perguntas e mensagens sem resposta', tipos: ['PERGUNTA', 'MENSAGEM'] },
  { titulo: 'Reclamações', tipos: ['RECLAMACAO'] },
  { titulo: 'Devoluções em andamento', tipos: ['DEVOLUCAO'] },
];

/** "há 3 h" / "vence em 18 h" — a cor sai do prazo. */
function tempo(p: Pendencia): { texto: string; cor: string } {
  const agora = Date.now();
  if (p.prazo) {
    const h = Math.round((new Date(p.prazo).getTime() - agora) / 3600_000);
    if (h < 0) return { texto: 'prazo vencido', cor: 'text-danger' };
    return {
      texto: h < 48 ? `vence em ${h} h` : `vence em ${Math.round(h / 24)} dias`,
      cor: h < 24 ? 'text-danger' : h < 48 ? 'text-warning' : 'text-muted',
    };
  }
  if (p.desde) {
    const h = Math.round((agora - new Date(p.desde).getTime()) / 3600_000);
    return {
      texto: h < 48 ? `esperando há ${h} h` : `esperando há ${Math.round(h / 24)} dias`,
      cor: h >= 24 ? 'text-warning' : 'text-muted',
    };
  }
  return { texto: '', cor: 'text-muted' };
}

export default function PendenciasPage() {
  const toast = useToast();
  const { data, loading, error, refetch } = useApiQuery<Pendencia[]>('/pendencias');
  const [conferindo, setConferindo] = useState(false);

  async function conferirAgora() {
    setConferindo(true);
    try {
      const r = await api.post<{ abertas: number }>('/pendencias/verificar', {});
      toast.success(`Conferido: ${r.abertas} pendência(s) aberta(s)`);
      refetch();
    } catch (err) {
      toast.error('Não deu pra conferir agora', apiErrorMessage(err));
    } finally {
      setConferindo(false);
    }
  }

  const lista = data ?? [];
  return (
    <PageLayout
      title="Pendências dos marketplaces"
      description="O que está esperando a loja no Mercado Livre e na Shopee. Confere sozinho de hora em hora e avisa no celular."
    >
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <Button
          variant="secondary"
          onClick={() => void conferirAgora()}
          loading={conferindo}
          data-testid="pendencias-conferir"
        >
          Conferir agora
        </Button>
        <AtivarPush />
      </div>
      <StateView loading={loading && !data} error={error} onRetry={refetch}>
        {lista.length === 0 ? (
          <p className="text-sm text-muted" data-testid="pendencias-vazio">
            Nada esperando a loja agora. ✅
          </p>
        ) : (
          GRUPOS.map((g) => {
            const itens = lista.filter((p) => g.tipos.includes(p.tipo));
            if (!itens.length) return null;
            return (
              <section key={g.titulo} className="mb-6" data-testid={`pendencias-${g.tipos[0]}`}>
                <h2 className="text-[15px] font-semibold text-text mb-2">
                  {g.titulo} <span className="text-muted font-normal">({itens.length})</span>
                </h2>
                <ul className="flex flex-col gap-2">
                  {itens.map((p) => {
                    const t = tempo(p);
                    return (
                      <li
                        key={p.id}
                        className="bg-surface border border-border rounded-[10px] px-4 py-3 flex flex-wrap gap-x-4 gap-y-1 items-baseline"
                      >
                        <span className="text-[11px] font-semibold uppercase tracking-wide text-primary">
                          {CANAL[p.canal] ?? p.canal}
                        </span>
                        <span className="text-sm font-medium text-text">{p.titulo}</span>
                        <span className={`text-xs ml-auto ${t.cor}`}>{t.texto}</span>
                        {p.detalhe && (
                          <span className="basis-full text-sm text-muted break-words">{p.detalhe}</span>
                        )}
                        {p.link && (
                          <Link to={p.link} className="text-xs text-primary hover:underline">
                            Abrir no app ›
                          </Link>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })
        )}
      </StateView>
    </PageLayout>
  );
}
