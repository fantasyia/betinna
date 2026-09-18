-- O levantamento de campo volta pro PropostaItem, que é onde ele sempre devia
-- estar.
--
-- 🔴 O QUE ACONTECEU (18/09): a migration `20260917230000_levantamento_campo_corrente`
-- criou `quadroPainel`/`tensaoV`/`correnteA` em **PropostaItem** — certo. Mas o
-- `schema.prisma` do mesmo commit declarou os campos em **PedidoItem** — errado.
--
-- No deploy, o fallback `db push` reconcilia o banco com o SCHEMA, não com as
-- migrations. Ele obedeceu: APAGOU as três colunas do PropostaItem e criou as
-- quatro no PedidoItem. Saiu com exit 0 e log de sucesso, e o `_prisma_migrations`
-- seguiu dizendo "aplicada" para as duas migrations de ontem.
--
-- ⚠️ É por isso que esta migration precisa existir em vez de "rodar o deploy de
-- novo": migration marcada como aplicada NÃO roda outra vez. O banco ficou num
-- estado que nenhuma migration descreve e que nada acusa — a proposta técnica
-- (Anexo II) simplesmente não tinha onde guardar quadro, tensão e corrente.
--
-- 📌 As colunas do PedidoItem FICAM, agora de propósito: o pedido é o que chega
-- na produção e na instalação, e quem monta precisa saber a que quadro cada
-- equipamento se destina. Lá é snapshot; a origem é o PropostaItem.
ALTER TABLE "PropostaItem"
  ADD COLUMN IF NOT EXISTS "quadroPainel" TEXT,
  ADD COLUMN IF NOT EXISTS "tensaoV"      INTEGER,
  ADD COLUMN IF NOT EXISTS "correnteA"    INTEGER;

-- O enum já existe (foi criado com o PedidoItem). `IF NOT EXISTS` na coluna
-- deixa esta migration repetível sem erro.
ALTER TABLE "PropostaItem"
  ADD COLUMN IF NOT EXISTS "secaoTecnica" "PropostaSecaoTecnica";
