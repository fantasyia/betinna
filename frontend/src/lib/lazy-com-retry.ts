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

/** `sessionStorage` joga em aba anônima / storage bloqueado. Nunca derruba o app por isso. */
function lerMarca(): boolean {
  try {
    return sessionStorage.getItem(CHAVE) === '1';
  } catch {
    // Sem storage não dá pra garantir "uma vez só" — e reload sem freio é
    // laço infinito na cara do usuário. Mentir que JÁ recarregou é o lado
    // seguro de errar: perde-se o conserto, não a página.
    return true;
  }
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
export function lazyComRetry<T extends ComponentType<unknown>>(
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
      if (lerMarca()) throw erro;

      // Alteração não salva vale mais que a comodidade de recarregar sozinho:
      // a recarga levaria o rascunho junto, calada. Cai no ErrorBoundary, que
      // explica o que houve e deixa a pessoa decidir a hora.
      if (temAlteracaoNaoSalva()) {
        porMarca();
        throw erro;
      }

      porMarca();
      window.location.reload();
      // Promessa que nunca resolve, de propósito: a página está indo embora.
      // Resolver ou rejeitar aqui faria a tela de erro PISCAR durante a
      // recarga, que é feio e assusta sem motivo.
      return new Promise<never>(() => {});
    }
  });
}
