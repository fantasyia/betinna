import { z } from 'zod';
import { eanValido } from './codigos-produto';

/**
 * Vitrine de atacado — Fase 1 (Ribelt Distribuidora Têxtil, 05/10/2026).
 * DTOs do lado da EMPRESA (cadastro). A vitrine pública tem os dela.
 */

const hexSchema = z
  .string()
  .trim()
  .regex(/^#[0-9a-fA-F]{6}$/, 'Cor no formato #RRGGBB');

/** Dinheiro opcional: null = "sob consulta"/"sem sugerido". Nunca negativo. */
const precoSchema = z.number().nonnegative().max(1_000_000).nullable().optional();

export const vitrineConfigSchema = z.object({
  /** Endereço público `/v/<slug>`: minúsculas, números e hífen. */
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(
      /^[a-z0-9](?:[a-z0-9-]{1,38})[a-z0-9]$/,
      'Use 3 a 40 letras minúsculas, números ou hífen',
    ),
  ativa: z.boolean().optional(),
  minimoEntrada: z.number().int().min(1).max(100_000).nullable().optional(),
  minimoVolume: z.number().int().min(1).max(100_000).nullable().optional(),
  minimoAtacadao: z.number().int().min(1).max(100_000).nullable().optional(),
  /** ERP próprio: esconde tamanho esgotado e não aceita pedido além do disponível. */
  respeitaEstoque: z.boolean().optional(),
});
export type VitrineConfigDto = z.infer<typeof vitrineConfigSchema>;

export const corSchema = z.object({
  nome: z.string().trim().min(1).max(60),
  hex: hexSchema,
  ordem: z.number().int().min(0).max(10_000).optional(),
  ativo: z.boolean().optional(),
});
export type CorDto = z.infer<typeof corSchema>;

export const linhaSchema = z.object({
  nome: z.string().trim().min(1).max(40),
  /** Selo da linha na vitrine; vazio/null = sem selo. Ausente = não mexe. */
  selo: z
    .string()
    .trim()
    .max(160)
    .nullable()
    .optional()
    .transform((v) => (v === undefined ? undefined : v || null)),
  ordem: z.number().int().min(0).max(10_000).optional(),
  ativo: z.boolean().optional(),
});
export type LinhaDto = z.infer<typeof linhaSchema>;

export const categoriaSchema = z.object({
  nome: z.string().trim().min(1).max(60),
  ordem: z.number().int().min(0).max(10_000).optional(),
  ativo: z.boolean().optional(),
});
export type CategoriaDto = z.infer<typeof categoriaSchema>;

/** Nova ordem dos modelos na vitrine: TODOS os ids da empresa, na ordem. */
export const ordemModelosSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(2000),
});
export type OrdemModelosDto = z.infer<typeof ordemModelosSchema>;

export const tamanhoSchema = z.object({
  nome: z.string().trim().min(1).max(20),
  ordem: z.number().int().min(0).max(10_000).optional(),
  ativo: z.boolean().optional(),
});
export type TamanhoDto = z.infer<typeof tamanhoSchema>;

/** Tabela de medidas de uma linha: cabeçalho + uma linha por tamanho. */
export const tabelaMedidasSchema = z
  .object({
    colunas: z.array(z.string().trim().min(1).max(30)).min(1).max(10),
    linhas: z
      .array(
        z.object({
          tamanho: z.string().trim().min(1).max(20),
          valores: z.array(z.string().trim().max(20)).max(10),
        }),
      )
      .max(40),
  })
  .superRefine((t, ctx) => {
    t.linhas.forEach((l, i) => {
      if (l.valores.length !== t.colunas.length) {
        ctx.addIssue({
          code: 'custom',
          path: ['linhas', i, 'valores'],
          message: 'Cada tamanho precisa de um valor por coluna',
        });
      }
    });
  });

const modeloLinhaSchema = z.object({
  linhaId: z.string().min(1),
  /** Tamanhos DAQUELA linha que o modelo tem. */
  tamanhoIds: z.array(z.string().min(1)).min(1, 'Marque ao menos um tamanho').max(40),
  precoEntrada: precoSchema,
  precoVolume: precoSchema,
  precoAtacadao: precoSchema,
  precoSugerido: precoSchema,
  tabelaMedidas: tabelaMedidasSchema.nullable().optional(),
  /**
   * Peso de UMA peça por tamanho (gramas), chave = tamanhoId — é o que monta os
   * volumes do frete. Ausente = mantém o que está gravado; null = apaga.
   */
  pesos: z.record(z.string().min(1), z.number().int().min(1).max(30_000).nullable()).optional(),
});

export const modeloSchema = z
  .object({
    nome: z.string().trim().min(1).max(120),
    /** Da lista de categorias da empresa. */
    categoriaId: z.string().min(1).nullable().optional(),
    descricao: z.string().trim().max(4000).nullable().optional(),
    etiquetas: z.array(z.string().trim().min(1).max(40)).max(12).optional(),
    ordem: z.number().int().min(0).max(100_000).optional(),
    ativo: z.boolean().optional(),
    // Kit pra anunciar (marketplace do revendedor).
    tituloMarketplace: z.string().trim().max(60).nullable().optional(),
    descricaoMarketplace: z.string().trim().max(8000).nullable().optional(),
    composicao: z.string().trim().max(200).nullable().optional(),
    /** Cores marcadas, na ordem em que aparecem na vitrine. */
    corIds: z.array(z.string().min(1)).max(40).optional(),
    linhas: z.array(modeloLinhaSchema).max(10).optional(),
    /** Modelos que combinam (conjunto) — vale nos dois sentidos na vitrine. */
    combinaCom: z.array(z.string().min(1)).max(10).optional(),
  })
  .superRefine((m, ctx) => {
    const cores = m.corIds ?? [];
    if (new Set(cores).size !== cores.length) {
      ctx.addIssue({ code: 'custom', path: ['corIds'], message: 'Cor repetida' });
    }
    const linhas = (m.linhas ?? []).map((l) => l.linhaId);
    if (new Set(linhas).size !== linhas.length) {
      ctx.addIssue({ code: 'custom', path: ['linhas'], message: 'Linha repetida' });
    }
  });
export type ModeloDto = z.infer<typeof modeloSchema>;

export const variacaoPatchSchema = z.object({
  sku: z.string().trim().max(60).nullable().optional(),
  /** Código do sistema anterior / fornecedor (22/10). Só no sistema, não na etiqueta. */
  skuSecundario: z.string().trim().max(60).nullable().optional(),
  /** EAN-13 (20/10): 13 dígitos com verificador válido; null tira. */
  ean: z
    .string()
    .trim()
    .refine(eanValido, 'EAN-13 inválido (13 dígitos, com o dígito verificador certo)')
    .nullable()
    .optional(),
  estoque: z.number().int().min(0).max(10_000_000).nullable().optional(),
});
export type VariacaoPatchDto = z.infer<typeof variacaoPatchSchema>;

/** Gerar SKU/EAN que faltam (20/10). Sem modeloId = o catálogo todo. */
export const gerarCodigosSchema = z.object({
  modeloId: z.string().min(1).max(40).optional(),
  sku: z.boolean().optional(),
  ean: z.boolean().optional(),
});
export type GerarCodigosDto = z.infer<typeof gerarCodigosSchema>;

/** Texto opcional: string vazia vira "não informado". */
const opcional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : undefined));

const cepSchema = z
  .string()
  .trim()
  .transform((v) => v.replace(/\D/g, ''))
  .refine((v) => v.length === 8, 'CEP com 8 números');

export const enderecoEntregaSchema = z.object({
  cep: cepSchema,
  endereco: z.string().trim().min(2, 'Informe a rua').max(160),
  numero: z.string().trim().min(1, 'Informe o número').max(20),
  complemento: opcional(80),
  bairro: opcional(80),
  cidade: z.string().trim().min(2, 'Informe a cidade').max(80),
  uf: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}$/, 'UF com 2 letras'),
});
export type EnderecoEntrega = z.infer<typeof enderecoEntregaSchema>;

const itemCarrinhoSchema = z.object({
  corId: z.string().min(1).max(40),
  tamanhoId: z.string().min(1).max(40),
  quantidade: z.number().int().min(1).max(99_999),
});

/** Cotação de frete na vitrine pública (o carrinho + o CEP). */
export const cotarFreteSchema = z.object({
  cep: cepSchema,
  itens: z.array(itemCarrinhoSchema).min(1).max(2000),
});

// Caixa pode ficar INCOMPLETA (null) enquanto o frete está desligado — o Léo
// ainda não tinha o peso vazio nem a capacidade, e a caixa pela metade travava
// o "Salvar" da config inteira (09/10). Ligar exige ao menos uma completa
// (FreteService.salvar → faltandoNoFrete).
const embalagemSchema = z.object({
  nome: z.string().trim().min(1).max(60),
  comprimentoCm: z.number().positive().max(300).nullable(),
  larguraCm: z.number().positive().max(300).nullable(),
  alturaCm: z.number().positive().max(300).nullable(),
  pesoVazioG: z.number().int().min(0).max(30_000).nullable(),
  capacidadePecas: z.number().int().min(1).max(10_000).nullable(),
});

/** Configuração do frete (Vitrine → Configuração → Frete). */
export const freteConfigSchema = z.object({
  ativo: z.boolean(),
  ambiente: z.enum(['sandbox', 'producao']),
  cepOrigem: z
    .string()
    .trim()
    .transform((v) => v.replace(/\D/g, ''))
    .refine((v) => v === '' || v.length === 8, 'CEP com 8 números'),
  pesoMaxVolumeKg: z.number().positive().max(1000),
  /** Declarar o valor das peças no seguro do envio. */
  declararValor: z.boolean().default(true),
  embalagemIndividual: embalagemSchema.nullable(),
  caixas: z.array(embalagemSchema).max(10),
  retirada: z.object({
    ativo: z.boolean(),
    minimoPecas: z.number().int().min(1).max(10_000_000),
    endereco: z.string().trim().max(240),
    horario: z.string().trim().max(160),
  }),
  /**
   * Remetente da etiqueta (Léo, 11/10). Pode ficar incompleto aqui — quem
   * cobra completo é a hora de imprimir (`faltandoNoRemetente`).
   */
  remetente: z
    .object({
      nome: z.string().trim().max(120),
      cnpj: z.string().trim().max(20),
      telefone: z.string().trim().max(20),
      email: z.string().trim().max(120),
      cep: z.string().trim().max(10),
      endereco: z.string().trim().max(160),
      numero: z.string().trim().max(20),
      complemento: z.string().trim().max(80),
      bairro: z.string().trim().max(80),
      cidade: z.string().trim().max(80),
      uf: z.string().trim().max(2),
    })
    .partial()
    .nullable()
    .optional(),
});
export type FreteConfigDto = z.infer<typeof freteConfigSchema>;

/** Pixel do Meta da vitrine (o token da API de Conversões fica em Integrações). */
export const pixelConfigSchema = z.object({
  ativo: z.boolean(),
  pixelId: z
    .string()
    .trim()
    .regex(/^\d{8,20}$/, 'ID do pixel: só números'),
  testEventCode: z
    .string()
    .trim()
    .max(40)
    .regex(/^[A-Za-z0-9]*$/, 'Código de teste inválido')
    .optional()
    .nullable(),
});
export type PixelConfigDto = z.infer<typeof pixelConfigSchema>;

/** Tag do Google da vitrine (15/10): GA4 e/ou Google Ads + rótulo da conversão de compra. */
const vazioVira = (s: z.ZodString) =>
  z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
    s.nullable().optional(),
  );
export const googleTagConfigSchema = z
  .object({
    ativo: z.boolean(),
    ga4Id: vazioVira(
      z
        .string()
        .trim()
        .toUpperCase()
        .regex(/^G-[A-Z0-9]{4,20}$/, 'ID do GA4: G-XXXXXXX'),
    ),
    adsId: vazioVira(
      z
        .string()
        .trim()
        .toUpperCase()
        .regex(/^AW-\d{6,15}$/, 'ID do Google Ads: AW-123456789'),
    ),
    compraLabel: vazioVira(
      z
        .string()
        .trim()
        .regex(/^[A-Za-z0-9_-]{4,64}$/, 'Rótulo da conversão: só letras, números, _ e -'),
    ),
  })
  .superRefine((d, ctx) => {
    if (d.ativo && !d.ga4Id && !d.adsId) {
      ctx.addIssue({
        code: 'custom',
        path: ['ga4Id'],
        message: 'Informe o ID do GA4 ou do Google Ads',
      });
    }
    if (d.compraLabel && !d.adsId) {
      ctx.addIssue({
        code: 'custom',
        path: ['adsId'],
        message: 'O rótulo da conversão precisa do ID do Google Ads',
      });
    }
  });
export type GoogleTagConfigDto = z.infer<typeof googleTagConfigSchema>;

/** Modo interno (19/10): IPs da equipe cadastrados à mão. */
export const internoConfigSchema = z.object({
  ips: z.array(z.string().trim().max(64)).max(50),
});
export type InternoConfigDto = z.infer<typeof internoConfigSchema>;

const blocoAtribuicao = z
  .object({
    utmSource: z.string().max(2048),
    utmMedium: z.string().max(2048),
    utmCampaign: z.string().max(2048),
    utmContent: z.string().max(2048),
    utmTerm: z.string().max(2048),
    gclid: z.string().max(2048),
    gbraid: z.string().max(2048),
    wbraid: z.string().max(2048),
    fbclid: z.string().max(2048),
    landingPage: z.string().max(2048),
    referrer: z.string().max(2048),
    capturadoEm: z.string().max(40),
  })
  .partial();

/** Política de Privacidade da vitrine: quem responde pelos dados e o canal de contato. */
export const privacidadeConfigSchema = z.object({
  razaoSocial: z.string().trim().min(2, 'Informe a razão social').max(160),
  email: z.string().trim().toLowerCase().email('E-mail inválido').max(160),
});
export type PrivacidadeConfigDto = z.infer<typeof privacidadeConfigSchema>;

/** WhatsApp de atendimento da vitrine (ícone no topo). Vazio = ícone some. */
export const contatoConfigSchema = z.object({
  whatsapp: z
    .string()
    .trim()
    .max(20)
    .refine((v) => {
      const d = v.replace(/\D/g, '');
      return (
        d.length === 0 ||
        d.length === 10 ||
        d.length === 11 ||
        ((d.length === 12 || d.length === 13) && d.startsWith('55'))
      );
    }, 'WhatsApp com DDD (ex.: 11 99999-9999)'),
});
export type ContatoConfigDto = z.infer<typeof contatoConfigSchema>;

/** "Simular frete" da tela de configuração: N peças de X gramas pra um CEP. */
export const simularFreteSchema = z.object({
  cep: cepSchema,
  pecas: z.number().int().min(1).max(100_000),
  pesoG: z.number().int().min(1).max(30_000),
  valor: z.number().min(0).max(100_000_000).default(0),
});

/**
 * Pedido enviado na vitrine PÚBLICA. Só diz o QUÊ e QUANTO — preço e faixa
 * são recalculados no servidor (ver `VitrinePedidoService`).
 */
/** Carrinho de quem veio pelo link do WhatsApp (?r=), salvo pelo recuperador (14/10). */
export const carrinhoRefSchema = z.object({
  ref: z.string().trim().min(12).max(80),
  itens: z
    .array(
      z.object({
        corId: z.string().min(1).max(40),
        tamanhoId: z.string().min(1).max(40),
        quantidade: z.number().int().min(1).max(100_000),
      }),
    )
    .max(2000),
});
export type CarrinhoRefDto = z.infer<typeof carrinhoRefSchema>;

export const pedidoVitrineSchema = z.object({
  /** Ref do lead (?r= do link do WhatsApp): fecha o carrinho salvo dele (14/10). */
  ref: z.string().trim().max(80).optional(),
  nome: z.string().trim().min(2, 'Informe seu nome').max(120),
  whatsapp: z
    .string()
    .trim()
    .refine((v) => {
      const d = v.replace(/\D/g, '');
      return d.length >= 10 && d.length <= 13;
    }, 'WhatsApp com DDD'),
  cidade: opcional(80),
  uf: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}$/, 'UF com 2 letras')
    .optional()
    .or(z.literal('').transform(() => undefined)),
  cpfCnpj: opcional(20).refine((v) => {
    if (!v) return true;
    const d = v.replace(/\D/g, '');
    return d.length === 11 || d.length === 14;
  }, 'CPF ou CNPJ incompleto'),
  observacoes: opcional(500),
  /** Endereço de entrega — obrigatório quando a empresa cobra frete (exceto retirada). */
  entrega: enderecoEntregaSchema.optional(),
  /** Serviço escolhido na cotação (id do Melhor Envio) ou retirada em mãos. */
  frete: z
    .union([
      z.object({ servicoId: z.number().int().positive() }),
      z.object({ retirada: z.literal(true) }),
    ])
    .optional(),
  /** De onde o cliente veio (campanha) e os cookies do Meta (fbc/fbp). */
  atribuicao: z
    .object({
      primeiro: blocoAtribuicao.optional(),
      ultimo: blocoAtribuicao.optional(),
      fbc: z.string().max(500).optional(),
      fbp: z.string().max(500).optional(),
      /** Do cookie `_ga` (GA4): a compra pelo servidor cai na mesma visita. */
      gaClientId: z.string().max(100).optional(),
      /** Código do link "modo interno" guardado no aparelho (pedido da equipe). */
      interno: z.string().max(64).optional(),
    })
    .optional(),
  /** Isca pra robô: campo invisível na tela. Gente nunca preenche. */
  site: z.string().max(0).optional(),
  itens: z.array(itemCarrinhoSchema).min(1, 'Seu pedido está vazio').max(2000),
});
export type PedidoVitrineDto = z.infer<typeof pedidoVitrineSchema>;
