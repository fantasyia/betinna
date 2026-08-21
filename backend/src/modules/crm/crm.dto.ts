import { z } from 'zod';
import { usuarioIdSchema } from '@shared/validators/id.schema';

/**
 * Ações de CRM sobre UM contato, via MCP (Claude Code). Escopo de token `crm`
 * (escrita). Identifica o contato por leadId, clienteId ou telefone.
 */

/** Demanda 4 — adicionar/remover tags de um contato (por NOME). */
export const contatoTagsSchema = z
  .object({
    leadId: z.string().min(1).optional(),
    clienteId: z.string().min(1).optional(),
    telefone: z.string().trim().max(30).optional(),
    adicionar: z.array(z.string().trim().min(1).max(60)).max(50).default([]),
    remover: z.array(z.string().trim().min(1).max(60)).max(50).default([]),
  })
  .refine((d) => Boolean(d.leadId || d.clienteId || d.telefone), {
    message: 'Informe leadId, clienteId ou telefone',
  })
  .refine((d) => d.adicionar.length > 0 || d.remover.length > 0, {
    message: 'Informe ao menos uma tag em adicionar ou remover',
  });
export type ContatoTagsDto = z.infer<typeof contatoTagsSchema>;

/** Demanda 3 — mover um lead de etapa dentro de um funil. */
export const contatoEtapaSchema = z.object({
  leadId: z.string().min(1),
  funilId: z.string().min(1).optional(),
  etapaId: z.string().min(1),
  motivo: z.string().max(300).optional(),
  /**
   * Data RETROATIVA de entrada na etapa — facilidade de TESTE (card 🤖 21/08).
   * O SLA de etapa compara `Lead.etapaDesde`; lead de teste nasce agora e nunca
   * venceria o prazo — cada caso do RB viraria 1h30 de espera. Com isto, o
   * teste grava "entrou há 10 dias" e o job pega na rodada seguinte. Recusa
   * data futura (mascararia o SLA de um lead real por dias).
   */
  etapaDesde: z.coerce
    .date()
    .refine((d) => d.getTime() <= Date.now() + 60_000, 'etapaDesde não pode ser no futuro')
    .optional(),
});
export type ContatoEtapaDto = z.infer<typeof contatoEtapaSchema>;

/**
 * Exclusão de LEAD por MCP — a tool mais perigosa da superfície `crm`.
 *
 * O motivo da paranoia está no banco: hoje a empresa tem 30.308 leads, dos quais
 * 30.282 são a base de prospecção importada (sem funil) e 26 são os leads reais
 * dentro do funil de Triagem. As duas coisas moram na MESMA tabela — a única
 * diferença é o `funilId`. Um filtro errado aqui apaga o ativo mais caro do
 * projeto, e não tem volta.
 *
 * Por isso NÃO existe exclusão por filtro. Só por lista EXPLÍCITA de ids, que
 * obriga quem chama a passar por uma leitura antes (leads_por_etapa), e com a
 * contagem repetida no payload — o mesmo padrão do `confirmoEnvioAoCliente`:
 * se o número não bate com a lista, nada é apagado. A recusa de lead SEM FUNIL
 * é validada no service, onde dá pra dizer quais ids ofenderam.
 */
export const contatoExcluirSchema = z
  .object({
    leadIds: z.array(z.string().min(1)).min(1).max(50),
    confirmoExclusaoDe: z
      .number()
      .int()
      .positive()
      .describe('Quantidade esperada — precisa bater com os leadIds distintos'),
    motivo: z.string().max(300).optional(),
  })
  .refine((d) => new Set(d.leadIds).size === d.confirmoExclusaoDe, {
    message: 'confirmoExclusaoDe precisa ser exatamente a quantidade de leadIds DISTINTOS enviados',
    path: ['confirmoExclusaoDe'],
  });
export type ContatoExcluirDto = z.infer<typeof contatoExcluirSchema>;

/**
 * Atribuir/desatribuir REPRESENTANTE de um lead (MCP, escopo `crm`).
 * `representanteId: null` DESATRIBUI — importa tanto quanto atribuir: o teste
 * do fluxo de reabordagem alterna o mesmo lead entre "com dono" e "sem dono"
 * pra comparar os dois ramos da CONDICAO.
 */
export const contatoRepresentanteSchema = z.object({
  leadId: z.string().min(1),
  representanteId: usuarioIdSchema.nullable(),
});
export type ContatoRepresentanteDto = z.infer<typeof contatoRepresentanteSchema>;
