-- Reserva até a NF dos pedidos de marketplace lidos do Magis5 (Ribelt Distribuidora
-- Têxtil; regra do Léo de 25/10, reconfirmada em 14/11).
--
-- Só CRIA (duas tabelas, índices e chaves): o container antigo, que ainda atende
-- durante o deploy, não conhece nada disto. NÃO liga nada: a chave
-- `config.erpInterno.reservaMagis5.ativo` nasce ausente (= desligada) e só o Léo liga.

-- CreateTable
CREATE TABLE "EstoqueReservaMarketplace" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "origem" VARCHAR(20) NOT NULL,
    "pedidoNumero" TEXT NOT NULL,
    "produtoId" TEXT NOT NULL,
    "quantidade" INTEGER NOT NULL,
    "status" "EstoqueReservaStatus" NOT NULL DEFAULT 'CONFIRMADA',
    "movimentoId" TEXT,
    "motivoLiberacao" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EstoqueReservaMarketplace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Magis5SaldoEnviado" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "quantidade" INTEGER NOT NULL,
    "enviadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Magis5SaldoEnviado_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EstoqueReservaMarketplace_empresaId_origem_pedidoNumero_produtoId_key" ON "EstoqueReservaMarketplace"("empresaId", "origem", "pedidoNumero", "produtoId");
CREATE INDEX "EstoqueReservaMarketplace_empresaId_produtoId_status_idx" ON "EstoqueReservaMarketplace"("empresaId", "produtoId", "status");
CREATE INDEX "EstoqueReservaMarketplace_empresaId_status_idx" ON "EstoqueReservaMarketplace"("empresaId", "status");
CREATE UNIQUE INDEX "Magis5SaldoEnviado_empresaId_sku_key" ON "Magis5SaldoEnviado"("empresaId", "sku");

-- AddForeignKey
ALTER TABLE "EstoqueReservaMarketplace" ADD CONSTRAINT "EstoqueReservaMarketplace_produtoId_fkey" FOREIGN KEY ("produtoId") REFERENCES "Produto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Magis5SaldoEnviado" ADD CONSTRAINT "Magis5SaldoEnviado_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;
