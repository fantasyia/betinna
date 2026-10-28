import { useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { Printer } from 'lucide-react';
import { formatMoeda, formatNumero, formatPercent } from '@/lib/masks';
import { useApiQuery } from '@/hooks/useApiQuery';
import { StateView } from '@/components/StateView';
import { Button } from '@/components/ui';
import { viesPorCor } from './EncaixeDaOp';
import { enfestoPorCor, gradeCorTamanho, pecasPorTamanho, qtdUn, totalDoItem, type ItemGrade } from './fichaImpressao';

/**
 * Ficha da OP pra IMPRIMIR (card cmv8po94p0089pf5ih9l3n8bn — Léo, 14/10): A4,
 * uma via por folha — CORTE, FACÇÃO e ACABAMENTO. Abre em aba própria, sem o
 * menu do app; o botão chama a impressão do navegador (dá pra salvar em PDF).
 */

interface ItemFicha {
  nome: string;
  tipo: 'TECIDO' | 'AVIAMENTO';
  unidade: string;
  consumoPorPeca: number;
  porTamanho: Record<string, number> | null;
  etapa: 'FACCAO' | 'ACABAMENTO';
  observacao: string | null;
  /** Cor fixa da ficha (cordão sempre Branco); null = a cor da peça. */
  cor?: string | null;
  /**
   * Onde vai na peça (27/10). O servidor já juntou as linhas do mesmo insumo
   * (cós + barra): o consumo e o total são a SOMA delas.
   */
  usos?: string[];
}
interface Ficha {
  modeloLinhaId: string;
  linha: string;
  observacoes: string | null;
  tabelaMedidas: { colunas: string[]; linhas: Array<{ tamanho: string; valores: string[] }>; nota?: string } | null;
  acabamento: Array<{ id: string; nome: string; preco: number }>;
  itens: ItemFicha[];
}
interface Risco {
  material: 'TECIDO' | 'RIBANA';
  linha: string | null;
  composicao: Array<{ linha?: string; tamanho: string; quantidade: number }>;
  resultado: {
    comprimentoM: number;
    aproveitamento: number;
    detalhes?: { viesAreaM2PorFolha?: number; viesLarguraAbertaM?: number };
  } | null;
}
export interface DadosImpressao {
  empresa: string;
  op: {
    numero: number | string;
    criadoEm: string;
    prazo: string | null;
    faccao: string | null;
    precoFaccaoPorPeca: number | null;
    observacoes: string | null;
  };
  modelo: {
    nome: string;
    codigoMolde: string | null;
    tecido: string | null;
    larguraUtilMm: number | null;
    ribana: { tecido: string; larguraUtilMm: number } | null;
  };
  grade: Array<ItemGrade & { corHex: string | null; cortada: number | null }>;
  fichas: Ficha[];
  riscos: Risco[];
}

const RISCO_IDEAL_M = 6;
const MESA_M = 10.8;
const data = (s: string | null) => (s ? new Date(s).toLocaleDateString('pt-BR') : '—');
const m = (v: number) => `${formatNumero(Math.round(v * 100) / 100)} m`;

/** Linha em branco pra preencher à mão. */
function Campo({ rotulo, largo }: { rotulo: string; largo?: boolean }) {
  return (
    <div className={largo ? 'col-span-2' : undefined}>
      <div className="text-[10px] uppercase tracking-wide text-gray-500">{rotulo}</div>
      <div className="h-6 border-b border-gray-400" />
    </div>
  );
}

function Titulo({ children }: { children: React.ReactNode }) {
  return <h3 className="mt-4 mb-1 text-[11px] font-bold uppercase tracking-wide border-b border-black">{children}</h3>;
}

function Cabecalho({ d, via }: { d: DadosImpressao; via: string }) {
  const g = gradeCorTamanho(d.grade);
  return (
    <header>
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-[10px] uppercase text-gray-500">{d.empresa}</div>
          <h1 className="text-xl font-bold leading-tight">{d.op.numero} · {d.modelo.nome}</h1>
          <div className="text-xs">
            Emitida {data(d.op.criadoEm)} · Prazo <b>{data(d.op.prazo)}</b> · Facção <b>{d.op.faccao ?? '—'}</b>
            {d.modelo.codigoMolde ? <> · Molde <b>{d.modelo.codigoMolde}</b></> : null}
          </div>
        </div>
        <div className="border-2 border-black px-3 py-1 text-center">
          <div className="text-[10px] uppercase">Via</div>
          <div className="text-lg font-bold">{via}</div>
        </div>
      </div>
      <table className="ficha mt-2">
        <thead>
          <tr>
            <th className="text-left">Cor</th>
            {g.tamanhos.map((t) => <th key={t}>{t}</th>)}
            <th>Total</th>
          </tr>
        </thead>
        <tbody>
          {g.linhas.map((l) => (
            <tr key={`${l.linha}|${l.cor}`}>
              <td className="text-left">{l.cor}{d.fichas.length > 1 ? <span className="text-gray-500"> · {l.linha}</span> : null}</td>
              {g.tamanhos.map((t) => <td key={t}>{l.porTam[t] ?? ''}</td>)}
              <td className="font-bold">{l.total}</td>
            </tr>
          ))}
          <tr className="font-bold">
            <td className="text-left">Total</td>
            {g.tamanhos.map((t) => <td key={t}>{g.totalPorTam[t] || ''}</td>)}
            <td>{g.total}</td>
          </tr>
        </tbody>
      </table>
    </header>
  );
}

/** Itens da ficha de uma etapa, com quantidade por tamanho e o total da OP. */
function TabelaItens({ d, etapa, tipo }: { d: DadosImpressao; etapa?: 'FACCAO' | 'ACABAMENTO'; tipo?: 'TECIDO' | 'AVIAMENTO' }) {
  const linhas = d.fichas.flatMap((f) => {
    const pecas = pecasPorTamanho(d.grade, f.modeloLinhaId);
    return f.itens
      .filter((i) => (!etapa || i.etapa === etapa) && (!tipo || i.tipo === tipo))
      .map((i) => ({ f, i, pecas, total: totalDoItem(i, pecas) }));
  });
  if (!linhas.length) return <p className="text-xs text-gray-500">Nada nesta etapa na ficha.</p>;
  return (
    <table className="ficha">
      <thead>
        <tr>
          <th className="text-left">Item</th>
          <th className="text-left">Por peça</th>
          <th>Total da OP</th>
          <th>Conferido</th>
        </tr>
      </thead>
      <tbody>
        {linhas.map(({ f, i, pecas, total }, k) => (
          <tr key={k}>
            <td className="text-left">
              {i.nome}
              {i.cor ? ` · ${i.cor}` : null}
              {d.fichas.length > 1 ? <span className="text-gray-500"> · {f.linha}</span> : null}
              {i.usos?.length ? <div className="text-[10px] text-gray-600">{i.usos.join(' + ')}</div> : null}
              {i.observacao ? <div className="text-[10px] text-gray-600">{i.observacao}</div> : null}
            </td>
            <td className="text-left">
              {i.porTamanho && Object.keys(i.porTamanho).length
                ? Object.keys(pecas)
                    .map((t) => `${t}: ${qtdUn(i.porTamanho?.[t] ?? i.consumoPorPeca, i.unidade)}`)
                    .join(' · ')
                : qtdUn(i.consumoPorPeca, i.unidade)}
            </td>
            <td className="font-bold">{qtdUn(total, i.unidade)}</td>
            <td />
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ViaCorte({ d }: { d: DadosImpressao }) {
  const tecido = d.riscos.find((r) => r.material === 'TECIDO');
  const ribana = d.riscos.find((r) => r.material === 'RIBANA');
  const enfesto =
    tecido?.resultado ? enfestoPorCor(d.grade, { linha: tecido.linha ?? '', composicao: tecido.composicao, comprimentoM: tecido.resultado.comprimentoM }) : [];
  const vies = tecido?.resultado
    ? viesPorCor(
        d.grade.map((g) => ({ ...g, cor: { nome: g.cor } })),
        tecido.composicao,
        tecido.linha,
        tecido.resultado.detalhes,
      )
    : [];
  const avisos: string[] = [];
  if (tecido?.resultado && tecido.resultado.comprimentoM > MESA_M)
    avisos.push(`Risco de ${m(tecido.resultado.comprimentoM)} passa da mesa (${m(MESA_M)}).`);
  else if (tecido?.resultado && tecido.resultado.comprimentoM > RISCO_IDEAL_M)
    avisos.push(`Risco de ${m(tecido.resultado.comprimentoM)} passa do ideal (${m(RISCO_IDEAL_M)}).`);
  if (!tecido) avisos.push('OP sem risco do tecido concluído — gere o encaixe antes de cortar.');
  if (d.modelo.ribana && !ribana) avisos.push('Produto com ribana e sem risco da ribana concluído.');

  return (
    <section className="via">
      <Cabecalho d={d} via="CORTE" />
      <Titulo>Tecido e risco</Titulo>
      <div className="text-xs">
        Tecido <b>{d.modelo.tecido ?? '—'}</b>
        {d.modelo.larguraUtilMm ? <> · largura útil <b>{formatNumero(Math.round(d.modelo.larguraUtilMm / 10))} cm</b></> : null}
        {tecido?.resultado ? (
          <>
            {' '}· risco <b>{m(tecido.resultado.comprimentoM)}</b> ({tecido.composicao.map((c) => `${c.tamanho}×${c.quantidade}`).join(' ')}) · aproveitamento{' '}
            <b>{formatPercent(tecido.resultado.aproveitamento * 100, 1)}</b>
          </>
        ) : null}
      </div>
      <Titulo>Enfesto por cor</Titulo>
      <table className="ficha">
        <thead>
          <tr>
            <th className="text-left">Cor</th>
            <th>Folhas</th>
            <th>Tecido do risco</th>
            <th>Viés (à parte)</th>
            <th>Total a separar</th>
            <th>Folhas cortadas</th>
          </tr>
        </thead>
        <tbody>
          {enfesto.length ? (
            enfesto.map((e) => {
              const v = vies.find((x) => x.cor === e.cor)?.metros ?? 0;
              return (
                <tr key={e.cor}>
                  <td className="text-left">{e.cor}</td>
                  <td>{formatNumero(Math.round(e.folhas * 10) / 10)}</td>
                  <td>{m(e.metros)}</td>
                  <td>{v ? m(v) : '—'}</td>
                  <td className="font-bold">{m(e.metros + v)}</td>
                  <td />
                </tr>
              );
            })
          ) : (
            <tr>
              <td colSpan={6} className="text-gray-500">Sem risco concluído.</td>
            </tr>
          )}
        </tbody>
      </table>
      {d.modelo.ribana ? (
        <>
          <Titulo>Ribana</Titulo>
          <div className="text-xs">
            {d.modelo.ribana.tecido} · largura útil {formatNumero(Math.round(d.modelo.ribana.larguraUtilMm / 10))} cm
            {ribana?.resultado ? <> · risco <b>{m(ribana.resultado.comprimentoM)}</b> ({ribana.composicao.map((c) => `${c.tamanho}×${c.quantidade}`).join(' ')})</> : ' · sem risco concluído'}
          </div>
        </>
      ) : null}
      <Titulo>Tecidos da ficha (consumo previsto)</Titulo>
      <TabelaItens d={d} tipo="TECIDO" />
      {avisos.length ? (
        <>
          <Titulo>Atenção</Titulo>
          <ul className="text-xs list-disc pl-5">{avisos.map((a) => <li key={a}>{a}</li>)}</ul>
        </>
      ) : null}
      <Titulo>Corte</Titulo>
      <div className="grid grid-cols-4 gap-x-4 gap-y-2 text-xs">
        <Campo rotulo="Cortado por" />
        <Campo rotulo="Data" />
        <Campo rotulo="Peças cortadas" />
        <Campo rotulo="Sobra de tecido (m/kg)" />
        <Campo rotulo="Observações" largo />
      </div>
    </section>
  );
}

function ViaFaccao({ d }: { d: DadosImpressao }) {
  const instr = [d.op.observacoes, ...d.fichas.map((f) => f.observacoes && (d.fichas.length > 1 ? `${f.linha}: ${f.observacoes}` : f.observacoes))].filter(Boolean);
  const total = gradeCorTamanho(d.grade).total;
  return (
    <section className="via">
      <Cabecalho d={d} via="FACÇÃO" />
      <Titulo>Aviamentos que vão com o corte</Titulo>
      <TabelaItens d={d} etapa="FACCAO" tipo="AVIAMENTO" />
      {d.fichas.filter((f) => f.tabelaMedidas?.linhas.length).map((f) => (
        <div key={f.modeloLinhaId}>
          <Titulo>Tabela de medidas{d.fichas.length > 1 ? ` · ${f.linha}` : ''} (cm)</Titulo>
          <table className="ficha">
            <thead>
              <tr>
                <th className="text-left">Tam.</th>
                {f.tabelaMedidas!.colunas.map((c) => <th key={c}>{c}</th>)}
              </tr>
            </thead>
            <tbody>
              {f.tabelaMedidas!.linhas.map((l) => (
                <tr key={l.tamanho}>
                  <td className="text-left font-bold">{l.tamanho}</td>
                  {l.valores.map((v, k) => <td key={k}>{v}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
          {f.tabelaMedidas!.nota && <p className="text-xs">{f.tabelaMedidas!.nota}</p>}
        </div>
      ))}
      {instr.length ? (
        <>
          <Titulo>Instruções</Titulo>
          <div className="text-xs whitespace-pre-line">{instr.join('\n')}</div>
        </>
      ) : null}
      <Titulo>Pagamento</Titulo>
      <div className="text-xs">
        {d.op.precoFaccaoPorPeca !== null ? (
          <>Preço por peça <b>{formatMoeda(d.op.precoFaccaoPorPeca)}</b> × {total} peças = <b>{formatMoeda(d.op.precoFaccaoPorPeca * total)}</b> (pago pelas peças recebidas boas)</>
        ) : (
          'Preço por peça não definido na OP.'
        )}
      </div>
      <Titulo>Envio e recebimento</Titulo>
      <div className="grid grid-cols-4 gap-x-4 gap-y-2 text-xs">
        <Campo rotulo="Enviado em" />
        <Campo rotulo="Peças enviadas" />
        <Campo rotulo="Recebido em" />
        <Campo rotulo="Peças recebidas" />
        <Campo rotulo="Com defeito" />
        <Campo rotulo="Sobra de aviamento devolvida" />
        <Campo rotulo="Assinatura da facção" largo />
      </div>
    </section>
  );
}

function ViaAcabamento({ d }: { d: DadosImpressao }) {
  const servicos = new Map<string, { nome: string; preco: number }>();
  for (const f of d.fichas) for (const s of f.acabamento) servicos.set(s.id, s);
  const total = gradeCorTamanho(d.grade).total;
  const amostra = Math.max(1, Math.ceil(total * 0.1));
  return (
    <section className="via">
      <Cabecalho d={d} via="ACABAMENTO" />
      <Titulo>Recebido da facção</Titulo>
      <div className="grid grid-cols-4 gap-x-4 gap-y-2 text-xs">
        <Campo rotulo="Data" />
        <Campo rotulo="Peças recebidas" />
        <Campo rotulo="Com defeito" />
        <Campo rotulo="Defeito (qual)" />
      </div>
      <Titulo>Serviços do acabamento</Titulo>
      {servicos.size ? (
        <table className="ficha">
          <thead>
            <tr>
              <th className="text-left">Serviço</th>
              <th>Por peça</th>
              <th>Previsto ({total} pç)</th>
              <th>Feito (pç)</th>
            </tr>
          </thead>
          <tbody>
            {[...servicos.values()].map((s) => (
              <tr key={s.nome}>
                <td className="text-left">{s.nome}</td>
                <td>{formatMoeda(s.preco)}</td>
                <td>{formatMoeda(s.preco * total)}</td>
                <td />
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="text-xs text-gray-500">Nenhum serviço marcado na ficha.</p>
      )}
      <Titulo>Aviamentos do acabamento</Titulo>
      <TabelaItens d={d} etapa="ACABAMENTO" />
      <Titulo>Embalagem</Titulo>
      <div className="grid grid-cols-4 gap-x-4 gap-y-2 text-xs">
        <Campo rotulo="Peças por pacote" />
        <Campo rotulo="Pacotes" />
        <Campo rotulo="Etiquetado (s/n)" />
        <Campo rotulo="Caixas / volumes" />
      </div>
      <Titulo>Conferência por amostragem</Titulo>
      <div className="text-xs mb-1">
        Medir <b>{amostra}</b> peças (10%) contra a tabela de medidas · tolerância <b>± 1 cm</b>. Fora da tolerância: separar e avisar.
      </div>
      <div className="grid grid-cols-4 gap-x-4 gap-y-2 text-xs">
        <Campo rotulo="Peças medidas" />
        <Campo rotulo="Fora da medida" />
        <Campo rotulo="Conferido por" />
        <Campo rotulo="Data" />
      </div>
      <Titulo>Fechamento</Titulo>
      <div className="grid grid-cols-4 gap-x-4 gap-y-2 text-xs">
        <Campo rotulo="Peças boas para estoque" />
        <Campo rotulo="Segunda linha" />
        <Campo rotulo="Assinatura" largo />
      </div>
    </section>
  );
}

export function FichaOp({ d }: { d: DadosImpressao }) {
  return (
    <div className="ficha-op">
      <ViaCorte d={d} />
      <ViaFaccao d={d} />
      <ViaAcabamento d={d} />
    </div>
  );
}

const CSS = `
.ficha-op { color: #000; background: #fff; font-family: Cabin, sans-serif; }
.ficha-op .via { width: 210mm; min-height: 297mm; padding: 12mm; margin: 0 auto 8mm; background: #fff; box-shadow: 0 0 0 1px #ddd; box-sizing: border-box; }
.ficha-op table.ficha { width: 100%; border-collapse: collapse; font-size: 11px; }
.ficha-op table.ficha th, .ficha-op table.ficha td { border: 1px solid #999; padding: 2px 4px; text-align: center; vertical-align: top; }
.ficha-op table.ficha th { background: #eee; font-weight: 600; }
.ficha-op table.ficha .text-left { text-align: left; }
@page { size: A4; margin: 0; }
@media print {
  body { background: #fff !important; }
  .ficha-tela { padding: 0 !important; min-height: 0 !important; background: #fff !important; }
  .ficha-op .via { min-height: 0; }
  .nao-imprime { display: none !important; }
  .ficha-op .via { margin: 0; box-shadow: none; page-break-after: always; break-after: page; }
  .ficha-op .via:last-child { page-break-after: auto; break-after: auto; }
  .ficha-op table.ficha th { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
}
`;

export default function FichaOpImpressaoPage() {
  const { id } = useParams();
  const q = useApiQuery<DadosImpressao>(id ? `/erp/ops/${id}/impressao` : null);
  useEffect(() => {
    if (q.data) document.title = `${q.data.op.numero} · ficha`;
  }, [q.data]);
  return (
    <div className="ficha-tela min-h-screen bg-gray-100 py-6">
      <style>{CSS}</style>
      <div className="nao-imprime mx-auto mb-4 flex max-w-[210mm] items-center justify-between gap-3 px-2">
        <span className="text-sm text-gray-700">3 vias em A4 — corte, facção e acabamento.</span>
        <Button onClick={() => window.print()} disabled={!q.data} data-testid="ficha-op-imprimir">
          <Printer className="h-4 w-4" /> Imprimir / salvar PDF
        </Button>
      </div>
      <StateView loading={q.loading && !q.data} error={q.error} onRetry={q.refetch}>
        {q.data && <FichaOp d={q.data} />}
      </StateView>
    </div>
  );
}
