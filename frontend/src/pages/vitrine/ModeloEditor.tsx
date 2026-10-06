import { useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, Copy, Plus, Trash2, X } from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';
import { formatMoeda } from '@/lib/masks';
import { useToast } from '@/components/toast';
import { useApiQuery } from '@/hooks/useApiQuery';
import { Button, Checkbox, Dialog, Field, Input, Select, Switch, Tabs, Textarea } from '@/components/ui';
import { CorDialog } from './ListasEmpresa';
import { FichaTecnicaAba } from './FichaTecnica';
import { FotosDaCor, VideosDoModelo } from './MidiaModelo';
import { pendenciasDoModelo } from './pendencias';
import {
  dinheiroParaNumero,
  type Categoria,
  type Cor,
  type Linha,
  type Modelo,
  type TabelaMedidas,
} from './tipos';

/** "39,90" / "39.9" / "" → número ou null ("sob consulta"). Inválido → NaN. */
export function lerPreco(texto: string): number | null {
  const t = texto.trim().replace(/\s/g, '').replace('R$', '');
  if (!t) return null;
  const normal = t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t;
  const n = Number(normal);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : Number.NaN;
}

function precoParaTexto(v: number | string | null): string {
  const n = dinheiroParaNumero(v);
  return n === null ? '' : String(n).replace('.', ',');
}

const CAMPOS_PRECO = ['precoEntrada', 'precoVolume', 'precoAtacadao', 'precoSugerido'] as const;

export interface RascunhoLinha {
  marcada: boolean;
  tamanhoIds: string[];
  precoEntrada: string;
  precoVolume: string;
  precoAtacadao: string;
  precoSugerido: string;
  /** Cabeçalho da tabela de medidas (ex.: Tórax, Comprimento). */
  colunas: string[];
  /** tamanho (nome) → um valor por coluna. */
  medidas: Record<string, string[]>;
}

export interface Rascunho {
  nome: string;
  categoriaId: string;
  descricao: string;
  etiquetas: string;
  ativo: boolean;
  tituloMarketplace: string;
  descricaoMarketplace: string;
  composicao: string;
  corIds: string[];
  linhas: Record<string, RascunhoLinha>;
}

function rascunhoDe(m: Modelo | null, linhas: Linha[]): Rascunho {
  const porLinha: Record<string, RascunhoLinha> = {};
  for (const l of linhas) {
    const ml = m?.linhas.find((x) => x.linhaId === l.id);
    const tabela = ml?.tabelaMedidas ?? null;
    porLinha[l.id] = {
      marcada: !!ml,
      tamanhoIds: ml?.tamanhos.map((t) => t.tamanhoId) ?? [],
      precoEntrada: precoParaTexto(ml?.precoEntrada ?? null),
      precoVolume: precoParaTexto(ml?.precoVolume ?? null),
      precoAtacadao: precoParaTexto(ml?.precoAtacadao ?? null),
      precoSugerido: precoParaTexto(ml?.precoSugerido ?? null),
      colunas: tabela?.colunas ?? [],
      medidas: Object.fromEntries((tabela?.linhas ?? []).map((r) => [r.tamanho, r.valores])),
    };
  }
  return {
    nome: m?.nome ?? '',
    categoriaId: m?.categoriaId ?? '',
    descricao: m?.descricao ?? '',
    etiquetas: (m?.etiquetas ?? []).join(', '),
    ativo: m?.ativo ?? true,
    tituloMarketplace: m?.tituloMarketplace ?? '',
    descricaoMarketplace: m?.descricaoMarketplace ?? '',
    composicao: m?.composicao ?? '',
    corIds: m?.cores.map((c) => c.corId) ?? [],
    linhas: porLinha,
  };
}

const separar = (t: string) =>
  t
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);

/** Monta o corpo do PUT/POST. Erro de digitação vira mensagem, não envio. */
export function montarCorpo(
  r: Rascunho,
  linhas: Linha[],
): { ok: true; corpo: Record<string, unknown> } | { ok: false; erro: string } {
  if (!r.nome.trim()) return { ok: false, erro: 'Dê um nome ao modelo' };
  const linhasCorpo: Record<string, unknown>[] = [];
  for (const l of linhas) {
    const rl = r.linhas[l.id];
    if (!rl?.marcada) continue;
    if (rl.tamanhoIds.length === 0) {
      return { ok: false, erro: `Marque ao menos um tamanho na linha ${l.nome}` };
    }
    const precos: Record<string, number | null> = {};
    for (const campo of CAMPOS_PRECO) {
      const v = lerPreco(rl[campo]);
      if (Number.isNaN(v)) return { ok: false, erro: `Preço inválido na linha ${l.nome}` };
      precos[campo] = v;
    }
    let tabelaMedidas: TabelaMedidas | null = null;
    const colunas = rl.colunas.map((c) => c.trim()).filter(Boolean);
    if (colunas.length) {
      if (colunas.length !== rl.colunas.length) {
        return { ok: false, erro: `Tabela de medidas (${l.nome}): dê nome a todas as colunas` };
      }
      const nomes = l.tamanhos.filter((t) => rl.tamanhoIds.includes(t.id)).map((t) => t.nome);
      const linhasTabela = nomes
        .map((n) => ({ tamanho: n, valores: (rl.medidas[n] ?? []).map((v) => v.trim()) }))
        .filter((x) => x.valores.some(Boolean))
        // Coluna nova sem valor ainda vira "" — a tabela fica retangular.
        .map((x) => ({
          ...x,
          valores: colunas.map((_, i) => x.valores[i] ?? ''),
        }));
      tabelaMedidas = { colunas, linhas: linhasTabela };
    }
    linhasCorpo.push({ linhaId: l.id, tamanhoIds: rl.tamanhoIds, ...precos, tabelaMedidas });
  }
  return {
    ok: true,
    corpo: {
      nome: r.nome.trim(),
      categoriaId: r.categoriaId || null,
      descricao: r.descricao.trim() || null,
      etiquetas: separar(r.etiquetas),
      ativo: r.ativo,
      tituloMarketplace: r.tituloMarketplace.trim() || null,
      descricaoMarketplace: r.descricaoMarketplace.trim() || null,
      composicao: r.composicao.trim() || null,
      corIds: r.corIds,
      linhas: linhasCorpo,
    },
  };
}

/** Copia os 4 preços de uma linha pra outra (item 9). Puro. */
export function copiarPrecos(r: Rascunho, de: string, para: string): Rascunho {
  const origem = r.linhas[de];
  const destino = r.linhas[para];
  if (!origem || !destino) return r;
  const precos = Object.fromEntries(CAMPOS_PRECO.map((c) => [c, origem[c]])) as Pick<
    RascunhoLinha,
    (typeof CAMPOS_PRECO)[number]
  >;
  return { ...r, linhas: { ...r.linhas, [para]: { ...destino, ...precos } } };
}

type Aba = 'dados' | 'cores' | 'grades' | 'variacoes' | 'kit' | 'ficha';

export function ModeloEditor({
  modelo,
  cores,
  linhas,
  categorias,
  onClose,
  onSalvou,
  onExcluiu,
  onListasMudaram,
}: {
  /** null = modelo novo. */
  modelo: Modelo | null;
  cores: Cor[];
  linhas: Linha[];
  categorias: Categoria[];
  onClose: () => void;
  onSalvou: (m: Modelo) => void;
  onExcluiu: () => void;
  onListasMudaram: () => void;
}) {
  const toast = useToast();
  const precificacao = useApiQuery<{ ativa: boolean }>('/precificacao/status');
  // ERP próprio ligado: aba de ficha técnica (só com o modelo já salvo).
  const erp = useApiQuery<{ ativo: boolean }>('/erp/estoque/status');
  const [aba, setAba] = useState<Aba>('dados');
  const [atual, setAtual] = useState<Modelo | null>(modelo);
  const [r, setR] = useState<Rascunho>(() => rascunhoDe(modelo, linhas));
  const [salvando, setSalvando] = useState(false);
  const [novaCor, setNovaCor] = useState(false);
  const [novaCategoria, setNovaCategoria] = useState('');

  const set = <K extends keyof Rascunho>(k: K, v: Rascunho[K]) => setR((x) => ({ ...x, [k]: v }));
  const setLinha = (linhaId: string, patch: Partial<RascunhoLinha>) =>
    setR((x) => ({ ...x, linhas: { ...x.linhas, [linhaId]: { ...x.linhas[linhaId], ...patch } } }));

  async function recarregar(id: string) {
    const m = await api.get<Modelo>(`/vitrine/admin/modelos/${id}`);
    setAtual(m);
    onSalvou(m);
  }

  async function salvar() {
    const montado = montarCorpo(r, linhas);
    if (!montado.ok) return toast.error(montado.erro);
    setSalvando(true);
    try {
      const eraNovo = !atual;
      const m = atual
        ? await api.put<Modelo>(`/vitrine/admin/modelos/${atual.id}`, montado.corpo)
        : await api.post<Modelo>('/vitrine/admin/modelos', montado.corpo);
      setAtual(m);
      onSalvou(m);
      if (eraNovo) {
        toast.success('Modelo criado — agora as cores e as fotos');
        setAba('cores');
      } else {
        toast.success('Modelo salvo');
      }
    } catch (err) {
      toast.error('Não foi possível salvar o modelo', apiErrorMessage(err));
    } finally {
      setSalvando(false);
    }
  }

  async function excluirModelo() {
    if (!atual) return;
    if (
      !window.confirm(
        `Excluir o modelo "${atual.nome}"? Fotos e vídeos são apagados. Pedidos antigos continuam com os produtos.`,
      )
    )
      return;
    try {
      await api.delete(`/vitrine/admin/modelos/${atual.id}`);
      toast.success('Modelo excluído');
      onExcluiu();
      onClose();
    } catch (err) {
      toast.error('Não foi possível excluir', apiErrorMessage(err));
    }
  }

  async function criarCategoria() {
    const nome = novaCategoria.trim();
    if (!nome) return;
    try {
      const cat = await api.post<Categoria>('/vitrine/admin/categorias', {
        nome,
        ordem: categorias.length,
      });
      setNovaCategoria('');
      set('categoriaId', cat.id);
      onListasMudaram();
    } catch (err) {
      toast.error('Não foi possível criar a categoria', apiErrorMessage(err));
    }
  }

  async function salvarVariacao(id: string, campo: 'sku' | 'estoque', valor: string) {
    const v = valor.trim();
    const corpo =
      campo === 'sku'
        ? { sku: v || null }
        : { estoque: v === '' ? null : Number.parseInt(v, 10) };
    if (campo === 'estoque' && corpo.estoque !== null && Number.isNaN(corpo.estoque as number)) {
      return toast.error('Estoque precisa ser um número inteiro');
    }
    try {
      await api.patch(`/vitrine/admin/variacoes/${id}`, corpo);
      if (atual) await recarregar(atual.id);
    } catch (err) {
      toast.error('Não foi possível salvar a variação', apiErrorMessage(err));
    }
  }

  const coresAtivas = cores.filter((c) => c.ativo || r.corIds.includes(c.id));
  const linhasAtivas = linhas.filter((l) => l.ativo || r.linhas[l.id]?.marcada);
  const linhasMarcadas = linhasAtivas.filter((l) => r.linhas[l.id]?.marcada);
  const categoriasAtivas = categorias.filter((c) => c.ativo || c.id === r.categoriaId);
  const pendencias = atual ? pendenciasDoModelo(atual) : [];

  return (
    <Dialog
      open
      onClose={onClose}
      size="xl"
      title={atual ? `Modelo · ${atual.nome}` : 'Novo modelo'}
      footer={
        <>
          {atual && (
            <Button
              variant="danger"
              className="mr-auto"
              onClick={() => void excluirModelo()}
              data-testid="vitrine-excluir-modelo"
            >
              <Trash2 size={14} /> Excluir modelo
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>
            Fechar
          </Button>
          <Button onClick={salvar} loading={salvando} data-testid="vitrine-salvar-modelo">
            Salvar
          </Button>
        </>
      }
    >
      {/* Item 7: o que falta, clicável, sempre visível. */}
      {!atual ? (
        <p className="mb-3 rounded-[10px] border border-border bg-surface-hover px-3 py-2 text-sm text-muted">
          Passo a passo: <strong className="text-text">1. Dados</strong> → Salvar →{' '}
          <strong className="text-text">2. Cores e fotos</strong> →{' '}
          <strong className="text-text">3. Grades e preços</strong> →{' '}
          <strong className="text-text">4. Material de divulgação</strong>.
        </p>
      ) : pendencias.length === 0 ? (
        <p className="mb-3 flex items-center gap-2 text-sm text-success">
          <CheckCircle2 size={16} /> Completo: este modelo aparece na vitrine.
        </p>
      ) : (
        <ul className="mb-3 flex flex-wrap gap-2" data-testid="vitrine-pendencias">
          {pendencias.map((p) => (
            <li key={p.texto}>
              <button
                type="button"
                onClick={() => setAba(p.aba)}
                className={`flex items-center gap-1.5 rounded-[10px] border px-2.5 py-1 text-xs ${
                  p.nivel === 'bloqueia'
                    ? 'border-danger/40 bg-danger/10 text-danger'
                    : 'border-warning/40 bg-warning/10 text-warning'
                }`}
              >
                <AlertTriangle size={12} /> {p.texto}
              </button>
            </li>
          ))}
        </ul>
      )}

      <Tabs
        value={aba}
        onChange={(v) => setAba(v as Aba)}
        items={[
          { value: 'dados', label: '1. Dados' },
          { value: 'cores', label: '2. Cores e fotos' },
          { value: 'grades', label: '3. Grades e preços' },
          { value: 'variacoes', label: 'Variações', count: atual?.variacoes.length },
          { value: 'kit', label: '4. Material de divulgação' },
          ...(erp.data?.ativo && atual ? [{ value: 'ficha', label: 'Ficha técnica' }] : []),
        ]}
        className="mb-4"
      />

      {aba === 'dados' && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Nome" required className="sm:col-span-2">
            <Input value={r.nome} maxLength={120} onChange={(e) => set('nome', e.target.value)} data-testid="vitrine-modelo-nome" />
          </Field>
          <Field label="Categoria">
            <Select
              value={r.categoriaId}
              onChange={(e) => set('categoriaId', e.target.value)}
              data-testid="vitrine-modelo-categoria"
            >
              <option value="">— sem categoria —</option>
              {categoriasAtivas.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Nova categoria" hint="Cria e já seleciona">
            <div className="flex gap-2">
              <Input
                value={novaCategoria}
                onChange={(e) => setNovaCategoria(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void criarCategoria()}
                placeholder="Ex.: Moletom"
                maxLength={60}
              />
              <Button variant="secondary" onClick={() => void criarCategoria()} aria-label="Criar categoria">
                <Plus size={14} />
              </Button>
            </div>
          </Field>
          <Field label="Etiquetas" hint="Separadas por vírgula: Gramatura 280, Capuz" className="sm:col-span-2">
            <Input value={r.etiquetas} onChange={(e) => set('etiquetas', e.target.value)} />
          </Field>
          <Field label="Descrição curta (vitrine)" className="sm:col-span-2">
            <Textarea value={r.descricao} rows={3} maxLength={4000} onChange={(e) => set('descricao', e.target.value)} />
          </Field>
          <Switch label="Ativo na vitrine" checked={r.ativo} onChange={(e) => set('ativo', e.target.checked)} />
        </div>
      )}

      {aba === 'cores' && (
        <div className="flex flex-col gap-4">
          <div>
            <div className="mb-2 flex items-center justify-between">
              <p className="text-sm text-muted">Marque as cores que este modelo tem e salve.</p>
              <Button size="sm" variant="ghost" onClick={() => setNovaCor(true)}>
                <Plus size={14} /> Criar cor
              </Button>
            </div>
            <div className="flex flex-wrap gap-2">
              {coresAtivas.map((c) => {
                const marcada = r.corIds.includes(c.id);
                return (
                  <label
                    key={c.id}
                    className={`flex cursor-pointer items-center gap-2 rounded-[10px] border px-3 py-1.5 text-sm ${marcada ? 'border-primary bg-primary/10' : 'border-border'}`}
                  >
                    <Checkbox
                      checked={marcada}
                      onChange={(e) =>
                        set('corIds', e.target.checked ? [...r.corIds, c.id] : r.corIds.filter((x) => x !== c.id))
                      }
                    />
                    <span className="inline-block h-4 w-4 rounded-full border border-border" style={{ background: c.hex }} />
                    {c.nome}
                  </label>
                );
              })}
            </div>
          </div>
          {!atual ? (
            <p className="text-sm text-muted">Salve o modelo pra poder enviar as fotos de cada cor.</p>
          ) : (
            <div className="flex flex-col gap-3">
              {atual.cores.map((mc) => (
                <FotosDaCor key={mc.id} modeloCor={mc} onMudou={() => void recarregar(atual.id)} />
              ))}
              {r.corIds.some((id) => !atual.cores.find((c) => c.corId === id)) && (
                <p className="text-xs text-warning">Cor marcada agora: salve pra liberar o envio das fotos dela.</p>
              )}
            </div>
          )}
          <CorDialog
            key={novaCor ? 'aberta' : 'fechada'}
            form={novaCor ? { nome: '', hex: '#1A2D38', ativo: true } : null}
            onClose={() => setNovaCor(false)}
            onSalvou={(cor) => {
              onListasMudaram();
              set('corIds', [...r.corIds, cor.id]);
            }}
          />
        </div>
      )}

      {aba === 'grades' && (
        <div className="flex flex-col gap-3">
          {linhasAtivas.length === 0 && (
            <p className="text-sm text-muted">Crie as linhas e os tamanhos na aba "Linhas e tamanhos" da vitrine.</p>
          )}
          {linhasAtivas.map((l) => {
            const rl = r.linhas[l.id];
            if (!rl) return null;
            const entrada = lerPreco(rl.precoEntrada);
            const sugerido = lerPreco(rl.precoSugerido);
            const lucro =
              entrada !== null && sugerido !== null && !Number.isNaN(entrada) && !Number.isNaN(sugerido)
                ? sugerido - entrada
                : null;
            const outras = linhasMarcadas.filter((o) => o.id !== l.id);
            // Atalho pra calculadora: só com a linha JÁ salva no modelo (abre com os preços salvos).
            const linhaSalva = atual?.linhas.find((x) => x.linhaId === l.id);
            return (
              <div key={l.id} className="rounded-[10px] border border-border p-3">
                <Switch label={`Linha ${l.nome}`} checked={rl.marcada} onChange={(e) => setLinha(l.id, { marcada: e.target.checked })} />
                {rl.marcada && (
                  <div className="mt-3 flex flex-col gap-3">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {l.tamanhos
                        .filter((t) => t.ativo || rl.tamanhoIds.includes(t.id))
                        .map((t) => {
                          const on = rl.tamanhoIds.includes(t.id);
                          return (
                            <button
                              key={t.id}
                              type="button"
                              onClick={() =>
                                setLinha(l.id, {
                                  tamanhoIds: on ? rl.tamanhoIds.filter((x) => x !== t.id) : [...rl.tamanhoIds, t.id],
                                })
                              }
                              className={`min-w-10 rounded-[10px] border px-2.5 py-1 text-sm ${on ? 'border-primary bg-primary text-white' : 'border-border'}`}
                            >
                              {t.nome}
                            </button>
                          );
                        })}
                      <button
                        type="button"
                        className="ml-1 text-xs text-primary underline"
                        onClick={() => setLinha(l.id, { tamanhoIds: l.tamanhos.filter((t) => t.ativo).map((t) => t.id) })}
                      >
                        todos
                      </button>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-4">
                      <Field label="Atacado · Entrada (R$)">
                        <Input value={rl.precoEntrada} inputMode="decimal" onChange={(e) => setLinha(l.id, { precoEntrada: e.target.value })} placeholder="sob consulta" />
                      </Field>
                      <Field label="Atacado · Volume (R$)">
                        <Input value={rl.precoVolume} inputMode="decimal" onChange={(e) => setLinha(l.id, { precoVolume: e.target.value })} placeholder="sob consulta" />
                      </Field>
                      <Field label="Atacadão (R$)">
                        <Input value={rl.precoAtacadao} inputMode="decimal" onChange={(e) => setLinha(l.id, { precoAtacadao: e.target.value })} placeholder="sob consulta" />
                      </Field>
                      <Field label="Revenda sugerida (R$)">
                        <Input value={rl.precoSugerido} inputMode="decimal" onChange={(e) => setLinha(l.id, { precoSugerido: e.target.value })} />
                      </Field>
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      {lucro !== null && entrada !== null && entrada > 0 ? (
                        <p className="text-sm text-muted">
                          Lucro do lojista na faixa Entrada: <strong className="text-text">{formatMoeda(lucro)}</strong> por peça
                        </p>
                      ) : (
                        <span />
                      )}
                      {precificacao.data?.ativa && linhaSalva && (
                        <Link
                          to={`/precificacao?linha=${linhaSalva.id}`}
                          className="text-xs font-semibold text-primary underline"
                          title="Abre a calculadora com os preços SALVOS desta linha"
                        >
                          Calcular lucro →
                        </Link>
                      )}
                      {outras.length > 0 && (
                        <label className="flex items-center gap-2 text-xs text-muted">
                          <Copy size={12} /> Copiar preços de
                          <Select
                            value=""
                            onChange={(e) => e.target.value && setR((x) => copiarPrecos(x, e.target.value, l.id))}
                            className="h-8 w-36"
                          >
                            <option value="">escolha…</option>
                            {outras.map((o) => (
                              <option key={o.id} value={o.id}>
                                {o.nome}
                              </option>
                            ))}
                          </Select>
                        </label>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {aba === 'ficha' && atual && (
        <FichaTecnicaAba
          modeloId={atual.id}
          linhas={atual.linhas.map((l) => ({ id: l.id, nome: l.linha.nome }))}
        />
      )}

      {aba === 'variacoes' && (
        <TabelaVariacoes modelo={atual} onSalvar={salvarVariacao} />
      )}

      {aba === 'kit' && (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-muted">O que o revendedor baixa pra montar o próprio anúncio no marketplace.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Título sugerido pro marketplace" hint={`${r.tituloMarketplace.length}/60`} className="sm:col-span-2">
              <Input value={r.tituloMarketplace} maxLength={60} onChange={(e) => set('tituloMarketplace', e.target.value)} />
            </Field>
            <Field label="Descrição pro marketplace" className="sm:col-span-2">
              <Textarea value={r.descricaoMarketplace} rows={5} maxLength={8000} onChange={(e) => set('descricaoMarketplace', e.target.value)} />
            </Field>
            <Field label="Composição" hint="Ex.: 50% algodão, 50% poliéster" className="sm:col-span-2">
              <Input value={r.composicao} maxLength={200} onChange={(e) => set('composicao', e.target.value)} />
            </Field>
          </div>
          {linhasMarcadas.map((l) => (
            <TabelaMedidasEditor
              key={l.id}
              linha={l}
              rl={r.linhas[l.id]}
              onChange={(patch) => setLinha(l.id, patch)}
            />
          ))}
          {atual ? (
            <VideosDoModelo modeloId={atual.id} videos={atual.videos} onMudou={() => void recarregar(atual.id)} />
          ) : (
            <p className="text-sm text-muted">Salve o modelo pra poder enviar vídeos.</p>
          )}
        </div>
      )}
    </Dialog>
  );
}

/** Itens 2 e 3: cada combinação cor × linha × tamanho, com SKU e estoque. */
function TabelaVariacoes({
  modelo,
  onSalvar,
}: {
  modelo: Modelo | null;
  onSalvar: (id: string, campo: 'sku' | 'estoque', valor: string) => unknown;
}) {
  if (!modelo || modelo.variacoes.length === 0) {
    return (
      <p className="text-sm text-muted">
        As variações nascem sozinhas quando o modelo tem cor e grade salvas (cada cor × cada tamanho marcado).
      </p>
    );
  }
  const corPorId = new Map(modelo.cores.map((c) => [c.id, c.cor]));
  const tamPorId = new Map(
    modelo.linhas.flatMap((l) => l.tamanhos.map((t) => [t.id, { linha: l.linha.nome, tamanho: t.tamanho.nome, ordem: t.tamanho.ordem }] as const)),
  );
  const linhas = modelo.variacoes
    .map((v) => ({ v, cor: corPorId.get(v.modeloCorId), tam: tamPorId.get(v.modeloTamanhoId) }))
    .sort(
      (a, b) =>
        (a.cor?.nome ?? '').localeCompare(b.cor?.nome ?? '') ||
        (a.tam?.linha ?? '').localeCompare(b.tam?.linha ?? '') ||
        (a.tam?.ordem ?? 0) - (b.tam?.ordem ?? 0),
    );
  return (
    <div>
      <p className="mb-2 text-sm text-muted">
        {modelo.variacoes.length} variações. SKU e estoque são opcionais nesta fase — estoque não bloqueia venda.
      </p>
      <div className="max-h-[50vh] overflow-auto rounded-[10px] border border-border">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-surface">
            <tr className="text-left text-xs text-muted">
              <th className="px-3 py-2">Cor</th>
              <th className="px-3 py-2">Linha · tamanho</th>
              <th className="px-3 py-2">SKU</th>
              <th className="px-3 py-2 w-28">Estoque</th>
            </tr>
          </thead>
          <tbody>
            {linhas.map(({ v, cor, tam }) => (
              <tr key={v.id} className="border-t border-border">
                <td className="px-3 py-1.5">
                  <span className="flex items-center gap-2">
                    <span className="inline-block h-3.5 w-3.5 rounded-full border border-border" style={{ background: cor?.hex }} />
                    {cor?.nome}
                  </span>
                </td>
                <td className="px-3 py-1.5">
                  {tam?.linha} · <strong>{tam?.tamanho}</strong>
                </td>
                <td className="px-3 py-1.5">
                  <Input
                    defaultValue={v.sku ?? ''}
                    maxLength={60}
                    className="h-8"
                    onBlur={(e) => e.target.value !== (v.sku ?? '') && void onSalvar(v.id, 'sku', e.target.value)}
                  />
                </td>
                <td className="px-3 py-1.5">
                  <Input
                    defaultValue={v.estoque?.toString() ?? ''}
                    inputMode="numeric"
                    className="h-8"
                    onBlur={(e) =>
                      e.target.value !== (v.estoque?.toString() ?? '') && void onSalvar(v.id, 'estoque', e.target.value)
                    }
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Item 8: tabela de medidas em grade — uma célula por tamanho × medida. */
function TabelaMedidasEditor({
  linha,
  rl,
  onChange,
}: {
  linha: Linha;
  rl: RascunhoLinha;
  onChange: (patch: Partial<RascunhoLinha>) => void;
}) {
  const tamanhos = linha.tamanhos.filter((t) => rl.tamanhoIds.includes(t.id));
  const setCelula = (tamanho: string, col: number, valor: string) => {
    const atual = [...(rl.medidas[tamanho] ?? [])];
    while (atual.length < rl.colunas.length) atual.push('');
    atual[col] = valor;
    onChange({ medidas: { ...rl.medidas, [tamanho]: atual } });
  };
  const removerColuna = (col: number) =>
    onChange({
      colunas: rl.colunas.filter((_, i) => i !== col),
      medidas: Object.fromEntries(
        Object.entries(rl.medidas).map(([t, vals]) => [t, vals.filter((_, i) => i !== col)]),
      ),
    });

  return (
    <div className="rounded-[10px] border border-border p-3">
      <div className="mb-2 flex items-center justify-between">
        <p className="font-medium text-text">Tabela de medidas (cm) · {linha.nome}</p>
        <Button size="sm" variant="ghost" onClick={() => onChange({ colunas: [...rl.colunas, ''] })}>
          <Plus size={14} /> Medida
        </Button>
      </div>
      {rl.colunas.length === 0 ? (
        <p className="text-sm text-muted">Sem tabela. Clique em "+ Medida" pra criar uma coluna (ex.: Tórax).</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="text-sm">
            <thead>
              <tr>
                <th className="px-1 py-1 text-left text-xs text-muted">Tamanho</th>
                {rl.colunas.map((c, i) => (
                  <th key={i} className="px-1 py-1">
                    <div className="flex items-center gap-1">
                      <Input
                        value={c}
                        placeholder="Ex.: Tórax"
                        maxLength={30}
                        className="h-8 w-28"
                        onChange={(e) => onChange({ colunas: rl.colunas.map((x, j) => (j === i ? e.target.value : x)) })}
                      />
                      <button type="button" onClick={() => removerColuna(i)} aria-label="Remover medida" className="text-muted hover:text-danger">
                        <X size={14} />
                      </button>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tamanhos.map((t) => (
                <tr key={t.id}>
                  <td className="px-1 py-1 font-medium">{t.nome}</td>
                  {rl.colunas.map((_, i) => (
                    <td key={i} className="px-1 py-1">
                      <Input
                        value={rl.medidas[t.nome]?.[i] ?? ''}
                        maxLength={20}
                        inputMode="decimal"
                        className="h-8 w-28"
                        onChange={(e) => setCelula(t.nome, i, e.target.value)}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
