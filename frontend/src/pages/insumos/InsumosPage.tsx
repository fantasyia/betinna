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
import { prepararFoto } from '@/pages/vitrine/imagem';
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
  | { tipo: 'cadastro'; insumo: Insumo | null; copiaDe?: Insumo }
  | { tipo: 'compra'; insumo: Insumo; cor?: string }
  | { tipo: 'movimento'; insumo: Insumo; cor?: string }
  | { tipo: 'historico'; insumo: Insumo; cor?: string };

/** Miniatura da foto do insumo/cor na lista (sem foto, nada). */
function Miniatura({ url, nome }: { url?: string | null; nome: string }) {
  if (!url) return null;
  return (
    <img
      src={url}
      alt={nome}
      loading="lazy"
      className="inline-block h-7 w-7 rounded-md object-cover align-middle mr-2 border border-border"
    />
  );
}

/** "ref." ao lado do custo: ainda é o preço de referência, sem nenhuma compra. */
function MarcaReferencia({ ativo }: { ativo?: boolean }) {
  if (!ativo) return null;
  return (
    <span
      className="block text-[11px] text-muted"
      title="Preço de referência do cadastro — vale até a 1ª compra"
    >
      referência
    </span>
  );
}

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
                          <Miniatura url={i.thumbUrl} nome={i.nome} />
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
                          {!i.temCores && <MarcaReferencia ativo={i.custoDaReferencia} />}
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
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setDlg({ tipo: 'cadastro', insumo: null, copiaDe: i })}
                              data-testid={`insumo-copiar-${i.id}`}
                            >
                              Copiar
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
                              <Miniatura url={c.thumbUrl} nome={`${i.nome} ${c.nome}`} />
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
                            <MarcaReferencia ativo={c.custoDaReferencia} />
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
        <CadastroDialog
          insumo={dlg.insumo}
          copiaDe={dlg.copiaDe}
          onClose={fechar}
          onSalvou={salvou}
        />
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

/**
 * Cadastro e edição de insumo. Com `copiaDe` (Léo, 14/10: "opção de copiar o
 * item"): é um insumo NOVO que já nasce com o nome + " (cópia)", o tipo, a
 * unidade, o fornecedor e todas as cores do original. Saldo, custo, compras,
 * perdas e histórico NÃO vêm — tudo isso é movimento, e o novo nasce zerado.
 */
function CadastroDialog({
  insumo,
  copiaDe,
  onClose,
  onSalvou,
}: {
  insumo: Insumo | null;
  copiaDe?: Insumo;
  onClose: () => void;
  onSalvou: () => void;
}) {
  // Molde dos campos: o próprio insumo (editar) ou o original (copiar).
  const base = insumo ?? copiaDe ?? null;
  const [nome, setNome] = useState(
    insumo ? insumo.nome : copiaDe ? `${copiaDe.nome} (cópia)` : '',
  );
  const [tipo, setTipo] = useState<TipoInsumo>(base?.tipo ?? 'TECIDO');
  const [unidade, setUnidade] = useState<Unidade>(base?.unidade ?? 'KG');
  const [cor, setCor] = useState(base?.cor ?? '');
  // Cores da lista da empresa (a mesma da vitrine). Sem a lista, o campo de texto de antes.
  const coresEmpresa = useApiQuery<CorEmpresa[]>('/erp/insumos/cores');
  const [cores, setCores] = useState<string[]>(
    () => base?.cores.filter((c) => c.ativo).map((c) => c.corId) ?? [],
  );
  const alternar = (id: string) =>
    setCores((xs) => (xs.includes(id) ? xs.filter((x) => x !== id) : [...xs, id]));
  const [fornecedor, setFornecedor] = useState(base?.fornecedor ?? '');
  const [minimo, setMinimo] = useState(paraCampo(insumo?.estoqueMinimo));
  const [ativo, setAtivo] = useState(insumo?.ativo ?? true);
  // Preço de referência (Léo, 14/10): do insumo sem cores e de cada cor. Só do
  // próprio insumo — a cópia nasce sem preço (preço é custo, e custo não copia).
  const [precoRef, setPrecoRef] = useState(paraCampo(insumo?.precoReferencia ?? undefined));
  const [precosCor, setPrecosCor] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      (insumo?.cores ?? []).map((c) => [c.corId, paraCampo(c.precoReferencia ?? undefined)]),
    ),
  );
  // Foto escolhida mas ainda não enviada (sobe depois de salvar, quando a cor já
  // tem id). Chave: corId da lista, ou '' pro insumo sem cores. null = tirar.
  const [fotos, setFotos] = useState<Record<string, { arquivo: File; previa: string } | null>>({});
  const fotoAtual = (chave: string): string | null => {
    if (chave in fotos) return fotos[chave]?.previa ?? null;
    if (!insumo) return null;
    if (!chave) return insumo.thumbUrl ?? null;
    return insumo.cores.find((c) => c.corId === chave)?.thumbUrl ?? null;
  };
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
    precoReferencia: cores.length ? null : lerNumero(precoRef),
    ...(cores.length
      ? { precosCor: Object.fromEntries(cores.map((id) => [id, lerNumero(precosCor[id] ?? '')])) }
      : {}),
  });

  /** Salva o insumo e, com o id em mãos, sobe/tira as fotos escolhidas. */
  async function salvarTudo() {
    const salvo = await (insumo
      ? api.put<Insumo>(`/erp/insumos/${insumo.id}`, corpo())
      : api.post<Insumo>('/erp/insumos', corpo()));
    for (const [chave, escolhida] of Object.entries(fotos)) {
      const arquivo = escolhida?.arquivo ?? null;
      const corDoInsumo = chave ? salvo.cores.find((c) => c.corId === chave)?.id : undefined;
      if (chave && !corDoInsumo) continue; // cor que saiu no mesmo salvar
      if (arquivo === null) {
        await api.delete(
          `/erp/insumos/${salvo.id}/foto${corDoInsumo ? `?corId=${encodeURIComponent(corDoInsumo)}` : ''}`,
        );
        continue;
      }
      const p = await prepararFoto(arquivo);
      const form = new FormData();
      form.append('foto', p.foto, 'foto.webp');
      form.append('thumb', p.thumb, 'thumb.webp');
      if (corDoInsumo) form.append('corId', corDoInsumo);
      await api.upload(`/erp/insumos/${salvo.id}/foto`, form);
    }
    return salvo;
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={insumo ? 'Editar insumo' : copiaDe ? 'Copiar insumo' : 'Novo insumo'}
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
            onClick={() => enviar(salvarTudo)}
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
        <div className="col-span-2 flex flex-col gap-2" data-testid="insumo-precos-fotos">
          <p className="text-sm font-medium text-text">
            {cores.length ? 'Preço de referência e foto por cor' : 'Preço de referência e foto'}
          </p>
          <p className="text-xs text-muted">
            O preço de referência vale como custo até a 1ª compra; depois, o custo é a média das
            compras.
          </p>
          {(cores.length
            ? (coresEmpresa.data ?? []).filter((c) => cores.includes(c.id))
            : [null]
          ).map((c) => {
            const chave = c?.id ?? '';
            const atual = fotoAtual(chave);
            return (
              <div key={chave || 'geral'} className="flex flex-wrap items-center gap-2">
                {c && (
                  <span className="inline-flex w-32 items-center gap-1.5 text-[13px]">
                    <Bolinha hex={c.hex} />
                    {c.nome}
                  </span>
                )}
                <Input
                  value={c ? (precosCor[chave] ?? '') : precoRef}
                  onChange={(e) =>
                    c
                      ? setPrecosCor((x) => ({ ...x, [chave]: e.target.value }))
                      : setPrecoRef(e.target.value)
                  }
                  inputMode="decimal"
                  placeholder={`R$/${SIGLA[unidade]}`}
                  className="h-9 w-28"
                  aria-label={`Preço de referência${c ? ` ${c.nome}` : ''}`}
                  data-testid={`insumo-preco-${chave || 'geral'}`}
                />
                {atual ? (
                  <img src={atual} alt="" className="h-9 w-9 rounded-md object-cover border border-border" />
                ) : null}
                <label className="inline-flex h-9 cursor-pointer items-center rounded-md border border-border px-2.5 text-[13px] text-text-subtle hover:text-text">
                  {atual ? 'Trocar foto' : 'Foto'}
                  <input
                    type="file"
                    accept="image/*"
                    className="sr-only"
                    data-testid={`insumo-foto-${chave || 'geral'}`}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      // Prévia criada UMA vez (não a cada redesenho da tela).
                      if (f) setFotos((x) => ({ ...x, [chave]: { arquivo: f, previa: URL.createObjectURL(f) } }));
                      e.target.value = '';
                    }}
                  />
                </label>
                {atual && (
                  <button
                    type="button"
                    className="text-[12px] text-muted hover:text-danger"
                    onClick={() => setFotos((x) => ({ ...x, [chave]: null }))}
                  >
                    tirar
                  </button>
                )}
              </div>
            );
          })}
        </div>
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
