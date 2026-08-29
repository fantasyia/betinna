import { z } from 'zod';
import { usuarioIdSchema } from '@shared/validators/id.schema';
import { boolQuery } from '@shared/validators/query.schema';

export const createEmpresaSchema = z.object({
  nome: z.string().min(2).max(200),
  cnpj: z
    .string()
    .regex(/^\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}$/, 'CNPJ deve seguir o formato 00.000.000/0001-00')
    .optional(),
  ramo: z.string().max(100).optional(),
  cidade: z.string().max(100).optional(),
  uf: z.string().length(2).optional(),
  subtitulo: z.string().max(200).optional(),
  // B1 (Lote 6) — Desconto à vista automático (0 = desligado). Máx 50%.
  // Aplicado em PIX (descontoPixPct) e BOLETO+condição=avista (descontoBoletoAvistaPct).
  descontoPixPct: z.number().min(0).max(50).optional(),
  descontoBoletoAvistaPct: z.number().min(0).max(50).optional(),
  // Fase 2 — liga/desliga global do bot Muller no WhatsApp da empresa.
  botWhatsappAtivo: z.boolean().optional(),
});

export type CreateEmpresaDto = z.infer<typeof createEmpresaSchema>;

export const updateEmpresaSchema = createEmpresaSchema.partial();
export type UpdateEmpresaDto = z.infer<typeof updateEmpresaSchema>;

export const listEmpresasSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  search: z.string().optional(),
  ativo: boolQuery.optional(),
});
export type ListEmpresasDto = z.infer<typeof listEmpresasSchema>;

// ─── ConfiguracaoTenant (no-code) ─────────────────────────────────────────
// Patch parcial da config da empresa (Admin Panel). `passthrough` deixa novos
// consumidores entrarem sem mudar o schema; valida só as chaves conhecidas.

/** Metadados por status do lifecycle de pedido (1º consumidor). Chave = PedidoStatus. */
const pedidoStatusMetaSchema = z.object({
  /** Nome custom exibido pro tenant (ex: "Em produção" no lugar de "Enviado ao ERP"). */
  label: z.string().trim().max(40).optional(),
  /** Cor (variant do Badge) — alinhado ao design system do app. */
  variant: z.enum(['neutral', 'warning', 'info', 'success', 'primary', 'danger']).optional(),
});

/**
 * Pedido mínimo configurável por tenant (2º consumidor da ConfiguracaoTenant).
 * MSM: por peso, 250 kg mínimo. `tipo='combinada'` avalia os limites setados
 * com `modo` E (todos) / OU (qualquer um). `sem_minimo` = sem trava (default).
 */
const pedidoMinimoSchema = z
  .object({
    tipo: z
      .enum(['sem_minimo', 'por_valor', 'por_peso', 'por_quantidade', 'combinada'])
      .default('sem_minimo'),
    /** Valor mínimo em R$ (soma dos itens). `null` = limpar (#R4). */
    valorMin: z.number().nonnegative().nullable().optional(),
    /** Peso mínimo em kg (Σ quantidade × pesoPorUnidade do produto). `null` = limpar (#R4). */
    pesoMin: z.number().nonnegative().nullable().optional(),
    /** Quantidade mínima de unidades (Σ quantidade dos itens). `null` = limpar (#R4). */
    quantidadeMin: z.number().int().nonnegative().nullable().optional(),
    /** Combinador pra tipo='combinada': E (todos os limites) ou OU (qualquer um). */
    modo: z.enum(['E', 'OU']).optional(),
  })
  .optional();

/**
 * Amostra: modos + elegibilidade + fila de aprovação (3º consumidor).
 * MSM: subsidiada + compra_propria ativos; elegibilidade por média kg/mês.
 */
const amostraModosSchema = z
  .object({
    modosAtivos: z
      .object({
        subsidiada: z.boolean(),
        compra_propria: z.boolean(),
        compra_cliente: z.boolean(),
      })
      .partial()
      .optional(),
    elegibilidadeSubsidiada: z
      .object({
        tipo: z.enum(['sempre', 'media_kg_mes', 'manual']),
        minKgMes: z.number().nonnegative(),
        mesesJanela: z.number().int().positive().max(24),
      })
      .partial()
      .optional(),
    exigeAprovacaoSubsidiada: z.boolean().optional(),
  })
  .optional();

/**
 * Comissão escalonada por faturamento (4º consumidor). modelo 'fixa' = atual
 * (soma do comissao por pedido); 'escalonada_por_faturamento' = faturamento × % da faixa.
 */
const comissaoBonusSchema = z
  .object({
    modelo: z.enum(['fixa', 'escalonada_por_faturamento']),
    faixas: z
      .array(
        z.object({
          de: z.number().nonnegative(),
          ate: z.number().nonnegative().nullable(),
          percentual: z.number().min(0).max(100),
        }),
      )
      .optional(),
  })
  .optional();

/** Materiais de venda: tipos configuráveis (5º consumidor). */
const materiaisTiposSchema = z
  .object({
    tipos: z
      .array(
        z.object({
          key: z.string().trim().min(1).max(40),
          label: z.string().trim().min(1).max(60),
        }),
      )
      .optional(),
  })
  .optional();

/** Devolução interna: motivos + SLA + janela (6º consumidor). */
const devolucaoInternaSchema = z
  .object({
    motivos: z
      .array(
        z.object({
          key: z.string().trim().min(1).max(40),
          label: z.string().trim().min(1).max(60),
          fotosObrigatorias: z.boolean().optional(),
        }),
      )
      .optional(),
    slaAnaliseDiasUteis: z.number().int().nonnegative().max(60).optional(),
    janelaPosEntregaDias: z.number().int().nonnegative().max(365).optional(),
    estornoComissaoProporcional: z.boolean().optional(),
  })
  .optional();

/** Inbox interna: tipos de canal + SLA (7º consumidor). */
const inboxInternaSchema = z
  .object({
    tipos: z
      .array(
        z.object({
          key: z.string().trim().min(1).max(40),
          nome: z.string().trim().min(1).max(60),
          slaHorasUteis: z.number().int().nonnegative().max(720),
          permiteResposta: z.boolean(),
          prioridade: z.enum(['baixa', 'media', 'alta', 'urgente']),
          destinatariosPapeis: z.array(z.string()).optional(),
        }),
      )
      .optional(),
  })
  .optional();

/** Pacing global de envio de WhatsApp (anti-rajada / humano) — 8º consumidor. */
// `null` numa folha = limpar/resetar pro default do env (#R4).
const envioWhatsappSchema = z
  .object({
    maxPorMinuto: z.number().int().positive().max(600).nullable(),
    maxPorMinutoReativo: z.number().int().positive().max(600).nullable(),
    jitterMinSeg: z.number().nonnegative().max(120).nullable(),
    jitterMaxSeg: z.number().nonnegative().max(120).nullable(),
    /**
     * Janela de envio (silêncio noturno). Vale só pro PROATIVO — responder quem
     * escreveu às 23h continua saindo na hora. Vazio/null = default (8h–20h,
     * todos os dias).
     */
    janela: z
      .object({
        ativa: z.boolean().nullable(),
        horaInicio: z.number().int().min(0).max(23).nullable(),
        horaFim: z.number().int().min(1).max(24).nullable(),
        dias: z.array(z.number().int().min(0).max(6)).max(7).nullable(),
      })
      .partial()
      .nullable(),
    /**
     * Teto DIÁRIO de envios proativos. Ritmo e horário não limitam volume:
     * 12/min numa janela de 12h dá 8.640/dia. O teto é o que transforma um
     * acidente (fluxo em laço, campanha mal filtrada) em "log com N adiados"
     * em vez de número banido. Vazio/null = default (500/dia).
     */
    tetoDiario: z
      .object({
        ativo: z.boolean().nullable(),
        maxPorDia: z.number().int().min(1).max(100_000).nullable(),
      })
      .partial()
      .nullable(),
  })
  .partial()
  .optional();

// Remetente por-tenant do e-mail transacional (Resend). Vazio/null = default do env (#R4).
const emailTransacionalSchema = z
  .object({
    fromNome: z.string().trim().min(1).max(80).nullable(),
    replyTo: z.string().trim().email().max(160).nullable(),
  })
  .partial()
  .optional();

/**
 * Alerta de conversa esquecida (card 🔔) — 9º consumidor.
 *
 * Depois de uma transferência o bot fica desligado até o atendente religar. Se
 * ele esquecer, a conversa fica muda. A varredura abre tarefa pro atendente
 * quando passa de `horas` SEM resposta — contadas só dentro do expediente,
 * senão o alarme dispara toda noite e todo fim de semana e vira ruído.
 * Vazio/null = default (4h, seg–sex, 8h–18h).
 */
const alertaConversaEsquecidaSchema = z
  .object({
    ativo: z.boolean().nullable(),
    /** Horas COMERCIAIS sem resposta até alertar. */
    horas: z.number().int().positive().max(240).nullable(),
    /** Dias úteis (0=domingo … 6=sábado). */
    dias: z.array(z.number().int().min(0).max(6)).max(7).nullable(),
    horaInicio: z.number().int().min(0).max(23).nullable(),
    horaFim: z.number().int().min(1).max(24).nullable(),
  })
  .partial()
  .optional();

/**
 * Como esta empresa trata ESTOQUE.
 *
 * `controlado` é o mundo de quem vende de prateleira: saldo baixo é alerta,
 * saldo zero é problema. `sob_encomenda` é o oposto — a Somatec monta o Master
 * Block DEPOIS do pedido (uma OP por pedido, montagem no mesmo dia ou no
 * seguinte), então saldo zero é o estado NORMAL e pintá-lo de vermelho ensina o
 * time a ignorar o alerta justamente onde ele deveria significar alguma coisa.
 *
 * Não mexe em nenhuma trava: o app nunca bloqueou venda por estoque. O que muda
 * é o que a tela AFIRMA — "sem estoque" vira "sob encomenda".
 */
const estoqueSchema = z
  .object({
    modo: z.enum(['controlado', 'sob_encomenda']).default('controlado'),
    /** Prazo de montagem prometido, em dias úteis. Vira texto na tela. */
    diasMontagem: z.number().int().min(0).max(60).nullable().optional(),
  })
  .optional();

/**
 * Comissão de ORIGINAÇÃO — a de quem trouxe o representante.
 *
 * Não sai do `comissaoPadrao` de ninguém (aquele é do rep que vendeu) e por
 * isso precisa de configuração própria: quem recebe e quanto, por canal.
 * Percentuais do Léo: 6% no que veio por representante (locação) e 12% no que
 * veio sem representante (site).
 */
const comissaoOriginacaoSchema = z
  .object({
    ativo: z.boolean().default(false),
    /** Usuário do app que recebe — usamos o contato dele no ERP. */
    usuarioId: usuarioIdSchema.nullable().optional(),
    /** Contato no ERP, quando quem recebe não é usuário do app. */
    contatoErpId: z.string().max(40).nullable().optional(),
    pctRep: z.number().min(0).max(100).nullable().optional(),
    pctSemRep: z.number().min(0).max(100).nullable().optional(),
  })
  .partial()
  .optional();

/**
 * Quem pode abrir pedido — e por onde a venda do rep entra.
 *
 * Na Somatec (regra do Léo, 29/08) o representante **não abre pedido**: ele sobe
 * PROPOSTA. A proposta vai pro ERP como orçamento, o diretor aprova lá e atribui
 * a venda ao rep — e é o pedido de volta do ERP que vira comissão. Deixar o rep
 * abrir pedido aqui criaria venda que o ERP não conhece, e comissão sobre ela.
 *
 * `repCriaPedido: true` devolve o comportamento antigo pra quem vende de
 * prateleira, sem aprovação no meio.
 */
const vendasSchema = z
  .object({
    repCriaPedido: z.boolean().default(false),
  })
  .partial()
  .optional();

/**
 * Identidade visual da empresa nos materiais que saem do app (PDF de proposta,
 * catálogo).
 *
 * O logo NÃO vem aqui — ele já tem lugar próprio (`Empresa.logoUrl`, bucket
 * `empresa-logos`). Aqui ficam só as cores e a linha de rodapé, que são
 * decisão de marca e mudam sem trocar arquivo.
 */
const marcaSchema = z
  .object({
    /** Títulos, cabeçalho de tabela e números. Hex, ex. "#00416E". */
    corPrimaria: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/, 'cor deve ser hex, ex. #00416E')
      .nullable()
      .optional(),
    /** Fio e destaques finos. */
    corSecundaria: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/, 'cor deve ser hex, ex. #008CC8')
      .nullable()
      .optional(),
    /** Uma linha no rodapé: site, telefone — como o cliente responde. */
    rodape: z.string().max(120).nullable().optional(),
  })
  .partial()
  .optional();

export const tenantConfigPatchSchema = z
  .object({
    // #R4 — cada seção aceita `null` = remover a seção inteira (reset pro default). O merge no service
    // trata: null no topo apaga a chave; null numa sub-chave apaga só ela.
    pedidoStatusLabels: z.record(z.string(), pedidoStatusMetaSchema).nullable().optional(),
    pedidoMinimo: pedidoMinimoSchema.nullable(),
    amostraModos: amostraModosSchema.nullable(),
    comissaoBonus: comissaoBonusSchema.nullable(),
    materiaisVenda: materiaisTiposSchema.nullable(),
    devolucaoInterna: devolucaoInternaSchema.nullable(),
    inboxInterna: inboxInternaSchema.nullable(),
    envioWhatsapp: envioWhatsappSchema.nullable(),
    emailTransacional: emailTransacionalSchema.nullable(),
    alertaConversaEsquecida: alertaConversaEsquecidaSchema.nullable(),
    estoque: estoqueSchema.nullable(),
    comissaoOriginacao: comissaoOriginacaoSchema.nullable(),
    vendas: vendasSchema.nullable(),
    marca: marcaSchema.nullable(),
  })
  // .strip() (default zod): DESCARTA chaves desconhecidas em vez de deixá-las entrar no
  // Empresa.config (o front só manda as seções conhecidas; .passthrough deixava lixo crescer).
  .strip();
export type TenantConfigPatchDto = z.infer<typeof tenantConfigPatchSchema>;
