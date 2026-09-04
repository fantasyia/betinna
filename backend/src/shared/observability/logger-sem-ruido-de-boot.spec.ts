import { describe, expect, it, vi } from 'vitest';
import { semRuidoDeBoot } from './logger-sem-ruido-de-boot';

/**
 * O Railway corta em 500 logs/s por réplica e DESCARTA o excedente. A API
 * despejava o inventário de boot inteiro (uma linha por rota, por controller e
 * por módulo) no mesmo segundo e batia o teto:
 * `Railway rate limit of 500 logs/sec reached [...] Messages dropped: 82`.
 *
 * O que se perde ali é arbitrário — um erro de boot pode cair na janela. Estes
 * testes prendem os dois lados: o inventário some, o erro NÃO.
 */
const base = () => ({
  log: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
  verbose: vi.fn(),
});

describe('semRuidoDeBoot', () => {
  it('engole o mapeamento de rota, o controller e o módulo', () => {
    const b = base();
    const l = semRuidoDeBoot(b);

    l.log('Mapped {/api/v1/pedidos, GET} route', 'RouterExplorer');
    l.log('PedidosController {/api/v1/pedidos}:', 'RoutesResolver');
    l.log('PedidosModule dependencies initialized', 'InstanceLoader');

    expect(b.log).not.toHaveBeenCalled();
  });

  it('log de negócio passa — o filtro é por CONTEXTO, não por volume', () => {
    const b = base();
    semRuidoDeBoot(b).log('pedido PED-0034 liberado no ERP', 'PedidoErpSyncService');
    expect(b.log).toHaveBeenCalledTimes(1);
  });

  it('log SEM contexto passa', () => {
    const b = base();
    semRuidoDeBoot(b).log('🚀 Betinna.ai backend rodando');
    expect(b.log).toHaveBeenCalledTimes(1);
  });

  it('error e warn passam MESMO vindos dos contextos calados — é o ponto todo', () => {
    const b = base();
    const l = semRuidoDeBoot(b);

    l.error('Nest não conseguiu resolver a dependência', 'InstanceLoader');
    l.warn('rota duplicada', 'RouterExplorer');

    expect(b.error).toHaveBeenCalledTimes(1);
    expect(b.warn).toHaveBeenCalledTimes(1);
  });

  it('debug/verbose do boot também somem (o teto conta TODA linha)', () => {
    const b = base();
    const l = semRuidoDeBoot(b);

    l.debug?.('detalhe', 'RouterExplorer');
    l.verbose?.('detalhe', 'InstanceLoader');
    l.debug?.('consulta lenta', 'PrismaService');

    expect(b.debug).toHaveBeenCalledTimes(1);
    expect(b.verbose).not.toHaveBeenCalled();
  });

  it('logger base sem debug/verbose não quebra', () => {
    const parcial = { log: vi.fn(), error: vi.fn(), warn: vi.fn() };
    const l = semRuidoDeBoot(parcial);
    expect(() => l.debug?.('x', 'PrismaService')).not.toThrow();
  });
});
