-- Migration faltando: tabela Notificacao + 2 enums.
-- Modelo foi adicionado ao schema.prisma anterior sem migration correspondente.
-- Isso causava P2021 "table public.Notificacao does not exist" em prod.

-- CreateEnum
CREATE TYPE "NotificacaoTipo" AS ENUM (
  'APROVACAO_PENDENTE',
  'APROVACAO_RESOLVIDA',
  'OCORRENCIA_ABERTA',
  'OCORRENCIA_RESOLVIDA',
  'PEDIDO_APROVADO',
  'COMISSAO_FECHADA',
  'COMISSAO_PAGA',
  'MENSAGEM_INBOX',
  'AMOSTRA_FOLLOWUP',
  'LEAD_INATIVO',
  'CLIENTE_BLOQUEADO',
  'GENERICO'
);

-- CreateEnum
CREATE TYPE "NotificacaoPrioridade" AS ENUM (
  'BAIXA',
  'NORMAL',
  'ALTA',
  'URGENTE'
);

-- CreateTable
CREATE TABLE "Notificacao" (
  "id"          TEXT NOT NULL,
  "empresaId"   TEXT NOT NULL,
  "usuarioId"   TEXT NOT NULL,
  "tipo"        "NotificacaoTipo" NOT NULL,
  "prioridade"  "NotificacaoPrioridade" NOT NULL DEFAULT 'NORMAL',
  "titulo"      TEXT NOT NULL,
  "mensagem"    TEXT NOT NULL,
  "link"        TEXT,
  "metadata"    JSONB,
  "lidaEm"      TIMESTAMP(3),
  "criadoEm"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "Notificacao_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Notificacao_usuarioId_lidaEm_criadoEm_idx"
  ON "Notificacao"("usuarioId", "lidaEm", "criadoEm");

-- CreateIndex
CREATE INDEX "Notificacao_empresaId_criadoEm_idx"
  ON "Notificacao"("empresaId", "criadoEm");

-- AddForeignKey
ALTER TABLE "Notificacao" ADD CONSTRAINT "Notificacao_empresaId_fkey"
  FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notificacao" ADD CONSTRAINT "Notificacao_usuarioId_fkey"
  FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
