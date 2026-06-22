import { describe, expect, it } from 'vitest';
import { BusinessRuleException, IntegrationException } from '@shared/errors/app-exception';
import { classificarFalhaToken } from './meta-token-refresh.job';

describe('classificarFalhaToken', () => {
  it('5xx do Meta = transitória (não desconecta)', () => {
    expect(
      classificarFalhaToken(new IntegrationException('Meta Graph HTTP 503', undefined, 503)),
    ).toBe('transitoria');
  });

  it('timeout/rede (upstreamStatus 0) = transitória', () => {
    expect(classificarFalhaToken(new IntegrationException('Meta Graph HTTP 0', undefined, 0))).toBe(
      'transitoria',
    );
  });

  it('429 (rate limit) = transitória', () => {
    expect(
      classificarFalhaToken(new IntegrationException('Meta Graph HTTP 429', undefined, 429)),
    ).toBe('transitoria');
  });

  it('4xx (token inválido/revogado) = definitiva', () => {
    expect(
      classificarFalhaToken(new IntegrationException('Meta Graph HTTP 400', undefined, 400)),
    ).toBe('definitiva');
  });

  it('página inacessível (BusinessRuleException) = definitiva', () => {
    expect(classificarFalhaToken(new BusinessRuleException('Página 123 não acessível'))).toBe(
      'definitiva',
    );
  });

  it('IntegrationException sem upstreamStatus = transitória (conservador)', () => {
    expect(classificarFalhaToken(new IntegrationException('erro genérico'))).toBe('transitoria');
  });

  it('erro desconhecido = transitória (não derruba conexão por engano)', () => {
    expect(classificarFalhaToken(new Error('boom'))).toBe('transitoria');
  });
});
