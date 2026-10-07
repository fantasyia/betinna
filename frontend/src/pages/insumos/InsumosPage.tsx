import { useState } from 'react';
import { Plus } from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatMoeda, formatNumero } from '@/lib/masks';
import { hojeIso } from '@/pages/financeiro/tipos';
import { useApiQuery } from '@/hooks/useApiQuery';
import { useRole } from '@/hooks/usePermission';
import { useToast } from '@/components/toast';
import { PageLayout } from '@/components/PageLayout';
import { StateView } from '@/components/StateView';
import { CatalogoTabs } from '@/components/CatalogoTabs';
import {
  Badge,
  Button,
  Card,
  Dialog,
  Field,
  Input,
  Select,
  Switch,
  Tabs,
  Textarea,
} from '@/components/ui';
import { lerNumero, paraCampo } from '@/pages/precificacao/calculo';
import {
  NOME_TIPO,
  NOME_UNIDADE,
  SIGLA,
  coresAtivas,
  custoMedioDepois,
  precoPorUnidade,
  type CorEmpresa,
  type Insumo,
  type TipoInsumo,
  type Unidade,
} from './insumo';

/**
 * Matéria-prima (ERP próprio · Fase 2 · entrega 2): tecido e aviamento, cada
 * um na sua unidade. Saldo = soma dos movimentos; a compra recalcula o custo
 * médio ponderado, que é o que a ficha técnica e a OP usam pra custear a peça.
 * Insumo com cores (Léo, 07/10): saldo, custo e movimento POR COR — a OP baixa
 * a cor da peça.
 */

const qtd = (v: number, u: Unidade) => `${formatNumero(Math.round(v * 1000) / 1000)} ${SIGLA[u]}`;

/** Custo por unidade: tecido por kg pode ter centavo quebrado — até 4 casas. */
const custoUn = (v: number, u: Unidade) =>
  `${v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 4 })}/${SIGLA[u]}`;

/** `cor` = id da cor do insumo já escolhida (botão na linha da cor). */
type Dlg =
  | { tipo: 'cadastro'; insumo: Insumo | null }
  | { tipo: 'compra'; insumo: Insumo; cor?: string }
  | { tipo: 'movimento'; insumo: Insumo; cor?: string }
  | { tipo: 'historico'; insumo: Insumo; cor?: string };

function Bolinha({ hex }: { hex: string }) {
  return (
    <span
      className="inline-block h-3 w-3 shrink-0 rounded-full border border-border align-middle"
      style={{ background: hex }}
    />
  );
}

export default function InsumosPage() {
  const role = useRole();
  const gestor = role === 'ADMIN' || role === 'DIRECTOR';
  const q = useApiQuery<Insumo[]>(gestor ? '/erp/insumos' : null);
  const [filtro, setFiltro] = useState<'todos' | TipoInsumo>('todos');
  const [dlg, setDlg] = useState<Dlg | null>(null);
  const lista = (q.data ?? []).filter((i) => filtro === 'todos' || i.tipo === filtro);
  const total = lista.reduce((s, i) => s + (i.ativo ? i.valorEmEstoque : 0), 0);
  const fechar = () => setDlg(null);
  const salvou = () => {
    setDlg(null);
    q.refetch();
  };

  return (
    <PageLayout
      title="Insumos"
      description="Tecido e aviamento: saldo, custo médio e o que precisa repor."
      actions={
        gestor ? (
          <Button
            leftIcon={<Plus className="h-3.5 w-3.5" />}
            onClick={() => setDlg({ tipo: 'cadastro', insumo: null })}
            data-testid="insumo-novo"
          >
            Novo insumo
          </Button>
        ) : undefined
      }
    >
      <CatalogoTabs />
      {!gestor ? (
        <Card className="p-6 text-sm text-muted">Só a diretoria acessa os insumos.</Card>
      ) : (
        <StateView loading={q.loading} error={q.error} onRetry={q.refetch}>
          <Card className="p-4 flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <Tabs
                value={filtro}
                onChange={(v) => setFiltro(v as typeof filtro)}
                items={[
                  { value: 'todos', label: 'Todos', count: q.data?.length },
                  {
                    value: 'TECIDO',
                    label: 'Tecidos',
                    count: q.data?.filter((i) => i.tipo === 'TECIDO').length,
                  },
                  {
                    value: 'AVIAMENTO',
                    label: 'Aviamentos',
                    count: q.data?.filter((i) => i.tipo === 'AVIAMENTO').length,
                  },
                ]}
              />
              <span className="ml-auto text-sm text-muted">
                Valor em estoque: <b className="text-text tabular-nums">{formatMoeda(total)}</b>
              </span>
            </div>
            {lista.length === 0 ? (
              <p className="text-sm text-muted py-6 text-center">
                Nenhum insumo ainda. Cadastre o primeiro tecido ou aviamento em "Novo insumo".
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table
                  className="w-full min-w-[820px] text-sm tabular-nums"
                  data-testid="insumos-tabela"
                >
                  <thead className="text-[11px] uppercase tracking-wide text-muted">
                    <tr>
                      <th className="px-2 py-1.5 text-left font-semibold">Insumo</th>
                      <th className="px-2 py-1.5 text-left font-semibold">Tipo</th>
                      <th className="px-2 py-1.5 text-right font-semibold">Saldo</th>
                      <th className="px-2 py-1.5 text-right font-semibold">Custo médio</th>
                      <th className="px-2 py-1.5 text-right font-semibold">Em estoque</th>
                      <th className="px-2 py-1.5 text-left font-semibold">Fornecedor</th>
                      <th className="px-2 py-1.5" />
                    </tr>
                  </thead>
                  <tbody>
                    {lista.flatMap((i) => [
                      <tr
                        key={i.id}
                        className={cn('border-t border-border', !i.ativo && 'opacity-50')}
                      >
                        <td className="px-2 py-2">
                          <button
                            type="button"
                            className="text-left font-medium hover:underline"
                            onClick={() => setDlg({ tipo: 'cadastro', insumo: i })}
                          >
                            {i.nome}
                          </button>
                          {i.cor && <span className="text-muted"> · {i.cor}</span>}
                          {i.temCores && (
                            <span className="text-muted">
                              {' '}
                              · {i.cores.length} {i.cores.length === 1 ? 'cor' : 'cores'}
                            </span>
                          )}
                          {!i.ativo && (
                            <Badge variant="neutral" size="sm" className="ml-2">
                              inativo
                            </Badge>
                          )}
                        </td>
                        <td className="px-2 py-2">{NOME_TIPO[i.tipo]}</td>
                        <td
                          className={cn(
                            'px-2 py-2 text-right font-semibold',
                            i.saldo < 0 && 'text-danger',
                          )}
                        >
                          {qtd(i.saldo, i.unidade)}
                          {i.repor && (
                            <Badge variant="warning" size="sm" className="ml-2">
                              repor
                            </Badge>
                          )}
                        </td>
                        <td className="px-2 py-2 text-right">
                          {i.custoMedio > 0 ? custoUn(i.custoMedio, i.unidade) : '—'}
                          {i.temCores && i.custoMedio > 0 && (
                            <span className="block text-[11px] text-muted">média das cores</span>
                          )}
                        </td>
                        <td className="px-2 py-2 text-right">{formatMoeda(i.valorEmEstoque)}</td>
                        <td className="px-2 py-2 text-muted">{i.fornecedor ?? '—'}</td>
                        <td className="px-2 py-2">
                          <div className="flex justify-end gap-1.5">
                            <Button
                              size="sm"
                              onClick={() => setDlg({ tipo: 'compra', insumo: i })}
                              data-testid={`insumo-compra-${i.id}`}
                            >
                              Compra
                            </Button>
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => setDlg({ tipo: 'movimento', insumo: i })}
                            >
                              Perda/ajuste
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setDlg({ tipo: 'historico', insumo: i })}
                            >
                              Histórico
                            </Button>
                          </div>
                        </td>
                      </tr>,
                      // Uma linha por cor: saldo, custo e valor DAQUELA cor.
                      ...i.cores.map((c) => (
                        <tr
                          key={`${i.id}-${c.id}`}
                          className={cn('text-[13px]', (!i.ativo || !c.ativo) && 'opacity-50')}
                          data-testid={`insumo-cor-${c.id}`}
                        >
                          <td className="py-1 pl-6 pr-2">
                            <span className="inline-flex items-center gap-1.5">
                              <Bolinha hex={c.hex} />
                              {c.nome}
                              {!c.ativo && <span className="text-muted">(tirada)</span>}
                            </span>
                          </td>
                          <td />
                          <td className={cn('px-2 py-1 text-right', c.saldo < 0 && 'text-danger')}>
                            {qtd(c.saldo, i.unidade)}
                            {c.repor && (
                              <Badge variant="warning" size="sm" className="ml-2">
                                repor
                              </Badge>
                            )}
                          </td>
                          <td className="px-2 py-1 text-right">
                            {c.custoMedio > 0 ? custoUn(c.custoMedio, i.unidade) : '—'}
                          </td>
                          <td className="px-2 py-1 text-right">{formatMoeda(c.valorEmEstoque)}</td>
                          <td />
                          <td className="px-2 py-1">
                            {c.ativo && (
                              <div className="flex justify-end gap-1.5">
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => setDlg({ tipo: 'compra', insumo: i, cor: c.id })}
                                  data-testid={`insumo-cor-compra-${c.id}`}
                                >
                                  Compra
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() =>
                                    setDlg({ tipo: 'movimento', insumo: i, cor: c.id })
                                  }
                                >
                                  Perda
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() =>
                                    setDlg({ tipo: 'historico', insumo: i, cor: c.id })
                                  }
                                >
                                  Histórico
                                </Button>
                              </div>
                            )}
                          </td>
                        </tr>
                      )),
                    ])}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </StateView>
      )}

      {dlg?.tipo === 'cadastro' && (
        <CadastroDialog insumo={dlg.insumo} onClose={fechar} onSalvou={salvou} />
      )}
      {dlg?.tipo === 'compra' && (
        <CompraDialog insumo={dlg.insumo} cor={dlg.cor} onClose={fechar} onSalvou={salvou} />
      )}
      {dlg?.tipo === 'movimento' && (
        <MovimentoDialog insumo={dlg.insumo} cor={dlg.cor} onClose={fechar} onSalvou={salvou} />
      )}
      {dlg?.tipo === 'historico' && (
        <HistoricoDialog insumo={dlg.insumo} cor={dlg.cor} onClose={fechar} />
      )}
    </PageLayout>
  );
}

function useEnviar(onSalvou: () => void, okMsg: string) {
  const toast = useToast();
  const [salvando, setSalvando] = useState(false);
  async function enviar(fn: () => Promise<unknown>) {
    setSalvando(true);
    try {
      await fn();
      toast.success(okMsg);
      onSalvou();
    } catch (err) {
      toast.error('Não foi possível salvar', apiErrorMessage(err));
    } finally {
      setSalvando(false);
    }
  }
  return { salvando, enviar };
}

/**
 * Escolha da cor num movimento de insumo com cores. Começa na cor do botão
 * clicado (ou na primeira). Sem cores, não aparece.
 */
function useCorDoMovimento(insumo: Insumo, inicial: string | undefined) {
  const ativas = coresAtivas(insumo);
  const [cor, setCor] = useState(inicial ?? ativas[0]?.id ?? '');
  const escolhida = insumo.cores.find((c) => c.id === cor) ?? null;
  const campo = insumo.temCores ? (
    <Field label="Cor" required>
      <Select value={cor} onChange={(e) => setCor(e.target.value)} data-testid="mov-cor">
        {ativas.map((c) => (
          <option key={c.id} value={c.id}>
            {c.nome}
          </option>
        ))}
      </Select>
    </Field>
  ) : null;
  return { insumoCorId: insumo.temCores ? cor || null : null, escolhida, campo };
}

function CadastroDialog({
  insumo,
  onClose,
  onSalvou,
}: {
  insumo: Insumo | null;
  onClose: () => void;
  onSalvou: () => void;
}) {
  const [nome, setNome] = useState(insumo?.nome ?? '');
  const [tipo, setTipo] = useState<TipoInsumo>(insumo?.tipo ?? 'TECIDO');
  const [unidade, setUnidade] = useState<Unidade>(insumo?.unidade ?? 'KG');
  const [cor, setCor] = useState(insumo?.cor ?? '');
  // Cores da lista da empresa (a mesma da vitrine). Sem a lista, o campo de texto de antes.
  const coresEmpresa = useApiQuery<CorEmpresa[]>('/erp/insumos/cores');
  const [cores, setCores] = useState<string[]>(
    () => insumo?.cores.filter((c) => c.ativo).map((c) => c.corId) ?? [],
  );
  const alternar = (id: string) =>
    setCores((xs) => (xs.includes(id) ? xs.filter((x) => x !== id) : [...xs, id]));
  const [fornecedor, setFornecedor] = useState(insumo?.fornecedor ?? '');
  const [minimo, setMinimo] = useState(paraCampo(insumo?.estoqueMinimo));
  const [ativo, setAtivo] = useState(insumo?.ativo ?? true);
  const { salvando, enviar } = useEnviar(onSalvou, insumo ? 'Insumo salvo' : 'Insumo cadastrado');
  const corpo = () => ({
    nome: nome.trim(),
    tipo,
    unidade,
    cor: cores.length ? null : cor,
    // Só manda as cores se a lista carregou — senão "nenhuma marcada" apagaria as dele.
    ...(coresEmpresa.data ? { cores } : {}),
    fornecedor,
    estoqueMinimo: lerNumero(minimo),
    ativo,
  });

  return (
    <Dialog
      open
      onClose={onClose}
      title={insumo ? 'Editar insumo' : 'Novo insumo'}
      footer={
        <div className="flex w-full items-center gap-2">
          {insumo && (
            <Button
              variant="ghost"
              size="sm"
              className="mr-auto text-danger"
              onClick={() => enviar(() => api.delete(`/erp/insumos/${insumo.id}`))}
              disabled={salvando}
            >
              Excluir
            </Button>
          )}
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            loading={salvando}
            disabled={nome.trim().length < 2}
            onClick={() =>
              enviar(() =>
                insumo
                  ? api.put(`/erp/insumos/${insumo.id}`, corpo())
                  : api.post('/erp/insumos', corpo()),
              )
            }
            data-testid="insumo-salvar"
          >
            Salvar
          </Button>
        </div>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="Nome" required className="col-span-2">
          <Input
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            placeholder="Moletom 3 cabos, zíper 15 cm…"
            data-testid="insumo-nome"
          />
        </Field>
        <Field label="Tipo">
          <Select value={tipo} onChange={(e) => setTipo(e.target.value as TipoInsumo)}>
            <option value="TECIDO">Tecido</option>
            <option value="AVIAMENTO">Aviamento</option>
          </Select>
        </Field>
        <Field
          label="Unidade"
          hint={
            insumo ? 'Com histórico lançado, não muda' : 'Tecido: kg ou metro, conforme o tecido'
          }
        >
          <Select
            value={unidade}
            onChange={(e) => setUnidade(e.target.value as Unidade)}
            data-testid="insumo-unidade"
          >
            {(Object.keys(NOME_UNIDADE) as Unidade[]).map((u) => (
              <option key={u} value={u}>
                {NOME_UNIDADE[u]}
              </option>
            ))}
          </Select>
        </Field>
        {(coresEmpresa.data ?? []).length > 0 && (
          <Field
            label="Cores"
            className="col-span-2"
            hint="Cada cor tem saldo e custo próprios; a OP baixa a cor da peça. Sem cor marcada, funciona como antes."
          >
            <div className="flex flex-wrap gap-1.5" data-testid="insumo-cores">
              {(coresEmpresa.data ?? [])
                .filter((c) => c.ativo || cores.includes(c.id))
                .map((c) => {
                  const on = cores.includes(c.id);
                  return (
                    <button
                      key={c.id}
                      type="button"
                      aria-pressed={on}
                      onClick={() => alternar(c.id)}
                      className={cn(
                        'inline-flex items-center gap-1.5 rounded-full border px-2.5 h-8 text-[13px]',
                        on
                          ? 'border-primary bg-primary-light font-semibold text-text'
                          : 'border-border text-muted hover:text-text',
                      )}
                      data-testid={`insumo-cor-opcao-${c.id}`}
                    >
                      <Bolinha hex={c.hex} />
                      {c.nome}
                    </button>
                  );
                })}
            </div>
          </Field>
        )}
        {cores.length === 0 && (
          <Field label="Cor (opcional)">
            <Input value={cor} onChange={(e) => setCor(e.target.value)} />
          </Field>
        )}
        <Field
          label={`Estoque mínimo (${SIGLA[unidade]})`}
          hint={cores.length ? 'Vale pra cada cor' : 'Abaixo disso aparece “repor”'}
        >
          <Input value={minimo} onChange={(e) => setMinimo(e.target.value)} inputMode="decimal" />
        </Field>
        <Field label="Fornecedor (opcional)" className="col-span-2">
          <Input value={fornecedor} onChange={(e) => setFornecedor(e.target.value)} />
        </Field>
        {insumo && (
          <div className="col-span-2">
            <Switch label="Ativo" checked={ativo} onChange={(e) => setAtivo(e.target.checked)} />
          </div>
        )}
      </div>
    </Dialog>
  );
}

function CompraDialog({
  insumo,
  cor,
  onClose,
  onSalvou,
}: {
  insumo: Insumo;
  cor?: string;
  onClose: () => void;
  onSalvou: () => void;
}) {
  const daCor = useCorDoMovimento(insumo, cor);
  // Prévia do custo: com cor, o saldo e o custo DA COR.
  const base = daCor.escolhida ?? insumo;
  const [quantidade, setQuantidade] = useState('');
  const [modo, setModo] = useState<'total' | 'unidade'>('total');
  const [valor, setValor] = useState('');
  const [documento, setDocumento] = useState('');
  // Financeiro: a compra vira conta a pagar do fornecedor, vencendo nesta data.
  const [vencimento, setVencimento] = useState(() => hojeIso());
  const { salvando, enviar } = useEnviar(onSalvou, 'Compra lançada');
  const q = lerNumero(quantidade);
  const v = lerNumero(valor);
  const preco = modo === 'total' ? precoPorUnidade(v, q) : v;
  // Total EXATO (o preço por unidade arredonda): é o valor da conta a pagar.
  const valorTotal =
    v === null ? null : modo === 'total' ? v : q === null ? null : Math.round(q * v * 100) / 100;
  const valido =
    q !== null && q > 0 && preco !== null && preco >= 0 && (!insumo.temCores || !!daCor.escolhida);
  const u = insumo.unidade;

  return (
    <Dialog
      open
      onClose={onClose}
      title="Entrada de compra"
      description={`${insumo.nome}${insumo.cor ? ` · ${insumo.cor}` : ''}`}
      footer={
        <div className="flex w-full justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            loading={salvando}
            disabled={!valido}
            onClick={() =>
              enviar(() =>
                api.post(`/erp/insumos/${insumo.id}/compras`, {
                  insumoCorId: daCor.insumoCorId,
                  quantidade: q,
                  custoUnitario: preco,
                  documento,
                  vencimento: vencimento || null,
                  valorTotal,
                }),
              )
            }
            data-testid="compra-salvar"
          >
            Lançar compra
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-3">
          {daCor.campo && <div className="col-span-2">{daCor.campo}</div>}
          <Field label={`Quantidade (${SIGLA[u]})`} required>
            <Input
              value={quantidade}
              onChange={(e) => setQuantidade(e.target.value)}
              inputMode="decimal"
              data-testid="compra-qtd"
            />
          </Field>
          <Field label="Nº da nota / pedido (opcional)">
            <Input value={documento} onChange={(e) => setDocumento(e.target.value)} />
          </Field>
          <Field label="Valor que eu digito é…">
            <Select value={modo} onChange={(e) => setModo(e.target.value as 'total' | 'unidade')}>
              <option value="total">o total pago</option>
              <option value="unidade">{`o preço por ${SIGLA[u]}`}</option>
            </Select>
          </Field>
          <Field
            label={modo === 'total' ? 'Total pago (R$)' : `Preço por ${SIGLA[u]} (R$)`}
            required
          >
            <Input
              value={valor}
              onChange={(e) => setValor(e.target.value)}
              inputMode="decimal"
              data-testid="compra-valor"
            />
          </Field>
          <Field label="Vence em" hint="Vira conta a pagar no Financeiro">
            <Input
              type="date"
              value={vencimento}
              onChange={(e) => setVencimento(e.target.value)}
              data-testid="compra-vencimento"
            />
          </Field>
        </div>
        {valido && (
          <p className="text-sm text-muted" data-testid="compra-previa">
            {custoUn(preco!, u)} nesta compra. Custo médio
            {daCor.escolhida ? ` do ${daCor.escolhida.nome}` : ''} passa de{' '}
            <b className="text-text">{base.custoMedio > 0 ? custoUn(base.custoMedio, u) : '—'}</b>{' '}
            pra{' '}
            <b className="text-text">
              {custoUn(custoMedioDepois(base.saldo, base.custoMedio, q!, preco!), u)}
            </b>
            .
          </p>
        )}
      </div>
    </Dialog>
  );
}

function MovimentoDialog({
  insumo,
  cor,
  onClose,
  onSalvou,
}: {
  insumo: Insumo;
  cor?: string;
  onClose: () => void;
  onSalvou: () => void;
}) {
  const daCor = useCorDoMovimento(insumo, cor);
  const [tipo, setTipo] = useState<'PERDA' | 'SOBRA_RETORNO' | 'AJUSTE'>('PERDA');
  const [quantidade, setQuantidade] = useState('');
  const [motivo, setMotivo] = useState('');
  const { salvando, enviar } = useEnviar(onSalvou, 'Movimento lançado');
  const q = lerNumero(quantidade);
  const valido =
    q !== null &&
    q !== 0 &&
    (tipo === 'AJUSTE' || q > 0) &&
    motivo.trim().length >= 3 &&
    (!insumo.temCores || !!daCor.escolhida);
  const u = insumo.unidade;
  const saldo = daCor.escolhida?.saldo ?? insumo.saldo;

  return (
    <Dialog
      open
      onClose={onClose}
      title="Perda, sobra ou ajuste"
      description={`${insumo.nome}${daCor.escolhida ? ` ${daCor.escolhida.nome}` : ''} · saldo ${qtd(saldo, u)}`}
      footer={
        <div className="flex w-full justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            loading={salvando}
            disabled={!valido}
            onClick={() =>
              enviar(() =>
                api.post(`/erp/insumos/${insumo.id}/movimentos`, {
                  insumoCorId: daCor.insumoCorId,
                  tipo,
                  quantidade: q,
                  motivo: motivo.trim(),
                }),
              )
            }
          >
            Lançar
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-3">
          {daCor.campo && <div className="col-span-2">{daCor.campo}</div>}
          <Field label="O que aconteceu">
            <Select value={tipo} onChange={(e) => setTipo(e.target.value as typeof tipo)}>
              <option value="PERDA">Perda (sai do estoque)</option>
              <option value="SOBRA_RETORNO">Sobra que voltou (entra)</option>
              <option value="AJUSTE">Ajuste de inventário (+ ou −)</option>
            </Select>
          </Field>
          <Field
            label={`Quantidade (${SIGLA[u]})`}
            hint={tipo === 'AJUSTE' ? 'Use − pra tirar' : undefined}
          >
            <Input
              value={quantidade}
              onChange={(e) => setQuantidade(e.target.value)}
              inputMode="decimal"
            />
          </Field>
        </div>
        <Field label="Motivo" required hint="Fica no histórico, com seu nome">
          <Textarea
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            rows={2}
            maxLength={300}
          />
        </Field>
      </div>
    </Dialog>
  );
}

interface MovInsumo {
  id: string;
  tipo: string;
  quantidade: number;
  custoUnitario: number | null;
  motivo: string | null;
  documento: string | null;
  criadoEm: string;
  cor: { nome: string; hex: string } | null;
}

const TIPO_MOV: Record<string, string> = {
  ENTRADA_COMPRA: 'Compra',
  CONSUMO_CORTE: 'Consumo no corte',
  ENVIO_FACCAO: 'Enviado pra facção',
  SOBRA_RETORNO: 'Sobra que voltou',
  PERDA: 'Perda',
  AJUSTE: 'Ajuste',
};

function HistoricoDialog({
  insumo,
  cor,
  onClose,
}: {
  insumo: Insumo;
  cor?: string;
  onClose: () => void;
}) {
  // Aberto pela linha de uma cor: só aquela cor.
  const q = useApiQuery<MovInsumo[]>(
    `/erp/insumos/${insumo.id}/movimentos${cor ? `?cor=${encodeURIComponent(cor)}` : ''}`,
  );
  const u = insumo.unidade;
  const daCor = insumo.cores.find((c) => c.id === cor);
  return (
    <Dialog
      open
      onClose={onClose}
      title="Histórico"
      description={daCor ? `${insumo.nome} ${daCor.nome}` : insumo.nome}
      size="lg"
    >
      <StateView loading={q.loading} error={q.error} onRetry={q.refetch}>
        {(q.data ?? []).length === 0 ? (
          <p className="text-sm text-muted">Nada lançado ainda.</p>
        ) : (
          <table className="w-full text-sm tabular-nums">
            <tbody>
              {(q.data ?? []).map((m) => (
                <tr key={m.id} className="border-t border-border first:border-t-0">
                  <td className="py-1.5 pr-2 whitespace-nowrap text-muted">
                    {new Date(m.criadoEm).toLocaleString('pt-BR', {
                      dateStyle: 'short',
                      timeStyle: 'short',
                    })}
                  </td>
                  <td className="py-1.5 pr-2">
                    {TIPO_MOV[m.tipo] ?? m.tipo}
                    {m.cor && !cor && (
                      <span className="ml-1.5 inline-flex items-center gap-1 text-muted">
                        <Bolinha hex={m.cor.hex} />
                        {m.cor.nome}
                      </span>
                    )}
                  </td>
                  <td
                    className={cn(
                      'py-1.5 pr-2 text-right font-semibold',
                      m.quantidade < 0 ? 'text-danger' : 'text-success',
                    )}
                  >
                    {m.quantidade > 0 ? '+' : ''}
                    {qtd(m.quantidade, u)}
                  </td>
                  <td className="py-1.5 text-muted">
                    {[
                      m.custoUnitario !== null ? custoUn(m.custoUnitario, u) : null,
                      m.documento,
                      m.motivo,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </StateView>
    </Dialog>
  );
}
