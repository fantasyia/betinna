import { describe, expect, it, vi } from 'vitest';
import { HttpStatus } from '@nestjs/common';
import {
  BusinessRuleException,
  IntegracaoNaoConfiguradaException,
  IntegrationException,
} from '@shared/errors/app-exception';
import { MullerBotService } from './mullerbot.service';

/**
 * Triagem Sentry, 30/09 — dois defeitos na mesma costura:
 *
 * 1. "Integração não configurada" saía como 502, e o filtro global manda pro
 *    Sentry tudo que é >= 500. Condição LOCAL virava erro de servidor.
 * 2. O MullerBot tinha um `catch {}` vazio: linha inexistente, linha DESATIVADA
 *    e falha ao DECIFRAR viravam a mesma mensagem — "defina a chave" —,
 *    mandando cadastrar uma chave que já estava cadastrada.
 *
 * As mensagens de `obterCredenciaisInternas` usadas abaixo são as reais
 * (integracoes.service.ts).
 */

function svcCom(falha: Error | null, envKey = '') {
  const integracoes = {
    obterCredenciaisInternas: vi.fn(async () => {
      if (falha) throw falha;
      return { credenciais: { apiKey: 'sk-empresa' } };
    }),
  };
  const env = { get: vi.fn((k: string) => (k === 'OPENAI_API_KEY' ? envKey : undefined)) };
  const vazio = {} as never;
  const svc = new MullerBotService(
    vazio,
    env as never,
    vazio,
    vazio,
    vazio,
    vazio,
    integracoes as never,
    vazio,
    vazio,
  );
  const priv = svc as unknown as {
    resolverChaveEmpresaDetalhada(e: string): Promise<{ chave?: string; falha?: string }>;
    erroSemChaveEmpresa(r: { falha?: string; detalhe?: string }, padrao: string): Error;
  };
  return { priv };
}

const PADRAO = 'OpenAI não configurada — defina a chave da empresa em Integrações.';

describe('exceção nova: não configurado é 4xx', () => {
  it('IntegracaoNaoConfiguradaException responde 422 — abaixo do corte de 500 do Sentry', () => {
    expect(new IntegracaoNaoConfiguradaException('x').getStatus()).toBe(
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
    // e a de falha REAL do provedor continua 502, indo pro Sentry
    expect(new IntegrationException('x').getStatus()).toBe(HttpStatus.BAD_GATEWAY);
  });
});

describe('MullerBot: o motivo de não ter chave chega até a mensagem', () => {
  it.each([
    [
      'linha inexistente',
      new BusinessRuleException('Integração openai não configurada para esta empresa'),
      'ausente',
    ],
    [
      'linha desativada',
      new BusinessRuleException('Integração openai está desativada para esta empresa'),
      'inativa',
    ],
    [
      'falha ao decifrar',
      new BusinessRuleException('Falha ao descriptografar credenciais de openai: bad decrypt'),
      'cripto',
    ],
    ['erro que nem é de cadastro', new Error('connection refused'), 'erro'],
  ])('%s → falha "%s"', async (_, erro, esperado) => {
    const { priv } = svcCom(erro);
    const r = await priv.resolverChaveEmpresaDetalhada('emp1');
    expect(r.chave).toBeUndefined();
    expect(r.falha).toBe(esperado);
  });

  it('sem chave da empresa, o env continua salvando — como antes', async () => {
    const { priv } = svcCom(
      new BusinessRuleException('Integração openai não configurada para esta empresa'),
      'sk-env',
    );
    expect((await priv.resolverChaveEmpresaDetalhada('emp1')).chave).toBe('sk-env');
  });

  it('ausente → 422 com a mensagem de "defina a chave"', () => {
    const { priv } = svcCom(null);
    const e = priv.erroSemChaveEmpresa({ falha: 'ausente' }, PADRAO);
    expect(e).toBeInstanceOf(IntegracaoNaoConfiguradaException);
    expect(e.message).toBe(PADRAO);
  });

  it('DESATIVADA → 422 dizendo pra reativar, NÃO pra cadastrar de novo', () => {
    const { priv } = svcCom(null);
    const e = priv.erroSemChaveEmpresa({ falha: 'inativa' }, PADRAO);
    expect(e).toBeInstanceOf(IntegracaoNaoConfiguradaException);
    expect(e.message).toMatch(/DESATIVADA/);
    expect(e.message).not.toBe(PADRAO);
  });

  it('cadastrada e ilegível → 502 (vai pro Sentry: o problema é nosso)', () => {
    const { priv } = svcCom(null);
    const e = priv.erroSemChaveEmpresa({ falha: 'cripto' }, PADRAO);
    expect(e).toBeInstanceOf(IntegrationException);
    expect(e.message).toMatch(/decifrar/);
  });

  it('toda mensagem mantém "chave" — o conversar-ia roteia ia_sem_chave pelo texto', () => {
    const { priv } = svcCom(null);
    for (const falha of ['ausente', 'inativa', 'cripto', 'erro']) {
      expect(priv.erroSemChaveEmpresa({ falha, detalhe: 'x' }, PADRAO).message).toMatch(/chave/);
    }
  });
});
