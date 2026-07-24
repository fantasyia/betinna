import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Play,
  Pause,
  PencilRuler,
  AlertTriangle,
  CheckCircle2,
  FileEdit,
  FlaskConical,
  type LucideIcon,
} from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  Dialog,
  IconButton,
} from '@/components/ui';
import { useToast } from '@/components/toast';
import { api, apiErrorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { TRIGGER_LABEL } from '@/pages/fluxo/lib/metadata';
import type { TriggerTipo } from '@/pages/fluxo/lib/types';
import type { FluxoSalaRow } from './types';

/** Chip de status: SEMPRE ícone + texto (nunca cor sozinha). */
const STATUS_META: Record<FluxoSalaRow['status'], { label: string; icone: LucideIcon; classe: string }> = {
  ATIVO: { label: 'Ativo', icone: CheckCircle2, classe: 'text-success' },
  PAUSADO: { label: 'Pausado', icone: Pause, classe: 'text-warning' },
  RASCUNHO: { label: 'Rascunho', icone: FileEdit, classe: 'text-muted' },
};

/** Família do fluxo pelo prefixo do nome ("E1 …" → E-mail, "R2 …" → Reps, "W…" → WhatsApp). */
function familiaDe(nome: string): string {
  const m = nome.trim().match(/^([ERW])\d/i);
  if (!m) return 'Outros';
  const letra = m[1].toUpperCase();
  return letra === 'E' ? 'E-mail' : letra === 'R' ? 'Reps' : 'WhatsApp';
}

/** Sparkline 7d — SVG minúsculo, sem lib. Barras (execução é contagem, não fluxo contínuo). */
function Sparkline({ serie }: { serie: number[] }) {
  const max = Math.max(...serie, 1);
  const W = 56;
  const H = 18;
  const bw = W / serie.length - 2;
  return (
    <svg width={W} height={H} aria-hidden className="shrink-0">
      {serie.map((v, i) => {
        const h = Math.max(v > 0 ? 2 : 0, Math.round((v / max) * H));
        return (
          <rect
            key={i}
            x={i * (bw + 2)}
            y={H - h}
            width={bw}
            height={h}
            rx={1}
            className="fill-primary/60"
          />
        );
      })}
    </svg>
  );
}

function fmtProximo(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  const difH = (d.getTime() - Date.now()) / 3_600_000;
  const hora = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  if (difH < 24 && d.getDate() === new Date().getDate()) return `hoje ${hora}`;
  return `${d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} ${hora}`;
}

/**
 * M6 — Fluxos: sala de controle. Grade com TODOS os fluxos agrupada por família,
 * ações rápidas por linha (ativar/pausar com confirmação · testar · abrir grafo).
 * Com 0 fluxos ativos exibe ALERTA DE PRONTIDÃO — nunca tabela vazia sem contexto.
 */
export function FluxosSala({ fluxos, onChanged }: { fluxos: FluxoSalaRow[]; onChanged: () => void }) {
  const navigate = useNavigate();
  const toast = useToast();
  const [confirmar, setConfirmar] = useState<{ fluxo: FluxoSalaRow; acao: 'ativar' | 'pausar' } | null>(null);
  const [busy, setBusy] = useState(false);

  const ativos = fluxos.filter((f) => f.status === 'ATIVO').length;
  const rascunhos = fluxos.filter((f) => f.status === 'RASCUNHO').length;
  const pausados = fluxos.filter((f) => f.status === 'PAUSADO').length;

  const familias = new Map<string, FluxoSalaRow[]>();
  for (const f of fluxos) {
    const fam = familiaDe(f.nome);
    familias.set(fam, [...(familias.get(fam) ?? []), f]);
  }

  async function executarAcao() {
    if (!confirmar) return;
    setBusy(true);
    try {
      await api.post(`/fluxos/${confirmar.fluxo.id}/${confirmar.acao}`);
      toast.success(confirmar.acao === 'ativar' ? 'Fluxo ativado' : 'Fluxo pausado');
      setConfirmar(null);
      onChanged();
    } catch (err) {
      toast.error('Falha na ação', apiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card padding="md" id="mod-fluxos" data-testid="fluxos-sala">
      <CardHeader>
        <CardTitle>Fluxos — sala de controle</CardTitle>
        <CardDescription>
          {ativos}/{fluxos.length} ativos · execuções dos últimos 7 dias
        </CardDescription>
      </CardHeader>

      {/* ALERTA DE PRONTIDÃO: máquina desligada nunca vira tabela vazia muda. */}
      {ativos === 0 && fluxos.length > 0 && (
        <div
          data-testid="alerta-prontidao-fluxos"
          className="mb-3 flex items-start gap-2 rounded-md bg-warning/12 border border-warning/30 px-3 py-2 text-sm text-warning"
        >
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" aria-hidden />
          <span>
            Nenhuma automação rodando: {rascunhos} rascunho{rascunhos === 1 ? '' : 's'},{' '}
            {pausados} pausado{pausados === 1 ? '' : 's'}. Revise e ative pra ligar a máquina.
          </span>
        </div>
      )}

      {fluxos.length === 0 ? (
        <p className="py-3 text-sm text-muted">Nenhum fluxo criado ainda.</p>
      ) : (
        <div className="overflow-x-auto -mx-2">
          {/* w-auto (não w-full): a tabela toma a largura do CONTEÚDO em vez de
              esticar pro card inteiro e espalhar as colunas com gaps enormes. */}
          <table className="w-auto min-w-[640px] max-w-full">
            <thead>
              <tr className="text-[11px] font-semibold uppercase tracking-wider text-muted border-b border-border">
                <th className="text-left px-2 py-2">Fluxo</th>
                <th className="text-left px-2 py-2">Status</th>
                <th className="text-left px-2 py-2">Gatilho</th>
                <th className="text-left px-2 py-2">Exec. 7d</th>
                <th className="text-left px-2 py-2">Sucesso</th>
                <th className="text-left px-2 py-2">Próx. disparo</th>
                <th className="text-right px-2 py-2">Ações</th>
              </tr>
            </thead>
            <tbody>
              {[...familias.entries()].map(([fam, lista]) => (
                <FamiliaRows
                  key={fam}
                  familia={fam}
                  lista={lista}
                  onAtivar={(f) => setConfirmar({ fluxo: f, acao: 'ativar' })}
                  onPausar={(f) => setConfirmar({ fluxo: f, acao: 'pausar' })}
                  onAbrir={(f) => navigate(`/fluxos/${f.id}`)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {confirmar && (
        <Dialog
          open
          onClose={() => setConfirmar(null)}
          title={confirmar.acao === 'ativar' ? 'Ativar fluxo' : 'Pausar fluxo'}
          size="sm"
          footer={
            <>
              <Button variant="secondary" onClick={() => setConfirmar(null)} disabled={busy}>
                Cancelar
              </Button>
              <Button
                loading={busy}
                onClick={() => void executarAcao()}
                data-testid="confirmar-acao-fluxo"
              >
                {confirmar.acao === 'ativar' ? 'Ativar' : 'Pausar'}
              </Button>
            </>
          }
        >
          <p className="text-sm text-text-subtle">
            {confirmar.acao === 'ativar'
              ? `"${confirmar.fluxo.nome}" vai começar a disparar de verdade (mensagens/ações reais).`
              : `"${confirmar.fluxo.nome}" para de disparar até você reativar.`}
          </p>
        </Dialog>
      )}
    </Card>
  );
}

function FamiliaRows({
  familia,
  lista,
  onAtivar,
  onPausar,
  onAbrir,
}: {
  familia: string;
  lista: FluxoSalaRow[];
  onAtivar: (f: FluxoSalaRow) => void;
  onPausar: (f: FluxoSalaRow) => void;
  onAbrir: (f: FluxoSalaRow) => void;
}) {
  return (
    <>
      <tr>
        <td colSpan={7} className="px-2 pt-3 pb-1">
          <Badge variant="neutral">{familia}</Badge>
        </td>
      </tr>
      {lista.map((f) => {
        const st = STATUS_META[f.status];
        return (
          <tr key={f.id} className="border-b border-border last:border-b-0" data-testid="fluxo-row">
            <td className="px-2 py-2">
              <button
                type="button"
                onClick={() => onAbrir(f)}
                className="text-sm font-medium text-text hover:text-primary text-left truncate max-w-[220px] block"
              >
                {f.nome}
              </button>
            </td>
            <td className="px-2 py-2">
              <span className={cn('inline-flex items-center gap-1 text-xs font-medium', st.classe)}>
                <st.icone className="h-3.5 w-3.5" aria-hidden />
                {st.label}
              </span>
            </td>
            <td className="px-2 py-2 text-xs text-text-subtle truncate max-w-[140px]">
              {f.triggerTipo ? (TRIGGER_LABEL[f.triggerTipo as TriggerTipo] ?? f.triggerTipo) : 'Manual'}
            </td>
            <td className="px-2 py-2">
              <div className="flex items-center gap-2">
                <Sparkline serie={f.exec7d.serie} />
                <span className="text-xs tabular text-text-subtle">{f.exec7d.total}</span>
              </div>
            </td>
            <td className="px-2 py-2">
              {f.pctSucesso === null ? (
                <span className="text-xs text-muted">—</span>
              ) : (
                <div className="flex flex-col">
                  <span
                    className={cn(
                      'inline-flex items-center gap-1 text-xs font-medium tabular',
                      f.pctSucesso >= 90 ? 'text-success' : f.pctSucesso >= 60 ? 'text-warning' : 'text-danger',
                    )}
                  >
                    {f.pctSucesso >= 90 ? (
                      <CheckCircle2 className="h-3 w-3" aria-hidden />
                    ) : (
                      <AlertTriangle className="h-3 w-3" aria-hidden />
                    )}
                    {f.pctSucesso}%
                  </span>
                  {f.ultimoErro && (
                    <span className="text-[10px] text-danger/80 truncate max-w-[160px]" title={f.ultimoErro}>
                      {f.ultimoErro}
                    </span>
                  )}
                </div>
              )}
            </td>
            <td className="px-2 py-2 text-xs tabular text-text-subtle">{fmtProximo(f.proximoDisparo)}</td>
            <td className="px-2 py-2">
              <div className="flex items-center justify-end gap-0.5">
                {f.status === 'ATIVO' ? (
                  <IconButton
                    aria-label={`Pausar ${f.nome}`}
                    variant="ghost"
                    size="sm"
                    icon={<Pause />}
                    onClick={() => onPausar(f)}
                  />
                ) : (
                  <IconButton
                    aria-label={`Ativar ${f.nome}`}
                    variant="ghost"
                    size="sm"
                    icon={<Play />}
                    onClick={() => onAtivar(f)}
                  />
                )}
                <IconButton
                  aria-label={`Testar ${f.nome}`}
                  variant="ghost"
                  size="sm"
                  icon={<FlaskConical />}
                  onClick={() => onAbrir(f)}
                  title="Abrir o grafo (painel de teste fica no editor)"
                />
                <IconButton
                  aria-label={`Abrir grafo de ${f.nome}`}
                  variant="ghost"
                  size="sm"
                  icon={<PencilRuler />}
                  onClick={() => onAbrir(f)}
                />
              </div>
            </td>
          </tr>
        );
      })}
    </>
  );
}
