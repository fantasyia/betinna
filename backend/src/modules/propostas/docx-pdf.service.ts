import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Injectable, Logger } from '@nestjs/common';
import { BusinessRuleException } from '@shared/errors/app-exception';

const TEMPO_MAXIMO_MS = 90_000;

/**
 * Word → PDF no servidor, com o LibreOffice (Léo, 25/09).
 *
 * O navegador desenhava o .docx do contrato por aproximação: as imagens EMF do
 * modelo (o logo do cabeçalho e a figura grande) não aparecem em navegador
 * nenhum, e o texto virava UMA folha de 6 mil pixels sem página. E a ClickSign
 * convertia o Word do jeito dela — o cliente lia uma coisa e assinava outra.
 * Convertido aqui, UMA vez, o PDF é o arquivo que ele lê E o que ele assina.
 *
 * Uma conversão por vez: o LibreOffice come memória, e o link de aceite é
 * gerado raramente — fila é mais barato que um pico derrubar a api.
 */
@Injectable()
export class DocxPdfService {
  private readonly logger = new Logger(DocxPdfService.name);
  private fila: Promise<unknown> = Promise.resolve();

  converter(docx: Buffer): Promise<Buffer> {
    const vez = this.fila.then(() => this.converterAgora(docx));
    this.fila = vez.catch(() => undefined);
    return vez;
  }

  private async converterAgora(docx: Buffer): Promise<Buffer> {
    const dir = join(tmpdir(), `docx-pdf-${randomUUID()}`);
    await mkdir(dir, { recursive: true });
    const entrada = join(dir, 'contrato.docx');
    try {
      await writeFile(entrada, docx);
      await new Promise<void>((ok, falha) => {
        execFile(
          process.env.SOFFICE_PATH || 'soffice',
          [
            '--headless',
            '--norestore',
            '--nolockcheck',
            // Perfil próprio por conversão: o perfil compartilhado trava quando
            // duas instâncias se cruzam, e o HOME do container não é gravável.
            `-env:UserInstallation=file://${dir.replace(/\\/g, '/')}/perfil`,
            '--convert-to',
            'pdf',
            '--outdir',
            dir,
            entrada,
          ],
          { timeout: TEMPO_MAXIMO_MS },
          (err, _out, stderr) => (err ? falha(new Error(`${err.message} ${stderr ?? ''}`)) : ok()),
        );
      });
      const pdf = await readFile(join(dir, 'contrato.pdf'));
      if (pdf.subarray(0, 5).toString() !== '%PDF-') throw new Error('saída não é PDF');
      return pdf;
    } catch (err) {
      this.logger.error(`Word → PDF falhou: ${err instanceof Error ? err.message : String(err)}`);
      throw new BusinessRuleException(
        'O contrato não pôde ser convertido em PDF agora. Tente gerar o link de novo em instantes.',
      );
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}
