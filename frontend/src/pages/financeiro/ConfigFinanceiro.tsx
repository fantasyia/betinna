import { useState } from 'react';
import { Plus } from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatMoeda } from '@/lib/masks';
import { useApiQuery } from '@/hooks/useApiQuery';
import { useToast } from '@/components/toast';
import { StateView } from '@/components/StateView';
import { Badge, Button, Card, Dialog, Field, Input, Select, Switch } from '@/components/ui';
import { lerNumero, paraCampo } from '@/pages/precificacao/calculo';
import type { Categoria, Conta } from './tipos';

/**
 * Financeiro → contas (com saldo), categorias de receita/despesa e
 * lançamentos recorrentes. Tudo da empresa, editável.
 */

interface Recorrencia {
  id: string;
  tipo: 'RECEBER' | 'PAGAR';
  descricao: string;
  valor: number;
  dia: number;
  categoria: { id: string; nome: string } | null;
  categoriaId: string | null;
  contatoNome: string | null;
  ativo: boolean;
}

function useSalvar(onPronto: () => void) {
  const toast = useToast();
  const [salvando, setSalvando] = useState(false);
  async function salvar(fn: () => Promise<unknown>, ok: string) {
    setSalvando(true);
    try {
      await fn();
      toast.success(ok);
      onPronto();
    } catch (err) {
      toast.error('Não foi possível salvar', apiErrorMessage(err));
    } finally {
      setSalvando(false);
    }
  }
  return { salvando, salvar };
}

export function ConfigFinanceiro() {
  const contas = useApiQuery<Conta[]>('/financeiro/contas');
  const categorias = useApiQuery<Categoria[]>('/financeiro/categorias');
  const recorrencias = useApiQuery<Recorrencia[]>('/financeiro/recorrencias');
  const [contaDlg, setContaDlg] = useState<Conta | 'nova' | null>(null);
  const [recDlg, setRecDlg] = useState<Recorrencia | 'nova' | null>(null);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="p-4 flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-semibold mr-auto">Contas</h2>
          <Button size="sm" leftIcon={<Plus className="h-3.5 w-3.5" />} onClick={() => setContaDlg('nova')}>
            Nova conta
          </Button>
        </div>
        <StateView loading={contas.loading} error={contas.error} onRetry={contas.refetch}>
          <ul className="divide-y divide-border text-sm" data-testid="fin-contas">
            {(contas.data ?? []).map((c) => (
              <li key={c.id} className={cn('flex items-center gap-2 py-2', !c.ativo && 'opacity-50')}>
                <button type="button" className="font-medium hover:underline" onClick={() => setContaDlg(c)}>
                  {c.nome}
                </button>
                <Badge variant="outline" size="sm">
                  {c.tipo.toLowerCase()}
                </Badge>
                <b className={cn('ml-auto tabular-nums', c.saldo < 0 && 'text-danger')}>{formatMoeda(c.saldo)}</b>
              </li>
            ))}
          </ul>
        </StateView>
        <p className="text-xs text-muted">Saldo = saldo inicial + o que entrou − o que saiu (baixas).</p>
      </Card>

      <Card className="p-4 flex flex-col gap-3">
        <h2 className="text-base font-semibold">Categorias</h2>
        <StateView loading={categorias.loading} error={categorias.error} onRetry={categorias.refetch}>
          <div className="grid gap-4 sm:grid-cols-2">
            {(['RECEBER', 'PAGAR'] as const).map((tipo) => (
              <ListaCategorias
                key={tipo}
                tipo={tipo}
                itens={(categorias.data ?? []).filter((c) => c.tipo === tipo)}
                onMudou={categorias.refetch}
              />
            ))}
          </div>
        </StateView>
      </Card>

      <Card className="p-4 flex flex-col gap-3 lg:col-span-2">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-semibold mr-auto">Recorrentes (todo mês)</h2>
          <Button size="sm" leftIcon={<Plus className="h-3.5 w-3.5" />} onClick={() => setRecDlg('nova')} data-testid="fin-rec-nova">
            Nova recorrente
          </Button>
        </div>
        <StateView loading={recorrencias.loading} error={recorrencias.error} onRetry={recorrencias.refetch}>
          {(recorrencias.data ?? []).length === 0 ? (
            <p className="text-sm text-muted">
              Nenhuma ainda. Aluguel, contador, sistemas… cadastre aqui e o lançamento do mês aparece sozinho.
            </p>
          ) : (
            <table className="w-full text-sm tabular-nums">
              <tbody>
                {(recorrencias.data ?? []).map((r) => (
                  <tr key={r.id} className={cn('border-t border-border first:border-t-0', !r.ativo && 'opacity-50')}>
                    <td className="py-1.5">
                      <button type="button" className="font-medium hover:underline" onClick={() => setRecDlg(r)}>
                        {r.descricao}
                      </button>
                      {r.contatoNome && <span className="text-muted"> · {r.contatoNome}</span>}
                    </td>
                    <td className="py-1.5 text-muted">{r.tipo === 'PAGAR' ? 'a pagar' : 'a receber'}</td>
                    <td className="py-1.5 text-muted">todo dia {r.dia}</td>
                    <td className="py-1.5 text-muted">{r.categoria?.nome ?? '—'}</td>
                    <td className="py-1.5 text-right font-semibold">{formatMoeda(r.valor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </StateView>
      </Card>

      {contaDlg && (
        <ContaDialog
          conta={contaDlg === 'nova' ? null : contaDlg}
          onClose={() => setContaDlg(null)}
          onPronto={() => {
            setContaDlg(null);
            contas.refetch();
          }}
        />
      )}
      {recDlg && (
        <RecorrenciaDialog
          rec={recDlg === 'nova' ? null : recDlg}
          categorias={categorias.data ?? []}
          onClose={() => setRecDlg(null)}
          onPronto={() => {
            setRecDlg(null);
            recorrencias.refetch();
          }}
        />
      )}
    </div>
  );
}

function ListaCategorias({ tipo, itens, onMudou }: { tipo: 'RECEBER' | 'PAGAR'; itens: Categoria[]; onMudou: () => void }) {
  const [nova, setNova] = useState('');
  const { salvando, salvar } = useSalvar(() => {
    setNova('');
    onMudou();
  });
  return (
    <div className="flex flex-col gap-1.5" data-testid={`fin-cat-${tipo}`}>
      <span className="text-[11px] uppercase tracking-wide text-muted font-semibold">{tipo === 'RECEBER' ? 'Receitas' : 'Despesas'}</span>
      {itens.map((c) => (
        <label key={c.id} className={cn('flex items-center gap-2 text-sm', !c.ativo && 'text-muted line-through')}>
          <input
            type="checkbox"
            checked={c.ativo}
            disabled={salvando}
            onChange={(e) => salvar(() => api.put(`/financeiro/categorias/${c.id}`, { tipo, nome: c.nome, ativo: e.target.checked }), 'Categoria salva')}
          />
          {c.nome}
        </label>
      ))}
      <div className="flex gap-1.5 pt-1">
        <Input value={nova} onChange={(e) => setNova(e.target.value)} placeholder="Nova categoria" className="h-8" />
        <Button size="sm" variant="secondary" disabled={nova.trim().length < 2 || salvando} onClick={() => salvar(() => api.post('/financeiro/categorias', { tipo, nome: nova.trim() }), 'Categoria criada')}>
          +
        </Button>
      </div>
    </div>
  );
}

function ContaDialog({ conta, onClose, onPronto }: { conta: Conta | null; onClose: () => void; onPronto: () => void }) {
  const [nome, setNome] = useState(conta?.nome ?? '');
  const [tipo, setTipo] = useState(conta?.tipo ?? 'BANCO');
  const [saldo, setSaldo] = useState(paraCampo(conta?.saldoInicial ?? 0));
  const [ativo, setAtivo] = useState(conta?.ativo ?? true);
  const { salvando, salvar } = useSalvar(onPronto);
  const corpo = { nome: nome.trim(), tipo, saldoInicial: lerNumero(saldo) ?? 0, ativo };
  return (
    <Dialog
      open
      onClose={onClose}
      title={conta ? 'Editar conta' : 'Nova conta'}
      footer={
        <div className="flex w-full justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Voltar
          </Button>
          <Button
            loading={salvando}
            disabled={nome.trim().length < 2}
            onClick={() => salvar(() => (conta ? api.put(`/financeiro/contas/${conta.id}`, corpo) : api.post('/financeiro/contas', corpo)), 'Conta salva')}
          >
            Salvar
          </Button>
        </div>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="Nome" className="col-span-2">
          <Input value={nome} onChange={(e) => setNome(e.target.value)} />
        </Field>
        <Field label="Tipo">
          <Select value={tipo} onChange={(e) => setTipo(e.target.value)}>
            <option value="BANCO">Banco</option>
            <option value="ASAAS">Asaas</option>
            <option value="DINHEIRO">Dinheiro</option>
            <option value="OUTRA">Outra</option>
          </Select>
        </Field>
        <Field label="Saldo inicial (R$)" hint="O saldo do dia em que começou a usar">
          <Input value={saldo} onChange={(e) => setSaldo(e.target.value)} inputMode="decimal" />
        </Field>
        {conta && (
          <div className="col-span-2">
            <Switch label="Ativa" checked={ativo} onChange={(e) => setAtivo(e.target.checked)} />
          </div>
        )}
      </div>
    </Dialog>
  );
}

function RecorrenciaDialog({
  rec,
  categorias,
  onClose,
  onPronto,
}: {
  rec: Recorrencia | null;
  categorias: Categoria[];
  onClose: () => void;
  onPronto: () => void;
}) {
  const [tipo, setTipo] = useState<'RECEBER' | 'PAGAR'>(rec?.tipo ?? 'PAGAR');
  const [descricao, setDescricao] = useState(rec?.descricao ?? '');
  const [valor, setValor] = useState(paraCampo(rec?.valor));
  const [dia, setDia] = useState(String(rec?.dia ?? 5));
  const [categoriaId, setCategoriaId] = useState(rec?.categoriaId ?? '');
  const [contato, setContato] = useState(rec?.contatoNome ?? '');
  const [ativo, setAtivo] = useState(rec?.ativo ?? true);
  const { salvando, salvar } = useSalvar(onPronto);
  const v = lerNumero(valor);
  const d = Number.parseInt(dia, 10);
  const corpo = { tipo, descricao: descricao.trim(), valor: v, dia: d, categoriaId: categoriaId || null, contatoNome: contato, ativo };
  const valido = descricao.trim().length >= 2 && v !== null && v > 0 && d >= 1 && d <= 31;
  return (
    <Dialog
      open
      onClose={onClose}
      title={rec ? 'Editar recorrente' : 'Nova recorrente'}
      description="Gera o lançamento deste mês e do próximo; os seguintes aparecem sozinhos."
      footer={
        <div className="flex w-full justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Voltar
          </Button>
          <Button
            loading={salvando}
            disabled={!valido}
            data-testid="fin-rec-salvar"
            onClick={() => salvar(() => (rec ? api.put(`/financeiro/recorrencias/${rec.id}`, corpo) : api.post('/financeiro/recorrencias', corpo)), 'Recorrente salva')}
          >
            Salvar
          </Button>
        </div>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="Tipo">
          <Select value={tipo} onChange={(e) => setTipo(e.target.value as 'RECEBER' | 'PAGAR')} disabled={Boolean(rec)}>
            <option value="PAGAR">A pagar</option>
            <option value="RECEBER">A receber</option>
          </Select>
        </Field>
        <Field label="Dia do mês" hint="31 vira o último dia em mês curto">
          <Input value={dia} onChange={(e) => setDia(e.target.value.replace(/\D/g, ''))} inputMode="numeric" />
        </Field>
        <Field label="Descrição" className="col-span-2">
          <Input value={descricao} onChange={(e) => setDescricao(e.target.value)} placeholder="Aluguel, contador…" data-testid="fin-rec-descricao" />
        </Field>
        <Field label="Valor (R$)">
          <Input value={valor} onChange={(e) => setValor(e.target.value)} inputMode="decimal" data-testid="fin-rec-valor" />
        </Field>
        <Field label="Categoria">
          <Select value={categoriaId} onChange={(e) => setCategoriaId(e.target.value)}>
            <option value="">Sem categoria</option>
            {categorias
              .filter((c) => c.tipo === tipo && (c.ativo || c.id === categoriaId))
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome}
                </option>
              ))}
          </Select>
        </Field>
        <Field label="Com quem" className="col-span-2">
          <Input value={contato} onChange={(e) => setContato(e.target.value)} />
        </Field>
        {rec && (
          <div className="col-span-2">
            <Switch label="Ativa" checked={ativo} onChange={(e) => setAtivo(e.target.checked)} />
          </div>
        )}
      </div>
    </Dialog>
  );
}
