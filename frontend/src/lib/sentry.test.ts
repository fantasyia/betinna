import { describe, expect, it } from 'vitest';

/**
 * O `redact` do front roda também sobre a PILHA — então limpar demais é tão
 * ruim quanto limpar de menos.
 *
 * Ele já cobria SEGREDO (`token=`, `bearer`, o path de aceite de proposta) e não
 * cobria PESSOA — que é o que este app tem em quase toda tela: o CRM mostra
 * telefone e CPF, e a mensagem de erro que sobe daqui carrega o que estava na
 * mão, inclusive o texto de erro que veio da API.
 *
 * O backend tinha exatamente a mesma lacuna e foi corrigido em 09/09 (`26a1d53`)
 * depois que um erro criado no mesmo dia mandou o corpo cru do Evolution — com
 * telefone — pro Sentry.
 *
 * Metade destes testes é sobre o que NÃO pode ser tocado. A sessão do site
 * perdeu tempo com um filtro que comia a própria exceção (`exCEPtion` contém
 * `cep`): o evento chegava sem mensagem e sem pilha, compilando e com teste de
 * unidade verde.
 */

import { redact } from './sentry';

describe('redação de PII no front', () => {
  it('mascara e-mail mantendo o domínio', () => {
    expect(redact('falha ao salvar joao@empresa.com.br')).not.toContain('joao@empresa.com.br');
    expect(redact('falha ao salvar joao@empresa.com.br')).toContain('@empresa.com.br');
  });

  it('mascara CPF e CNPJ com pontuação', () => {
    expect(redact('cliente 372.585.458-08')).not.toContain('372.585.458-08');
    expect(redact('empresa 16.774.052/0001-55')).not.toContain('16.774.052/0001-55');
  });

  it('NÃO toca id, número de pedido nem timestamp', () => {
    for (const t of [
      'pedido SB2609TESTE / ERP 99',
      'execucao cmttkj84q005as1brr627ji8w em 2026-09-09T15:16:01.683Z',
      'conta 339059437 no valor de 0.73',
    ]) {
      expect(redact(t), t).toBe(t);
    }
  });

  it('NÃO destrói a pilha', () => {
    const stack =
      "TypeError: Cannot read properties of undefined (reading 'id')\n" +
      '    at PedidoCard (/assets/index-a1b2c3.js:412:19)';
    expect(redact(stack)).toBe(stack);
  });

  it('a palavra "exception" sobrevive', () => {
    expect(redact('Unhandled exception na recepcao')).toBe('Unhandled exception na recepcao');
  });
});
