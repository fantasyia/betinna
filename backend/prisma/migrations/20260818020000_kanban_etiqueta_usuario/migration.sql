-- Etiqueta que representa uma PESSOA (o rep dono da tarefa, no quadro espelho
-- do Diretor).
--
-- Guardar o id do usuário — em vez de casar pelo nome da etiqueta — é o que
-- permite clicar na etiqueta e abrir o quadro daquele rep sem depender de
-- string igual, e sobrevive a renomear o usuário.
--
-- SET NULL no delete: usuário removido não pode apagar a etiqueta (os cartões
-- históricos continuam mostrando de quem eram); ela só perde o vínculo.
ALTER TABLE "KanbanEtiqueta" ADD COLUMN IF NOT EXISTS "usuarioId" TEXT;

CREATE INDEX IF NOT EXISTS "KanbanEtiqueta_usuarioId_idx" ON "KanbanEtiqueta"("usuarioId");

ALTER TABLE "KanbanEtiqueta"
  ADD CONSTRAINT "KanbanEtiqueta_usuarioId_fkey"
  FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;
