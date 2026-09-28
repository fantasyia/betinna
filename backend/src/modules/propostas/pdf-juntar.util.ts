import { PDFDocument } from 'pdf-lib';

/**
 * Junta PDFs num só, na ordem dada. O aceite (levantamento + contrato
 * congelados no link) e o reenvio (mesmo levantamento + contrato novo) montam
 * o documento único por aqui — os dois têm que sair com a mesma cara.
 */
export async function juntarPdfs(arquivos: Buffer[]): Promise<Buffer> {
  const junto = await PDFDocument.create();
  for (const arquivo of arquivos) {
    const parte = await PDFDocument.load(arquivo);
    const paginas = await junto.copyPages(parte, parte.getPageIndices());
    paginas.forEach((pg) => junto.addPage(pg));
  }
  return Buffer.from(await junto.save());
}
