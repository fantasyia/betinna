import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, apiErrorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatNumero } from '@/lib/masks';
import { useApiQuery } from '@/hooks/useApiQuery';
import { useRole } from '@/hooks/usePermission';
import { useToast } from '@/components/toast';
import { PageLayout } from '@/components/PageLayout';
import { StateView } from '@/components/StateView';
import { CatalogoTabs } from '@/components/CatalogoTabs';
import { Badge, Button, Card, Dialog, Field, Input, Select, Textarea } from '@/components/ui';
import { montarGrade, type Celula, type SaldoVariacao } from './grade';

/**
 * Estoque de peça pronta (ERP próprio · Fase 2 · entrega 1).
 *
 * Grade cor × tamanho por modelo e linha: o número grande é o DISPONÍVEL
 * (físico − reservado). Clicar numa célula abre o ajuste — que é um
 * movimento com motivo, nunca uma edição do saldo.
 */

interface Movimento {
  id: string;
  tipo: 'ENTRADA_PRODUCAO' | 'SAIDA_PEDIDO' | 'AJUSTE' | 'DEVOLUCAO';
  quantidade: number;
  motivo: string | null;
  documento: string | null;
  criadoEm: string;
  produto: { id: string; nome: string };
  pedido: { id: string; numero: string } | null;
}

const TIPO: Record<Movimento['tipo'], string> = {
  ENTRADA_PRODUCAO: 'Entrada de produção',
  SAIDA_PEDIDO: 'Saída por pedido',
  AJUSTE: 'Ajuste',
  DEVOLUCAO: 'Devolução',
};

export default function EstoquePage() {
  const role = useRole();
  const gestor = role === 'ADMIN' || role === 'DIRECTOR';
  const saldos = useApiQuery<SaldoVariacao[]>(gestor ? '/erp/estoque/saldos' : null);
  const [filtro, setFiltro] = useState<{ produtoId: string; nome: string } | null>(null);
  const movs = useApiQuery<Movimento[]>(
    gestor ? `/erp/estoque/movimentos?limite=100${filtro ? `&produtoId=${filtro.produtoId}` : ''}` : null,
  );
  const grade = useMemo(() => montarGrade(saldos.data ?? []), [saldos.data]);
  const [ajuste, setAjuste] = useState<{ celula: Celula; nome: string } | null>(null);

  return (
    <PageLayout
      title="Estoque"
      description="Peça pronta por cor e tamanho. O número grande é o que está disponível pra vender (físico − reservado)."
      actions={
        gestor ? (
          <div className="flex gap-2">
            <Link to="/estoque/reposicao">
              <Button variant="secondary" size="sm" data-testid="estoque-reposicao">
                Reposição
              </Button>
            </Link>
            <Link to="/estoque/inventario">
              <Button variant="secondary" size="sm" data-testid="estoque-inventario">
                Inventário
              </Button>
            </Link>
          </div>
        ) : undefined
      }
    >
      <CatalogoTabs />
      {!gestor ? (
        <Card className="p-6 text-sm text-muted">Só a diretoria acessa o estoque.</Card>
      ) : (
        <StateView loading={saldos.loading} error={saldos.error} onRetry={saldos.refetch}>
          <div className="flex flex-col gap-4">
            {grade.length === 0 && (
              <Card className="p-6 text-sm text-muted">
                Nenhum modelo com grade ainda. Cadastre cores, linhas e tamanhos na aba Vitrine.
              </Card>
            )}
            {grade.map((m) => (
              <Card key={m.id} className="p-4 flex flex-col gap-3">
                <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                  <h2 className="text-base font-semibold mr-auto">{m.nome}</h2>
                  <span className="text-xs text-muted tabular-nums">
                    físico {formatNumero(m.fisico)} · reservado {formatNumero(m.reservado)} ·{' '}
                    <b className={cn(m.disponivel < 0 ? 'text-danger' : 'text-text')}>
                      disponível {formatNumero(m.disponivel)}
                    </b>
                  </span>
                </div>
                {m.linhas.map((l) => (
                  <div key={l.linha} className="overflow-x-auto">
                    <table className="text-sm tabular-nums" data-testid={`estoque-${m.id}-${l.linha}`}>
                      <thead>
                        <tr className="text-[11px] uppercase tracking-wide text-muted">
                          <th className="px-2 py-1 text-left font-semibold">{l.linha}</th>
                          {l.tamanhos.map((t) => (
                            <th key={t} className="px-2 py-1 font-semibold text-center min-w-16">
                              {t}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {l.cores.map((c) => (
                          <tr key={c.nome} className="border-t border-border">
                            <td className="px-2 py-1.5 whitespace-nowrap">
                              <span className="inline-flex items-center gap-2">
                                <i className="inline-block h-3 w-3 rounded-full border border-border" style={{ background: c.hex }} />
                                {c.nome}
                              </span>
                            </td>
                            {c.celulas.map((cel, i) => (
                              <td key={l.tamanhos[i]} className="px-1 py-1 text-center">
                                {cel ? (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setAjuste({ celula: cel, nome: `${m.nome} · ${c.nome} · ${l.linha} ${l.tamanhos[i]}` })
                                    }
                                    className={cn(
                                      'w-full rounded-md border border-border px-2 py-1 hover:border-primary flex flex-col items-center',
                                      !cel.ativo && 'opacity-50',
                                      cel.minimo !== null && cel.disponivel < cel.minimo && 'border-warning bg-warning/10',
                                    )}
                                    title={`Físico ${cel.fisico} · reservado ${cel.reservado} — clique pra ajustar`}
                                  >
                                    <b className={cn('text-base', cel.disponivel < 0 && 'text-danger', cel.disponivel === 0 && 'text-muted')}>
                                      {cel.disponivel}
                                    </b>
                                    {cel.reservado > 0 && <span className="text-[10px] text-warning">res. {cel.reservado}</span>}
                                  </button>
                                ) : (
                                  <span className="text-muted">—</span>
                                )}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ))}
              </Card>
            ))}

            <Card className="p-4 flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-base font-semibold mr-auto">Movimentações</h2>
                {filtro && (
                  <Badge variant="primary">
                    {filtro.nome}
                    <button type="button" className="ml-1.5" onClick={() => setFiltro(null)} aria-label="Limpar filtro">
                      ×
                    </button>
                  </Badge>
                )}
              </div>
              <StateView loading={movs.loading} error={movs.error} onRetry={movs.refetch}>
                {(movs.data ?? []).length === 0 ? (
                  <p className="text-sm text-muted">Nenhuma movimentação ainda.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[640px] text-sm tabular-nums">
                      <thead className="text-[11px] uppercase tracking-wide text-muted">
                        <tr>
                          <th className="px-2 py-1 text-left font-semibold">Quando</th>
                          <th className="px-2 py-1 text-left font-semibold">Peça</th>
                          <th className="px-2 py-1 text-left font-semibold">Tipo</th>
                          <th className="px-2 py-1 text-right font-semibold">Qtd.</th>
                          <th className="px-2 py-1 text-left font-semibold">Motivo / documento</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(movs.data ?? []).map((mv) => (
                          <tr key={mv.id} className="border-t border-border">
                            <td className="px-2 py-1.5 whitespace-nowrap text-muted">
                              {new Date(mv.criadoEm).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
                            </td>
                            <td className="px-2 py-1.5">
                              <button
                                type="button"
                                className="text-left hover:underline"
                                onClick={() => setFiltro({ produtoId: mv.produto.id, nome: mv.produto.nome })}
                              >
                                {mv.produto.nome}
                              </button>
                            </td>
                            <td className="px-2 py-1.5">{TIPO[mv.tipo]}</td>
                            <td className={cn('px-2 py-1.5 text-right font-semibold', mv.quantidade < 0 ? 'text-danger' : 'text-success')}>
                              {mv.quantidade > 0 ? `+${mv.quantidade}` : mv.quantidade}
                            </td>
                            <td className="px-2 py-1.5 text-muted">
                              {mv.pedido ? (
                                <Link to={`/pedidos/${mv.pedido.id}`} className="text-primary hover:underline">
                                  #{mv.pedido.numero}
                                </Link>
                              ) : null}
                              {mv.pedido && (mv.motivo || mv.documento) ? ' · ' : ''}
                              {[mv.documento, mv.motivo].filter(Boolean).join(' · ')}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </StateView>
            </Card>
          </div>
        </StateView>
      )}

      {ajuste && (
        <AjusteDialog
          alvo={ajuste}
          onClose={() => setAjuste(null)}
          onSalvou={() => {
            setAjuste(null);
            saldos.refetch();
            movs.refetch();
          }}
          onVerHistorico={() => {
            setFiltro({ produtoId: ajuste.celula.produtoId, nome: ajuste.nome });
            setAjuste(null);
          }}
        />
      )}
    </PageLayout>
  );
}

function AjusteDialog({
  alvo,
  onClose,
  onSalvou,
  onVerHistorico,
}: {
  alvo: { celula: Celula; nome: string };
  onClose: () => void;
  onSalvou: () => void;
  onVerHistorico: () => void;
}) {
  const toast = useToast();
  const [tipo, setTipo] = useState<'AJUSTE' | 'DEVOLUCAO'>('AJUSTE');
  const [qtd, setQtd] = useState('');
  const [motivo, setMotivo] = useState('');
  const [minimo, setMinimo] = useState(alvo.celula.minimo === null ? '' : String(alvo.celula.minimo));
  const [salvando, setSalvando] = useState(false);
  const n = Number.parseInt(qtd.replace(/\s/g, ''), 10);
  const valido = Number.isInteger(n) && n !== 0 && (tipo === 'AJUSTE' || n > 0) && motivo.trim().length >= 3;
  const c = alvo.celula;

  async function salvarMinimo() {
    setSalvando(true);
    try {
      const m = minimo.trim() === '' ? null : Number.parseInt(minimo, 10);
      await api.put('/erp/estoque/minimos', { itens: [{ produtoId: c.produtoId, minimo: Number.isFinite(m) ? m : null }] });
      toast.success(m === null ? 'Mínimo tirado' : 'Estoque mínimo salvo');
      onSalvou();
    } catch (err) {
      toast.error('Não foi possível salvar', apiErrorMessage(err));
    } finally {
      setSalvando(false);
    }
  }

  async function salvar() {
    setSalvando(true);
    try {
      await api.post('/erp/estoque/ajustes', { produtoId: c.produtoId, tipo, quantidade: n, motivo: motivo.trim() });
      toast.success('Estoque ajustado');
      onSalvou();
    } catch (err) {
      toast.error('Não foi possível ajustar', apiErrorMessage(err));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="Ajustar estoque"
      description={alvo.nome}
      footer={
        <div className="flex w-full items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onVerHistorico} className="mr-auto">
            Ver histórico desta peça
          </Button>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={salvar} loading={salvando} disabled={!valido} data-testid="estoque-ajuste-salvar">
            Salvar
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-sm text-muted tabular-nums">
          Físico <b className="text-text">{c.fisico}</b> · reservado <b className="text-text">{c.reservado}</b> ·
          disponível <b className="text-text">{c.disponivel}</b>
        </p>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Tipo">
            <Select value={tipo} onChange={(e) => setTipo(e.target.value as 'AJUSTE' | 'DEVOLUCAO')}>
              <option value="AJUSTE">Ajuste (inventário/correção)</option>
              <option value="DEVOLUCAO">Devolução (volta pro estoque)</option>
            </Select>
          </Field>
          <Field label="Quantidade" hint={tipo === 'AJUSTE' ? 'Use − pra tirar (ex.: -2)' : 'Peças que voltaram'}>
            <Input value={qtd} onChange={(e) => setQtd(e.target.value)} inputMode="numeric" data-testid="estoque-ajuste-qtd" />
          </Field>
        </div>
        <Field label="Motivo" required hint="Fica no histórico, com seu nome">
          <Textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={2} maxLength={300} data-testid="estoque-ajuste-motivo" />
        </Field>
        <div className="flex items-end gap-2 border-t border-border pt-3">
          <Field label="Estoque mínimo" hint="Abaixo disto aparece em Reposição. Vazio = sem mínimo.">
            <Input value={minimo} onChange={(e) => setMinimo(e.target.value.replace(/\D/g, ''))} inputMode="numeric" className="w-28" data-testid="estoque-minimo" />
          </Field>
          <Button variant="secondary" size="sm" onClick={salvarMinimo} disabled={salvando} className="mb-1" data-testid="estoque-minimo-salvar">
            Salvar mínimo
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
