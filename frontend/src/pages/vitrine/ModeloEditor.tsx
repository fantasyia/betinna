import { useState } from 'react';
import { Plus } from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';
import { formatMoeda } from '@/lib/masks';
import { useToast } from '@/components/toast';
import { Button, Checkbox, Dialog, Field, Input, Switch, Tabs, Textarea } from '@/components/ui';
import { CorDialog } from './ListasEmpresa';
import { FotosDaCor, VideosDoModelo } from './MidiaModelo';
import { dinheiroParaNumero, type Cor, type Linha, type Modelo, type TabelaMedidas } from './tipos';

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

interface RascunhoLinha {
  marcada: boolean;
  tamanhoIds: string[];
  precoEntrada: string;
  precoVolume: string;
  precoAtacadao: string;
  precoSugerido: string;
  /** Colunas da tabela de medidas, separadas por vírgula. */
  colunas: string;
  /** tamanho (nome) → valores por coluna, separados por vírgula na tela. */
  medidas: Record<string, string>;
}

interface Rascunho {
  nome: string;
  categoria: string;
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
      colunas: tabela?.colunas.join(', ') ?? '',
      medidas: Object.fromEntries(
        (tabela?.linhas ?? []).map((r) => [r.tamanho, r.valores.join(', ')]),
      ),
    };
  }
  return {
    nome: m?.nome ?? '',
    categoria: m?.categoria ?? '',
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
    for (const campo of ['precoEntrada', 'precoVolume', 'precoAtacadao', 'precoSugerido'] as const) {
      const v = lerPreco(rl[campo]);
      if (Number.isNaN(v)) return { ok: false, erro: `Preço inválido na linha ${l.nome}` };
      precos[campo] = v;
    }
    let tabelaMedidas: TabelaMedidas | null = null;
    const colunas = separar(rl.colunas);
    if (colunas.length) {
      const nomes = l.tamanhos.filter((t) => rl.tamanhoIds.includes(t.id)).map((t) => t.nome);
      const linhasTabela = nomes
        .filter((n) => (rl.medidas[n] ?? '').trim())
        .map((n) => ({ tamanho: n, valores: (rl.medidas[n] ?? '').split(',').map((x) => x.trim()) }));
      const torto = linhasTabela.find((x) => x.valores.length !== colunas.length);
      if (torto) {
        return {
          ok: false,
          erro: `Medidas do tamanho ${torto.tamanho} (${l.nome}): informe ${colunas.length} valor(es), um por coluna`,
        };
      }
      tabelaMedidas = { colunas, linhas: linhasTabela };
    }
    linhasCorpo.push({ linhaId: l.id, tamanhoIds: rl.tamanhoIds, ...precos, tabelaMedidas });
  }
  return {
    ok: true,
    corpo: {
      nome: r.nome.trim(),
      categoria: r.categoria.trim() || null,
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

export function ModeloEditor({
  modelo,
  cores,
  linhas,
  onClose,
  onSalvou,
  onListasMudaram,
}: {
  /** null = modelo novo. */
  modelo: Modelo | null;
  cores: Cor[];
  linhas: Linha[];
  onClose: () => void;
  onSalvou: (m: Modelo) => void;
  onListasMudaram: () => void;
}) {
  const toast = useToast();
  const [aba, setAba] = useState('dados');
  const [atual, setAtual] = useState<Modelo | null>(modelo);
  const [r, setR] = useState<Rascunho>(() => rascunhoDe(modelo, linhas));
  const [salvando, setSalvando] = useState(false);
  const [novaCor, setNovaCor] = useState(false);

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
      const m = atual
        ? await api.put<Modelo>(`/vitrine/admin/modelos/${atual.id}`, montado.corpo)
        : await api.post<Modelo>('/vitrine/admin/modelos', montado.corpo);
      setAtual(m);
      onSalvou(m);
      toast.success(atual ? 'Modelo salvo' : 'Modelo criado — agora dá pra enviar as fotos');
    } catch (err) {
      toast.error('Não foi possível salvar o modelo', apiErrorMessage(err));
    } finally {
      setSalvando(false);
    }
  }

  const coresAtivas = cores.filter((c) => c.ativo || r.corIds.includes(c.id));
  const linhasAtivas = linhas.filter((l) => l.ativo || r.linhas[l.id]?.marcada);

  return (
    <Dialog
      open
      onClose={onClose}
      size="xl"
      title={atual ? `Modelo · ${atual.nome}` : 'Novo modelo'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Fechar
          </Button>
          <Button onClick={salvar} loading={salvando} data-testid="vitrine-salvar-modelo">
            Salvar
          </Button>
        </>
      }
    >
      <Tabs
        value={aba}
        onChange={setAba}
        items={[
          { value: 'dados', label: 'Dados' },
          { value: 'cores', label: 'Cores e fotos' },
          { value: 'grades', label: 'Grades e preços' },
          { value: 'kit', label: 'Kit pra anunciar' },
        ]}
        className="mb-4"
      />

      {aba === 'dados' && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Nome" required className="sm:col-span-2">
            <Input value={r.nome} maxLength={120} onChange={(e) => set('nome', e.target.value)} data-testid="vitrine-modelo-nome" />
          </Field>
          <Field label="Categoria" hint="Ex.: Moletom, Camiseta UV, Bermuda">
            <Input value={r.categoria} maxLength={60} onChange={(e) => set('categoria', e.target.value)} />
          </Field>
          <Field label="Etiquetas" hint="Separadas por vírgula: Gramatura 280, Capuz">
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
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm text-muted">Marque as cores que este modelo tem.</p>
              <Button size="sm" variant="ghost" onClick={() => setNovaCor(true)}>
                <Plus size={14} /> Criar cor
              </Button>
            </div>
            <div className="flex flex-wrap gap-2">
              {coresAtivas.map((c) => {
                const marcada = r.corIds.includes(c.id);
                return (
                  <label key={c.id} className={`flex cursor-pointer items-center gap-2 rounded-[10px] border px-3 py-1.5 text-sm ${marcada ? 'border-primary bg-primary/10' : 'border-border'}`}>
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
                <p className="text-xs text-muted">Cor marcada agora: salve pra liberar o envio das fotos dela.</p>
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
            return (
              <div key={l.id} className="rounded-[10px] border border-border p-3">
                <Switch
                  label={`Linha ${l.nome}`}
                  checked={rl.marcada}
                  onChange={(e) => setLinha(l.id, { marcada: e.target.checked })}
                />
                {rl.marcada && (
                  <div className="mt-3 flex flex-col gap-3">
                    <div className="flex flex-wrap gap-1.5">
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
                    </div>
                    <div className="grid gap-2 sm:grid-cols-4">
                      <Field label="Atacado · Entrada (R$)">
                        <Input value={rl.precoEntrada} inputMode="decimal" onChange={(e) => setLinha(l.id, { precoEntrada: e.target.value })} placeholder="sob consulta" />
                      </Field>
                      <Field label="Atacado · Volume (R$)">
                        <Input value={rl.precoVolume} inputMode="decimal" onChange={(e) => setLinha(l.id, { precoVolume: e.target.value })} placeholder="sob consulta" />
                      </Field>
                      <Field label="Atacado · 500+ (R$)">
                        <Input value={rl.precoAtacadao} inputMode="decimal" onChange={(e) => setLinha(l.id, { precoAtacadao: e.target.value })} placeholder="sob consulta" />
                      </Field>
                      <Field label="Revenda sugerida (R$)">
                        <Input value={rl.precoSugerido} inputMode="decimal" onChange={(e) => setLinha(l.id, { precoSugerido: e.target.value })} />
                      </Field>
                    </div>
                    {lucro !== null && entrada !== null && entrada > 0 && (
                      <p className="text-sm text-muted">
                        Lucro do lojista na faixa Entrada: <strong className="text-text">{formatMoeda(lucro)}</strong> por peça
                      </p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {aba === 'kit' && (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-muted">
            O que o revendedor baixa pra montar o próprio anúncio no marketplace.
          </p>
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
          {linhasAtivas
            .filter((l) => r.linhas[l.id]?.marcada)
            .map((l) => {
              const rl = r.linhas[l.id];
              const nomes = l.tamanhos.filter((t) => rl.tamanhoIds.includes(t.id)).map((t) => t.nome);
              return (
                <div key={l.id} className="rounded-[10px] border border-border p-3">
                  <p className="font-medium text-text mb-2">Tabela de medidas · {l.nome}</p>
                  <Field label="Colunas" hint="Separadas por vírgula: Tórax, Comprimento, Manga">
                    <Input value={rl.colunas} onChange={(e) => setLinha(l.id, { colunas: e.target.value })} />
                  </Field>
                  {separar(rl.colunas).length > 0 && (
                    <div className="mt-2 grid gap-2">
                      {nomes.map((n) => (
                        <Field key={n} label={`${n} (cm, na ordem das colunas)`}>
                          <Input
                            value={rl.medidas[n] ?? ''}
                            onChange={(e) => setLinha(l.id, { medidas: { ...rl.medidas, [n]: e.target.value } })}
                            placeholder="Ex.: 52, 70, 22"
                          />
                        </Field>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
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
