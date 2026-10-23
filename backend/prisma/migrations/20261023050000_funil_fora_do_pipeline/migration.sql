-- Funil de carteira de clientes (23/10): fora do pipeline em aberto. Só ADD.
ALTER TABLE "Funil" ADD COLUMN IF NOT EXISTS "foraDoPipeline" BOOLEAN NOT NULL DEFAULT false;
