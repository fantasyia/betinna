import { z } from 'zod';

/**
 * Schema de validação das variáveis de ambiente.
 * O processo encerra se alguma variável obrigatória estiver ausente ou inválida.
 */
export const envSchema = z
  .object({
    // App
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(3001),
    API_PREFIX: z.string().default('api/v1'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
    CORS_ORIGINS: z.string().default('http://localhost:3000'),
    /**
     * URL pública do frontend — usada em links de e-mail transacional
     * (botão "Acessar Betinna.ai", deep-links pra pedido/ocorrência).
     * Default: primeiro CORS_ORIGINS.
     */
    FRONTEND_URL: z.string().url().optional(),

    // Database
    DATABASE_URL: z.string().url(),
    DIRECT_URL: z.string().url(),

    // Supabase
    SUPABASE_URL: z.string().url(),
    SUPABASE_ANON_KEY: z.string().min(1),
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
    SUPABASE_JWT_SECRET: z.string().optional().default(''),

    // Redis (BullMQ)
    REDIS_URL: z.string().url().default('redis://localhost:6379'),

    // Crypto (AES-256 — 64 chars hex = 32 bytes)
    ENCRYPTION_KEY: z
      .string()
      .regex(/^[0-9a-fA-F]{64}$/, 'ENCRYPTION_KEY deve ser 64 caracteres hex (32 bytes)'),

    // IA
    OPENAI_API_KEY: z.string().optional().default(''),
    ANTHROPIC_API_KEY: z.string().optional().default(''),
    /** Modelo padrão pro MullerBot. */
    MULLERBOT_MODEL: z.string().default('gpt-4o-mini'),
    /** Limite total de tokens de entrada (system + user). Catálogo é truncado pra caber. */
    MULLERBOT_MAX_INPUT_TOKENS: z.coerce.number().int().positive().default(4000),
    /** Limite de tokens da resposta. */
    MULLERBOT_MAX_OUTPUT_TOKENS: z.coerce.number().int().positive().default(1024),
    /** Fase 2 — horas que o bot fica pausado numa conversa após um humano responder (handoff). */
    BOT_HANDOFF_HORAS: z.coerce.number().int().positive().default(24),
    /**
     * Fase 2 — liga o catálogo (RAG) no bot do WhatsApp da empresa.
     * `false` (default) = bot puro conversa (sem catálogo). Trocar pra `true`
     * no Railway ATIVA o RAG (busca de produtos + guardrails) sem mexer em código.
     */
    MULLERBOT_WHATSAPP_CATALOGO: z
      .union([z.boolean(), z.string().transform((s) => s === 'true')])
      .default(false),
    /**
     * Sprint 2.2 — palavras que marcam uma resposta do bot pra revisão (🚩) na
     * auditoria. Como o bot roda sem catálogo, respostas citando preço/estoque/
     * prazo são suspeitas (pode estar inventando). Lista separada por vírgula.
     */
    BOT_AUDIT_KEYWORDS: z
      .string()
      .default(
        'preço,preco,R$,valor é,valor e,estoque,disponível,disponivel,indisponível,indisponivel,entrega em,prazo de,dias úteis,dias uteis,frete,promoção,promocao,desconto',
      ),

    // OMIE
    OMIE_APP_KEY: z.string().optional().default(''),
    OMIE_APP_SECRET: z.string().optional().default(''),
    OMIE_WEBHOOK_SECRET: z.string().optional().default(''),
    /** Quando true, OMIE retorna dados mockados em vez de chamar a API real */
    OMIE_DEMO_MODE: z.union([z.boolean(), z.string().transform((s) => s === 'true')]).default(true),
    /**
     * Trava de segurança do go-live do OMIE. DESLIGADA por default (dormente).
     * Quando você plugar o OMIE REAL, defina `OMIE_REQUIRE_REAL=true` no Railway:
     * a partir daí, se `OMIE_DEMO_MODE` continuar `true` em produção, o boot
     * ABORTA com mensagem clara — evita pedidos "fantasma" (que parecem enviados
     * ao ERP mas não chegam). Enquanto `false`, produção sobe normal mesmo em demo.
     */
    OMIE_REQUIRE_REAL: z
      .union([z.boolean(), z.string().transform((s) => s === 'true')])
      .default(false),
    OMIE_BASE_URL: z.string().url().default('https://app.omie.com.br/api/v1'),
    OMIE_TIMEOUT_MS: z.coerce.number().int().positive().default(30000),
    /**
     * Ratio aplicado em precoTabela pra estimar precoFabrica quando o
     * produto OMIE não tem essa info explícita. Default 0.7 (preço fábrica
     * = 70% do preço tabela), ajustável por empresa via env. Quando OMIE
     * tabela_de_preco for integrada, esse fallback fica só pra casos onde
     * o produto não está em nenhuma tabela auxiliar.
     */
    OMIE_PRECO_FABRICA_RATIO: z.coerce.number().min(0).max(1).default(0.7),
    /**
     * P7 — Remessa de amostra grátis. CFOP usado quando cliente e empresa
     * estão na MESMA UF (5911) ou em UFs diferentes (6911). Defaults são os
     * CFOPs padrão de "remessa de amostra grátis"; ajustáveis se a contabilidade
     * do cliente usar outros.
     */
    OMIE_CFOP_AMOSTRA_UF: z.string().default('5911'),
    OMIE_CFOP_AMOSTRA_INTERESTADUAL: z.string().default('6911'),
    /**
     * Código do cenário fiscal "sem destaque de tributos" cadastrado na conta
     * OMIE do cliente, aplicado às remessas de amostra. Opcional (0 = não envia
     * cenário; OMIE usa a tributação padrão do produto com o CFOP informado).
     */
    OMIE_CENARIO_IMPOSTO_AMOSTRA: z.coerce.number().int().min(0).default(0),

    // WhatsApp Business Cloud
    WHATSAPP_ACCESS_TOKEN: z.string().optional().default(''),
    WHATSAPP_PHONE_NUMBER_ID: z.string().optional().default(''),
    WHATSAPP_BUSINESS_ACCOUNT_ID: z.string().optional().default(''),
    WHATSAPP_VERIFY_TOKEN: z.string().optional().default(''),
    WHATSAPP_APP_SECRET: z.string().optional().default(''),

    // Mercado Livre
    ML_CLIENT_ID: z.string().optional().default(''),
    ML_CLIENT_SECRET: z.string().optional().default(''),
    ML_REDIRECT_URI: z.string().optional().default(''),
    /** Comma-separated. IPs do ML que enviam webhooks. Default: produção ML 2024. Vazio = aceita qualquer IP. */
    ML_WEBHOOK_IP_WHITELIST: z
      .string()
      .default('54.88.218.97,18.215.140.160,18.213.114.129,18.206.34.84'),
    /** Site ID padrão (MLB = Brasil, MLA = Argentina, MLM = México, etc.). */
    ML_SITE_ID: z.string().default('MLB'),

    // Shopee
    SHOPEE_PARTNER_ID: z.string().optional().default(''),
    SHOPEE_PARTNER_KEY: z.string().optional().default(''),
    SHOPEE_REDIRECT_URI: z.string().optional().default(''),
    /** 'live' (default — partner.shopeemobile.com) ou 'sandbox' (partner.test-stable.shopeemobile.com). */
    SHOPEE_ENV: z.enum(['live', 'sandbox']).default('live'),

    // Amazon SP-API
    /** LWA Client ID (do app "Login with Amazon" linkado ao Selling Partner App). */
    AMAZON_CLIENT_ID: z.string().optional().default(''),
    /** LWA Client Secret. */
    AMAZON_CLIENT_SECRET: z.string().optional().default(''),
    /** Refresh token sistêmico (single-account/self-auth). Em multi-tenant, cada empresa
     * faz seu OAuth e tem o próprio refresh_token em IntegracaoConexao. */
    AMAZON_REFRESH_TOKEN: z.string().optional().default(''),
    /** Mantida pra compatibilidade — não usada após Amazon remover AWS Sigv4 em 10/2023. */
    AMAZON_REGION: z.string().default('us-east-1'),
    /** Selling Partner App ID (registrado em developer.amazonservices.com). */
    AMAZON_APP_ID: z.string().optional().default(''),
    /** URL de callback do OAuth Selling Partner. */
    AMAZON_LWA_REDIRECT_URI: z.string().optional().default(''),
    /** Marketplace ID padrão (BR=A2Q3Y263D00KWC, US=ATVPDKIKX0DER). */
    AMAZON_MARKETPLACE_ID: z.string().default('A2Q3Y263D00KWC'),
    /** Região SP-API: NA (Brasil/US/CA/MX), EU, FE (Japan/Australia/Singapore/India). */
    AMAZON_SP_API_REGION: z.enum(['NA', 'EU', 'FE']).default('NA'),
    /** Host do OAuth Seller Central (varia por país). Default BR. */
    AMAZON_OAUTH_HOST: z.string().default('sellercentral.amazon.com.br'),
    /** Sandbox mode (usa endpoints sandbox SP-API quando true). */
    AMAZON_SANDBOX: z
      .union([z.boolean(), z.string().transform((s) => s === 'true')])
      .default(false),

    // TikTok Shop
    TIKTOK_APP_KEY: z.string().optional().default(''),
    TIKTOK_APP_SECRET: z.string().optional().default(''),
    /** Service ID do app TikTok Shop (do painel partner). */
    TIKTOK_SERVICE_ID: z.string().optional().default(''),
    /** URL de callback do OAuth shop authorization. */
    TIKTOK_REDIRECT_URI: z.string().optional().default(''),
    /** Versão do API path (v202309 atual). */
    TIKTOK_API_VERSION: z.string().default('202309'),

    // Meta (Instagram + Facebook)
    META_GRAPH_APP_ID: z.string().optional().default(''),
    META_GRAPH_APP_SECRET: z.string().optional().default(''),
    META_GRAPH_REDIRECT_URI: z.string().optional().default(''),
    /** Token compartilhado para Meta verificar nosso webhook (GET handshake). */
    META_GRAPH_VERIFY_TOKEN: z.string().optional().default(''),
    /** Versão da Graph API. Default v21.0 (atual). */
    META_GRAPH_API_VERSION: z.string().default('v21.0'),

    // Google Calendar
    GOOGLE_CLIENT_ID: z.string().optional().default(''),
    GOOGLE_CLIENT_SECRET: z.string().optional().default(''),
    GOOGLE_REDIRECT_URI: z.string().optional().default(''),

    // E-mail
    SENDGRID_API_KEY: z.string().optional().default(''),
    SENDGRID_FROM_EMAIL: z.string().email().default('noreply@betinna.ai'),
    SENDGRID_FROM_NAME: z.string().default('Betinna.ai'),

    // Resend (alternativa preferida ao SendGrid pra e-mails sistêmicos)
    // Quando RESEND_API_KEY está configurado, TransactionalEmailService usa
    // Resend. Senão, cai pro SendGrid (legado). Cria conta em resend.com.
    RESEND_API_KEY: z.string().optional().default(''),
    RESEND_FROM_EMAIL: z.string().email().optional(),
    RESEND_FROM_NAME: z.string().optional(),

    // Observability
    SENTRY_DSN: z.string().optional().default(''),
    /** Sample rate de traces (0–1). 0.1 = 10% das requests instrumentadas. Em prod, manter baixo pra controlar custo. */
    SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(0.1),

    // Backup automático (cron `backup-diario` 03:00 UTC)
    /** Liga/desliga o backup diário automático. Default ligado. */
    BACKUP_ENABLED: z
      .union([z.boolean(), z.string().transform((s) => s !== 'false')])
      .default(true),
    /** Dias de retenção dos backups no storage. Default 30. */
    BACKUP_RETENTION_DAYS: z.coerce.number().int().positive().default(30),
    /** E-mail que recebe alerta se o backup falhar. Vazio = usa o primeiro ADMIN ativo. */
    BACKUP_ALERT_EMAIL: z.string().optional().default(''),
    /** Banco sandbox pra restore-test fazer restauração REAL. Vazio = só valida integridade (pg_restore --list). */
    RESTORE_TEST_DATABASE_URL: z.string().optional().default(''),

    // LGPD — retenção de dados (cron `retention-cleanup-mensal` purga registros antigos)
    /** Meses de retenção do AuditLog. Default 24m (2 anos) — atende LGPD/CCPA. 0 desabilita purga. */
    LGPD_AUDIT_RETENTION_MONTHS: z.coerce.number().int().min(0).default(24),
    /** Meses de retenção das Message da Inbox. Default 24m. 0 desabilita purga. */
    LGPD_MESSAGES_RETENTION_MONTHS: z.coerce.number().int().min(0).default(24),
    /** Meses de retenção das Notificacao já lidas. Default 6m. 0 desabilita purga. */
    LGPD_NOTIFICACOES_RETENTION_MONTHS: z.coerce.number().int().min(0).default(6),

    // Auth / Cache
    /** TTL do cache de AuthGuard em Redis. Mantenha curto pra refletir mudanças de role rapidamente. */
    AUTH_CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(60),

    // Deploy identity (para cron locks)
    /** Identificador único da réplica (ex: hostname do container Railway). */
    INSTANCE_ID: z.string().optional().default(''),
    /** Tipo do serviço: 'api' (default, HTTP server) ou 'worker' (background only). */
    SERVICE_TYPE: z.enum(['api', 'worker']).default('api'),
    /** Railway injeta automaticamente em production. Usado para TLS Redis. */
    RAILWAY_ENVIRONMENT: z.string().optional().default(''),
  })
  /**
   * Em produção, secrets de webhook são OBRIGATÓRIOS — não aceitamos webhook
   * sem validação HMAC em prod. Em dev/test, podem ficar vazios (warn-mode).
   *
   * Refs auditoria 2026-05-15 — webhooks OMIE/Meta/Shopee/TikTok aceitavam
   * silenciosamente sem secret → atacante podia injetar eventos.
   */
  .superRefine((env, ctx) => {
    if (env.NODE_ENV !== 'production') return;

    const required: Array<{ key: keyof typeof env; label: string }> = [
      { key: 'OMIE_WEBHOOK_SECRET', label: 'OMIE' },
      { key: 'META_GRAPH_APP_SECRET', label: 'Meta (Facebook/Instagram)' },
      { key: 'META_GRAPH_VERIFY_TOKEN', label: 'Meta verify token' },
      { key: 'SHOPEE_PARTNER_KEY', label: 'Shopee' },
      { key: 'TIKTOK_APP_SECRET', label: 'TikTok' },
    ];

    for (const { key, label } of required) {
      const value = env[key];
      if (typeof value !== 'string' || value.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: `[PROD] Secret obrigatório em produção para validar webhooks ${label}`,
        });
      }
    }

    // ML não tem HMAC — exige whitelist de IP em produção
    const mlWhitelist = (env.ML_WEBHOOK_IP_WHITELIST ?? '').trim();
    if (mlWhitelist.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['ML_WEBHOOK_IP_WHITELIST'],
        message: '[PROD] ML_WEBHOOK_IP_WHITELIST obrigatório em produção (ML não suporta HMAC)',
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

/**
 * Carrega e valida o env. Encerra o processo se inválido.
 */
export function loadAndValidateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');

    console.error(`\n❌ Variáveis de ambiente inválidas:\n${issues}\n`);
    process.exit(1);
  }
  return result.data;
}
