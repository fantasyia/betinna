import { Link } from 'react-router-dom';
import { Bot, CalendarDays, User } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui';
import { cn } from '@/lib/cn';
import type { AgendaHojeItem } from './types';

/**
 * M3 — Agenda de hoje (meio do trilho): timeline VERTICAL do dia unindo duas
 * coisas que viviam separadas — "o que EU tenho que fazer" (compromissos) e
 * "o que a MÁQUINA vai fazer sozinha" (disparos CRON dos fluxos ativos).
 * Ver o robô ao lado dos próprios compromissos é o que dá sensação de controle
 * — por isso é UMA lista só, ordenada por hora, nunca duas.
 */
export function AgendaHoje({ itens }: { itens: AgendaHojeItem[] }) {
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
                    <p className="text-[11px] text-muted">
                      {item.tipo === 'robo' ? '🤖 disparo automático' : (item.detalhe ?? 'compromisso')}
                    </p>
                  </div>
                </Link>
              </li>
            );
          })}
        </ol>
      )}
    </Card>
  );
}
