-- Pedido.numeroOmie passa a ser único POR EMPRESA (antes era único GLOBAL).
--
-- Seguro: a regra nova é MAIS FROUXA que a antiga (que já garantia unicidade
-- global). Logo, todo dado existente já satisfaz a nova trava — o CREATE da
-- unique não pode falhar por duplicidade. Permite que duas empresas distintas
-- tenham um pedido com o mesmo numeroOmie (cada uma tem sua própria conta OMIE).

-- DropIndex (unique global antigo, gerado pelo @unique de campo)
DROP INDEX IF EXISTS "Pedido_numeroOmie_key";

-- CreateIndex (unique composto por empresa)
CREATE UNIQUE INDEX "Pedido_empresaId_numeroOmie_key" ON "Pedido"("empresaId", "numeroOmie");
