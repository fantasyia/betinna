import { useState } from 'react';
import { api, apiErrorMessage } from '@/lib/api';
import { useApiQuery } from '@/hooks/useApiQuery';
import { PageLayout } from '@/components/PageLayout';
import { CatalogoTabs } from '@/components/CatalogoTabs';
import { StateView } from '@/components/StateView';
import { Button } from '@/components/ui';
import { useToast } from '@/components/toast';

/**
 * Avaliações da Shopee na vitrine (Léo, 23–25/10; card cmvleo3tv). A rotina
 * traz 1x por dia as de 5 estrelas com foto, das cores do site, com texto sem
 * marketplace; a IA olha a foto (embalagem/logo = fora). Aqui o Léo revisa:
 * só APROVADA aparece no site, e a decisão dele vale sobre a da IA.
 */
type Status = 'APROVADA' | 'RECUSADA' | 'PENDENTE';
interface Avaliacao {
  id: string;
  modelo: string;
  estrelas: number;
  texto: string;
  cores: string[];
  fotos: string[];
  status: Status;
  motivo: string | null;
  revisada: boolean;
  criadoEm: string;
}

const ABAS: Array<[Status, string]> = [
  ['APROVADA', 'No site'],
  ['RECUSADA', 'Recusadas'],
  ['PENDENTE', 'Pendentes'],
];

export default function AvaliacoesPage() {
  const toast = useToast();
  const [status, setStatus] = useState<Status>('APROVADA');
  const [importando, setImportando] = useState(false);
  const { data, loading, error, refetch } = useApiQuery<{
    data: Avaliacao[];
    contagem: Partial<Record<Status, number>>;
  }>(`/vitrine/admin/avaliacoes?status=${status}`);

  async function decidir(id: string, novo: 'APROVADA' | 'RECUSADA') {
    try {
      await api.patch(`/vitrine/admin/avaliacoes/${id}`, { status: novo });
      refetch();
    } catch (err) {
      toast.error('Não deu pra salvar', apiErrorMessage(err));
    }
  }

  async function importar() {
    setImportando(true);
    try {
      const r = await api.post<{ novas: number; aprovadas: number }>('/vitrine/admin/avaliacoes/importar', {});
      toast.success(`${r.novas} nova(s), ${r.aprovadas} aprovada(s) pela IA`);
      refetch();
    } catch (err) {
      toast.error('Não deu pra buscar agora', apiErrorMessage(err));
    } finally {
      setImportando(false);
    }
  }

  return (
    <PageLayout
      title="Avaliações na vitrine"
      description="Avaliações de 5 estrelas com foto, das cores do site. A IA tira as que mostram embalagem ou marketplace; você decide o que fica."
      actions={
        <Button variant="secondary" onClick={() => void importar()} loading={importando} data-testid="avaliacoes-importar">
          Buscar agora
        </Button>
      }
    >
      <CatalogoTabs />
      <div className="flex flex-wrap gap-2 mb-4">
        {ABAS.map(([s, rot]) => (
          <Button
            key={s}
            size="sm"
            variant={status === s ? 'primary' : 'ghost'}
            onClick={() => setStatus(s)}
            data-testid={`avaliacoes-aba-${s}`}
          >
            {rot}
            {data?.contagem[s] !== undefined && <span className="ml-1 opacity-70">({data.contagem[s]})</span>}
          </Button>
        ))}
      </div>
      <StateView loading={loading && !data} error={error} onRetry={refetch}>
        {(data?.data ?? []).length === 0 ? (
          <p className="text-sm text-muted">Nenhuma avaliação aqui.</p>
        ) : (
          <ul className="grid gap-3 md:grid-cols-2" data-testid="avaliacoes-lista">
            {data!.data.map((a) => (
              <li key={a.id} className="bg-surface border border-border rounded-[10px] p-4 flex flex-col gap-2">
                <div className="flex flex-wrap items-baseline gap-x-3 text-sm">
                  <b className="text-text">{a.modelo}</b>
                  <span className="text-warning">{'★'.repeat(a.estrelas)}</span>
                  {a.cores.length > 0 && <span className="text-muted text-xs">{a.cores.join(' + ')}</span>}
                </div>
                <p className="text-sm text-text">{a.texto}</p>
                <div className="flex gap-2 overflow-x-auto">
                  {a.fotos.map((f) => (
                    <a key={f} href={f} target="_blank" rel="noreferrer">
                      <img src={f} alt="" className="w-24 h-32 object-cover rounded-[10px]" loading="lazy" />
                    </a>
                  ))}
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                  {a.motivo && <span>{a.revisada ? 'Você' : 'IA'}: {a.motivo}</span>}
                  <span className="ml-auto flex gap-2">
                    {a.status !== 'APROVADA' && (
                      <Button size="sm" onClick={() => void decidir(a.id, 'APROVADA')} data-testid={`avaliacao-aprovar-${a.id}`}>
                        Pôr no site
                      </Button>
                    )}
                    {a.status !== 'RECUSADA' && (
                      <Button size="sm" variant="ghost" onClick={() => void decidir(a.id, 'RECUSADA')} data-testid={`avaliacao-recusar-${a.id}`}>
                        Tirar do site
                      </Button>
                    )}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </StateView>
    </PageLayout>
  );
}
