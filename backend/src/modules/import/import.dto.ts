import { z } from 'zod';

/**
 * Schemas dos imports CSV. O arquivo é enviado como string (POST body),
 * NÃO via multipart — pra MVP, simplificamos.
 *
 * Limite 1MB do CSV (~5000 linhas) é seguro pra payload JSON.
 */
const csvBody = z.object({
  csv: z
    .string()
    .min(10)
    .max(1024 * 1024),
  /**
   * dryRun=true valida tudo mas NÃO persiste. Default false.
   * Útil pro frontend mostrar "vai criar X, vai atualizar Y, erros: Z"
   * antes de confirmar.
   */
  dryRun: z.boolean().optional().default(false),
  /**
   * Estratégia de duplicatas:
   *  - 'skip': ignora linhas que conflitam com registros existentes
   *  - 'update': atualiza registros existentes (match por email/cnpj/sku)
   *  - 'error': falha o batch inteiro se houver duplicata
   */
  onDuplicate: z.enum(['skip', 'update', 'error']).optional().default('skip'),
});

export const importClientesSchema = csvBody;
export type ImportClientesDto = z.infer<typeof importClientesSchema>;

export const importProdutosSchema = csvBody;
export type ImportProdutosDto = z.infer<typeof importProdutosSchema>;

export interface ImportResultLinha {
  linha: number;
  status: 'criado' | 'atualizado' | 'pulado' | 'erro';
  id?: string;
  motivo?: string;
}

export interface ImportResultDto {
  total: number;
  criados: number;
  atualizados: number;
  pulados: number;
  erros: number;
  dryRun: boolean;
  /** Detalhes — limita a 100 primeiras pra não inflar response */
  detalhes: ImportResultLinha[];
}
