import { Link } from 'react-router-dom';
import { Rocket, ArrowRight } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui';
import type { ProntidaoLinha } from './types';

/**
 * MODO PRONTIDÃO — quando não há operação rodando, o dashboard mostra O QUE
 * FALTA pra ligar a máquina, em vez de gráfico zerado. Cada linha tem o próximo
 * passo e o link de 1 clique.
 */
export function ProntidaoCard({ linhas }: { linhas: ProntidaoLinha[] }) {
  return (
    <Card padding="md" data-testid="modo-prontidao" className="border-warning/40">
      <CardHeader>
        <CardTitle>
          <span className="inline-flex items-center gap-2">
            <Rocket className="h-4 w-4 text-warning" aria-hidden />
            Prontidão pro lançamento
          </span>
        </CardTitle>
        <CardDescription>
          A operação ainda não está rodando — este é o caminho pra ligar a máquina.
        </CardDescription>
      </CardHeader>
      <ul className="flex flex-col divide-y divide-border">
        {linhas.map((l, i) => (
          <li key={i}>
            <Link
              to={l.link}
              data-testid="prontidao-linha"
              className="flex items-center justify-between gap-3 py-2.5 group hover:bg-surface-hover rounded-md px-1 transition-colors"
            >
              <div className="min-w-0">
                <p className="text-sm text-text leading-snug">{l.texto}</p>
                <p className="text-xs text-muted">→ {l.proximoPasso}</p>
              </div>
              <ArrowRight
                className="h-3.5 w-3.5 shrink-0 text-muted opacity-0 group-hover:opacity-100 transition-opacity"
                aria-hidden
              />
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}
