import { lazy, type ComponentType } from 'react';
import { temAlteracaoNaoSalva } from './dirty';

/**
 * `lazy()` que sobrevive a um deploy com a aba aberta.
 *
 * O que acontecia (Sentry BETINNA-FRONT-8, 3 ocorrências em 18/09): o Vite
 * gera chunks com hash novo a cada build e os antigos somem do servidor. Quem
 * estava com a aba aberta continua rodando o `index` velho; ao navegar pra uma
 * rota `lazy()`, o import dinâmico busca um chunk que já não existe, toma 404,
 * e a pessoa recebe "Algo deu errado" em vez da página.
 *
 * 🔴 E a guarda que deveria cobrir isso NÃO está quebrada — ela está certa e
 * mesmo assim não alcança. O `main.tsx` adia o reload do service worker quando
 * há alteração não salva e conta com "recarrega na próxima navegação". Só que
 * em SPA a navegação é client-side: não existe page load, o bundle velho segue
 * no ar, e a "próxima navegação" nunca recarrega nada. O fallback documentado
 * não é alcançável pelo caminho que ele promete cobrir.
 *
 * Aqui o reload é explícito: falhou o import, recarrega UMA vez (o index.html
 * novo traz os hashes certos) e marca em `sessionStorage` pra não entrar em
 * laço. Falhou de novo com a marca posta, cai no ErrorBoundary como hoje.
 */

/** Marca de "já recarreguei por causa disto nesta aba". */
const CHAVE = 'betinna:recarregou-por-chunk';

/**
 * Por que a tela de "versão nova" apareceu. Vai pro Sentry: sem isto os três
 * caminhos chegam iguais, e toda volta da BETINNA-FRONT-8 parecia conserto
 * falhando — que é como um defeito real se esconde atrás de um ruído conhecido.
 */
export type MotivoErroDeChunk = 'ja-recarregou' | 'rascunho' | 'sem-storage';
let ultimoMotivo: MotivoErroDeChunk | null = null;

/** O ErrorBoundary pergunta isto na hora de reportar. */
export function motivoDoErroDeChunk(): MotivoErroDeChunk | null {
  return ultimoMotivo;
}

/** `sessionStorage` joga em aba anônima / storage bloqueado. Nunca derruba o app por isso. */
function estadoDaMarca(): 'posta' | 'livre' | 'sem-storage' {
  try {
    return sessionStorage.getItem(CHAVE) === '1' ? 'posta' : 'livre';
  } catch {
    // Sem storage não dá pra garantir "uma vez só" — e reload sem freio é
    // laço infinito na cara do usuário. Tratar como JÁ recarregou é o lado
    // seguro de errar: perde-se o conserto, não a página.
    return 'sem-storage';
  }
}

function lerMarca(): boolean {
  return estadoDaMarca() !== 'livre';
}

function porMarca(): void {
  try {
    sessionStorage.setItem(CHAVE, '1');
  } catch {
    /* idem — o lerMarca já falha fechado */
  }
}

function limparMarca(): void {
  try {
    sessionStorage.removeItem(CHAVE);
  } catch {
    /* idem */
  }
}

/**
 * O erro tem cara de chunk que sumiu?
 *
 * Um texto por engine — Chrome, Firefox e Safari escrevem diferente para a
 * mesma falha. Usado só pra ESCOLHER A MENSAGEM no ErrorBoundary; a decisão de
 * recarregar NÃO depende disto (ver o comentário no `lazyComRetry`).
 */
export function ehErroDeChunk(erro: unknown): boolean {
  const msg = erro instanceof Error ? erro.message : String(erro ?? '');
  return /failed to fetch dynamically imported module|error loading dynamically imported module|importing a module script failed/i.test(
    msg,
  );
}

/**
 * Pede a versão nova do service worker ANTES de recarregar, e espera ela assumir.
 *
 * O `index.html` está no precache do SW. Recarregar com o SW VELHO no controle
 * devolve o MESMO index velho, com os mesmos hashes mortos: o import falha de
 * novo, a marca já está posta, e a pessoa cai na tela de erro (BETINNA-FRONT-8,
 * 07/10). E o SW novo não descobre o deploy sozinho: o navegador só confere
 * atualização em page load, que SPA não tem.
 *
 * Com teto: se o SW travar, recarrega assim mesmo — é o comportamento de antes,
 * não pior que ele.
 */
export async function trazerVersaoNova(limiteMs = 4000): Promise<void> {
  const sw = typeof navigator !== 'undefined' ? navigator.serviceWorker : undefined;
  if (!sw) return;
  const assumir = async (): Promise<void> => {
    const reg = await sw.getRegistration();
    if (!reg) return;
    await reg.update();
    const novo = reg.installing ?? reg.waiting;
    if (!novo) return;
    await new Promise<void>((pronto) => {
      const olhar = () => {
        if (novo.state === 'installed') novo.postMessage({ type: 'SKIP_WAITING' });
        if (novo.state === 'activated' || novo.state === 'redundant') pronto();
      };
      novo.addEventListener('statechange', olhar);
      olhar();
    });
  };
  await Promise.race([
    assumir().catch(() => undefined),
    new Promise<void>((r) => setTimeout(r, limiteMs)),
  ]);
}

/** O ErrorBoundary usa pra saber que já houve uma tentativa de recarga. */
export function jaRecarregouPorChunk(): boolean {
  return lerMarca();
}

/**
 * Envolve o `import()` de uma rota.
 *
 * ⚠️ Recarrega em QUALQUER falha de import, não só nas que casam com o
 * `ehErroDeChunk`. É deliberado: a lista de textos de erro é por engine e muda
 * com versão de browser, e os dois modos de errar não custam a mesma coisa.
 * Texto novo que eu não reconheça = o defeito continua exatamente como está
 * hoje, na cara de quem abriu a aba. Erro real dentro do módulo = uma recarga
 * inútil, que falha igual e cai no ErrorBoundary logo em seguida. Prefiro
 * gastar uma recarga a deixar o defeito passar por não reconhecer uma string.
 */
// Mesma restrição do `lazy` do React (ComponentType<any>): com `unknown` a página
// não podia receber props (a vitrine na raiz recebe o slug — 14/10).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lazyComRetry<T extends ComponentType<any>>(
  importar: () => Promise<{ default: T }>,
) {
  return lazy(async () => {
    try {
      const modulo = await importar();
      // Carregou: a aba está coerente com o servidor de novo. Limpar é o que
      // permite o PRÓXIMO deploy também ganhar sua recarga — sem isto, a marca
      // fica posta pra sempre e o conserto vale uma vez por aba.
      limparMarca();
      return modulo;
    } catch (erro) {
      const marca = estadoDaMarca();
      if (marca !== 'livre') {
        ultimoMotivo = marca === 'sem-storage' ? 'sem-storage' : 'ja-recarregou';
        throw erro;
      }

      // Alteração não salva vale mais que a comodidade de recarregar sozinho:
      // a recarga levaria o rascunho junto, calada. Cai no ErrorBoundary, que
      // explica o que houve e deixa a pessoa decidir a hora.
      if (temAlteracaoNaoSalva()) {
        porMarca();
        ultimoMotivo = 'rascunho';
        throw erro;
      }

      porMarca();
      await trazerVersaoNova();
      window.location.reload();
      // Promessa que nunca resolve, de propósito: a página está indo embora.
      // Resolver ou rejeitar aqui faria a tela de erro PISCAR durante a
      // recarga, que é feio e assusta sem motivo.
      return new Promise<never>(() => {});
    }
  });
}
