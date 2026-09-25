import { writeFile } from 'node:fs/promises';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DocxPdfService } from './docx-pdf.service';

/**
 * Word → PDF (Léo, 25/09). O LibreOffice é mockado: o que se trava aqui é a
 * chamada (perfil próprio, headless, pasta de saída) e que falha vira erro
 * de negócio em vez de um PDF vazio seguir adiante.
 */
type Cb = (e: Error | null) => void;
const execFile = vi.hoisted(() =>
  vi.fn<(bin: string, args: string[], o: unknown, cb: Cb) => void>(),
);
vi.mock('node:child_process', () => ({
  execFile: (bin: string, args: string[], o: unknown, cb: Cb) => execFile(bin, args, o, cb),
}));

beforeEach(() => {
  execFile.mockReset();
});

describe('DocxPdfService', () => {
  it('chama o soffice headless, com perfil próprio, e devolve o PDF gerado', async () => {
    execFile.mockImplementation((_bin, args, _o, cb) => {
      const dir = args[args.indexOf('--outdir') + 1];
      void writeFile(`${dir}/contrato.pdf`, Buffer.from('%PDF-1.7 ok')).then(() => cb(null));
    });
    const pdf = await new DocxPdfService().converter(Buffer.from('PK docx'));
    expect(pdf.toString()).toBe('%PDF-1.7 ok');
    const args = execFile.mock.calls[0][1];
    expect(args).toEqual(expect.arrayContaining(['--headless', '--convert-to', 'pdf']));
    expect(args.some((a) => a.startsWith('-env:UserInstallation=file://'))).toBe(true);
  });

  it('LibreOffice falhou → erro claro, nada de PDF', async () => {
    execFile.mockImplementation((_b, _a, _o, cb) => cb(new Error('soffice: not found')));
    await expect(new DocxPdfService().converter(Buffer.from('PK'))).rejects.toThrow(/PDF/);
  });

  it('saída que não é PDF é recusada', async () => {
    execFile.mockImplementation((_bin, args, _o, cb) => {
      const dir = args[args.indexOf('--outdir') + 1];
      void writeFile(`${dir}/contrato.pdf`, Buffer.from('lixo')).then(() => cb(null));
    });
    await expect(new DocxPdfService().converter(Buffer.from('PK'))).rejects.toThrow();
  });
});
