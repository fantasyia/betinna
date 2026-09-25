import { PropostaModalidade, PropostaSecaoTecnica, PropostaStatus } from '@prisma/client';
import { z } from 'zod';
import { usuarioIdSchema } from '@shared/validators/id.schema';

export const propostaItemInputSchema = z.object({
  produtoId: z.string().cuid(),
  quantidade: z.number().int().min(1).max(100_000),
  desconto: z.number().min(0).max(80).default(0),
  precoUnitarioOverride: z.number().positive().optional(),

  /**
   * ── LEVANTAMENTO DE CAMPO (Anexo II) ──
   *
   * O rep mede o quadro do cliente e cada quadro vira um item. Opcionais porque
   * a maior parte das propostas é venda comum, sem levantamento.
   */
  /** Como o cliente chama o quadro: "QGBT", "Painel 3". */
  quadroPainel: z.string().trim().min(1).max(80).optional(),
  /** Tensão medida, em volts. */
  tensaoV: z.number().int().min(1).max(100_000).optional(),
  /**
   * 🔴 Corrente de carga medida, em ampères — foi ela que selecionou o modelo.
   *
   * Vai junto de propósito, mesmo não aparecendo no documento: sem o medido,
   * ninguém confere depois por que aquele MB foi escolhido.
   */
  correnteA: z.number().int().min(1).max(100_000).optional(),
  secaoTecnica: z.nativeEnum(PropostaSecaoTecnica).optional(),
});
export type PropostaItemInputDto = z.infer<typeof propostaItemInputSchema>;

export const createPropostaSchema = z.object({
  clienteId: z.string().cuid(),
  itens: z.array(propostaItemInputSchema).min(1),
  // Só Pix e cartão de crédito (decisão do Léo). Boleto existe no enum só pelo histórico.
  formaPagamento: z.enum(['PIX', 'CARTAO_CREDITO']).default('PIX'),
  condicaoPagamento: z.enum(['avista', '15dias', '30dias', '30_60', '30_60_90']).default('30dias'),
  prazoEntrega: z.coerce.date().optional(),
  descontoGeral: z.number().min(0).max(50).default(0),
  probabilidade: z.number().int().min(0).max(100).default(50),
  validoAte: z.coerce.date().optional(),
  observacoes: z.string().max(2000).optional(),
  /**
   * De quem é a venda. Só a gestão escolhe — o rep é sempre ele mesmo.
   *
   * Proposta da gestão sem dono viraria pedido sem vendedor no ERP, e comissão
   * de ninguém. Como o orçamento do Tiny EXIGE vendedor, isso quebraria no
   * envio; melhor decidir aqui, onde dá pra escolher.
   */
  representanteId: usuarioIdSchema.optional(),
  /**
   * VENDA ou LOCACAO. O REP não escolhe: ele vende locação, sempre.
   *
   * A gestão escolhe porque apresenta as duas modalidades. Sem isto a proposta
   * do rep saía com preço de VENDA — o número errado chegando no cliente.
   */
  modalidade: z.nativeEnum(PropostaModalidade).optional(),
  /**
   * Termos do CONTRATO — só fazem sentido em LOCACAO, e sem os três não dá pra
   * criar o contrato recorrente no ERP (é ele que gera os pedidos mensais).
   *
   * `diaVencimento` para em 28 de propósito: 29, 30 e 31 não existem em todo
   * mês, e vencimento que "pula" é cobrança errada — o cliente reclama e o
   * financeiro conserta na mão todo fevereiro.
   *
   * `carenciaDias` é o período de avaliação GRÁTIS: a 1ª cobrança cai depois
   * dele. Contrato que começa a cobrar no ato contraria a oferta comercial.
   */
  prazoMeses: z.number().int().min(1).max(120).optional(),
  /**
   * ── PRAZOS DO ANEXO II (item 04) ──
   *
   * O documento escreve "em ate __ (____) dias". O representante coleta com o
   * cliente e lanca aqui; e daqui que sai o texto do documento que vai pro
   * ClickSign (`proposta-tecnica-variaveis.util`).
   *
   * Opcionais porque a proposta nasce do levantamento, antes da conversa sobre
   * prazo. ⛔ Mas ausente sai EM BRANCO no documento, nunca com um numero que o
   * sistema escolheu: prazo padrao impresso num contrato e um compromisso que
   * ninguem combinou.
   */
  prazoEntregaDias: z.number().int().min(1).max(365).optional(),
  prazoInstalacaoDias: z.number().int().min(1).max(365).optional(),
  prazoSoftwareDias: z.number().int().min(1).max(365).optional(),
  /** Item 08, V — verificação de funcionamento (documento único, 23/09). */
  prazoVerificacaoDias: z.number().int().min(1).max(365).optional(),
  /**
   * ── SERVIÇOS DE IMPLANTAÇÃO (itens 7.2 e III.a do documento único) ──
   *
   * Valor ÚNICO, separado do aluguel mensal: instalação + materiais +
   * customização, pago em 2 parcelas. A paridade dos centavos (parcelas iguais)
   * é conferida na montagem do contrato, não aqui: o rep pode estar no meio do
   * ajuste, e recusar na digitação seria atrito sem ganho.
   */
  servicosTotal: z.number().min(0).max(99_999_999).optional(),
  customizacaoUnitario: z.number().min(0).max(99_999_999).optional(),
  customizacaoQuantidade: z.number().int().min(1).max(10_000).optional(),
  diaVencimento: z.number().int().min(1).max(28).optional(),
  carenciaDias: z.number().int().min(0).max(180).optional(),
  /**
   * QUEM assina o contrato pelo cliente — pessoa, não empresa.
   *
   * A assinatura eletrônica recusa razão social como nome de signatário, e o
   * cadastro de Cliente só guarda a empresa. Sem uma pessoa aqui o contrato
   * não sai da proposta aceita.
   */
  signatarioNome: z.string().trim().min(3).max(120).optional(),
  signatarioEmail: z.string().trim().email().max(160).optional(),
  /** Telefone do signatário — exigido pela autenticação por SMS/WhatsApp. */
  signatarioTelefone: z.string().trim().max(30).optional(),
});
export type CreatePropostaDto = z.infer<typeof createPropostaSchema>;

export const updatePropostaSchema = createPropostaSchema
  .omit({ clienteId: true, itens: true })
  .partial();
export type UpdatePropostaDto = z.infer<typeof updatePropostaSchema>;

export const changeStatusSchema = z.object({
  status: z.nativeEnum(PropostaStatus),
  motivo: z.string().max(500).optional(),
});
export type ChangeStatusDto = z.infer<typeof changeStatusSchema>;

export const listPropostasSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  sortBy: z.enum(['criadoEm', 'valor', 'numero', 'probabilidade']).default('criadoEm'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
  search: z.string().optional(),
  status: z.nativeEnum(PropostaStatus).optional(),
  clienteId: z.string().cuid().optional(),
  representanteId: usuarioIdSchema.optional(),
});
export type ListPropostasDto = z.infer<typeof listPropostasSchema>;

/**
 * A corrente medida no quadro, pra descobrir o modelo.
 *
 * `coerce` porque vem de query string. O piso é 1 A: corrente zero ou negativa
 * não é medição, é campo em branco — e o seletor precisa distinguir "não medi"
 * de "medi e não tem modelo".
 */
export const selecaoModeloSchema = z.object({
  correnteA: z.coerce.number().int().min(1).max(100_000),
  /**
   * O acompanhamento é opcional e escolhido POR QUADRO (Léo, 18/09): sem ele é
   * o Master Block puro; com ele, o quadro principal leva o Data Sense e os
   * demais o End Point.
   *
   * Default `BASE` de propósito: é a venda mais simples, e errar pra cima
   * colocaria no contrato um equipamento mais caro que ninguém pediu.
   */
  variante: z.enum(['BASE', 'DATA_SENSE', 'END_POINT']).default('BASE'),
});
export type SelecaoModeloDto = z.infer<typeof selecaoModeloSchema>;
