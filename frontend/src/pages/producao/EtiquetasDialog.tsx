import { useEffect, useMemo, useState } from 'react';
import { api, apiErrorMessage } from '@/lib/api';
import { formatNumero } from '@/lib/masks';
import { useApiQuery } from '@/hooks/useApiQuery';
import { useToast } from '@/components/toast';
import { StateView } from '@/components/StateView';
import { Button, Dialog, Input, Select } from '@/components/ui';

/** Peça unitária do catálogo, como o backend lista (GET /erp/etiquetas/pecas). */
export interface PecaEtiqueta {
  produtoId: string;
  modelo: string;
  cor: string;
  linha: string;
  tamanho: string;
  sku: string | null;
  ean: string | null;
}

type Formato = '40x80' | '50x30';

const FORMATOS: Array<{ id: Formato; rotulo: string }> = [
  { id: '40x80', rotulo: '40 × 80 mm · 1 coluna' },
  { id: '50x30', rotulo: '50 × 30 mm · 2 colunas' },
];

/** Baixa o PDF que o backend devolve em base64. */
function baixarPdf(filename: string, base64: string) {
  const bytes = atob(base64);
  const buf = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i += 1) buf[i] = bytes.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([buf], { type: 'application/pdf' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * Etiquetas de código de barras (Léo, 20/10): escolher as peças e quantas de
 * cada, no formato do rolo. Da OP, já vem com a grade dela (`inicial`).
 */
export function EtiquetasDialog({
  open,
  onClose,
  inicial,
  titulo = 'Imprimir etiquetas',
}: {
  open: boolean;
  onClose: () => void;
  /** Quantidade por peça já preenchida (a grade da OP). */
  inicial?: Record<string, number>;
  titulo?: string;
}) {
  const toast = useToast();
  const q = useApiQuery<PecaEtiqueta[]>(open ? '/erp/etiquetas/pecas' : null);
  const [formato, setFormato] = useState<Formato>('50x30');
  const [qtd, setQtd] = useState<Record<string, string>>({});
  const [modelo, setModelo] = useState('');
  const [busca, setBusca] = useState('');
  const [gerando, setGerando] = useState(false);

  useEffect(() => {
    if (!open) return;
    setQtd(Object.fromEntries(Object.entries(inicial ?? {}).map(([k, v]) => [k, String(v)])));
    setBusca('');
  }, [open, inicial]);

  const pecas = useMemo(() => q.data ?? [], [q.data]);
  const modelos = useMemo(() => [...new Set(pecas.map((p) => p.modelo))], [pecas]);
  const temInicial = Object.keys(inicial ?? {}).length > 0;
  const visiveis = pecas.filter((p) => {
    if (temInicial && !modelo && !busca) return (inicial ?? {})[p.produtoId] !== undefined;
    if (modelo && p.modelo !== modelo) return false;
    const t = busca.trim().toLowerCase();
    if (!t) return true;
    return [p.modelo, p.cor, p.linha, p.tamanho, p.sku ?? '', p.ean ?? '']
      .join(' ')
      .toLowerCase()
      .includes(t);
  });
  const escolhidas = Object.entries(qtd)
    .map(([produtoId, v]) => ({ produtoId, quantidade: Number.parseInt(v, 10) || 0 }))
    .filter((i) => i.quantidade > 0);
  const total = escolhidas.reduce((s, i) => s + i.quantidade, 0);
  const semCodigo = escolhidas.filter((i) => {
    const p = pecas.find((x) => x.produtoId === i.produtoId);
    return p && !p.ean && !p.sku;
  }).length;

  async function gerar() {
    setGerando(true);
    try {
      const r = await api.post<{ filename: string; base64: string; etiquetas: number }>('/erp/etiquetas', {
        formato,
        itens: escolhidas,
      });
      baixarPdf(r.filename, r.base64);
      toast.success(`${formatNumero(r.etiquetas)} etiquetas geradas`);
    } catch (err) {
      toast.error('Não foi possível gerar as etiquetas', apiErrorMessage(err));
    } finally {
      setGerando(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={titulo}
      description="Código de barras (EAN; sem EAN, o SKU), SKU e a data de hoje. PDF no tamanho exato do rolo."
      size="lg"
      footer={
        <div className="flex w-full flex-wrap items-center gap-2">
          <span className="mr-auto text-sm text-muted" data-testid="etq-total">
            {formatNumero(total)} etiqueta{total === 1 ? '' : 's'}
            {semCodigo > 0 && <span className="text-danger"> · {semCodigo} peça(s) sem EAN nem SKU</span>}
          </span>
          <Button variant="secondary" onClick={onClose}>
            Fechar
          </Button>
          <Button
            onClick={() => void gerar()}
            loading={gerando}
            disabled={total === 0 || semCodigo > 0}
            data-testid="etq-gerar"
          >
            Gerar PDF
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Formato da etiqueta">
          {FORMATOS.map((f) => (
            <Button
              key={f.id}
              size="sm"
              variant={formato === f.id ? 'primary' : 'secondary'}
              onClick={() => setFormato(f.id)}
              aria-pressed={formato === f.id}
              data-testid={`etq-formato-${f.id}`}
            >
              {f.rotulo}
            </Button>
          ))}
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <Select value={modelo} onChange={(e) => setModelo(e.target.value)} data-testid="etq-modelo">
            <option value="">{temInicial ? 'Peças da OP' : 'Todos os modelos'}</option>
            {modelos.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </Select>
          <Input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar cor, tamanho, SKU ou EAN"
            data-testid="etq-busca"
          />
        </div>
        <StateView loading={q.loading} error={q.error} onRetry={q.refetch}>
          <div className="max-h-[50vh] overflow-auto rounded-[10px] border border-border">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-surface text-left text-xs text-muted">
                <tr>
                  <th className="px-3 py-2">Peça</th>
                  <th className="px-3 py-2">SKU · EAN</th>
                  <th className="px-3 py-2 w-24">Qtd.</th>
                </tr>
              </thead>
              <tbody>
                {visiveis.map((p) => (
                  <tr key={p.produtoId} className="border-t border-border">
                    <td className="px-3 py-1.5">
                      <div className="font-medium">{p.modelo}</div>
                      <div className="text-xs text-muted">
                        {p.cor} · {p.linha} · <b>{p.tamanho}</b>
                      </div>
                    </td>
                    <td className="px-3 py-1.5 text-xs tabular-nums">
                      <div>{p.sku ?? <span className="text-danger">sem SKU</span>}</div>
                      <div className="text-muted">{p.ean ?? 'sem EAN (vai o SKU)'}</div>
                    </td>
                    <td className="px-3 py-1.5">
                      <Input
                        value={qtd[p.produtoId] ?? ''}
                        onChange={(e) =>
                          setQtd((x) => ({ ...x, [p.produtoId]: e.target.value.replace(/\D/g, '') }))
                        }
                        inputMode="numeric"
                        className="h-8"
                        aria-label={`Quantidade de ${p.modelo} ${p.cor} ${p.tamanho}`}
                        data-testid={`etq-qtd-${p.produtoId}`}
                      />
                    </td>
                  </tr>
                ))}
                {visiveis.length === 0 && (
                  <tr>
                    <td colSpan={3} className="px-3 py-4 text-center text-muted">
                      Nenhuma peça encontrada.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </StateView>
      </div>
    </Dialog>
  );
}
