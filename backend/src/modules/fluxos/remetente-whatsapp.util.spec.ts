import { describe, expect, it } from 'vitest';
import { resolverRemetente } from './remetente-whatsapp.util';

/**
 * De qual número sai a mensagem de um fluxo.
 *
 * O caso que motivou: o app deixa o rep conectar o WhatsApp pessoal e o inbound
 * já recebe por ele, mas o envio saía sempre pela empresa — o cliente escrevia
 * pro número do rep e a Somatec respondia de outro número.
 */
describe('resolverRemetente', () => {
  it('conversa do rep + resposta ao lead: sai pelo número do REP', () => {
    expect(resolverRemetente({ donoDaConversa: 'rep-1', modo: 'lead' })).toEqual({
      proprietarioId: 'rep-1',
      origem: 'conversa',
    });
  });

  it('conversa do número da empresa: sai pela empresa', () => {
    expect(resolverRemetente({ donoDaConversa: null, modo: 'lead' })).toEqual({
      proprietarioId: null,
      origem: 'empresa',
    });
  });

  it('aviso interno (numero/contato) NÃO sai do celular do rep', () => {
    // Alerta pra diretoria saindo do número pessoal de um funcionário não é
    // "responder pela mesma porta" — é usar o rep como remetente de recado
    // interno. Mesmo com a execução vindo da conversa dele.
    for (const modo of ['numero', 'contato'] as const) {
      expect(resolverRemetente({ donoDaConversa: 'rep-1', modo })).toEqual({
        proprietarioId: null,
        origem: 'empresa',
      });
    }
  });

  it('override explícito ganha de tudo — inclusive nos modos internos', () => {
    expect(
      resolverRemetente({ configurado: 'rep-9', donoDaConversa: null, modo: 'numero' }),
    ).toEqual({ proprietarioId: 'rep-9', origem: 'configurado' });
    expect(
      resolverRemetente({ configurado: 'rep-9', donoDaConversa: 'rep-1', modo: 'lead' }),
    ).toEqual({ proprietarioId: 'rep-9', origem: 'configurado' });
  });

  it('string vazia no override não conta como escolha', () => {
    expect(resolverRemetente({ configurado: '', donoDaConversa: 'rep-1', modo: 'lead' })).toEqual({
      proprietarioId: 'rep-1',
      origem: 'conversa',
    });
  });

  it('a origem viaja na resposta — é o que o histórico mostra depois', () => {
    // Sem isso, olhar a execução não diz por qual número a mensagem saiu, que é
    // exatamente a dúvida quando o cliente reclama de ter recebido de outro
    // contato.
    expect(resolverRemetente({ donoDaConversa: 'rep-1', modo: 'lead' }).origem).toBe('conversa');
    expect(resolverRemetente({ configurado: 'rep-2', modo: 'lead' }).origem).toBe('configurado');
    expect(resolverRemetente({ modo: 'lead' }).origem).toBe('empresa');
  });
});
