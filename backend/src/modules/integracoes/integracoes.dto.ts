import { z } from 'zod';
import { boolQuery } from '@shared/validators/query.schema';
import { SERVICOS_EMPRESA, SERVICOS_INTEGRACAO, SERVICOS_USUARIO } from './integracoes.constants';
import { TEMPLATES_AMOSTRA } from '@integrations/email/transactional-email.service';

const servicoEnum = z.enum(SERVICOS_INTEGRACAO);
const servicoEmpresaEnum = z.enum(SERVICOS_EMPRESA);
const servicoUsuarioEnum = z.enum(SERVICOS_USUARIO);

export const conectarSchema = z.object({
  servico: servicoEmpresaEnum,
  /**
   * Credenciais opacas — formato depende do serviço:
   *  - erp: { appKey, appSecret }
   *  - whatsapp: { accessToken, phoneNumberId, businessAccountId, appSecret }
   *  - mercadolivre: { clientId, clientSecret, refreshToken }
   *  - etc.
   * Tudo é validado pelo service do respectivo serviço, não aqui.
   */
  credenciais: z.record(z.string(), z.unknown()),
});
export type ConectarDto = z.infer<typeof conectarSchema>;

export const desconectarSchema = z.object({
  servico: servicoEnum,
});
export type DesconectarDto = z.infer<typeof desconectarSchema>;

export const listConexoesSchema = z.object({
  servico: servicoEmpresaEnum.optional(),
  ativo: boolQuery.optional(),
});
export type ListConexoesDto = z.infer<typeof listConexoesSchema>;

// ─── Escopo USUÁRIO ───────────────────────────────────────────────────

export const conectarUsuarioSchema = z.object({
  servico: servicoUsuarioEnum,
  credenciais: z.record(z.string(), z.unknown()),
});
export type ConectarUsuarioDto = z.infer<typeof conectarUsuarioSchema>;

export const listConexoesUsuarioSchema = z.object({
  servico: servicoUsuarioEnum.optional(),
  ativo: boolQuery.optional(),
});
export type ListConexoesUsuarioDto = z.infer<typeof listConexoesUsuarioSchema>;

/**
 * Teste de e-mail: destinatário e template são OPCIONAIS.
 *
 * Sem nada, é o comportamento de sempre (mensagem genérica pro próprio
 * usuário). Com `template`, sai a amostra do template real com a marca do
 * tenant — que é a única forma honesta de revisar layout de e-mail: preview de
 * navegador e mensagem colada no Gmail não pegam a sanitização do cliente.
 */
export const emailTesteSchema = z.object({
  para: z.string().trim().email('Destinatário inválido').optional(),
  template: z.enum(TEMPLATES_AMOSTRA).optional(),
});

export type EmailTesteDto = z.infer<typeof emailTesteSchema>;
