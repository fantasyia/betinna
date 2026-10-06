import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { formatNumero } from '@/lib/masks';
import { useApiQuery } from '@/hooks/useApiQuery';
import { useRole } from '@/hooks/usePermission';
import { PageLayout } from '@/components/PageLayout';
import { StateView } from '@/components/StateView';
import { Button, Card } from '@/components/ui';
import type { SaldoVariacao } from './grade';

/**
 * Reposição (ERP próprio · entrega 5): o que está abaixo do estoque mínimo,
 * por modelo, com o atalho de gerar a OP já com a grade do que falta.
 */

type Repor = SaldoVariacao & { minimo: number; repor: number };

/** Agrupa por modelo, mantendo a ordem de maior falta. PURO. */
export function porModelo(xs: Repor[]) {
  const m = new Map<string, { modelo: Repor['modelo']; itens: Repor[] }>();
  for (const x of xs) {
    const g = m.get(x.modelo.id) ?? { modelo: x.modelo, itens: [] };
    g.itens.push(x);
    m.set(x.modelo.id, g);
  }
  return [...m.values()];
}

export default function ReposicaoPage() {
  const role = useRole();
  const gestor = role === 'ADMIN' || role === 'DIRECTOR';
  const q = useApiQuery<Repor[]>(gestor ? '/erp/estoque/reposicao' : null);
  const navigate = useNavigate();

  return (
    <PageLayout
      title="Reposição"
      description="Variações abaixo do estoque mínimo. Defina o mínimo clicando na peça em Estoque."
      actions={
        <Link to="/estoque" className="inline-flex items-center gap-1 text-sm text-muted hover:text-text">
          <ArrowLeft className="h-4 w-4" /> Estoque
        </Link>
      }
    >
      {!gestor ? (
        <Card className="p-6 text-sm text-muted">Só a diretoria acessa o estoque.</Card>
      ) : (
        <StateView loading={q.loading} error={q.error} onRetry={q.refetch}>
          {(q.data ?? []).length === 0 ? (
            <Card className="p-6 text-sm text-muted text-center">
              Nada abaixo do mínimo. (Só aparece aqui o que tem estoque mínimo definido.)
            </Card>
          ) : (
            <div className="flex flex-col gap-3">
              {porModelo(q.data ?? []).map((g) => (
                <Card key={g.modelo.id} className="p-4 flex flex-col gap-2" data-testid={`repor-${g.modelo.id}`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-base font-semibold mr-auto">{g.modelo.nome}</h2>
                    <span className="text-sm text-muted">
                      {formatNumero(g.itens.reduce((s, i) => s + i.repor, 0))} peças pra repor
                    </span>
                    <Button
                      size="sm"
                      data-testid={`repor-op-${g.modelo.id}`}
                      onClick={() =>
                        navigate('/producao', {
                          state: {
                            nova: {
                              modeloId: g.modelo.id,
                              grade: Object.fromEntries(g.itens.map((i) => [i.produtoId, String(i.repor)])),
                            },
                          },
                        })
                      }
                    >
                      Gerar OP com o que falta
                    </Button>
                  </div>
                  <table className="w-full text-sm tabular-nums">
                    <thead className="text-[11px] uppercase tracking-wide text-muted">
                      <tr>
                        <th className="py-1 text-left font-semibold">Variação</th>
                        <th className="py-1 text-right font-semibold">Disponível</th>
                        <th className="py-1 text-right font-semibold">Mínimo</th>
                        <th className="py-1 text-right font-semibold">Repor</th>
                      </tr>
                    </thead>
                    <tbody>
                      {g.itens.map((i) => (
                        <tr key={i.produtoId} className="border-t border-border">
                          <td className="py-1.5">
                            <span className="inline-flex items-center gap-1.5">
                              <i className="inline-block h-3 w-3 shrink-0 rounded-full border border-border" style={{ background: i.cor.hex }} />
                              {i.cor.nome} · {i.linha.nome} {i.tamanho.nome}
                            </span>
                          </td>
                          <td className={`py-1.5 text-right ${i.disponivel < 0 ? 'text-danger' : ''}`}>{i.disponivel}</td>
                          <td className="py-1.5 text-right text-muted">{i.minimo}</td>
                          <td className="py-1.5 text-right font-semibold">{i.repor}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Card>
              ))}
            </div>
          )}
        </StateView>
      )}
    </PageLayout>
  );
}
