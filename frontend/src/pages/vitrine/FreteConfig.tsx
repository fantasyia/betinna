import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Package, Plus, Trash2 } from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';
import { formatMoeda, formatNumero } from '@/lib/masks';
import { useApiQuery } from '@/hooks/useApiQuery';
import { useRole } from '@/hooks/usePermission';
import { useToast } from '@/components/toast';
import { Badge, Button, Card, Field, Input, Select, Switch } from '@/components/ui';

/**
 * Frete da vitrine pelo Melhor Envio (Checkout, itens 5–5e).
 *
 * O token fica em Integrações → Melhor Envio. Aqui: CEP de origem, caixas
 * (medidas, peso vazio, quantas peças cabem), teto por volume, embalagem da
 * peça avulsa e retirada em mãos. O peso de cada peça é por tamanho, no
 * cadastro do modelo (aba Grade). "Simular" cota antes de ligar.
 */
/** Como a API guarda: medidas podem estar vazias (null) enquanto o frete está desligado. */
interface Embalagem {
  nome: string;
  comprimentoCm: number | null;
  larguraCm: number | null;
  alturaCm: number | null;
  pesoVazioG: number | null;
  capacidadePecas: number | null;
}

export interface ConfigFreteApi {
  ativo?: boolean;
  ambiente?: 'sandbox' | 'producao';
  cepOrigem?: string;
  pesoMaxVolumeKg?: number;
  declararValor?: boolean;
  embalagemIndividual?: Embalagem | null;
  caixas?: Embalagem[];
  retirada?: { ativo?: boolean; minimoPecas?: number; endereco?: string; horario?: string } | null;
}

interface StatusFrete {
  conectado: boolean;
  config: ConfigFreteApi;
  sugestao: {
    pesoMaxVolumeKg: number;
    embalagemIndividual: Embalagem;
    retiradaMinimoPecas: number;
  };
  falta: string[];
}

interface Cotacao {
  volumes: Array<{ embalagem: string; pecas: number; pesoKg: number }>;
  opcoes: Array<{ id: number; nome: string; transportadora: string; preco: number; prazoDias: number | null }>;
  retirada: { endereco: string; horario: string } | null;
}

/** Embalagem como a tela edita: tudo texto (vírgula aceita). */
type EmbalagemForm = Record<keyof Embalagem, string>;

export interface FreteForm {
  ativo: boolean;
  ambiente: 'sandbox' | 'producao';
  cepOrigem: string;
  pesoMaxVolumeKg: string;
  declararValor: boolean;
  usarIndividual: boolean;
  individual: EmbalagemForm;
  caixas: EmbalagemForm[];
  retiradaAtivo: boolean;
  retiradaMinimo: string;
  retiradaEndereco: string;
  retiradaHorario: string;
}

const txt = (n: number | null | undefined) =>
  n === null || n === undefined ? '' : String(n).replace('.', ',');

const paraForm = (e: Embalagem): EmbalagemForm => ({
  nome: e.nome,
  comprimentoCm: txt(e.comprimentoCm),
  larguraCm: txt(e.larguraCm),
  alturaCm: txt(e.alturaCm),
  pesoVazioG: txt(e.pesoVazioG),
  capacidadePecas: txt(e.capacidadePecas),
});

const CAIXA_VAZIA: EmbalagemForm = {
  nome: '',
  comprimentoCm: '',
  larguraCm: '',
  alturaCm: '',
  pesoVazioG: '',
  capacidadePecas: '',
};

/** Config salva + sugestão (só onde não há valor) → formulário. */
export function formDoStatus(s: StatusFrete): FreteForm {
  const c = s.config;
  const ind = c.embalagemIndividual === undefined ? s.sugestao.embalagemIndividual : c.embalagemIndividual;
  return {
    ativo: c.ativo === true,
    ambiente: c.ambiente ?? 'sandbox',
    cepOrigem: c.cepOrigem ?? '',
    pesoMaxVolumeKg: txt(c.pesoMaxVolumeKg ?? s.sugestao.pesoMaxVolumeKg),
    declararValor: c.declararValor !== false,
    usarIndividual: ind !== null,
    individual: paraForm(ind ?? s.sugestao.embalagemIndividual),
    // Primeiro uso: a caixa grande (50×50×38) com peso vazio e capacidade a preencher.
    caixas: c.caixas?.length
      ? c.caixas.map(paraForm)
      : [{ ...CAIXA_VAZIA, nome: 'Caixa grande', comprimentoCm: '50', larguraCm: '50', alturaCm: '38' }],
    retiradaAtivo: c.retirada?.ativo === true,
    retiradaMinimo: txt(c.retirada?.minimoPecas ?? s.sugestao.retiradaMinimoPecas),
    retiradaEndereco: c.retirada?.endereco ?? '',
    retiradaHorario: c.retirada?.horario ?? '',
  };
}

const num = (v: string) => {
  const t = v.trim().replace(/\./g, '').replace(',', '.');
  return t === '' ? NaN : Number(t);
};

/**
 * Campo vazio → null (a caixa pode ficar pela metade enquanto o frete está
 * desligado — o Léo ainda não tinha peso e capacidade, 09/10). Digitado errado
 * → erro. `completa` diz se a caixa já serve pra montar volume.
 */
function embalagemDoForm(
  e: EmbalagemForm,
  rotulo: string,
): { emb: Embalagem; completa: boolean } | string {
  const ler = (v: string, inteiro: boolean, min: number): number | null | 'erro' => {
    if (!v.trim()) return null;
    const n = num(v);
    if (!Number.isFinite(n) || n < min || (inteiro && !Number.isInteger(n))) return 'erro';
    return n;
  };
  const campos = {
    comprimentoCm: ler(e.comprimentoCm, false, 0.1),
    larguraCm: ler(e.larguraCm, false, 0.1),
    alturaCm: ler(e.alturaCm, false, 0.1),
    pesoVazioG: ler(e.pesoVazioG, true, 0),
    capacidadePecas: ler(e.capacidadePecas, true, 1),
  };
  if ([campos.comprimentoCm, campos.larguraCm, campos.alturaCm].includes('erro')) {
    return `${rotulo}: medida em cm inválida`;
  }
  if (campos.pesoVazioG === 'erro') return `${rotulo}: peso vazio em gramas (número inteiro)`;
  if (campos.capacidadePecas === 'erro') return `${rotulo}: peças que cabem (número inteiro)`;
  const emb = { nome: e.nome.trim() || rotulo, ...campos } as Embalagem;
  const completa = Object.values(campos).every((v) => v !== null);
  return { emb, completa };
}

/** Formulário → corpo do PUT. Erro de digitação vira mensagem, não envio. */
export function corpoDoForm(f: FreteForm): { ok: true; corpo: Record<string, unknown> } | { ok: false; erro: string } {
  const caixas: Embalagem[] = [];
  let algumaCompleta = false;
  for (const [i, c] of f.caixas.entries()) {
    // Linha inteira em branco: ignora (sobra de "adicionar caixa").
    if (Object.values(c).every((v) => !v.trim())) continue;
    const r = embalagemDoForm(c, c.nome.trim() || `Caixa ${i + 1}`);
    if (typeof r === 'string') return { ok: false, erro: r };
    caixas.push(r.emb);
    algumaCompleta ||= r.completa;
  }
  let individual: Embalagem | null = null;
  if (f.usarIndividual) {
    const r = embalagemDoForm(f.individual, 'Embalagem individual');
    if (typeof r === 'string') return { ok: false, erro: r };
    individual = r.emb;
  }
  // Ligar o frete exige caixa completa; desligado, salva o que tiver.
  if (f.ativo && !algumaCompleta) {
    return {
      ok: false,
      erro: 'Pra cobrar frete, complete ao menos uma caixa (medidas, peso vazio e peças que cabem)',
    };
  }
  const cep = f.cepOrigem.replace(/\D/g, '');
  if (cep && cep.length !== 8) return { ok: false, erro: 'CEP de origem com 8 números' };
  const teto = num(f.pesoMaxVolumeKg);
  if (!(teto > 0)) return { ok: false, erro: 'Peso máximo por volume (kg)' };
  const minimo = num(f.retiradaMinimo);
  if (!Number.isInteger(minimo) || minimo < 1) {
    return { ok: false, erro: 'Retirada: mínimo de peças' };
  }
  if (f.retiradaAtivo && !f.retiradaEndereco.trim()) {
    return { ok: false, erro: 'Retirada: informe o endereço' };
  }
  return {
    ok: true,
    corpo: {
      ativo: f.ativo,
      ambiente: f.ambiente,
      cepOrigem: cep,
      pesoMaxVolumeKg: teto,
      declararValor: f.declararValor,
      embalagemIndividual: individual,
      caixas,
      retirada: {
        ativo: f.retiradaAtivo,
        minimoPecas: minimo,
        endereco: f.retiradaEndereco.trim(),
        horario: f.retiradaHorario.trim(),
      },
    },
  };
}

const CAMPOS_EMBALAGEM: Array<{ k: keyof Embalagem; rotulo: string; largura: string }> = [
  { k: 'comprimentoCm', rotulo: 'Compr. (cm)', largura: 'w-20' },
  { k: 'larguraCm', rotulo: 'Largura (cm)', largura: 'w-20' },
  { k: 'alturaCm', rotulo: 'Altura (cm)', largura: 'w-20' },
  { k: 'pesoVazioG', rotulo: 'Vazia (g)', largura: 'w-20' },
  { k: 'capacidadePecas', rotulo: 'Peças', largura: 'w-16' },
];

function LinhaEmbalagem({
  e,
  onChange,
  testid,
}: {
  e: EmbalagemForm;
  onChange: (patch: Partial<EmbalagemForm>) => void;
  testid: string;
}) {
  return (
    <div className="flex flex-wrap items-end gap-2">
      <Field label="Nome">
        <Input value={e.nome} onChange={(x) => onChange({ nome: x.target.value })} className="h-9 w-40" data-testid={`${testid}-nome`} />
      </Field>
      {CAMPOS_EMBALAGEM.map((c) => (
        <Field key={c.k} label={c.rotulo}>
          <Input
            value={e[c.k]}
            inputMode="decimal"
            onChange={(x) => onChange({ [c.k]: x.target.value })}
            className={`h-9 ${c.largura}`}
            data-testid={`${testid}-${c.k}`}
          />
        </Field>
      ))}
    </div>
  );
}

export function FreteConfig() {
  const role = useRole();
  const gestor = role === 'ADMIN' || role === 'DIRECTOR';
  const q = useApiQuery<StatusFrete>(gestor ? '/vitrine/admin/frete' : null);
  const toast = useToast();
  const [f, setF] = useState<FreteForm | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [erroForm, setErroForm] = useState<string | null>(null);
  const [sim, setSim] = useState({ cep: '', pecas: '100', pesoG: '300', valor: '' });
  const [simulando, setSimulando] = useState(false);
  const [cotacao, setCotacao] = useState<Cotacao | null>(null);

  useEffect(() => {
    if (q.data && !f) setF(formDoStatus(q.data));
  }, [q.data, f]);

  if (!gestor || !q.data || !f) return null;
  const s = q.data;
  const mudar = (patch: Partial<FreteForm>) => setF((x) => (x ? { ...x, ...patch } : x));

  async function salvar() {
    if (!f) return;
    const r = corpoDoForm(f);
    if (!r.ok) {
      setErroForm(r.erro);
      return;
    }
    setErroForm(null);
    setSalvando(true);
    try {
      const novo = await api.put<StatusFrete>('/vitrine/admin/frete', r.corpo);
      setF(formDoStatus(novo));
      q.refetch();
      toast.success(f.ativo ? 'Frete salvo e ligado na vitrine' : 'Frete salvo');
    } catch (err) {
      setErroForm(apiErrorMessage(err));
    } finally {
      setSalvando(false);
    }
  }

  async function simular() {
    setSimulando(true);
    setCotacao(null);
    try {
      setCotacao(
        await api.post<Cotacao>('/vitrine/admin/frete/simular', {
          cep: sim.cep,
          pecas: Number(sim.pecas),
          pesoG: Number(sim.pesoG),
          valor: num(sim.valor) || 0,
        }),
      );
    } catch (err) {
      toast.error('Não deu pra cotar', apiErrorMessage(err));
    } finally {
      setSimulando(false);
    }
  }

  return (
    <Card className="p-4 max-w-3xl flex flex-col gap-4" data-testid="frete-config">
      <div className="flex flex-wrap items-center gap-2">
        <Package className="h-4 w-4 text-muted" aria-hidden />
        <h2 className="text-base font-semibold">Frete (Melhor Envio)</h2>
        <Badge variant={f.ambiente === 'producao' ? 'success' : 'warning'}>
          {f.ambiente === 'producao' ? 'Produção' : 'Teste (sandbox)'}
        </Badge>
        <Badge variant={s.config.ativo ? 'success' : 'neutral'}>{s.config.ativo ? 'Ligado' : 'Desligado'}</Badge>
      </div>

      {!s.conectado && (
        <p className="text-sm text-muted">
          Conecte a conta em{' '}
          <Link to="/integracoes" className="text-primary hover:underline">
            Integrações → Melhor Envio
          </Link>{' '}
          (token e e-mail técnico). Dá pra preencher o resto antes.
        </p>
      )}
      {s.falta.length > 0 && (
        <p className="text-sm text-muted" data-testid="frete-falta">
          Pra ligar, falta: <strong className="text-text">{s.falta.join(', ')}</strong>.
        </p>
      )}

      <div className="flex flex-wrap items-end gap-3">
        <Field label="Ambiente">
          <Select
            value={f.ambiente}
            onChange={(e) => mudar({ ambiente: e.target.value as FreteForm['ambiente'] })}
            className="h-9 w-44"
            data-testid="frete-ambiente"
          >
            <option value="sandbox">Teste (sandbox)</option>
            <option value="producao">Produção</option>
          </Select>
        </Field>
        <Field label="CEP de origem">
          <Input
            value={f.cepOrigem}
            inputMode="numeric"
            onChange={(e) => mudar({ cepOrigem: e.target.value })}
            placeholder="00000-000"
            className="h-9 w-32"
            data-testid="frete-cep-origem"
          />
        </Field>
        <Field label="Máximo por volume (kg)">
          <Input
            value={f.pesoMaxVolumeKg}
            inputMode="decimal"
            onChange={(e) => mudar({ pesoMaxVolumeKg: e.target.value })}
            className="h-9 w-24"
            data-testid="frete-teto"
          />
        </Field>
      </div>
      <Switch
        label="Declarar o valor das peças no seguro do envio"
        checked={f.declararValor}
        onChange={(e) => mudar({ declararValor: e.target.checked })}
      />

      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold">Caixas</h3>
        <p className="text-xs text-muted">
          O pedido enche a maior caixa até o número de peças ou o peso máximo; o que sobrar vai na menor caixa
          que couber.
        </p>
        {f.caixas.map((c, i) => (
          <div key={i} className="flex items-end gap-2">
            <LinhaEmbalagem
              e={c}
              testid={`frete-caixa-${i}`}
              onChange={(patch) => mudar({ caixas: f.caixas.map((x, j) => (j === i ? { ...x, ...patch } : x)) })}
            />
            <Button
              variant="ghost"
              size="sm"
              aria-label="Tirar caixa"
              onClick={() => mudar({ caixas: f.caixas.filter((_, j) => j !== i) })}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
        <div>
          <Button variant="secondary" size="sm" onClick={() => mudar({ caixas: [...f.caixas, { ...CAIXA_VAZIA }] })}>
            <Plus className="h-4 w-4" /> Adicionar caixa
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <Switch
          label="Peça avulsa vai na embalagem individual"
          checked={f.usarIndividual}
          onChange={(e) => mudar({ usarIndividual: e.target.checked })}
        />
        {f.usarIndividual && (
          <LinhaEmbalagem
            e={f.individual}
            testid="frete-individual"
            onChange={(patch) => mudar({ individual: { ...f.individual, ...patch } })}
          />
        )}
      </div>

      <div className="flex flex-col gap-2">
        <Switch
          label="Retirada em mãos (frete R$ 0) pra pedido grande"
          checked={f.retiradaAtivo}
          onChange={(e) => mudar({ retiradaAtivo: e.target.checked })}
        />
        {f.retiradaAtivo && (
          <div className="flex flex-wrap items-end gap-3">
            <Field label="A partir de (peças)">
              <Input
                value={f.retiradaMinimo}
                inputMode="numeric"
                onChange={(e) => mudar({ retiradaMinimo: e.target.value })}
                className="h-9 w-28"
              />
            </Field>
            <Field label="Endereço de retirada">
              <Input
                value={f.retiradaEndereco}
                onChange={(e) => mudar({ retiradaEndereco: e.target.value })}
                className="h-9 w-72"
                data-testid="frete-retirada-endereco"
              />
            </Field>
            <Field label="Horário">
              <Input
                value={f.retiradaHorario}
                onChange={(e) => mudar({ retiradaHorario: e.target.value })}
                placeholder="seg a sex, 8h às 17h"
                className="h-9 w-56"
              />
            </Field>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
        <Switch
          label="Cobrar frete na vitrine"
          checked={f.ativo}
          onChange={(e) => mudar({ ativo: e.target.checked })}
        />
        <Button onClick={salvar} disabled={salvando} data-testid="frete-salvar">
          {salvando ? 'Salvando…' : 'Salvar frete'}
        </Button>
      </div>
      {erroForm && (
        <p className="text-sm font-medium text-danger" role="alert" data-testid="frete-erro">
          Não salvou: {erroForm}
        </p>
      )}

      <div className="flex flex-col gap-2 rounded-[10px] border border-border p-3">
        <h3 className="text-sm font-semibold">Simular</h3>
        <p className="text-xs text-muted">Usa o que está SALVO. Confere caixas e preços antes de ligar.</p>
        <div className="flex flex-wrap items-end gap-2">
          <Field label="CEP do cliente">
            <Input value={sim.cep} inputMode="numeric" onChange={(e) => setSim({ ...sim, cep: e.target.value })} className="h-9 w-32" data-testid="frete-sim-cep" />
          </Field>
          <Field label="Peças">
            <Input value={sim.pecas} inputMode="numeric" onChange={(e) => setSim({ ...sim, pecas: e.target.value })} className="h-9 w-20" />
          </Field>
          <Field label="Peso/peça (g)">
            <Input value={sim.pesoG} inputMode="numeric" onChange={(e) => setSim({ ...sim, pesoG: e.target.value })} className="h-9 w-24" />
          </Field>
          <Field label="Valor (R$)">
            <Input value={sim.valor} inputMode="decimal" onChange={(e) => setSim({ ...sim, valor: e.target.value })} className="h-9 w-28" />
          </Field>
          <Button variant="secondary" onClick={simular} disabled={simulando} data-testid="frete-simular">
            {simulando ? 'Cotando…' : 'Cotar'}
          </Button>
        </div>
        {cotacao && (
          <div className="text-sm" data-testid="frete-sim-resultado">
            <p className="text-muted">
              {cotacao.volumes.length} {cotacao.volumes.length === 1 ? 'volume' : 'volumes'}:{' '}
              {cotacao.volumes
                .map((v) => `${v.embalagem} (${v.pecas} pç, ${formatNumero(v.pesoKg)} kg)`)
                .join(' · ')}
            </p>
            <ul className="mt-1 flex flex-col gap-0.5 tabular-nums">
              {cotacao.opcoes.map((o) => (
                <li key={o.id}>
                  <strong>{formatMoeda(o.preco)}</strong> · {o.transportadora} {o.nome}
                  {o.prazoDias !== null ? ` · ${o.prazoDias} dias úteis` : ''}
                </li>
              ))}
            </ul>
            {cotacao.retirada && <p className="text-muted">+ retirada em mãos (R$ 0)</p>}
          </div>
        )}
      </div>
    </Card>
  );
}
