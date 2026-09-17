-- Preço PROMOCIONAL do ERP (`precos.precoPromocional` do Tiny).
--
-- O preço de tabela do MB-01/02/03 vai SUBIR no ERP e o valor de hoje vira
-- promoção (Léo, 17/09/2026). Sem este campo, o sync das 13:00 BRT espelharia o
-- preço novo em `precoTabela` e a loja passaria a vender por ele — sem erro em
-- lugar nenhum, sem alarme, com a venda saindo pelo valor errado.
--
-- 🔴 NULLABLE de propósito, e ausente/0 do ERP grava NULL, nunca 0: "sem
-- promoção" e "promoção de R$ 0" são fatos diferentes, e confundi-los faz a loja
-- anunciar de graça.
--
-- Aditivo: nenhum produto existente muda de comportamento (todos nascem null =
-- sem promoção, que é o estado de hoje).
ALTER TABLE "Produto"
  ADD COLUMN IF NOT EXISTS "precoPromocional" DECIMAL(14,2);
