import { describe, expect, it } from 'vitest';
import { BotAuditoriaService } from './bot-auditoria.service';

// EnvService falso — devolve a lista padrão de palavras-chave.
const envMock = {
  get: () =>
    'preço,preco,R$,estoque,disponível,disponivel,entrega em,prazo de,frete,promoção,promocao,desconto',
} as never;

function build() {
  return new BotAuditoriaService({} as never, envMock);
}

describe('BotAuditoriaService — flag de revisão', () => {
  const svc = build();

  it('marca resposta que cita preço/R$', () => {
    const r = svc.avaliarRevisao('O óleo custa R$ 48,00 a unidade.');
    expect(r.marcar).toBe(true);
    expect(r.motivo).toContain('r$');
  });

  it('marca resposta que cita estoque/disponível', () => {
    expect(svc.avaliarRevisao('Sim, temos em estoque, disponível pra entrega.').marcar).toBe(true);
  });

  it('marca resposta que cita prazo/frete', () => {
    expect(svc.avaliarRevisao('A entrega em 3 dias, frete grátis acima de 5 mil.').marcar).toBe(true);
  });

  it('NÃO marca conversa neutra', () => {
    expect(svc.avaliarRevisao('Olá! Tudo bem? Como posso ajudar você hoje?').marcar).toBe(false);
  });

  it('NÃO marca resposta vazia/nula', () => {
    expect(svc.avaliarRevisao(null).marcar).toBe(false);
    expect(svc.avaliarRevisao('').marcar).toBe(false);
  });
});
