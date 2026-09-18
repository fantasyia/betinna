import { z } from 'zod';
import { extrairYoutubeId } from './youtube-id.util';

/**
 * O campo é `video` e aceita QUALQUER forma do link, porque é isso que a pessoa
 * tem na mão: a barra de endereços, o botão Compartilhar, ou o `<iframe>`
 * inteiro. O `transform` normaliza pro ID de 11 caracteres antes de chegar ao
 * serviço.
 *
 * ⛔ Recusa o que não dá pra identificar, em vez de guardar o texto cru. ID
 * errado vira um embed que carrega sem erro e mostra "vídeo indisponível" — a
 * única hora em que alguém percebe é agora.
 */
const videoSchema = z
  .string()
  .trim()
  .min(1, 'Cole o link do vídeo no YouTube')
  .max(2000)
  .transform((v, ctx) => {
    const id = extrairYoutubeId(v);
    if (!id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'Não reconheci um vídeo do YouTube nesse link. Cole o endereço da página do vídeo ' +
          '(youtube.com/watch?v=… ou youtu.be/…).',
      });
      return z.NEVER;
    }
    return id;
  });

/**
 * Um treinamento é OU um vídeo do YouTube OU um arquivo nosso — nunca os dois,
 * nunca nenhum.
 *
 * O `superRefine` recusa as duas combinações inválidas em vez de deixar o banco
 * ou o serviço decidirem: erro de forma tem que aparecer na borda, com uma frase
 * que diz o que fazer.
 */
export const createTreinamentoSchema = z
  .object({
    titulo: z.string().trim().min(2).max(160),
    descricao: z.string().trim().max(2000).optional(),
    /** Preencha quando a fonte for YouTube. Aceita o link em qualquer forma. */
    video: videoSchema.optional(),
    /** Caminho devolvido por `POST /treinamentos/upload-url`, já com o arquivo enviado. */
    arquivoPath: z.string().trim().min(3).max(500).optional(),
    arquivoTamanho: z.number().int().positive().optional(),
    arquivoTipo: z.string().trim().max(120).optional(),
    categoria: z.string().trim().max(80).optional(),
    ordem: z.number().int().min(0).max(9999).default(0),
  })
  .superRefine((v, ctx) => {
    if (!v.video && !v.arquivoPath) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Informe o link do YouTube ou envie um arquivo de vídeo.',
      });
    }
    if (v.video && v.arquivoPath) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'Escolha UMA fonte: link do YouTube ou arquivo próprio. Com as duas, não dá pra ' +
          'saber qual o funcionário deve assistir.',
      });
    }
  });
export type CreateTreinamentoDto = z.infer<typeof createTreinamentoSchema>;

/**
 * `video` continua opcional no update: trocar o vídeo é raro, e reenviar o link
 * só pra corrigir um título seria atrito à toa.
 */
export const updateTreinamentoSchema = z.object({
  titulo: z.string().trim().min(2).max(160).optional(),
  descricao: z.string().trim().max(2000).nullable().optional(),
  video: videoSchema.optional(),
  categoria: z.string().trim().max(80).nullable().optional(),
  ordem: z.number().int().min(0).max(9999).optional(),
  ativo: z.boolean().optional(),
});
export type UpdateTreinamentoDto = z.infer<typeof updateTreinamentoSchema>;

export const listTreinamentosSchema = z.object({
  /** Por padrão a lista mostra só o que está no ar — é a visão do funcionário. */
  incluirInativos: z.coerce.boolean().default(false),
  categoria: z.string().trim().max(80).optional(),
});
export type ListTreinamentosDto = z.infer<typeof listTreinamentosSchema>;

/**
 * Pedido de permissão pra subir o arquivo.
 *
 * O backend valida tamanho e tipo ANTES de assinar — descobrir depois
 * significaria 500 MB enviados pra então recusar.
 */
export const uploadUrlSchema = z.object({
  nomeArquivo: z.string().trim().min(1).max(200),
  tamanho: z.number().int().positive(),
  tipo: z.string().trim().min(1).max(120),
});
export type UploadUrlDto = z.infer<typeof uploadUrlSchema>;
