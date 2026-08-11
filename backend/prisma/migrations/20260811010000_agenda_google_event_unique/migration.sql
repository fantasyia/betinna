-- #60: um evento do Google Calendar só pode espelhar UM AgendaItem do mesmo
-- usuário. Duas gravações concorrentes do mesmo item (duplo clique, aba
-- duplicada, app + celular) criavam DOIS eventos no Google e só um id era
-- persistido — o outro ficava órfão na agenda da pessoa, sem jeito de apagar
-- pelo Betinna. NULL não colide no Postgres, então item não espelhado segue livre.
--
-- Limpeza defensiva antes do índice: se já existir duplicata em produção,
-- mantém a linha mais ANTIGA (a que o usuário provavelmente reconhece) e
-- desvincula as demais — o item continua existindo, só perde o espelho.
UPDATE "AgendaItem" a
SET "googleEventId" = NULL
WHERE "googleEventId" IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM "AgendaItem" b
    WHERE b."usuarioId" = a."usuarioId"
      AND b."googleEventId" = a."googleEventId"
      AND (b."criadoEm" < a."criadoEm" OR (b."criadoEm" = a."criadoEm" AND b."id" < a."id"))
  );

CREATE UNIQUE INDEX "AgendaItem_usuarioId_googleEventId_key"
  ON "AgendaItem"("usuarioId", "googleEventId");
