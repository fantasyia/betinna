-- Fluxo transacional: sai fora da janela de envio e não conta no teto diário (Léo, 25/09).
ALTER TABLE "Fluxo" ADD COLUMN IF NOT EXISTS "transacional" BOOLEAN NOT NULL DEFAULT false;
