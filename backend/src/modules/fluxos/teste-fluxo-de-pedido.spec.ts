import { describe, expect, it } from 'vitest';
import { FluxosService } from './fluxos.service';

/**
 * A guarda do teste não pode ser mais rígida que os nós que ela protege.
 *
 * Ela exigia `conversationId` sempre que o grafo tivesse `PAUSAR_IA`. Isso
 * tornava **intestável na forma real** toda a família `PEDIDO_*`: o evento
 * verdadeiro traz `pedidoId`/`clienteId` e nunca conversa, então quem testasse
 * era obrigado a informar uma — e aí o `PAUSAR_IA` usava a conversa direto e o
 * caminho por telefone nunca rodava. O teste só exercitava o cenário que nunca
 * quebrou.
 *
 * Foi assim que o defeito de 10/09 atravessou a bateria inteira e só apareceu
 * quando dois pedidos REAIS despacharam, com o cliente ficando sem o rastreio.
 */
const NOS_COM_PAUSAR_IA = [
  { tipo: 'TRIGGER', acaoTipo: null, titulo: 'Rastreio passou a existir' },
  { tipo: 'ACAO', acaoTipo: 'PAUSAR_IA', titulo: 'Religar IA — ele pode perguntar quando chega' },
];

/** O método é privado; o teste chama pelo nome, que é o contrato real dele. */
const checar = (contexto: Record<string, unknown>) =>
  (
    FluxosService.prototype as unknown as {
      assertTesteNaoPrecisaDeConversa: (
        nos: typeof NOS_COM_PAUSAR_IA,
        ctx: Record<string, unknown>,
      ) => void;
    }
  ).assertTesteNaoPrecisaDeConversa(NOS_COM_PAUSAR_IA, contexto);

describe('testar fluxo que age sobre conversa', () => {
  // A forma EXATA do evento `PEDIDO_RASTREIO_DISPONIVEL`: sem lead, sem conversa.
  it('aceita o contexto real de um evento de PEDIDO', () => {
    expect(() => checar({ pedidoId: 'ped-1', clienteId: 'cli-1' })).not.toThrow();
  });

  it('aceita só clienteId — dá pra achar o telefone por ele', () => {
    expect(() => checar({ clienteId: 'cli-1' })).not.toThrow();
  });

  it('aceita só leadId, como sempre aceitou', () => {
    expect(() => checar({ leadId: 'lead-1' })).not.toThrow();
  });

  it('conversationId continua passando direto', () => {
    expect(() => checar({ conversationId: 'conv-1' })).not.toThrow();
  });

  // A guarda continua existindo: contexto de onde não dá pra chegar em conversa
  // nenhuma segue recusado ANTES de criar execução, pra não sujar o histórico
  // com um FALHOU que não diz nada sobre o fluxo.
  it('recusa contexto sem nenhuma via pra conversa', () => {
    expect(() => checar({ foo: 'bar' })).toThrow(/precisa chegar numa CONVERSA/);
  });

  it('a mensagem diz as saídas — conversa OU lead/pedido/cliente', () => {
    expect(() => checar({})).toThrow(/lead, pedido ou cliente/);
  });

  it('string vazia não conta como via', () => {
    expect(() => checar({ clienteId: '' })).toThrow();
  });
});
