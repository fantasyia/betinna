import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, apiErrorMessage } from '@/lib/api';
import { useApiQuery } from '@/hooks/useApiQuery';
import { PageLayout } from '@/components/PageLayout';
import { StateView } from '@/components/StateView';
import { Button, Input, Select } from '@/components/ui';
import { useToast } from '@/components/toast';
import { AtivarPush } from '@/components/AtivarPush';

/**
 * Pendências dos marketplaces (Léo, 24/10; card cmvly8hf1). Aba ÚNICA do que
 * espera a loja, de todos os marketplaces conectados: pergunta de pré-venda,
 * pergunta de pós-venda, reclamação e devolução (as reclamações saíram do
 * Atendimento). Filtros de busca, marketplace, tipo, status e período; as
 * abertas saem por urgência (prazo mais curto primeiro). A rotina confere de
 * hora em hora e avisa por push.
 */
type Tipo = 'PERGUNTA' | 'MENSAGEM' | 'RECLAMACAO' | 'DEVOLUCAO';
type Status = 'PENDENTE' | 'AGUARDANDO_HUMANO' | 'RESPONDIDA_IA' | 'ENCERRADA';

interface Pendencia {
  id: string;
  canal: string;
  tipo: Tipo;
  chave: string;
  titulo: string;
  detalhe: string | null;
  link: string | null;
  desde: string | null;
  prazo: string | null;
  comprador: string | null;
  pedido: string | null;
  anuncio: string | null;
  resolvidaEm: string | null;
  status: Status;
  /** Última coisa que a IA fez nesta pendência (fase 2, 25/10). */
  ia: {
    acao: 'responder' | 'humano';
    resposta: string;
    motivo: string | null;
    enviada: boolean;
    erro: string | null;
    criadoEm: string;
  } | null;
}
interface Resposta {
  data: Pendencia[];
  contagem: Record<Status, number>;
}

const CANAL: Record<string, string> = {
  MARKETPLACE_ML: 'Mercado Livre',
  MARKETPLACE_SHOPEE: 'Shopee',
  MARKETPLACE_SHEIN: 'Shein',
};
const TIPO: Record<Tipo, string> = {
  PERGUNTA: 'Pergunta pré-venda',
  MENSAGEM: 'Pergunta pós-venda',
  RECLAMACAO: 'Reclamação',
  DEVOLUCAO: 'Devolução',
};
const STATUS: Array<[Status | 'ABERTAS', string]> = [
  ['ABERTAS', 'Abertas'],
  ['PENDENTE', 'Pendentes'],
  ['AGUARDANDO_HUMANO', 'Aguardando humano'],
  ['RESPONDIDA_IA', 'Respondidas pela IA'],
  ['ENCERRADA', 'Encerradas'],
];
const UM_STATUS: Record<Status, string> = {
  PENDENTE: 'Pendente',
  AGUARDANDO_HUMANO: 'Aguardando humano',
  RESPONDIDA_IA: 'Respondida pela IA',
  ENCERRADA: 'Encerrada',
};
const COR_STATUS: Record<Status, string> = {
  PENDENTE: 'text-warning',
  AGUARDANDO_HUMANO: 'text-danger',
  RESPONDIDA_IA: 'text-primary',
  ENCERRADA: 'text-muted',
};

/** "há 3 h" / "vence em 18 h" — a cor sai do prazo. */
function tempo(p: Pendencia): { texto: string; cor: string } {
  if (p.status === 'ENCERRADA' || p.status === 'RESPONDIDA_IA') {
    return p.resolvidaEm
      ? { texto: `encerrada em ${new Date(p.resolvidaEm).toLocaleDateString('pt-BR')}`, cor: 'text-muted' }
      : { texto: '', cor: 'text-muted' };
  }
  const agora = Date.now();
  if (p.prazo) {
    const h = Math.round((new Date(p.prazo).getTime() - agora) / 3600_000);
    if (h < 0) return { texto: 'prazo vencido', cor: 'text-danger' };
    return {
      texto: h < 48 ? `vence em ${h} h` : `vence em ${Math.round(h / 24)} dias`,
      cor: h < 24 ? 'text-danger' : h < 48 ? 'text-warning' : 'text-muted',
    };
  }
  if (p.desde) {
    const h = Math.round((agora - new Date(p.desde).getTime()) / 3600_000);
    return {
      texto: h < 48 ? `esperando há ${h} h` : `esperando há ${Math.round(h / 24)} dias`,
      cor: h >= 24 ? 'text-warning' : 'text-muted',
    };
  }
  return { texto: '', cor: 'text-muted' };
}

export default function PendenciasPage() {
  const toast = useToast();
  const cfgIa = useApiQuery<{ ativo: boolean; desligados: string[] }>('/pendencias/ia');
  const [busca, setBusca] = useState('');
  const [buscaAplicada, setBuscaAplicada] = useState('');
  const [canal, setCanal] = useState('');
  const [tipo, setTipo] = useState('');
  const [status, setStatus] = useState<Status | 'ABERTAS'>('ABERTAS');
  const [de, setDe] = useState('');
  const [ate, setAte] = useState('');
  const [conferindo, setConferindo] = useState(false);

  // Busca espera parar de digitar (não bate na API a cada letra).
  useEffect(() => {
    const t = setTimeout(() => setBuscaAplicada(busca.trim()), 400);
    return () => clearTimeout(t);
  }, [busca]);

  const qs = new URLSearchParams({ status });
  if (buscaAplicada) qs.set('busca', buscaAplicada);
  if (canal) qs.set('canal', canal);
  if (tipo) qs.set('tipo', tipo);
  if (de) qs.set('de', `${de}T00:00:00-03:00`);
  if (ate) qs.set('ate', `${ate}T23:59:59-03:00`);
  const { data, loading, error, refetch } = useApiQuery<Resposta>(`/pendencias?${qs.toString()}`);

  async function alternarIa(mudanca: Partial<{ ativo: boolean; desligados: string[] }>) {
    const atual = cfgIa.data ?? { ativo: false, desligados: [] };
    try {
      await api.put('/pendencias/ia', { ...atual, ...mudanca });
      cfgIa.refetch();
    } catch (err) {
      toast.error('Não deu pra salvar', apiErrorMessage(err));
    }
  }

  async function conferirAgora() {
    setConferindo(true);
    try {
      const r = await api.post<{ abertas: number }>('/pendencias/verificar', {});
      toast.success(`Conferido: ${r.abertas} pendência(s) aberta(s)`);
      refetch();
    } catch (err) {
      toast.error('Não deu pra conferir agora', apiErrorMessage(err));
    } finally {
      setConferindo(false);
    }
  }

  const lista = data?.data ?? [];
  const cont = data?.contagem;
  const abertas = cont ? cont.PENDENTE + cont.AGUARDANDO_HUMANO : 0;
  const filtrando = Boolean(buscaAplicada || canal || tipo || de || ate);

  return (
    <PageLayout
      title="Pendências dos marketplaces"
      description="Perguntas, reclamações e devoluções esperando a loja no Mercado Livre e na Shopee. Confere sozinho de hora em hora e avisa no celular."
    >
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <Button
          variant="secondary"
          onClick={() => void conferirAgora()}
          loading={conferindo}
          data-testid="pendencias-conferir"
        >
          Conferir agora
        </Button>
        <AtivarPush />
        {cfgIa.data && (
          <div className="flex flex-wrap items-center gap-2 text-sm" data-testid="pendencias-ia">
            <label className="flex items-center gap-1.5 font-medium text-text">
              <input
                type="checkbox"
                checked={cfgIa.data.ativo}
                onChange={() => void alternarIa({ ativo: !cfgIa.data!.ativo })}
                data-testid="pendencias-ia-ativo"
              />
              IA responde sozinha
            </label>
            {cfgIa.data.ativo &&
              (Object.keys(TIPO) as Tipo[]).map((t) => {
                const ligado = !cfgIa.data!.desligados.includes(t);
                return (
                  <label key={t} className="flex items-center gap-1 text-muted">
                    <input
                      type="checkbox"
                      checked={ligado}
                      onChange={() =>
                        void alternarIa({
                          desligados: ligado
                            ? [...cfgIa.data!.desligados, t]
                            : cfgIa.data!.desligados.filter((x) => x !== t),
                        })
                      }
                      data-testid={`pendencias-ia-${t}`}
                    />
                    {TIPO[t]}
                  </label>
                );
              })}
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-2 items-end mb-3">
        <Input
          className="min-w-[220px] flex-1"
          placeholder="Buscar texto, comprador, nº do pedido, anúncio…"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          data-testid="pendencias-busca"
        />
        <Select className="max-w-[170px]" value={canal} onChange={(e) => setCanal(e.target.value)} data-testid="pendencias-canal">
          <option value="">Todos os marketplaces</option>
          {Object.entries(CANAL).map(([v, r]) => (
            <option key={v} value={v}>
              {r}
            </option>
          ))}
        </Select>
        <Select className="max-w-[180px]" value={tipo} onChange={(e) => setTipo(e.target.value)} data-testid="pendencias-tipo">
          <option value="">Todos os tipos</option>
          {(Object.keys(TIPO) as Tipo[]).map((t) => (
            <option key={t} value={t}>
              {TIPO[t]}
            </option>
          ))}
        </Select>
        <label className="text-xs text-muted flex flex-col">
          De
          <Input type="date" value={de} onChange={(e) => setDe(e.target.value)} data-testid="pendencias-de" />
        </label>
        <label className="text-xs text-muted flex flex-col">
          Até
          <Input type="date" value={ate} onChange={(e) => setAte(e.target.value)} data-testid="pendencias-ate" />
        </label>
      </div>

      <div className="flex flex-wrap gap-2 mb-4" role="tablist" aria-label="Status">
        {STATUS.map(([s, rot]) => {
          const n = !cont ? null : s === 'ABERTAS' ? abertas : cont[s];
          return (
            <Button
              key={s}
              size="sm"
              variant={status === s ? 'primary' : 'ghost'}
              onClick={() => setStatus(s)}
              data-testid={`pendencias-status-${s}`}
            >
              {rot}
              {n !== null && <span className="ml-1 opacity-70">({n})</span>}
            </Button>
          );
        })}
      </div>

      <StateView loading={loading && !data} error={error} onRetry={refetch}>
        {lista.length === 0 ? (
          <p className="text-sm text-muted" data-testid="pendencias-vazio">
            {filtrando || status !== 'ABERTAS' ? 'Nada com esses filtros.' : 'Nada esperando a loja agora. ✅'}
          </p>
        ) : (
          <ul className="flex flex-col gap-2" data-testid="pendencias-lista">
            {lista.map((p) => {
              const t = tempo(p);
              const ref = [p.comprador, p.pedido && `pedido ${p.pedido}`, p.anuncio && `anúncio ${p.anuncio}`]
                .filter(Boolean)
                .join(' · ');
              return (
                <li
                  key={p.id}
                  className="bg-surface border border-border rounded-[10px] px-4 py-3 flex flex-wrap gap-x-3 gap-y-1 items-baseline"
                >
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-primary">
                    {CANAL[p.canal] ?? p.canal}
                  </span>
                  <span className="text-[11px] rounded-[10px] border border-border px-2 text-text">{TIPO[p.tipo] ?? p.tipo}</span>
                  <span className="text-sm font-medium text-text">{p.titulo}</span>
                  <span className={`text-xs ml-auto ${t.cor}`}>{t.texto}</span>
                  {p.detalhe && <span className="basis-full text-sm text-muted break-words">{p.detalhe}</span>}
                  {p.ia && (
                    <span
                      className="basis-full text-xs rounded-[10px] bg-surface-hover border border-border px-3 py-2 text-text break-words"
                      data-testid="pendencia-ia"
                    >
                      <b>{p.ia.acao === 'humano' ? 'IA passou pra você' : 'IA respondeu'}</b>
                      {p.ia.motivo ? ` (${p.ia.motivo})` : ''}
                      {p.ia.resposta ? `: "${p.ia.resposta}"` : ''}
                      {!p.ia.enviada && p.ia.resposta && (
                        <span className="text-danger"> · não foi enviada{p.ia.erro ? `: ${p.ia.erro}` : ''}</span>
                      )}
                    </span>
                  )}
                  <span className="basis-full flex flex-wrap gap-x-3 text-xs">
                    <span className={COR_STATUS[p.status]}>{UM_STATUS[p.status]}</span>
                    {ref && <span className="text-muted">{ref}</span>}
                    {p.link && (
                      <Link to={p.link} className="text-primary hover:underline ml-auto">
                        Abrir no app ›
                      </Link>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </StateView>
    </PageLayout>
  );
}
