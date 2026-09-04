import type { LoggerService } from '@nestjs/common';

/**
 * Contextos do Nest que só falam no boot, uma linha por rota/módulo.
 *
 * - `RouterExplorer`  → `Mapped {/api/v1/..., GET} route` (uma por ENDPOINT)
 * - `RoutesResolver`  → `XController {/api/v1/...}:` (uma por controller)
 * - `InstanceLoader`  → `XModule dependencies initialized` (uma por módulo)
 */
const CONTEXTOS_DE_BOOT = new Set(['RouterExplorer', 'RoutesResolver', 'InstanceLoader']);

/**
 * Cala o inventário de boot do Nest — e só ele.
 *
 * O Railway corta em 500 linhas/s por réplica e DESCARTA o excedente. A API
 * despejava centenas de linhas de mapeamento de rota no mesmo segundo e batia o
 * teto: `Railway rate limit of 500 logs/sec reached [...] Messages dropped: 82`.
 * As 82 descartadas são arbitrárias dentro daquela janela — se um erro de boot
 * cair ali, ele some, e "subiu limpo" vira suposição em vez de fato. Foi
 * exatamente o log que faltou na investigação de 04/09.
 *
 * O filtro é deliberadamente estreito: derruba apenas `log`/`verbose`/`debug`
 * desses três contextos. `error` e `warn` passam SEMPRE, inclusive vindos deles
 * — módulo que falha ao inicializar continua gritando.
 */
export function semRuidoDeBoot(base: LoggerService): LoggerService {
  const ehRuido = (contexto?: unknown): boolean =>
    typeof contexto === 'string' && CONTEXTOS_DE_BOOT.has(contexto);

  return {
    log: (mensagem: unknown, ...resto: unknown[]) => {
      if (ehRuido(resto[0])) return;
      base.log(mensagem, ...resto);
    },
    // Nunca filtrados: são o motivo de o log existir.
    error: (mensagem: unknown, ...resto: unknown[]) => base.error(mensagem, ...resto),
    warn: (mensagem: unknown, ...resto: unknown[]) => base.warn(mensagem, ...resto),
    debug: (mensagem: unknown, ...resto: unknown[]) => {
      if (ehRuido(resto[0])) return;
      base.debug?.(mensagem, ...resto);
    },
    verbose: (mensagem: unknown, ...resto: unknown[]) => {
      if (ehRuido(resto[0])) return;
      base.verbose?.(mensagem, ...resto);
    },
  };
}
