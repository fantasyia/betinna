/**
 * Nome de arquivo vindo de upload: DECODIFICAR e SANITIZAR são coisas separadas.
 *
 * Dois bugs se somavam e produziam o mesmo sintoma, medido em 10/09 num anexo
 * de card do Kanban:
 *
 *   arquivo real   MODELO DE CONTRATO DE LOCAÇÃO MB IoT - GRUPO TARIFÁRIO A
 *   exibido        MODELO_DE_CONTRATO_DE_LOCA____O_MB_IoT_-_GRUPO_TARIF__RIO_A
 *
 * ⚠️ Repare na CONTAGEM, que é o que denuncia o primeiro bug: `Á` virou DOIS
 * underscores e `ÇÃ` virou QUATRO. Um por BYTE, não um por caractere.
 */

/**
 * 1 · DECODIFICA o nome que o multipart entrega.
 *
 * `multer`/`busboy` entregam `originalname` como os BYTES do nome interpretados
 * como **latin1**, não como UTF-8 (default do busboy; o padrão multipart é
 * ambíguo nisso). Então `Ç` — dois bytes em UTF-8 — chega como dois caracteres
 * latin1 sem sentido, e qualquer filtro depois vê dois caracteres estranhos em
 * vez de uma letra.
 *
 * O round-trip é a guarda: se re-codificar o resultado em UTF-8 devolver
 * exatamente os mesmos bytes, o nome ERA latin1-de-UTF-8 e a decodificação está
 * certa. Se não bater, ele já vinha decodificado — devolve como veio, porque
 * decodificar duas vezes corrompe.
 */
export function decodificarNomeDeUpload(originalname: string): string {
  if (!originalname) return '';
  try {
    const bytes = Buffer.from(originalname, 'latin1');
    const comoUtf8 = bytes.toString('utf8');
    return Buffer.from(comoUtf8, 'utf8').equals(bytes) ? comoUtf8 : originalname;
  } catch {
    return originalname;
  }
}

/**
 * 2 · SANITIZA para o CAMINHO no storage — e só para isso.
 *
 * O segundo bug era usar este resultado também como nome de EXIBIÇÃO. O que o
 * storage precisa (ASCII, sem espaço) não é o que a pessoa precisa ler: quem
 * subiu o arquivo quer ver o nome que deu a ele.
 *
 * E a sanitização perdia informação sem necessidade: `\w` é ASCII-only em JS,
 * então acento virava `_`. Aqui os acentos são **transliterados** — o NFD separa
 * a letra do diacrítico e só o diacrítico sai. `LOCAÇÃO` vira `LOCACAO`, que
 * continua legível no caminho e não perde nada.
 *
 * ⛔ NUNCA use o retorno disto como nome de exibição. Guarde o decodificado.
 */
export function nomeSeguroParaStorage(nome: string, maxLen = 80): string {
  // O range dos diacríticos combinantes vai numa string, não num literal de
  // regex: escrito como `/[<marcas>]/` o arquivo passa a depender de bytes
  // invisíveis, que qualquer normalização de editor come sem avisar.
  const DIACRITICOS = new RegExp('[\\u0300-\\u036f]', 'g');
  const limpo = (nome || '')
    .normalize('NFD')
    .replace(DIACRITICOS, '')
    .replace(/[^\w.\-]+/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/^[_.]+|_+$/g, '');
  // Nome que sanitiza pra vazio (só emoji, por exemplo) ainda precisa de um
  // caminho — sem isto o upload iria pra uma chave terminada em `_`.
  return limpo.slice(0, maxLen) || 'arquivo';
}
