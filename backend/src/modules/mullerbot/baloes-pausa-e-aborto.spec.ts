import { describe, expect, it, vi } from 'vitest';
import { enviarEmBaloes, PAUSA_BALAO_MAX_PADRAO } from './muller-whatsapp.service';

/**
 * As duas alavancas da CAUDA do turno, medidas em 11/09:
 *
 *   4 balões · pausa de até 4s = ~12s de cauda, num turno de ~30s.
 *
 * E a cauda não é só lentidão — é a janela em que a pessoa escreve algo novo e
 * recebe uma resposta que foi montada ANTES disso. O bot rodou o roteiro inteiro
 * de "como achar o disjuntor" 17 segundos depois de ela ter dito "63A".
 *
 *   (a) `pausaEntreBaloesMs` encurta a janela
 *   (b) `deveAbortar` trata o que acontece DENTRO dela
 *
 * As duas juntas de propósito: (a) sozinha não impede falar por cima, (b)
 * sozinha deixa a cauda longa.
 */
const CFG = {
  quebrarMensagens: true,
  maxMensagens: 4,
  mostrarDigitando: false,
  delayRespostaSegundos: 0,
};

/** Texto que o `dividirEmBaloes` quebra em N balões (o `|||` é o separador). */
const TRES_BALOES = 'primeiro ||| segundo ||| terceiro';

describe('(a) pausa entre balões é configurável', () => {
  it('o teto ausente é o de sempre — quem não configurou não muda de comportamento', () => {
    expect(PAUSA_BALAO_MAX_PADRAO).toBe(4000);
  });

  it('teto 0 manda os balões sem pausa nenhuma', async () => {
    const enviar = vi.fn().mockResolvedValue(undefined);
    const t0 = Date.now();

    const saiu = await enviarEmBaloes(TRES_BALOES, { ...CFG, pausaEntreBaloesMs: 0 }, { enviar });

    expect(saiu).toHaveLength(3);
    // Sem pausa, três balões saem no mesmo tick — folga generosa pra CI lenta.
    expect(Date.now() - t0).toBeLessThan(300);
  });

  it('teto baixo encurta a cauda de verdade (não é só cosmético)', async () => {
    const enviar = vi.fn().mockResolvedValue(undefined);
    const t0 = Date.now();

    await enviarEmBaloes(TRES_BALOES, { ...CFG, pausaEntreBaloesMs: 50 }, { enviar });

    // 2 pausas de no máximo 50ms. Com o teto de 4000 seriam ~1,3s.
    expect(Date.now() - t0).toBeLessThan(600);
    expect(enviar).toHaveBeenCalledTimes(3);
  });
});

describe('(b) a cauda PARA quando a pessoa volta a escrever', () => {
  it('o 1º balão sai mesmo com mensagem nova — segurar deixaria ela sem NADA', async () => {
    const enviar = vi.fn().mockResolvedValue(undefined);

    const saiu = await enviarEmBaloes(
      TRES_BALOES,
      { ...CFG, pausaEntreBaloesMs: 0 },
      { enviar, deveAbortar: () => Promise.resolve(true) },
    );

    expect(saiu).toEqual(['primeiro']);
    expect(enviar).toHaveBeenCalledTimes(1);
  });

  it('sem mensagem nova, manda tudo', async () => {
    const enviar = vi.fn().mockResolvedValue(undefined);

    const saiu = await enviarEmBaloes(
      TRES_BALOES,
      { ...CFG, pausaEntreBaloesMs: 0 },
      { enviar, deveAbortar: () => Promise.resolve(false) },
    );

    expect(saiu).toHaveLength(3);
  });

  /**
   * ⚠️ O caso que a checagem única não cobriria: a pessoa escreve DURANTE a
   * pausa. Se a guarda só rodasse antes de esperar, a pausa seria uma janela
   * cega — e a pausa é justamente onde ela escreve.
   */
  it('checa TAMBÉM depois da pausa — é lá que a pessoa escreve', async () => {
    const enviar = vi.fn().mockResolvedValue(undefined);
    let chamadas = 0;
    // false na 1ª pergunta (antes da pausa), true na 2ª (depois dela).
    const deveAbortar = vi.fn().mockImplementation(() => Promise.resolve(++chamadas > 1));

    const saiu = await enviarEmBaloes(
      TRES_BALOES,
      { ...CFG, pausaEntreBaloesMs: 20 },
      { enviar, deveAbortar },
    );

    expect(saiu).toEqual(['primeiro']);
    expect(deveAbortar).toHaveBeenCalledTimes(2);
  });

  /**
   * O retorno alimenta log e auditoria. Devolver o que foi PLANEJADO em vez do
   * que SAIU faria a interrupção sumir do registro — e ela é justamente o fato
   * que interessa.
   */
  it('devolve o que SAIU, não o que foi planejado', async () => {
    const enviar = vi.fn().mockResolvedValue(undefined);
    // 📌 `deveAbortar` roda DUAS vezes por balão (antes e depois da pausa), e o
    // 1º balão não pergunta. Então: chamadas 1-2 = balão 2, chamadas 3-4 = balão
    // 3. Liberar as duas primeiras e cortar na terceira deixa sair 2 de 3.
    let n = 0;
    const saiu = await enviarEmBaloes(
      TRES_BALOES,
      { ...CFG, pausaEntreBaloesMs: 0 },
      { enviar, deveAbortar: () => Promise.resolve(++n > 2) },
    );

    expect(saiu).toEqual(['primeiro', 'segundo']);
    expect(enviar).toHaveBeenCalledTimes(2);
  });

  it('sem o handler, nada muda — o caminho antigo continua igual', async () => {
    const enviar = vi.fn().mockResolvedValue(undefined);

    const saiu = await enviarEmBaloes(TRES_BALOES, { ...CFG, pausaEntreBaloesMs: 0 }, { enviar });

    expect(saiu).toHaveLength(3);
  });

  /**
   * Resposta de UM balão não tem cauda — e a guarda não pode transformar isso
   * em silêncio.
   */
  it('resposta de um balão só nunca é abortada', async () => {
    const enviar = vi.fn().mockResolvedValue(undefined);

    const saiu = await enviarEmBaloes(
      'resposta inteira sem separador',
      { ...CFG, quebrarMensagens: false, pausaEntreBaloesMs: 0 },
      { enviar, deveAbortar: () => Promise.resolve(true) },
    );

    expect(saiu).toHaveLength(1);
    expect(enviar).toHaveBeenCalledTimes(1);
  });
});
