import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatMoeda } from '@/lib/masks';
import { useApiQuery } from '@/hooks/useApiQuery';
import { useRole } from '@/hooks/usePermission';
import { useToast } from '@/components/toast';
import { PageLayout } from '@/components/PageLayout';
import { StateView } from '@/components/StateView';
import { Badge, Button, Card, Checkbox, Dialog, Field, Input, Select, Tabs, Textarea } from '@/components/ui';
import { lerNumero, paraCampo } from '@/pages/precificacao/calculo';
import { ConfigFinanceiro } from './ConfigFinanceiro';
import { FluxoCaixa, PorContatoView, Total } from './RelatoriosFinanceiro';
import { hojeIso, rotuloSituacao, type Categoria, type Conta, type Lista, type Titulo } from './tipos';

/**
 * Financeiro (ERP próprio · Fase 3): contas a receber e a pagar, sem nota
 * fiscal (ela sai num faturador externo). Só ADMIN/DIRECTOR e só onde a flag
 * `financeiro.ativo` está ligada — o backend recusa fora disso.
 */

type Aba = 'RECEBER' | 'PAGAR' | 'fluxo' | 'contatos' | 'config';
const FORMAS = [
  ['PIX', 'Pix'],
  ['CARTAO', 'Cartão'],
  ['BOLETO', 'Boleto'],
  ['TRANSFERENCIA', 'Transferência'],
  ['DINHEIRO', 'Dinheiro'],
  ['OUTRA', 'Outra'],
] as const;

export default function FinanceiroPage() {
  const role = useRole();
  const gestor = role === 'ADMIN' || role === 'DIRECTOR';
  // Atalho do pedido/OP: ?aba=RECEBER|PAGAR&busca=… abre a lista já filtrada.
  const [params] = useSearchParams();
  const abaUrl = params.get('aba');
  const [aba, setAba] = useState<Aba>(abaUrl === 'PAGAR' ? 'PAGAR' : 'RECEBER');
  // "Por contato" → abre a lista daquele contato já filtrada.
  const [buscaInicial, setBuscaInicial] = useState(params.get('busca') ?? '');
  const situacaoUrl = params.get('situacao') === 'TODOS' ? 'TODOS' : undefined;
  return (
    <PageLayout title="Financeiro" description="Contas a receber e a pagar. A nota fiscal sai no faturador externo.">
      {!gestor ? (
        <Card className="p-6 text-sm text-muted">Só a diretoria acessa o financeiro.</Card>
      ) : (
        <div className="flex flex-col gap-4">
          <Tabs
            value={aba}
            onChange={(v) => {
              setBuscaInicial('');
              setAba(v as Aba);
            }}
            items={[
              { value: 'RECEBER', label: 'A receber' },
              { value: 'PAGAR', label: 'A pagar' },
              { value: 'fluxo', label: 'Fluxo de caixa' },
              { value: 'contatos', label: 'Por contato' },
              { value: 'config', label: 'Contas, categorias e recorrentes' },
            ]}
          />
          {aba === 'config' ? (
            <ConfigFinanceiro />
          ) : aba === 'fluxo' ? (
            <FluxoCaixa />
          ) : aba === 'contatos' ? (
            <PorContatoView
              onAbrir={(tipo, contato) => {
                setBuscaInicial(contato);
                setAba(tipo);
              }}
            />
          ) : (
            <Titulos
              key={`${aba}:${buscaInicial}`}
              tipo={aba}
              buscaInicial={buscaInicial}
              situacaoInicial={buscaInicial ? situacaoUrl : undefined}
            />
          )}
        </div>
      )}
    </PageLayout>
  );
}

function Titulos({
  tipo,
  buscaInicial = '',
  situacaoInicial = 'ABERTO',
}: {
  tipo: 'RECEBER' | 'PAGAR';
  buscaInicial?: string;
  situacaoInicial?: string;
}) {
  const [situacao, setSituacao] = useState(situacaoInicial);
  const [de, setDe] = useState('');
  const [ate, setAte] = useState('');
  const [categoriaId, setCategoriaId] = useState('');
  const [busca, setBusca] = useState(buscaInicial);
  const qs = new URLSearchParams({ tipo, situacao });
  if (de) qs.set('de', de);
  if (ate) qs.set('ate', ate);
  if (categoriaId) qs.set('categoriaId', categoriaId);
  if (busca.trim()) qs.set('busca', busca.trim());
  const q = useApiQuery<Lista>(`/financeiro/titulos?${qs.toString()}`);
  const categorias = useApiQuery<Categoria[]>('/financeiro/categorias');
  const contas = useApiQuery<Conta[]>('/financeiro/contas');
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [dlg, setDlg] = useState<
    | { t: 'novo' }
    | { t: 'editar'; titulo: Titulo }
    | { t: 'baixa'; titulo: Titulo }
    | { t: 'massa' }
    | { t: 'historico'; titulo: Titulo }
    | null
  >(null);
  const cats = (categorias.data ?? []).filter((c) => c.tipo === tipo);
  const lista = q.data?.titulos ?? [];
  const abertos = lista.filter((t) => t.saldo > 0 && t.status !== 'CANCELADO');
  const verbo = tipo === 'RECEBER' ? 'Receber' : 'Pagar';
  const pronto = () => {
    setDlg(null);
    setSel(new Set());
    q.refetch();
    contas.refetch();
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-3" data-testid="fin-totais">
        <Total rotulo="Em aberto" v={q.data?.totais.emAberto} />
        <Total rotulo="Vencido" v={q.data?.totais.vencido} tom="danger" />
        <Total rotulo={tipo === 'RECEBER' ? 'Recebido no mês' : 'Pago no mês'} v={q.data?.totais.quitadoNoMes} tom="success" />
      </div>

      <Card className="p-4 flex flex-col gap-3">
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Situação" className="w-36">
            <Select value={situacao} onChange={(e) => setSituacao(e.target.value)} data-testid="fin-situacao">
              <option value="ABERTO">Em aberto</option>
              <option value="VENCIDO">Vencidos</option>
              <option value="QUITADO">{tipo === 'RECEBER' ? 'Recebidos' : 'Pagos'}</option>
              <option value="CANCELADO">Cancelados</option>
              <option value="TODOS">Todos</option>
            </Select>
          </Field>
          <Field label="Vence de" className="w-40">
            <Input type="date" value={de} onChange={(e) => setDe(e.target.value)} />
          </Field>
          <Field label="até" className="w-40">
            <Input type="date" value={ate} onChange={(e) => setAte(e.target.value)} />
          </Field>
          <Field label="Categoria" className="w-44">
            <Select value={categoriaId} onChange={(e) => setCategoriaId(e.target.value)}>
              <option value="">Todas</option>
              {cats.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Busca" className="w-48">
            <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Descrição ou contato" />
          </Field>
          <div className="ml-auto flex gap-2">
            {sel.size > 0 && (
              <Button variant="secondary" onClick={() => setDlg({ t: 'massa' })} data-testid="fin-massa">
                {verbo} {sel.size} selecionado{sel.size > 1 ? 's' : ''}
              </Button>
            )}
            <Button leftIcon={<Plus className="h-3.5 w-3.5" />} onClick={() => setDlg({ t: 'novo' })} data-testid="fin-novo">
              Novo lançamento
            </Button>
          </div>
        </div>

        <StateView loading={q.loading && !q.data} error={q.error} onRetry={q.refetch}>
          {lista.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted">Nada aqui com esses filtros.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] text-sm tabular-nums" data-testid="fin-tabela">
                <thead className="text-[11px] uppercase tracking-wide text-muted">
                  <tr>
                    <th className="w-8 px-2 py-1.5">
                      <Checkbox
                        aria-label="Selecionar todos em aberto"
                        checked={abertos.length > 0 && abertos.every((t) => sel.has(t.id))}
                        onChange={(e) => setSel(e.target.checked ? new Set(abertos.map((t) => t.id)) : new Set())}
                      />
                    </th>
                    <th className="px-2 py-1.5 text-left font-semibold">Vencimento</th>
                    <th className="px-2 py-1.5 text-left font-semibold">Descrição</th>
                    <th className="px-2 py-1.5 text-left font-semibold">Categoria</th>
                    <th className="px-2 py-1.5 text-right font-semibold">Valor</th>
                    <th className="px-2 py-1.5 text-right font-semibold">Falta</th>
                    <th className="px-2 py-1.5 text-left font-semibold">Situação</th>
                    <th className="px-2 py-1.5" />
                  </tr>
                </thead>
                <tbody>
                  {lista.map((t) => {
                    const s = rotuloSituacao(t.situacao, tipo);
                    const podeBaixar = t.saldo > 0 && t.status !== 'CANCELADO';
                    return (
                      <tr key={t.id} className="border-t border-border">
                        <td className="px-2 py-2">
                          {podeBaixar && (
                            <Checkbox
                              aria-label={`Selecionar ${t.descricao}`}
                              checked={sel.has(t.id)}
                              onChange={(e) => {
                                const n = new Set(sel);
                                if (e.target.checked) n.add(t.id);
                                else n.delete(t.id);
                                setSel(n);
                              }}
                            />
                          )}
                        </td>
                        <td className={cn('px-2 py-2 whitespace-nowrap', t.situacao === 'VENCIDO' && 'text-danger font-semibold')}>
                          {new Date(t.vencimento).toLocaleDateString('pt-BR', { timeZone: 'UTC' })}
                        </td>
                        <td className="px-2 py-2">
                          <span className="font-medium">{t.descricao}</span>
                          {t.contatoNome && <span className="text-muted"> · {t.contatoNome}</span>}
                          {t.recorrente && <Badge variant="outline" size="sm" className="ml-1.5">recorrente</Badge>}
                          {t.automatico && <Badge variant="info" size="sm" className="ml-1.5">automático</Badge>}
                        </td>
                        <td className="px-2 py-2 text-muted">{t.categoria?.nome ?? '—'}</td>
                        <td className="px-2 py-2 text-right">{formatMoeda(t.valor)}</td>
                        <td className="px-2 py-2 text-right font-semibold">{t.saldo > 0 ? formatMoeda(t.saldo) : '—'}</td>
                        <td className="px-2 py-2">
                          <Badge variant={s.tom}>{s.texto}</Badge>
                        </td>
                        <td className="px-2 py-2">
                          <div className="flex justify-end gap-1">
                            {podeBaixar && (
                              <Button size="sm" onClick={() => setDlg({ t: 'baixa', titulo: t })} data-testid={`fin-baixar-${t.id}`}>
                                {verbo}
                              </Button>
                            )}
                            {t.pago > 0 && (
                              <Button size="sm" variant="ghost" onClick={() => setDlg({ t: 'historico', titulo: t })}>
                                Baixas
                              </Button>
                            )}
                            {(t.status === 'ABERTO' || t.status === 'PARCIAL') && (
                              <Button size="sm" variant="ghost" onClick={() => setDlg({ t: 'editar', titulo: t })}>
                                Editar
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </StateView>
      </Card>

      {(dlg?.t === 'novo' || dlg?.t === 'editar') && (
        <LancamentoDialog tipo={tipo} titulo={dlg.t === 'editar' ? dlg.titulo : null} categorias={cats} onClose={() => setDlg(null)} onPronto={pronto} />
      )}
      {dlg?.t === 'baixa' && <BaixaDialog titulo={dlg.titulo} contas={contas.data ?? []} onClose={() => setDlg(null)} onPronto={pronto} />}
      {dlg?.t === 'massa' && (
        <MassaDialog
          tipo={tipo}
          titulos={lista.filter((t) => sel.has(t.id))}
          contas={contas.data ?? []}
          onClose={() => setDlg(null)}
          onPronto={pronto}
        />
      )}
      {dlg?.t === 'historico' && <HistoricoDialog titulo={dlg.titulo} onClose={() => setDlg(null)} onPronto={pronto} />}
    </div>
  );
}

function useAcao(onPronto: () => void, ok: string) {
  const toast = useToast();
  const [salvando, setSalvando] = useState(false);
  async function rodar(fn: () => Promise<unknown>) {
    setSalvando(true);
    try {
      await fn();
      toast.success(ok);
      onPronto();
    } catch (err) {
      toast.error('Não foi possível', apiErrorMessage(err));
    } finally {
      setSalvando(false);
    }
  }
  return { salvando, rodar };
}

function LancamentoDialog({
  tipo,
  titulo,
  categorias,
  onClose,
  onPronto,
}: {
  tipo: 'RECEBER' | 'PAGAR';
  titulo: Titulo | null;
  categorias: Categoria[];
  onClose: () => void;
  onPronto: () => void;
}) {
  const [descricao, setDescricao] = useState(titulo?.descricao ?? '');
  const [valor, setValor] = useState(paraCampo(titulo?.valor));
  const [venc, setVenc] = useState(titulo ? titulo.vencimento.slice(0, 10) : hojeIso());
  const [categoriaId, setCategoriaId] = useState(titulo?.categoria?.id ?? '');
  const [contato, setContato] = useState(titulo?.contatoNome ?? '');
  const [obs, setObs] = useState(titulo?.observacoes ?? '');
  const [parcelas, setParcelas] = useState('1');
  const { salvando, rodar } = useAcao(onPronto, titulo ? 'Lançamento salvo' : 'Lançamento criado');
  const v = lerNumero(valor);
  const n = Math.max(1, Number.parseInt(parcelas, 10) || 1);
  const corpo = {
    descricao: descricao.trim(),
    valor: v,
    vencimento: venc,
    categoriaId: categoriaId || null,
    contatoNome: contato,
    observacoes: obs,
  };
  const valido = descricao.trim().length >= 2 && v !== null && v > 0 && /^\d{4}-\d{2}-\d{2}$/.test(venc);
  return (
    <Dialog
      open
      onClose={onClose}
      title={titulo ? 'Editar lançamento' : tipo === 'RECEBER' ? 'Nova conta a receber' : 'Nova conta a pagar'}
      footer={
        <div className="flex w-full items-center gap-2">
          {titulo && (
            <Button variant="ghost" size="sm" className="mr-auto text-danger" disabled={salvando} onClick={() => rodar(() => api.post(`/financeiro/titulos/${titulo.id}/cancelar`))}>
              Cancelar lançamento
            </Button>
          )}
          <Button variant="secondary" onClick={onClose}>
            Voltar
          </Button>
          <Button
            loading={salvando}
            disabled={!valido}
            data-testid="fin-lanc-salvar"
            onClick={() =>
              rodar(() =>
                titulo ? api.put(`/financeiro/titulos/${titulo.id}`, corpo) : api.post('/financeiro/titulos', { ...corpo, tipo, parcelas: n }),
              )
            }
          >
            Salvar
          </Button>
        </div>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="Descrição" required className="col-span-2">
          <Input value={descricao} onChange={(e) => setDescricao(e.target.value)} data-testid="fin-lanc-descricao" />
        </Field>
        <Field label={n > 1 ? 'Valor de cada parcela (R$)' : 'Valor (R$)'} required>
          <Input value={valor} onChange={(e) => setValor(e.target.value)} inputMode="decimal" data-testid="fin-lanc-valor" />
        </Field>
        <Field label={n > 1 ? 'Vencimento da 1ª' : 'Vencimento'} required>
          <Input type="date" value={venc} onChange={(e) => setVenc(e.target.value)} />
        </Field>
        <Field label="Categoria">
          <Select value={categoriaId} onChange={(e) => setCategoriaId(e.target.value)}>
            <option value="">Sem categoria</option>
            {categorias
              .filter((c) => c.ativo || c.id === categoriaId)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome}
                </option>
              ))}
          </Select>
        </Field>
        <Field label={tipo === 'RECEBER' ? 'Cliente' : 'Fornecedor / facção'}>
          <Input value={contato} onChange={(e) => setContato(e.target.value)} />
        </Field>
        {!titulo && (
          <Field label="Parcelas (mensais)" hint="1 = à vista">
            <Input value={parcelas} onChange={(e) => setParcelas(e.target.value.replace(/\D/g, ''))} inputMode="numeric" />
          </Field>
        )}
        <Field label="Observações" className="col-span-2">
          <Textarea value={obs} onChange={(e) => setObs(e.target.value)} rows={2} />
        </Field>
      </div>
    </Dialog>
  );
}

function BaixaDialog({ titulo, contas, onClose, onPronto }: { titulo: Titulo; contas: Conta[]; onClose: () => void; onPronto: () => void }) {
  const ativas = contas.filter((c) => c.ativo);
  const [valor, setValor] = useState(paraCampo(titulo.saldo));
  const [data, setData] = useState(hojeIso());
  const [contaId, setContaId] = useState(ativas[0]?.id ?? '');
  const [forma, setForma] = useState('PIX');
  const [obs, setObs] = useState('');
  const { salvando, rodar } = useAcao(onPronto, 'Baixa registrada');
  const v = lerNumero(valor);
  const passa = v !== null && Math.round(v * 100) > Math.round(titulo.saldo * 100);
  return (
    <Dialog
      open
      onClose={onClose}
      title={titulo.tipo === 'RECEBER' ? 'Registrar recebimento' : 'Registrar pagamento'}
      description={`${titulo.descricao} — falta ${formatMoeda(titulo.saldo)}`}
      footer={
        <div className="flex w-full justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Voltar
          </Button>
          <Button
            loading={salvando}
            disabled={!v || v <= 0 || passa || !contaId}
            data-testid="fin-baixa-salvar"
            onClick={() => rodar(() => api.post(`/financeiro/titulos/${titulo.id}/baixas`, { valor: v, data, contaId, forma, observacao: obs }))}
          >
            Registrar
          </Button>
        </div>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="Valor (R$)" hint={v !== null && v < titulo.saldo && !passa ? 'Parcial — o resto continua em aberto' : passa ? 'Passa do que falta' : undefined} error={passa ? 'Passa do que falta' : undefined}>
          <Input value={valor} onChange={(e) => setValor(e.target.value)} inputMode="decimal" data-testid="fin-baixa-valor" />
        </Field>
        <Field label="Data">
          <Input type="date" value={data} onChange={(e) => setData(e.target.value)} />
        </Field>
        <Field label="Conta">
          <Select value={contaId} onChange={(e) => setContaId(e.target.value)} data-testid="fin-baixa-conta">
            {ativas.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nome}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Forma">
          <Select value={forma} onChange={(e) => setForma(e.target.value)}>
            {FORMAS.map(([k, n]) => (
              <option key={k} value={k}>
                {n}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Observação" className="col-span-2">
          <Input value={obs} onChange={(e) => setObs(e.target.value)} maxLength={300} />
        </Field>
      </div>
    </Dialog>
  );
}

function MassaDialog({
  tipo,
  titulos,
  contas,
  onClose,
  onPronto,
}: {
  tipo: 'RECEBER' | 'PAGAR';
  titulos: Titulo[];
  contas: Conta[];
  onClose: () => void;
  onPronto: () => void;
}) {
  const ativas = contas.filter((c) => c.ativo);
  const [data, setData] = useState(hojeIso());
  const [contaId, setContaId] = useState(ativas[0]?.id ?? '');
  const [forma, setForma] = useState('PIX');
  const total = useMemo(() => titulos.reduce((s, t) => s + t.saldo, 0), [titulos]);
  const { salvando, rodar } = useAcao(onPronto, 'Baixas registradas');
  return (
    <Dialog
      open
      onClose={onClose}
      title={`${tipo === 'RECEBER' ? 'Receber' : 'Pagar'} ${titulos.length} lançamento(s)`}
      description={`Cada um é quitado pelo que falta. Total ${formatMoeda(total)}.`}
      footer={
        <div className="flex w-full justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Voltar
          </Button>
          <Button
            loading={salvando}
            disabled={!contaId}
            data-testid="fin-massa-salvar"
            onClick={() => rodar(() => api.post('/financeiro/baixas-em-massa', { ids: titulos.map((t) => t.id), data, contaId, forma }))}
          >
            Registrar tudo
          </Button>
        </div>
      }
    >
      <div className="grid grid-cols-3 gap-3">
        <Field label="Data">
          <Input type="date" value={data} onChange={(e) => setData(e.target.value)} />
        </Field>
        <Field label="Conta">
          <Select value={contaId} onChange={(e) => setContaId(e.target.value)}>
            {ativas.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nome}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Forma">
          <Select value={forma} onChange={(e) => setForma(e.target.value)}>
            {FORMAS.map(([k, n]) => (
              <option key={k} value={k}>
                {n}
              </option>
            ))}
          </Select>
        </Field>
      </div>
    </Dialog>
  );
}

interface BaixaApi {
  id: string;
  valor: number;
  data: string;
  forma: string | null;
  observacao: string | null;
  conta: string;
  estornadaEm: string | null;
}

function HistoricoDialog({ titulo, onClose, onPronto }: { titulo: Titulo; onClose: () => void; onPronto: () => void }) {
  const q = useApiQuery<BaixaApi[]>(`/financeiro/titulos/${titulo.id}/baixas`);
  const { salvando, rodar } = useAcao(onPronto, 'Baixa estornada');
  return (
    <Dialog open onClose={onClose} title="Baixas" description={titulo.descricao}>
      <StateView loading={q.loading} error={q.error} onRetry={q.refetch}>
        <ul className="flex flex-col divide-y divide-border text-sm">
          {(q.data ?? []).map((b) => (
            <li key={b.id} className={cn('flex items-center gap-2 py-2', b.estornadaEm && 'opacity-50 line-through')}>
              <span className="tabular-nums">{new Date(b.data).toLocaleDateString('pt-BR', { timeZone: 'UTC' })}</span>
              <b className="tabular-nums">{formatMoeda(b.valor)}</b>
              <span className="text-muted">
                {b.conta}
                {b.forma ? ` · ${b.forma.toLowerCase()}` : ''}
                {b.observacao ? ` · ${b.observacao}` : ''}
              </span>
              {!b.estornadaEm && (
                <Button size="sm" variant="ghost" className="ml-auto text-danger" disabled={salvando} onClick={() => rodar(() => api.post(`/financeiro/baixas/${b.id}/estornar`))}>
                  Estornar
                </Button>
              )}
            </li>
          ))}
        </ul>
      </StateView>
    </Dialog>
  );
}
