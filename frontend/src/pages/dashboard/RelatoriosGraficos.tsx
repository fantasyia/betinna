import { useState } from 'react';
import { useApiQuery } from '@/hooks/useApiQuery';
import { SkeletonCard } from '@/components/ui';
import { Select } from '@/components/FormField';
import { formatNumero } from '@/lib/masks';
import {
  ChartCard,
  GraficoLinha,
  GraficoBarrasH,
  GraficoEmpilhadoDiario,
  GraficoConversao,
} from './graficos-kit';

/**
 * M8 — Relatórios do dashboard: 5 gráficos alimentados por UMA chamada
 * (/dashboard/graficos). Filtros de período/funil numa linha ÚNICA acima dos
 * gráficos (regra do card: não espalhar filtro por card). Cada gráfico tem
 * vista de tabela equivalente + export PNG e CSV.
 */

interface GraficosResp {
  periodo: { de: string; ate: string; dias: number };
  funis: Array<{ id: string; nome: string }>;
  funilSelecionado: { id: string; nome: string } | null;
  leadsPorDia: Array<{ dia: string; total: number }>;
  utm: Array<{ campanha: string; total: number }>;
  conversaoFunil: Array<{
    id: string;
    nome: string;
    cor: string;
    entradas: number;
    taxaAvanco: number | null;
  }>;
  tempoPorEtapa: Array<{ id: string; nome: string; cor: string; dias: number | null }>;
  saudeFluxos: Array<{ dia: string; ok: number; erro: number }>;
}

const DIAS_OPCOES = [7, 30, 90] as const;
type Dias = (typeof DIAS_OPCOES)[number];

export function RelatoriosGraficos({ ehGestao }: { ehGestao: boolean }) {
  const [dias, setDias] = useState<Dias>(30);
  const [funilId, setFunilId] = useState('');
  const { data, loading } = useApiQuery<GraficosResp>(
    `/dashboard/graficos?dias=${dias}${funilId ? `&funilId=${funilId}` : ''}`,
  );

  if (loading && !data) return <SkeletonCard />;
  if (!data) return null;

  const totalLeads = data.leadsPorDia.reduce((s, p) => s + p.total, 0);
  const totalExec = data.saudeFluxos.reduce((s, d) => s + d.ok + d.erro, 0);
  const fmtDias = (v: number | null) => (v == null ? '—' : `${String(v).replace('.', ',')}d`);

  return (
    <section data-testid="dash-graficos" className="flex flex-col gap-3">
      {/* Filtros numa linha ÚNICA acima dos gráficos */}
      <div className="flex items-center gap-2 flex-wrap">
        <h2 className="m-0 text-[15px] font-semibold mr-auto">Relatórios</h2>
        <div className="flex border border-border-strong rounded-md overflow-hidden">
          {DIAS_OPCOES.map((d) => (
            <button
              key={d}
              type="button"
              data-testid={`graficos-dias-${d}`}
              onClick={() => setDias(d)}
              className={`px-2.5 py-1 text-[12px] font-medium cursor-pointer border-none ${
                dias === d ? 'bg-primary text-primary-contrast' : 'bg-surface text-muted'
              }`}
            >
              {d}d
            </button>
          ))}
        </div>
        <Select
          value={funilId || data.funilSelecionado?.id || ''}
          onChange={(e) => setFunilId(e.target.value)}
          data-testid="graficos-funil"
          style={{ minWidth: 170, fontSize: 12, padding: '0.25rem 0.5rem' }}
        >
          {data.funis.map((f) => (
            <option key={f.id} value={f.id}>
              {f.nome}
            </option>
          ))}
        </Select>
      </div>

      {/* items-start: um card VAZIO não estica pra acompanhar o vizinho alto —
          encolhe pro "sem dados ainda" (regra da passada de densidade). */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-2.5 items-start">
        <ChartCard
          titulo="Leads ao longo do tempo"
          subtitulo={`${formatNumero(totalLeads)} no período · fora da triagem`}
          filename="leads-no-tempo"
          vazio={totalLeads === 0}
          tabela={{
            colunas: [
              { header: 'Dia', value: (r: GraficosResp['leadsPorDia'][number]) => r.dia },
              { header: 'Leads', value: (r) => r.total },
            ],
            rows: data.leadsPorDia,
          }}
        >
          <GraficoLinha pontos={data.leadsPorDia} rotuloSerie="Leads" />
        </ChartCard>

        <ChartCard
          titulo="Origem por campanha (UTM)"
          subtitulo="Leads com utm_campaign no período"
          filename="origem-utm"
          vazio={data.utm.length === 0}
          tabela={{
            colunas: [
              { header: 'Campanha', value: (r: GraficosResp['utm'][number]) => r.campanha },
              { header: 'Leads', value: (r) => r.total },
            ],
            rows: data.utm,
          }}
        >
          <GraficoBarrasH
            dados={data.utm.map((u) => ({ label: u.campanha, valor: u.total }))}
            sufixoTooltip="leads"
          />
        </ChartCard>

        <ChartCard
          titulo={`Conversão do funil${data.funilSelecionado ? ` — ${data.funilSelecionado.nome}` : ''}`}
          subtitulo="Entradas por etapa no período + % que avança"
          filename="conversao-funil"
          vazio={data.conversaoFunil.every((e) => e.entradas === 0)}
          tabela={{
            colunas: [
              { header: 'Etapa', value: (r: GraficosResp['conversaoFunil'][number]) => r.nome },
              { header: 'Entradas', value: (r) => r.entradas },
              {
                header: '% avança',
                value: (r) => (r.taxaAvanco == null ? '—' : `${String(r.taxaAvanco).replace('.', ',')}%`),
              },
            ],
            rows: data.conversaoFunil,
          }}
        >
          <GraficoConversao etapas={data.conversaoFunil} />
        </ChartCard>

        {ehGestao && (
          <ChartCard
            titulo="Saúde dos fluxos (execuções por dia)"
            subtitulo={`${formatNumero(totalExec)} execuções no período`}
            filename="saude-fluxos"
            vazio={totalExec === 0}
            tabela={{
              colunas: [
                { header: 'Dia', value: (r: GraficosResp['saudeFluxos'][number]) => r.dia },
                { header: 'OK', value: (r) => r.ok },
                { header: 'Erro', value: (r) => r.erro },
              ],
              rows: data.saudeFluxos,
            }}
          >
            <GraficoEmpilhadoDiario dados={data.saudeFluxos} />
          </ChartCard>
        )}

        <ChartCard
          titulo={`Tempo médio por etapa${data.funilSelecionado ? ` — ${data.funilSelecionado.nome}` : ''}`}
          subtitulo="Dias que um lead fica em cada etapa (histórico completo)"
          filename="tempo-por-etapa"
          vazio={data.tempoPorEtapa.every((e) => e.dias == null)}
          tabela={{
            colunas: [
              { header: 'Etapa', value: (r: GraficosResp['tempoPorEtapa'][number]) => r.nome },
              { header: 'Dias (média)', value: (r) => fmtDias(r.dias) },
            ],
            rows: data.tempoPorEtapa,
          }}
        >
          <GraficoBarrasH
            dados={data.tempoPorEtapa.map((e) => ({
              label: e.nome,
              valor: e.dias ?? 0,
              cor: e.cor,
            }))}
            formatValor={(v) => fmtDias(v)}
          />
        </ChartCard>
      </div>
    </section>
  );
}
