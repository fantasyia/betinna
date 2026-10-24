import { z } from 'zod';

/**
 * Dados fiscais do cadastro (card cmvlyt0n5, Léo 24/10) — pro export do Magis5.
 * A NF-e é emitida FORA do Betinna; aqui é só cadastro. NENHUM valor padrão:
 * o que não foi preenchido fica vazio (o Léo traz do Bling). PURO.
 *
 * Texto vazio vira null; com pontos/traços, guarda só os dígitos.
 */
const digitos = (n: number, msg: string) =>
  z
    .string()
    .trim()
    .transform((v) => v.replace(/\D/g, ''))
    .refine((v) => v === '' || v.length === n, msg)
    .transform((v) => v || null)
    .nullable()
    .optional();

const medidaCm = z.number().positive().max(500).nullable().optional();

/** Produto (modelo). Variação e kit herdam. */
export const fiscalProdutoSchema = z.object({
  cest: digitos(7, 'CEST tem 7 dígitos'),
  /** Origem da mercadoria: 0 a 8 (0 = nacional). */
  origem: z
    .string()
    .trim()
    .refine((v) => v === '' || /^[0-8]$/.test(v), 'Origem vai de 0 a 8')
    .transform((v) => v || null)
    .nullable()
    .optional(),
  /** Unidade comercial (UN, PC, KIT…). */
  unidade: z
    .string()
    .trim()
    .toUpperCase()
    .refine((v) => v === '' || /^[A-Z]{1,6}$/.test(v), 'Unidade: até 6 letras (UN, PC, KIT)')
    .transform((v) => v || null)
    .nullable()
    .optional(),
  /** Sobrescrevem o padrão da empresa. */
  csosn: digitos(3, 'CSOSN tem 3 dígitos'),
  cfopDentro: digitos(4, 'CFOP tem 4 dígitos'),
  cfopFora: digitos(4, 'CFOP tem 4 dígitos'),
  marca: z
    .string()
    .trim()
    .max(40)
    .transform((v) => v || null)
    .nullable()
    .optional(),
  /** Embalagem em cm (o peso já existe por tamanho). */
  embalagemComprimentoCm: medidaCm,
  embalagemLarguraCm: medidaCm,
  embalagemAlturaCm: medidaCm,
  /** Reforma tributária (IBS/CBS) — reservado, vazio por enquanto. */
  ibsCbsCst: digitos(3, 'CST do IBS/CBS tem 3 dígitos'),
  ibsCbsClassTrib: digitos(6, 'cClassTrib tem 6 dígitos'),
});
export type FiscalProduto = z.infer<typeof fiscalProdutoSchema>;

/** Padrão da empresa (Simples Nacional), em Empresa.config.fiscal. */
export const fiscalEmpresaSchema = z.object({
  /** CRT: 1 = Simples Nacional. */
  crt: z
    .string()
    .trim()
    .refine((v) => v === '' || /^[1-4]$/.test(v), 'CRT vai de 1 a 4')
    .transform((v) => v || null)
    .nullable()
    .optional(),
  csosn: digitos(3, 'CSOSN tem 3 dígitos'),
  cfopDentro: digitos(4, 'CFOP tem 4 dígitos'),
  cfopFora: digitos(4, 'CFOP tem 4 dígitos'),
  cstPisCofins: digitos(2, 'CST de PIS/COFINS tem 2 dígitos'),
});
export type FiscalEmpresa = z.infer<typeof fiscalEmpresaSchema>;

/** Tira as chaves vazias; nada preenchido = null (sem bloco no banco). */
export function limparFiscal<T extends Record<string, unknown>>(f: T | null | undefined): T | null {
  if (!f) return null;
  const out = Object.fromEntries(
    Object.entries(f).filter(([, v]) => v !== null && v !== undefined && v !== ''),
  ) as T;
  return Object.keys(out).length ? out : null;
}
