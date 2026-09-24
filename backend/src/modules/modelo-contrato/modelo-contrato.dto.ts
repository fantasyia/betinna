import { z } from 'zod';

/**
 * Upload do .docx em base64 no corpo — mesmo padrão do anexo de fluxo.
 * 19 MB de texto ≈ 14 MB de arquivo, o teto do `validarModelo` (e dentro dos
 * 20 MB que o corpo JSON aceita).
 */
export const enviarModeloSchema = z.object({
  nomeArquivo: z.string().trim().min(1).max(200),
  conteudoBase64: z.string().min(1).max(19_000_000),
  /** O que mudou nesta versão — "cláusula 7 revisada pelo jurídico". */
  observacao: z.string().trim().max(500).optional(),
});
export type EnviarModeloDto = z.infer<typeof enviarModeloSchema>;
