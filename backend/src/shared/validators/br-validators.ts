import { z } from 'zod';
import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js';

/** País assumido quando o número chega SEM código de país (nacional/CSV legado). */
export const PAIS_PADRAO: CountryCode = 'BR';

/**
 * Normaliza um telefone pra E.164 (`+<DDI><número>`). Aceita número já
 * internacional (com `+`/DDI) ou nacional (assume `paisPadrao`). Retorna `null`
 * se não for um número válido. Multi-país (atendemos clientes de qualquer lugar).
 */
export function normalizarTelefoneIntl(
  valor: string | null | undefined,
  paisPadrao: CountryCode = PAIS_PADRAO,
): string | null {
  const raw = (valor ?? '').trim();
  if (!raw) return null;
  const tel = parsePhoneNumberFromString(raw, paisPadrao);
  return tel && tel.isValid() ? tel.number : null; // tel.number = E.164 com '+'
}

/**
 * Telefone internacional OBRIGATÓRIO — valida e persiste em E.164. O front manda
 * E.164 (seletor de país + número); CSV/legado sem DDI assume `PAIS_PADRAO`.
 */
export const telefoneIntlSchema = z
  .string()
  .trim()
  .transform((s, ctx) => {
    const e164 = normalizarTelefoneIntl(s);
    if (!e164) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Telefone inválido (informe DDI + número)',
      });
      return z.NEVER;
    }
    return e164;
  });

/**
 * Validadores reutilizáveis pra dados brasileiros.
 *
 * Todos:
 *  - Limpam caracteres não-numéricos (`.`, `-`, `/`, espaços)
 *  - Validam dígito verificador quando aplicável
 *  - Retornam apenas dígitos (formato canônico pra persistir)
 *
 * Uso em DTOs:
 *   import { cpfSchema, cnpjSchema, telefoneBrSchema, cepSchema } from '@shared/validators/br-validators';
 *
 *   export const meuSchema = z.object({
 *     cpf: cpfSchema,
 *     telefone: telefoneBrSchema.optional(),
 *   });
 */

/**
 * CPF — 11 dígitos com validação de dígitos verificadores.
 * Aceita formato `000.000.000-00` ou apenas dígitos.
 * Persiste apenas dígitos.
 */
export const cpfSchema = z
  .string()
  .trim()
  .transform((s) => s.replace(/\D/g, ''))
  .refine((s) => s.length === 11, 'CPF deve ter 11 dígitos')
  .refine((s) => !/^(\d)\1{10}$/.test(s), 'CPF inválido (dígitos repetidos)')
  .refine(validarCpf, 'CPF com dígito verificador inválido');

/**
 * CNPJ — 14 dígitos com validação de dígitos verificadores.
 * Aceita formato `00.000.000/0000-00` ou apenas dígitos.
 */
export const cnpjSchema = z
  .string()
  .trim()
  .transform((s) => s.replace(/\D/g, ''))
  .refine((s) => s.length === 14, 'CNPJ deve ter 14 dígitos')
  .refine((s) => !/^(\d)\1{13}$/.test(s), 'CNPJ inválido (dígitos repetidos)')
  .refine(validarCnpj, 'CNPJ com dígito verificador inválido');

/**
 * Telefone brasileiro — 10 ou 11 dígitos (DDD + número).
 * Aceita formato `(11) 99999-9999` ou apenas dígitos.
 * Persiste apenas dígitos.
 *
 * NÃO valida operadora ou se é número real — só formato.
 */
export const telefoneBrSchema = z
  .string()
  .trim()
  .transform((s) => s.replace(/\D/g, ''))
  .refine((s) => s.length === 10 || s.length === 11, 'Telefone deve ter 10 ou 11 dígitos')
  .refine((s) => {
    // DDD válido (11-99)
    const ddd = parseInt(s.slice(0, 2), 10);
    return ddd >= 11 && ddd <= 99;
  }, 'DDD inválido');

/**
 * CEP — 8 dígitos.
 * Aceita `00000-000` ou apenas dígitos.
 */
export const cepSchema = z
  .string()
  .trim()
  .transform((s) => s.replace(/\D/g, ''))
  .refine((s) => s.length === 8, 'CEP deve ter 8 dígitos');

/**
 * E-mail trim + lowercase. Validação básica via Zod.
 */
export const emailLowerSchema = z.string().trim().toLowerCase().email('E-mail inválido');

// ─── Helpers internos ──────────────────────────────────────────────────────

/**
 * Algoritmo oficial de validação de CPF (módulo 11).
 * Referência: Receita Federal.
 */
function validarCpf(cpf: string): boolean {
  if (cpf.length !== 11) return false;

  // Dígito 1
  let soma = 0;
  for (let i = 0; i < 9; i++) {
    soma += parseInt(cpf[i], 10) * (10 - i);
  }
  let resto = (soma * 10) % 11;
  if (resto === 10) resto = 0;
  if (resto !== parseInt(cpf[9], 10)) return false;

  // Dígito 2
  soma = 0;
  for (let i = 0; i < 10; i++) {
    soma += parseInt(cpf[i], 10) * (11 - i);
  }
  resto = (soma * 10) % 11;
  if (resto === 10) resto = 0;
  if (resto !== parseInt(cpf[10], 10)) return false;

  return true;
}

/**
 * Algoritmo oficial de validação de CNPJ (módulo 11 com pesos específicos).
 * Referência: Receita Federal.
 */
function validarCnpj(cnpj: string): boolean {
  if (cnpj.length !== 14) return false;

  // Dígito 1
  const pesos1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  let soma = 0;
  for (let i = 0; i < 12; i++) {
    soma += parseInt(cnpj[i], 10) * pesos1[i];
  }
  let resto = soma % 11;
  const dv1 = resto < 2 ? 0 : 11 - resto;
  if (dv1 !== parseInt(cnpj[12], 10)) return false;

  // Dígito 2
  const pesos2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  soma = 0;
  for (let i = 0; i < 13; i++) {
    soma += parseInt(cnpj[i], 10) * pesos2[i];
  }
  resto = soma % 11;
  const dv2 = resto < 2 ? 0 : 11 - resto;
  if (dv2 !== parseInt(cnpj[13], 10)) return false;

  return true;
}

/**
 * Função pura — válida pra usar fora de Zod (ex: em masks frontend).
 */
export const isCpfValido = validarCpf;
export const isCnpjValido = validarCnpj;
