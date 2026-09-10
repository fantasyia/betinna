import { describe, expect, it, vi } from 'vitest';
import { enviarPaginaRetorno, paginaRetornoOAuth } from './pagina-retorno-oauth';

const base = {
  titulo: 'Agenda conectada',
  mensagem: 'A conta fulano@exemplo.com está conectada.',
  canal: 'google-oauth',
  origem: 'https://app.somatecblocking.com.br',
};

const MARCA = {
  empresaNome: 'Somatec Blocking',
  logoUrl: 'https://cdn.exemplo/logo.png',
  corPrimaria: '#00416E',
  corSecundaria: '#008CC8',
};

describe('página de retorno do OAuth', () => {
  // Sem isto a janela fecha e a tela de integrações continua dizendo
  // "desconectado" até alguém dar F5.
  it('avisa o app pelo postMessage, com a origem explícita', () => {
    const html = paginaRetornoOAuth({ ...base, ok: true });
    expect(html).toContain('window.opener.postMessage');
    expect(html).toContain('"google-oauth"');
    expect(html).toContain('"https://app.somatecblocking.com.br"');
    // Origem coringa aceitaria qualquer página escutando.
    expect(html).not.toContain("'*'");
  });

  it('no sucesso fecha sozinha; no erro NÃO fecha', () => {
    expect(paginaRetornoOAuth({ ...base, ok: true })).toContain('window.close()');
    const erro = paginaRetornoOAuth({ ...base, ok: false, mensagem: 'token expirado' });
    // A mensagem do provedor precisa sobreviver pra ser lida — fechar em 1,8s
    // fazia a janela piscar e a pessoa voltava sem saber o que houve.
    expect(erro).not.toContain('setTimeout');
    // Mas o botão de fechar continua existindo.
    expect(erro).toContain('onclick="window.close()"');
  });

  it('o erro avisa o app mesmo ficando aberto', () => {
    const erro = paginaRetornoOAuth({ ...base, ok: false, mensagem: 'token expirado' });
    expect(erro).toContain('ok: false');
  });

  it('usa a marca do tenant quando existe', () => {
    const html = paginaRetornoOAuth({ ...base, ok: true, marca: MARCA });
    expect(html).toContain('https://cdn.exemplo/logo.png');
    expect(html).toContain('#00416E');
  });

  it('sem marca do tenant, cai no navy do Betinna', () => {
    const html = paginaRetornoOAuth({ ...base, ok: true });
    expect(html).toContain('#201554');
  });

  // Na Somatec o `corAcao` é o laranja, que o brandbook reserva pra CTA e
  // número-dinheiro. Esta tela não tem CTA: se o laranja aparecer aqui, a
  // regra vazou pra um lugar onde ela não vale.
  it('o sucesso usa o CIANO do tenant, nunca a cor de ação', () => {
    const html = paginaRetornoOAuth({ ...base, ok: true, marca: { ...MARCA } });
    expect(html).toContain('#008CC8');
    expect(html).not.toContain('#dc2626');
  });

  // Vermelho é vermelho em qualquer marca: pintar a falha com a cor da
  // empresa faz erro parecer confirmação.
  it('a falha ganha o fio vermelho, independente da marca', () => {
    const html = paginaRetornoOAuth({ ...base, ok: false, marca: MARCA });
    expect(html).toContain('#dc2626');
    expect(html).not.toContain('#008CC8');
  });

  // A textura do cabeçalho é a mesma imagem dos e-mails, e vai POR CIMA da cor
  // sólida: quem bloqueia imagem vê o navy, não um retângulo branco.
  it('a textura do cabeçalho não substitui a cor de fundo', () => {
    const html = paginaRetornoOAuth({
      ...base,
      ok: true,
      marca: { ...MARCA, headerImgUrl: 'https://cdn.exemplo/bar.png' },
    });
    expect(html).toContain('background-color: #00416E');
    expect(html).toContain('https://cdn.exemplo/bar.png');
  });

  // A mensagem de erro carrega texto do provedor — entrada externa.
  it('escapa a mensagem do provedor', () => {
    const html = paginaRetornoOAuth({
      ...base,
      ok: false,
      mensagem: '<img src=x onerror="alert(1)">',
    });
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x');
  });

  it('escapa também o que vem da marca', () => {
    const html = paginaRetornoOAuth({
      ...base,
      ok: true,
      marca: { ...MARCA, empresaNome: 'Fulano" onload="alert(1)' },
    });
    expect(html).not.toContain('onload="alert(1)');
  });
});

/**
 * O header que faz a janela poder se fechar.
 *
 * O Helmet manda `COOP: same-origin` em tudo. No callback do OAuth isso corta o
 * `opener` do popup, e aí `window.opener` fica null (postMessage pulado) E
 * `window.close()` é BARRADO pelo navegador — sem erro nenhum na tela.
 *
 * Medido em 10/09: a conexão do Google Agenda funcionou (`conectadoEm`
 * carimbado) e a janela ficou parada. Não era a lógica da página, era o header
 * — e não era regressão: o `window.close()` está nos controllers desde o commit
 * inicial, então nunca funcionou. Só apareceu quando alguém ASSISTIU à tela.
 */
describe('enviarPaginaRetorno', () => {
  const fakeRes = () => {
    const res = {
      setHeader: vi.fn(() => res),
      status: vi.fn(() => res),
      type: vi.fn(() => res),
      send: vi.fn(() => res),
    };
    return res;
  };

  it('derruba o COOP — sem isso o navegador barra o window.close()', () => {
    const res = fakeRes();
    enviarPaginaRetorno(res as never, 200, '<html></html>');
    expect(res.setHeader).toHaveBeenCalledWith('Cross-Origin-Opener-Policy', 'unsafe-none');
  });

  it('preserva status e content-type', () => {
    const res = fakeRes();
    enviarPaginaRetorno(res as never, 400, '<html>erro</html>');
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.type).toHaveBeenCalledWith('html');
    expect(res.send).toHaveBeenCalledWith('<html>erro</html>');
  });

  // O header tem que sair ANTES do corpo: depois do `send` não há o que mudar.
  it('manda o header antes de enviar o corpo', () => {
    const res = fakeRes();
    enviarPaginaRetorno(res as never, 200, '<html></html>');
    const ordemHeader = res.setHeader.mock.invocationCallOrder[0];
    const ordemSend = res.send.mock.invocationCallOrder[0];
    expect(ordemHeader).toBeLessThan(ordemSend);
  });
});
