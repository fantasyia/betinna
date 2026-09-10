import { describe, it, expect } from 'vitest';
import { fingerprintDeadLetter, formaDoErro } from './dead-letter.fingerprint';

/**
 * O caso que originou isto, medido em 10/09/2026 na issue `BETINNA-API-3`:
 * dois erros sem relação nenhuma caíram no mesmo grupo do Sentry porque a pilha
 * da dead-letter é sempre a mesma. O título exibido virou o do último evento, e
 * resolver a issue pelo primeiro defeito marcou o segundo como resolvido junto.
 */
const ERRO_PAUSAR_IA =
  'Nó "Religar IA — ele pode perguntar quando chega" falhou: ' +
  'contexto.leadId ausente para PAUSAR_IA';

const ERRO_ENVIO_BLOQUEADO =
  'Nó "Manda {{texto_teste}} do número de TESTE pro da EMPRESA" falhou: ' +
  'ENVIAR_WHATSAPP NÃO enviado: o texto tem lacuna de exemplo não preenchida ' +
  '([documento]). Isso costuma vir do PROMPT: quando o exemplo usa colchete como ' +
  'espaço a preencher, o modelo às vezes copia o exemplo inteiro.';

const daFilaDeFluxo = (error: string): string[] =>
  fingerprintDeadLetter({ originalQueue: 'fluxo-execucao', originalJobName: 'step', error });

describe('fingerprint da dead-letter', () => {
  it('separa os dois erros reais que o Sentry tinha juntado', () => {
    expect(daFilaDeFluxo(ERRO_PAUSAR_IA)).not.toEqual(daFilaDeFluxo(ERRO_ENVIO_BLOQUEADO));
  });

  it('mantém o MESMO grupo quando só o nome do nó muda', () => {
    const outroNo =
      'Nó "Religa a IA depois do despacho" falhou: contexto.leadId ausente para PAUSAR_IA';

    expect(daFilaDeFluxo(outroNo)).toEqual(daFilaDeFluxo(ERRO_PAUSAR_IA));
  });

  it('não cria grupo novo por id, uuid, número ou data na mensagem', () => {
    const comCuid = 'Lead cmttk6bfl0001ks6wlvocvlfc sem contatoTelefone';
    const comOutroCuid = 'Lead cmtv7wi9i0020o7bryxqj7vub sem contatoTelefone';
    const comUuid = 'Lead 8f7a7dcf-319e-4297-a4f1-39ca9eacd81a sem contatoTelefone';

    expect(daFilaDeFluxo(comOutroCuid)).toEqual(daFilaDeFluxo(comCuid));
    expect(daFilaDeFluxo(comUuid)).toEqual(daFilaDeFluxo(comCuid));

    const comHora = 'Timeout depois de 30000ms às 06:01:09';
    const outraHora = 'Timeout depois de 45000ms às 08:06:46';
    expect(daFilaDeFluxo(outraHora)).toEqual(daFilaDeFluxo(comHora));
  });

  it('separa a mesma frase quando ela vem de filas diferentes', () => {
    const deFluxo = fingerprintDeadLetter({
      originalQueue: 'fluxo-execucao',
      originalJobName: 'step',
      error: 'Connection is closed.',
    });
    const deCampanha = fingerprintDeadLetter({
      originalQueue: 'campanha-envio',
      originalJobName: 'step',
      error: 'Connection is closed.',
    });

    expect(deFluxo).not.toEqual(deCampanha);
  });

  it('abre com o rótulo da origem, pra issue nascer legível', () => {
    expect(daFilaDeFluxo(ERRO_PAUSAR_IA).slice(0, 3)).toEqual([
      'dead-letter',
      'fluxo-execucao',
      'step',
    ]);
  });

  it('corta mensagem gigante sem deixar a chave crescer sem limite', () => {
    const gigante = `Falhou: ${'detalhe '.repeat(200)}`;

    expect(formaDoErro(gigante).length).toBeLessThanOrEqual(120);
  });

  it('preserva o que distingue o defeito dentro do corte', () => {
    expect(formaDoErro(ERRO_PAUSAR_IA)).toContain('contexto.leadId ausente para PAUSAR_IA');
    expect(formaDoErro(ERRO_ENVIO_BLOQUEADO)).toContain('ENVIAR_WHATSAPP');
  });
});
