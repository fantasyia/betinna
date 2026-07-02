import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Plus,
  Trash2,
  AlertCircle,
  CheckCircle2,
  Receipt,
  PackageX,
  PackageCheck,
  Package,
  AlertTriangle,
} from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { AsyncCombobox } from '@/components/AsyncCombobox';
import { useToast } from '@/components/toast';
import { useEmpresaConfig, descontoAVistaPct } from '@/hooks/useEmpresaConfig';
import {
  Button,
  Card,
  Dialog,
  Field,
  IconButton,
  Input,
  Select,
  Textarea,
} from '@/components/ui';
import { cn } from '@/lib/cn';
import { formatMoeda as fmtBRL } from '@/lib/masks';

/**
 * NovoPedidoDialog — modal pra criar pedido novo.
 *
 * Reusável em PedidosPage (sem cliente pré-selecionado) e em ClientesPage
 * (com cliente pré-selecionado).
 */

type PagamentoForma = 'BOLETO' | 'PIX' | 'TED' | 'CARTAO' | 'DINHEIRO';
type CondicaoPgto = 'avista' | '15dias' | '30dias' | '30_60' | '30_60_90';

interface ClienteOpt {
  id: string;
  nome: string;
  cnpj?: string | null;
}

interface ProdutoOpt {
  id: string;
  nome: string;
  sku?: string | null;
  precoTabela?: number;
  /** Estoque atual sincronizado do OMIE (sync 30min ou webhook). */
  estoque?: number;
  /** ISO timestamp do último sync. */
  estoqueAtualizadoEm?: string | null;
}

interface FormItem {
  uiKey: string;
  produto: ProdutoOpt | null;
  quantidade: number;
  desconto: number;
  precoUnitarioOverride: string;
}

function newFormItem(): FormItem {
  return {
    uiKey: Math.random().toString(36).slice(2),
    produto: null,
    quantidade: 1,
    desconto: 0,
    precoUnitarioOverride: '',
  };
}

/**
 * Estado inicial pra reusar valores de outro pedido (duplicar / clonar).
 * Todos os campos são opcionais; se omitido, usa default.
 */
export interface NovoPedidoInicial {
  itens?: Array<{
    produto: ProdutoOpt;
    quantidade: number;
    desconto?: number;
    precoUnitarioOverride?: number;
  }>;
  formaPagamento?: PagamentoForma;
  condicaoPagamento?: CondicaoPgto;
  descontoGeral?: number;
  observacoes?: string;
}

const FORMAS: PagamentoForma[] = ['BOLETO', 'PIX', 'TED', 'CARTAO', 'DINHEIRO'];
const CONDICOES: { value: CondicaoPgto; label: string }[] = [
  { value: 'avista', label: 'À vista' },
  { value: '15dias', label: '15 dias' },
  { value: '30dias', label: '30 dias' },
  { value: '30_60', label: '30/60' },
  { value: '30_60_90', label: '30/60/90' },
];

export function NovoPedidoDialog({
  open,
  clientePreSelecionado,
  inicial,
  editandoPedidoId,
  onClose,
  onCreated,
}: {
  open: boolean;
  /** Quando informado, pré-seleciona o cliente e esconde o seletor. */
  clientePreSelecionado?: ClienteOpt | null;
  /** Valores iniciais (usado pra duplicar/clonar pedido existente). */
  inicial?: NovoPedidoInicial | null;
  /**
   * Quando informado, o submit faz PATCH em /pedidos/:id em vez de POST /pedidos.
   * Backend permite editar itens só em RASCUNHO ou AGUARDANDO_APROVACAO.
   */
  editandoPedidoId?: string | null;
  onClose: () => void;
  onCreated: (pedidoId: string) => void;
}) {
  const toast = useToast();
  const [cliente, setCliente] = useState<ClienteOpt | null>(clientePreSelecionado ?? null);
  const [itens, setItens] = useState<FormItem[]>(() =>
    inicial?.itens && inicial.itens.length > 0
      ? inicial.itens.map((it) => ({
          uiKey: Math.random().toString(36).slice(2),
          produto: it.produto,
          quantidade: it.quantidade,
          desconto: it.desconto ?? 0,
          precoUnitarioOverride:
            it.precoUnitarioOverride !== undefined ? String(it.precoUnitarioOverride) : '',
        }))
      : [newFormItem()],
  );
  const [formaPagamento, setFormaPagamento] = useState<PagamentoForma>(
    inicial?.formaPagamento ?? 'BOLETO',
  );
  const [condicaoPagamento, setCondicaoPagamento] = useState<CondicaoPgto>(
    inicial?.condicaoPagamento ?? '30dias',
  );
  const [descontoGeral, setDescontoGeral] = useState(inicial?.descontoGeral ?? 0);
  const [observacoes, setObservacoes] = useState(inicial?.observacoes ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // BL-2 — detecta catálogo vazio (tenant novo sem produtos sincronizados) pra
  // orientar o onboarding em vez de só mostrar "Nenhum resultado" no seletor.
  const [catalogoVazio, setCatalogoVazio] = useState(false);

  useEffect(() => {
    if (clientePreSelecionado) setCliente(clientePreSelecionado);
  }, [clientePreSelecionado]);

  useEffect(() => {
    if (!open) return;
    let cancel = false;
    void api
      .get<{ data: unknown[] }>('/produtos?limit=1')
      .then((r) => {
        if (!cancel) setCatalogoVazio(Array.isArray(r.data) && r.data.length === 0);
      })
      .catch(() => {
        /* silencioso: a checagem é só um aviso, não pode atrapalhar o pedido */
      });
    return () => {
      cancel = true;
    };
  }, [open]);

  function setItem(idx: number, patch: Partial<FormItem>) {
    setItens((arr) => arr.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  }
  function removeItem(idx: number) {
    setItens((arr) => (arr.length > 1 ? arr.filter((_, i) => i !== idx) : arr));
  }
  function addItem() {
    setItens((arr) => [...arr, newFormItem()]);
  }

  // B1 — config de desconto à vista da empresa ativa (pra preview)
  const { data: empresaCfg } = useEmpresaConfig();
  const descAVistaPctPreview = descontoAVistaPct(empresaCfg, formaPagamento, condicaoPagamento);

  // Preview de total client-side
  const subtotal = itens.reduce((acc, it) => {
    if (!it.produto) return acc;
    const unit = it.precoUnitarioOverride.trim()
      ? Number(it.precoUnitarioOverride) || 0
      : it.produto.precoTabela ?? 0;
    const bruto = unit * it.quantidade;
    return acc + bruto * (1 - it.desconto / 100);
  }, 0);
  // Soma desconto geral (manual) + desconto à vista (automático da empresa),
  // capado em 90% pra não dar total negativo — mesma regra do backend.
  const descontoTotalPct = Math.min(90, descontoGeral + descAVistaPctPreview);
  const total = subtotal * (1 - descontoTotalPct / 100);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!cliente) {
      setError('Selecione um cliente.');
      return;
    }
    if (itens.length === 0) {
      setError('Adicione ao menos um item.');
      return;
    }
    const semProduto = itens.findIndex((it) => !it.produto);
    if (semProduto !== -1) {
      setError(`Selecione o produto do item ${semProduto + 1}.`);
      return;
    }
    const qtInvalida = itens.findIndex((it) => it.quantidade < 1);
    if (qtInvalida !== -1) {
      setError(`Quantidade do item ${qtInvalida + 1} precisa ser pelo menos 1.`);
      return;
    }
    setBusy(true);
    setError(null);

    const itensPayload = itens.map((it) => {
      const obj: Record<string, unknown> = {
        produtoId: it.produto!.id,
        quantidade: it.quantidade,
        desconto: it.desconto,
      };
      if (it.precoUnitarioOverride.trim()) {
        obj.precoUnitarioOverride = Number(it.precoUnitarioOverride);
      }
      return obj;
    });

    try {
      if (editandoPedidoId) {
        // Edit mode: PATCH sem clienteId (backend não aceita mudar cliente)
        const editPayload: Record<string, unknown> = {
          itens: itensPayload,
          formaPagamento,
          condicaoPagamento,
          descontoGeral,
        };
        if (observacoes.trim()) editPayload.observacoes = observacoes.trim();
        await api.patch(`/pedidos/${editandoPedidoId}`, editPayload);
        toast.success('Pedido atualizado');
        onCreated(editandoPedidoId);
      } else {
        const payload: Record<string, unknown> = {
          clienteId: cliente.id,
          itens: itensPayload,
          formaPagamento,
          condicaoPagamento,
          descontoGeral,
        };
        if (observacoes.trim()) payload.observacoes = observacoes.trim();
        const r = await api.post<{ id: string }>('/pedidos', payload);
        toast.success('Pedido criado');
        onCreated(r.id);
      }
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : editandoPedidoId
            ? 'Falha ao salvar alterações'
            : 'Falha ao criar pedido',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={
        editandoPedidoId
          ? 'Editar pedido'
          : inicial
            ? 'Duplicar pedido'
            : 'Novo pedido'
      }
      description={
        editandoPedidoId
          ? 'Backend recalcula totais. Cliente não pode mudar.'
          : inicial
            ? 'Edite antes de criar. Preços serão recalculados pelo backend.'
            : clientePreSelecionado
              ? `Cliente: ${clientePreSelecionado.nome}`
              : undefined
      }
      size="xl"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            type="submit"
            form="pedido-form"
            data-testid="pedido-save-btn"
            loading={busy}
            leftIcon={<CheckCircle2 className="h-3.5 w-3.5" />}
          >
            {editandoPedidoId ? 'Salvar alterações' : 'Criar pedido'}
          </Button>
        </>
      }
    >
      <form id="pedido-form" onSubmit={submit} className="flex flex-col gap-4">
        {catalogoVazio && (
          <div
            data-testid="pedido-catalogo-vazio"
            className="px-3 py-2 rounded-md bg-warning/10 border border-warning/30 text-warning text-sm flex items-start gap-2"
          >
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            <span>
              Nenhum produto no catálogo ainda. Cadastre ou sincronize seus produtos em{' '}
              <Link to="/produtos" onClick={onClose} className="underline font-semibold">
                Produtos
              </Link>{' '}
              antes de montar o pedido.
            </span>
          </div>
        )}
        {!clientePreSelecionado && (
          <Field label="Cliente" required>
            <AsyncCombobox<ClienteOpt>
              testId="cliente-picker"
              endpoint="/clientes"
              placeholder="Buscar cliente por nome ou CNPJ…"
              getLabel={(c) => c.nome}
              getSubLabel={(c) => c.cnpj ?? null}
              getId={(c) => c.id}
              value={cliente}
              onChange={setCliente}
            />
          </Field>
        )}

        <section>
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-[10px] font-semibold uppercase tracking-wider text-muted">
              Itens ({itens.length})
            </h4>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={addItem}
              leftIcon={<Plus className="h-3 w-3" />}
              data-testid="pedido-add-item"
            >
              Adicionar item
            </Button>
          </div>
          <div className="flex flex-col gap-2">
            {itens.map((it, idx) => (
              <ItemRow
                key={it.uiKey}
                item={it}
                onChange={(patch) => setItem(idx, patch)}
                onRemove={itens.length > 1 ? () => removeItem(idx) : null}
                testId={`item-${idx}`}
              />
            ))}
          </div>
        </section>

        <section>
          <h4 className="text-[10px] font-semibold uppercase tracking-wider text-muted mb-2">
            Pagamento
          </h4>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <Field label="Forma">
              <Select
                value={formaPagamento}
                onChange={(e) => setFormaPagamento(e.target.value as PagamentoForma)}
              >
                {FORMAS.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Condição">
              <Select
                value={condicaoPagamento}
                onChange={(e) => setCondicaoPagamento(e.target.value as CondicaoPgto)}
              >
                {CONDICOES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Desconto geral (%)">
              <Input
                type="number"
                min={0}
                max={50}
                step="0.1"
                value={descontoGeral}
                onChange={(e) => setDescontoGeral(Number(e.target.value))}
              />
            </Field>
          </div>
        </section>

        <Field label="Observações" hint="Notas internas, prazos especiais…">
          <Textarea
            value={observacoes}
            onChange={(e) => setObservacoes(e.target.value)}
            rows={3}
          />
        </Field>

        <Card variant="outline" padding="md" className="bg-primary/5 border-primary/30">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-[11px] uppercase tracking-wider text-muted">Total estimado</div>
              <div className="text-2xl font-bold text-text tabular tracking-tight flex items-center gap-2">
                <Receipt className="h-5 w-5 text-primary" />
                {fmtBRL(total)}
              </div>
            </div>
            <div className="text-right text-[11px] text-muted tabular">
              <div>Subtotal: {fmtBRL(subtotal)}</div>
              {descontoGeral > 0 && <div>Desconto geral: {descontoGeral}%</div>}
              {descAVistaPctPreview > 0 && (
                <div className="text-success">
                  Desconto à vista: {descAVistaPctPreview}%
                </div>
              )}
              <div className="text-muted-light mt-1">Backend recalcula no save.</div>
            </div>
          </div>
        </Card>

        {error && (
          <div className="px-3 py-2 rounded-md bg-danger/10 border border-danger/30 text-danger text-sm flex items-start gap-2">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            {error}
          </div>
        )}
      </form>
    </Dialog>
  );
}

function ItemRow({
  item,
  onChange,
  onRemove,
  testId,
}: {
  item: FormItem;
  onChange: (patch: Partial<FormItem>) => void;
  onRemove: (() => void) | null;
  testId: string;
}) {
  const estoque = item.produto?.estoque;
  // Avisos:
  //  - vermelho: produto selecionado com estoque 0 → OMIE vai gerar OP de reposição
  //  - amarelo : quantidade > estoque disponível → vende mais do que tem; OMIE puxa pra produção
  const semEstoque = item.produto !== null && (estoque ?? 0) <= 0;
  const excedeEstoque =
    item.produto !== null && estoque !== undefined && estoque > 0 && item.quantidade > estoque;

  return (
    <div
      data-testid={testId}
      className={cn(
        'grid grid-cols-[1fr_70px_70px_90px_32px] gap-2 items-start p-2.5',
        'rounded-md border bg-bg-alt',
        semEstoque
          ? 'border-danger/40'
          : excedeEstoque
            ? 'border-warning/40'
            : 'border-border',
      )}
    >
      <div className="flex flex-col gap-1">
        <AsyncCombobox<ProdutoOpt>
          testId={`${testId}-produto`}
          endpoint="/produtos"
          placeholder="Buscar produto…"
          getLabel={(p) => p.nome}
          getSubLabel={(p) =>
            [
              p.sku,
              p.precoTabela !== undefined ? fmtBRL(p.precoTabela) : null,
              p.estoque !== undefined ? estoqueLabel(p.estoque) : null,
            ]
              .filter(Boolean)
              .join(' · ')
          }
          getId={(p) => p.id}
          value={item.produto}
          onChange={(p) => onChange({ produto: p })}
        />
        {item.produto && (
          <StockHint
            estoque={estoque}
            quantidade={item.quantidade}
            testId={`${testId}-stock-hint`}
          />
        )}
      </div>
      <Input
        type="number"
        min={1}
        value={item.quantidade}
        onChange={(e) => onChange({ quantidade: Math.max(1, Number(e.target.value)) })}
        data-testid={`${testId}-qt`}
        aria-label="Quantidade"
      />
      <Input
        type="number"
        min={0}
        max={80}
        step="0.1"
        value={item.desconto}
        onChange={(e) => onChange({ desconto: Number(e.target.value) })}
        data-testid={`${testId}-desc`}
        aria-label="Desconto %"
        placeholder="% desc"
      />
      <Input
        type="number"
        min={0}
        step="0.01"
        value={item.precoUnitarioOverride}
        onChange={(e) => {
          const v = e.target.value.replace(',', '.');
          if (v === '' || /^\d*\.?\d*$/.test(v)) {
            onChange({ precoUnitarioOverride: v });
          }
        }}
        data-testid={`${testId}-override`}
        aria-label="Preço override"
        placeholder="preço"
      />
      {onRemove ? (
        <IconButton
          aria-label="Remover item"
          variant="danger"
          size="sm"
          icon={<Trash2 />}
          onClick={onRemove}
          data-testid={`${testId}-remove`}
          className="self-center"
        />
      ) : (
        <span />
      )}
    </div>
  );
}

function estoqueLabel(estoque: number): string {
  if (estoque <= 0) return 'sem estoque';
  if (estoque < 10) return `${estoque} un (baixo)`;
  return `${estoque} un em estoque`;
}

/**
 * Hint inline com semáforo de estoque.
 *
 * NÃO bloqueia o pedido em nenhum caso — só sinaliza. Por design (D-estoque):
 * mesmo sem estoque, o pedido vai pro OMIE e o OMIE gera Ordem de Produção
 * (OP) pra repor ou produzir sob demanda.
 */
function StockHint({
  estoque,
  quantidade,
  testId,
}: {
  estoque: number | undefined;
  quantidade: number;
  testId?: string;
}) {
  if (estoque === undefined) {
    return (
      <div
        data-testid={testId}
        className="flex items-center gap-1 text-[10px] text-muted px-1"
      >
        <Package className="h-2.5 w-2.5" />
        Estoque ainda não sincronizado
      </div>
    );
  }
  if (estoque <= 0) {
    return (
      <div
        data-testid={testId}
        className="flex items-center gap-1 text-[10px] text-danger px-1"
      >
        <PackageX className="h-2.5 w-2.5" />
        <strong>Sem estoque</strong> — pode lançar; OMIE gera OP de reposição
      </div>
    );
  }
  if (quantidade > estoque) {
    return (
      <div
        data-testid={testId}
        className="flex items-center gap-1 text-[10px] text-warning px-1"
      >
        <AlertTriangle className="h-2.5 w-2.5" />
        Quantidade ({quantidade}) maior que estoque ({estoque}) — OMIE produz o restante
      </div>
    );
  }
  if (estoque < 10) {
    return (
      <div
        data-testid={testId}
        className="flex items-center gap-1 text-[10px] text-warning px-1"
      >
        <Package className="h-2.5 w-2.5" />
        Estoque baixo: {estoque} un
      </div>
    );
  }
  return (
    <div
      data-testid={testId}
      className="flex items-center gap-1 text-[10px] text-success px-1"
    >
      <PackageCheck className="h-2.5 w-2.5" />
      {estoque} un disponíveis
    </div>
  );
}

export type { ClienteOpt };
