-- POR QUE a sessão do WhatsApp caiu.
--
-- O webhook `connection.update` do Evolution já trazia `statusReason`, e a gente
-- descartava: dava pra ver QUE caiu, nunca POR QUÊ. Numa queda recorrente isso
-- é a diferença entre diagnosticar e adivinhar — 401 (deslogado no aparelho),
-- 440 (sessão substituída por outro device), 428 (conexão fechada) e 515
-- (restart pedido pelo WhatsApp) pedem reações completamente diferentes.
ALTER TABLE "EvolutionInstancia" ADD COLUMN IF NOT EXISTS "ultimoMotivo" INTEGER;
ALTER TABLE "EvolutionInstancia" ADD COLUMN IF NOT EXISTS "ultimoMotivoEm" TIMESTAMP(3);
