import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { formatMoeda } from '@/lib/masks';
import { useApiQuery } from '@/hooks/useApiQuery';
import { useRole } from '@/hooks/usePermission';
import { PageLayout } from '@/components/PageLayout';
import { StateView } from '@/components/StateView';
import { Card } from '@/components/ui';
import { ServicosAcabamento } from '@/pages/vitrine/FichaTecnica';

interface Faccao {
  id: string;
  nome: string;
  ativo: boolean;
  precos: Array<{ modeloId: string; modelo: string; precoPorPeca: number }>;
}

/**
 * Regras de produção (Léo, 20/10): o que entra no custo da peça, num lugar só
 * — corte por peça, frete da facção por OP, serviços de acabamento e o preço
 * de cada facção por produto. Só diretoria.
 */
export default function RegrasProducaoPage() {
  const role = useRole();
  const gestor = role === 'ADMIN' || role === 'DIRECTOR';
  const faccoes = useApiQuery<Faccao[]>(gestor ? '/erp/faccoes' : null);

  return (
    <PageLayout
      title="Regras de produção"
      description="O que entra no custo de cada peça: corte, frete da facção, acabamento e facção por produto."
      actions={
        <Link to="/producao" className="inline-flex items-center gap-1 text-sm text-muted hover:text-text">
          <ArrowLeft className="h-4 w-4" /> Produção
        </Link>
      }
    >
      {!gestor ? (
        <Card className="p-6 text-sm text-muted">Só a diretoria acessa as regras de produção.</Card>
      ) : (
        <div className="flex max-w-3xl flex-col gap-4">
          <ServicosAcabamento />
          <Card className="p-4 flex flex-col gap-2" data-testid="regras-faccoes">
            <div className="flex flex-wrap items-baseline gap-2">
              <h3 className="text-sm font-semibold mr-auto">Facção por produto (R$ por peça)</h3>
              <Link to="/faccoes" className="text-xs text-primary hover:underline">
                Editar facções
              </Link>
            </div>
            <StateView loading={faccoes.loading} error={faccoes.error} onRetry={faccoes.refetch}>
              {(faccoes.data ?? []).length === 0 ? (
                <p className="text-sm text-muted">Nenhuma facção cadastrada.</p>
              ) : (
                <table className="w-full text-sm tabular-nums">
                  <thead className="text-[11px] uppercase tracking-wide text-muted">
                    <tr>
                      <th className="py-1 text-left font-semibold">Facção</th>
                      <th className="py-1 text-left font-semibold">Produto</th>
                      <th className="py-1 text-right font-semibold">R$/peça</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(faccoes.data ?? []).flatMap((f) =>
                      f.precos.map((p) => (
                        <tr key={`${f.id}|${p.modeloId}`} className="border-t border-border">
                          <td className="py-1">
                            {f.nome}
                            {!f.ativo && <span className="ml-1 text-xs text-muted">(inativa)</span>}
                          </td>
                          <td className="py-1">{p.modelo}</td>
                          <td className="py-1 text-right">{formatMoeda(p.precoPorPeca)}</td>
                        </tr>
                      )),
                    )}
                  </tbody>
                </table>
              )}
            </StateView>
          </Card>
        </div>
      )}
    </PageLayout>
  );
}
