-- Fundação do ConfiguracaoTenant (no-code Admin Panel) — regras configuráveis por
-- empresa em JSON, sem dev. Cada consumidor (lifecycle, pedido mínimo, comissão, etc.)
-- guarda sua própria sub-chave aqui.
ALTER TABLE "Empresa" ADD COLUMN "config" JSONB;
