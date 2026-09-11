-- Teto da pausa entre balões, por empresa.
--
-- Era a constante 4000 dentro de `pausaEntreBaloes()`. Virou campo porque o
-- custo foi medido em 11/09: com 4 balões, três pausas de até 4s dão ~12s de
-- cauda — a maior fatia isolada de um turno de 30s. E a cauda é a janela em que
-- o cliente escreve algo novo e recebe uma resposta montada antes disso.
--
-- DEFAULT 4000 de propósito: quem já está rodando não muda de comportamento na
-- migration. Quem quiser encurtar decide na tela.
ALTER TABLE "MullerBotPersona"
  ADD COLUMN IF NOT EXISTS "pausaEntreBaloesMs" INTEGER NOT NULL DEFAULT 4000;
