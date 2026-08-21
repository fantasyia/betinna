-- Fluxo com DONO (card 👤 21/08): null = fluxo da EMPRESA (tudo que existe
-- hoje — a migration não muda comportamento de nada); preenchido = fluxo
-- PESSOAL do usuário (o rep monta régua pros clientes dele, saindo do
-- WhatsApp pessoal dele).
ALTER TABLE "Fluxo" ADD COLUMN "usuarioId" TEXT;

ALTER TABLE "Fluxo" ADD CONSTRAINT "Fluxo_usuarioId_fkey"
  FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "Fluxo_empresaId_usuarioId_idx" ON "Fluxo"("empresaId", "usuarioId");
