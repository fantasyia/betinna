import { z } from 'zod';
import { boolQuery } from '@shared/validators/query.schema';

// ─── Enums sync com Prisma ────────────────────────────────────────────
export const fluxoStatusValues = ['RASCUNHO', 'ATIVO', 'PAUSADO', 'ARQUIVADO'] as const;
export const fluxoNoTipoValues = ['TRIGGER', 'CONDICAO', 'ACAO', 'DELAY'] as const;
// ⚠️ MANTER SINCRONIZADO com o enum FluxoTriggerTipo do Prisma (schema.prisma).
export const fluxoTriggerTipoValues = [
  'LEAD_CRIADO',
  'LEAD_ETAPA_MUDOU',
  'PEDIDO_APROVADO',
  'PEDIDO_ENTREGUE',
  'PEDIDO_RASTREIO_DISPONIVEL',
  'OCORRENCIA_ABERTA',
  'CLIENTE_INATIVO_30D',
  'AMOSTRA_FOLLOWUP',
  'CRON_AGENDADO',
  // Orquestração (Fase B):
  'LEAD_RESPONDEU',
  'LEAD_SEM_RESPOSTA',
  'IA_CLASSIFICOU',
  'LEAD_RECEBEU_TAG',
  // Orquestração (Fase C):
  'MENSAGEM_CANAL',
  'WEBHOOK_RECEBIDO',
] as const;
// ⚠️ MANTER SINCRONIZADO com o enum FluxoAcaoTipo do Prisma (schema.prisma).
export const fluxoAcaoTipoValues = [
  'ENVIAR_WHATSAPP',
  'ENVIAR_EMAIL',
  'CRIAR_TAREFA',
  'MUDAR_TAG',
  'MOVER_LEAD_ETAPA',
  'ATRIBUIR_REP',
  'WEBHOOK_EXTERNO',
  // Orquestração (Fase B):
  'CONVERSAR_IA',
  'LIBERAR_LOTE',
  'PAUSAR_IA',
  'CRIAR_LEAD',
  'TRANSFERIR_ATENDIMENTO',
] as const;

// ─── Nó (FluxoNo) ────────────────────────────────────────────────────
export const createFluxoNoSchema = z.object({
  // id fornecido pelo frontend (para poder referenciar em arestas)
  id: z.string().min(1),
  tipo: z.enum(fluxoNoTipoValues),
  // nullable: nós não-ACAO (TRIGGER/CONDICAO/DELAY) mandam acaoTipo null pelo editor.
  acaoTipo: z.enum(fluxoAcaoTipoValues).nullable().optional(),
  titulo: z.string().min(1).max(100),
  config: z.record(z.unknown()).default({}),
  posX: z.number().default(0),
  posY: z.number().default(0),
});

// ─── Aresta (FluxoEdge) ───────────────────────────────────────────────
export const createFluxoEdgeSchema = z.object({
  id: z.string().min(1),
  sourceNoId: z.string().min(1),
  targetNoId: z.string().min(1),
  label: z.string().max(200).nullable().optional(),
});

// ─── Criar fluxo ─────────────────────────────────────────────────────
export const createFluxoSchema = z.object({
  nome: z.string().min(1).max(150),
  descricao: z.string().max(500).optional(),
  triggerTipo: z.enum(fluxoTriggerTipoValues).optional(),
  triggerConfig: z.record(z.unknown()).optional(),
  nos: z.array(createFluxoNoSchema).default([]),
  arestas: z.array(createFluxoEdgeSchema).default([]),
});

// ─── Import / Export de fluxo (arquivo .json) ────────────────────────
/**
 * Nó no arquivo de import: `id` é uma CHAVE estável (ex: "trigger", "msg1")
 * referenciada pelas arestas. No import o backend gera ids internos novos,
 * então o mesmo arquivo pode ser importado várias vezes sem colisão.
 */
const importFluxoNoSchema = z.object({
  id: z.string().min(1).max(120),
  tipo: z.enum(fluxoNoTipoValues),
  acaoTipo: z.enum(fluxoAcaoTipoValues).nullable().optional(),
  titulo: z.string().min(1).max(100),
  config: z.record(z.unknown()).optional().default({}),
  posX: z.number().optional().default(0),
  posY: z.number().optional().default(0),
});

/** Aresta no arquivo de import: referencia nós pela CHAVE (id acima); sem id próprio. */
const importFluxoEdgeSchema = z.object({
  sourceNoId: z.string().min(1),
  targetNoId: z.string().min(1),
  // max(200) e não 40 (auditoria 20/08): o editor grava rótulos maiores (saída
  // longa de roteador) e o max(40) só do IMPORT quebrava o round-trip
  // exportar→importar do próprio sistema. Simétrico ao createFluxoEdgeSchema.
  label: z.string().max(200).nullable().optional(),
});

export const importFluxoSchema = z
  .object({
    // Envelope opcional/tolerante — aceita arquivo "cru" sem ele.
    betinnaFluxo: z.literal(1).optional(),
    tipo: z.literal('fluxo').optional(),
    nome: z.string().min(1).max(150),
    descricao: z.string().max(500).nullable().optional(),
    triggerTipo: z.enum(fluxoTriggerTipoValues).nullable().optional(),
    triggerConfig: z.record(z.unknown()).nullable().optional(),
    nos: z.array(importFluxoNoSchema).max(200).default([]),
    arestas: z.array(importFluxoEdgeSchema).max(400).default([]),
  })
  .superRefine((d, ctx) => {
    const ids = new Set(d.nos.map((n) => n.id));
    if (ids.size !== d.nos.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Há nós com id (chave) duplicado',
        path: ['nos'],
      });
    }
    d.arestas.forEach((e, i) => {
      if (!ids.has(e.sourceNoId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Aresta ${i}: sourceNoId "${e.sourceNoId}" não existe em nos`,
          path: ['arestas', i, 'sourceNoId'],
        });
      }
      if (!ids.has(e.targetNoId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Aresta ${i}: targetNoId "${e.targetNoId}" não existe em nos`,
          path: ['arestas', i, 'targetNoId'],
        });
      }
    });
    d.nos.forEach((n, i) => {
      if (n.tipo === 'ACAO' && !n.acaoTipo) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Nó "${n.id}" é ACAO mas não tem acaoTipo`,
          path: ['nos', i, 'acaoTipo'],
        });
      }
    });
  });

// ─── Atualizar fluxo ─────────────────────────────────────────────────
/**
 * Aresta no UPDATE: o `id` é OPCIONAL (o banco gera via @default(cuid) quando
 * ausente). Sem isto, um full-replace vindo do MCP (que manda arestas SEM id,
 * igual ao import) era rejeitado com "Dados inválidos" sempre que havia ≥1
 * aresta — só dava pra atualizar fluxos sem topologia. Espelha o import.
 */
export const updateFluxoEdgeSchema = createFluxoEdgeSchema.extend({
  id: z.string().min(1).optional(),
});

export const updateFluxoSchema = z
  .object({
    nome: z.string().min(1).max(150).optional(),
    descricao: z.string().max(500).optional(),
    // nullable: converter o gatilho pra Manual manda triggerTipo=null (o front
    // omitia o campo, então o gatilho ANTIGO ficava gravado e o fluxo continuava
    // disparando no evento antigo em silêncio). null = manual.
    triggerTipo: z.enum(fluxoTriggerTipoValues).nullable().optional(),
    triggerConfig: z.record(z.unknown()).nullable().optional(),
    /// Quando fornecidos, substituem TODOS os nós e arestas existentes (full replace).
    nos: z.array(createFluxoNoSchema).optional(),
    arestas: z.array(updateFluxoEdgeSchema).optional(),
  })
  .refine((d) => (d.nos === undefined) === (d.arestas === undefined), {
    // Full-replace é do grafo INTEIRO: mandar só `nos` apagava todas as arestas
    // (topologia perdida em silêncio); só `arestas` deletava os nós e a FK
    // estourava. Ou os dois juntos, ou nenhum.
    message: 'nos e arestas devem ser enviados juntos (full replace do grafo) ou ambos omitidos',
    path: ['arestas'],
  });

// ─── Listar fluxos ───────────────────────────────────────────────────
export const listFluxosSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(fluxoStatusValues).optional(),
  triggerTipo: z.enum(fluxoTriggerTipoValues).optional(),
  search: z.string().optional(),
  /** true → só os fluxos favoritados PELO usuário logado. */
  favoritos: boolQuery.optional(),
  /**
   * Gestão: inclui os fluxos PESSOAIS dos usuários na lista (leitura — mesmo
   * padrão do espelho dos quadros de rep). Default: só fluxos da empresa.
   * Ignorado pra papéis não-gestão (cada um já vê os seus).
   */
  incluirPessoais: boolQuery.optional(),
  /**
   * SITUAÇÃO (saúde de execução, últimos 7 dias) — o que a lista não respondia:
   *  - `com_erro`   → teve execução FALHOU
   *  - `rodando`    → executou e NENHUMA falhou
   *  - `sem_execucao` → não rodou nada (fluxo ativo aqui = suspeito)
   */
  situacao: z.enum(['com_erro', 'rodando', 'sem_execucao']).optional(),
  /** Ordenação da lista. Default `nome` (a convenção E1 < E1-R < E2 sai natural). */
  ordenar: z.enum(['nome', 'recentes', 'execucoes']).optional(),
});

// ─── Listar execuções ────────────────────────────────────────────────
export const listExecucoesSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z
    .enum(['PENDENTE', 'EM_EXECUCAO', 'AGUARDANDO', 'CONCLUIDO', 'FALHOU', 'CANCELADO'])
    .optional(),
  /**
   * Quais execuções listar: `producao` (default), `teste` ou `todas`.
   *
   * Default é produção porque a pergunta que se faz abrindo o histórico é "como
   * o fluxo está se comportando" — e teste misturado com real é o que fez o
   * painel do T1 anunciar 0% de sucesso num fluxo que nunca rodou.
   */
  origem: z.enum(['producao', 'teste', 'todas']).default('producao'),
});

// ─── Testar fluxo (execução manual) ─────────────────────────────────
export const testarFluxoSchema = z.object({
  fluxoId: z.string().cuid(),
  /// Contexto inicial da execução de teste
  contexto: z.record(z.unknown()).default({}),
  /**
   * Conversa REAL contra a qual testar. Sem isto, fluxo de WhatsApp com
   * `CRIAR_LEAD` morre sempre no primeiro nó ("conversationId ausente") — ou
   * seja, o T1, que é a porta de entrada de todo inbound, era justo o fluxo que
   * a ferramenta de teste não alcançava.
   *
   * Informando a conversa, o teste semeia conversationId, canal, leadId e
   * telefone a partir dela — roda o grafo de ponta a ponta sem precisar mandar
   * mensagem de verdade pro número.
   */
  conversationId: z.string().min(1).optional(),
  /**
   * Deixar o teste MANDAR MENSAGEM DE VERDADE pro contato da conversa.
   *
   * Default `false`, e default seguro importa aqui: testar contra uma conversa
   * real significa que do outro lado tem uma pessoa real. Um teste do T1 que
   * dispara o opener manda "oi, é da Somatec…" pra um cliente que não pediu
   * nada — e não tem como desfazer.
   *
   * Com `false`, o fluxo roda inteiro (condições, IA, tags, etapas) e os envios
   * de WhatsApp ficam registrados como SIMULADOS no histórico: dá pra ver o
   * texto que sairia, sem mandar.
   */
  enviarDeVerdade: z.boolean().default(false),
});

/**
 * Define/atualiza SÓ o nó de gatilho, sem full-replace do grafo (o PUT reescreve
 * tudo, incluindo corpos de e-mail — caro e arriscado pra um ajuste de gatilho).
 */
export const definirGatilhoSchema = z.object({
  triggerTipo: z.enum(fluxoTriggerTipoValues).optional(),
  titulo: z.string().min(1).max(100).optional(),
  config: z.record(z.unknown()).optional(),
});
export type DefinirGatilhoDto = z.infer<typeof definirGatilhoSchema>;

export const cronPreviewSchema = z
  .object({
    // `expressao` (singular) mantém back-compat; `expressoes` (plural) cobre
    // múltiplos horários/regras no mesmo gatilho.
    expressao: z.string().max(120).optional(),
    expressoes: z.array(z.string().max(120)).max(20).optional(),
    timezone: z.string().max(64).optional(),
    pularFeriados: z.boolean().optional(),
  })
  .refine(
    (d) => (d.expressoes && d.expressoes.length > 0) || (d.expressao && d.expressao.length > 0),
    { message: 'Informe `expressao` ou `expressoes`.' },
  );

// ─── Upload de mídia da ação ENVIAR_WHATSAPP (sobe pro Storage; o nó guarda só o storagePath) ──
export const uploadFluxoMidiaSchema = z.object({
  tipo: z.enum(['IMAGE', 'VIDEO', 'AUDIO', 'DOCUMENT']),
  mimetype: z.string().max(120).optional(),
  fileName: z.string().max(255).optional(),
  /** AUDIO gravado na hora = true (PTT); anexado = false. */
  ptt: z.boolean().optional(),
  /** Base64 PURO do arquivo (sem prefixo data:...). ~15MB raw. */
  dataBase64: z.string().min(1).max(20_000_000),
});

// ─── Types ────────────────────────────────────────────────────────────
export type UploadFluxoMidiaDto = z.infer<typeof uploadFluxoMidiaSchema>;
export type CronPreviewDto = z.infer<typeof cronPreviewSchema>;
export type CreateFluxoDto = z.infer<typeof createFluxoSchema>;
export type UpdateFluxoDto = z.infer<typeof updateFluxoSchema>;
export type ListFluxosDto = z.infer<typeof listFluxosSchema>;
export type ListExecucoesDto = z.infer<typeof listExecucoesSchema>;
export type TestarFluxoDto = z.infer<typeof testarFluxoSchema>;
export type CreateFluxoNoDto = z.infer<typeof createFluxoNoSchema>;
export type CreateFluxoEdgeDto = z.infer<typeof createFluxoEdgeSchema>;
export type ImportFluxoDto = z.infer<typeof importFluxoSchema>;
