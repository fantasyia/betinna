import { Link } from 'react-router-dom';
import { AlertTriangle, Bot, CalendarDays, User, XCircle } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui';
import { cn } from '@/lib/cn';
import { tempoDesde, type AgendaHojeItem, type FalhaRecente, type ResultadoSlot } from './types';

/**
 * Cor do resultado de cada horário do robô. Nunca só cor: o texto do
 * `detalhe` diz o que aconteceu ("rodou ✓", "rodou — nada a fazer", "falhou — …").
 */
const TOM_RESULTADO: Record<ResultadoSlot, string> = {
  agendado: 'text-muted',
  ok: 'text-success',
  sem_efeito: 'text-muted',
  falhou: 'text-danger',
  rodando: 'text-info',
  cancelado: 'text-muted',
  feriado: 'text-muted',
  nao_disparou: 'text-danger',
  sem_registro: 'text-muted',
};

/**
 * M3 — Agenda de hoje (meio do trilho): timeline VERTICAL do dia unindo duas
 * coisas que viviam separadas — "o que EU tenho que fazer" (compromissos) e
 * "o que a MÁQUINA vai fazer sozinha" (disparos CRON dos fluxos ativos).
 * Ver o robô ao lado dos próprios compromissos é o que dá sensação de controle
 * — por isso é UMA lista só, ordenada por hora, nunca duas.
 */
export function AgendaHoje({
  itens,
  falhas = [],
}: {
  itens: AgendaHojeItem[];
  /** Execuções que falharam nas últimas 72h (Léo, 25/09): pra tratar rápido. */
  falhas?: FalhaRecente[];
}) {
  return (
    <Card padding="md" data-testid="agenda-hoje">
      <CardHeader>
        <CardTitle>Agenda de hoje</CardTitle>
        <CardDescription>
          {itens.length === 0 ? 'Nada agendado pra hoje' : 'Você + a máquina, na mesma linha do tempo'}
        </CardDescription>
      </CardHeader>

      {itens.length === 0 ? (
        <div className="flex items-center gap-2 py-3 text-sm text-muted">
          <CalendarDays className="h-4 w-4" aria-hidden />
          Dia livre — nenhum compromisso nem disparo automático.
        </div>
      ) : (
        <ol className="relative flex flex-col gap-0.5 pl-1">
          {itens.map((item, i) => {
            const Icone = item.tipo === 'robo' ? Bot : User;
            const hora = new Date(item.hora).toLocaleTimeString('pt-BR', {
              hour: '2-digit',
              minute: '2-digit',
            });
            return (
              <li key={`${item.hora}-${i}`}>
                <Link
                  to={item.link}
                  data-testid="agenda-item"
                  className="flex items-start gap-2.5 py-2 px-1 rounded-md hover:bg-surface-hover transition-colors"
                >
                  <span className="text-xs tabular text-muted w-10 shrink-0 pt-0.5">{hora}</span>
                  {/* Trilho vertical: ícone marca o tipo (humano × robô), nunca só cor. */}
                  <span
                    className={cn(
                      'flex h-6 w-6 items-center justify-center rounded-full border shrink-0',
                      item.tipo === 'robo'
                        ? 'border-secondary/40 bg-secondary/10 text-secondary-hover'
                        : 'border-primary/40 bg-primary/10 text-primary',
                    )}
                  >
                    <Icone className="h-3.5 w-3.5" aria-hidden />
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm text-text truncate">{item.titulo}</p>
                    <p
                      className={cn(
                        'text-[11px]',
                        item.tipo === 'robo' && item.resultado
                          ? TOM_RESULTADO[item.resultado]
                          : 'text-muted',
                      )}
                      data-testid={item.tipo === 'robo' ? 'agenda-resultado' : undefined}
                    >
                      {item.tipo === 'robo'
                        ? `🤖 ${item.detalhe ?? 'disparo automático'}`
                        : (item.detalhe ?? 'compromisso')}
                    </p>
                  </div>
                </Link>
              </li>
            );
          })}
        </ol>
      )}

      <div className="mt-3 border-t border-border pt-3" data-testid="falhas-72h">
        <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-text">
          {falhas.length ? (
            <AlertTriangle className="h-3.5 w-3.5 text-danger" aria-hidden />
          ) : null}
          Falhas nas últimas 72h
          <span className="text-muted font-normal">({falhas.length})</span>
        </p>
        {falhas.length === 0 ? (
          <p className="text-[11px] text-success">Nenhuma execução falhou.</p>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {falhas.map((f) => (
              <li key={f.id}>
                <Link
                  to={f.link}
                  data-testid="falha-item"
                  className="flex items-start gap-2 rounded-md px-1 py-1.5 hover:bg-surface-hover transition-colors"
                >
                  <XCircle className="h-3.5 w-3.5 mt-0.5 shrink-0 text-danger" aria-hidden />
                  <div className="min-w-0">
                    <p className="text-xs text-text truncate">
                      {f.fluxoNome}{' '}
                      <span className="text-[10px] text-muted tabular">{tempoDesde(f.em)}</span>
                    </p>
                    <p className="text-[11px] text-text-subtle line-clamp-2">{f.erro}</p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
