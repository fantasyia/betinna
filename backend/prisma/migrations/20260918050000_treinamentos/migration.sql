-- ABA DE TREINAMENTOS (pedido do Léo, 18/09): onde a empresa põe os vídeos
-- internos para o funcionário assistir.
--
-- 📌 Guarda o PONTEIRO, não o vídeo. O arquivo vive no YouTube e é servido por
-- ele — aqui ficam título, descrição, categoria e ordem. Foi escolha pelo motivo
-- certo: vídeo é o que deixa plataforma pesada e cara, e o YouTube já resolve
-- isso de graça.
--
-- ⚠️ O vídeo tem que ser NÃO LISTADO, não "privado": não listado some da busca e
-- do canal mas EMBEDA; privado não embeda. A URL é idêntica nos dois casos, então
-- o sintoma de errar é o funcionário ver "vídeo indisponível".
--
-- Aditivo: tabela nova, nada existente muda.
CREATE TABLE IF NOT EXISTS "Treinamento" (
  "id"           TEXT         NOT NULL,
  "empresaId"    TEXT         NOT NULL,
  "titulo"       TEXT         NOT NULL,
  "descricao"    TEXT,
  -- O ID de 11 caracteres, nunca a URL colada.
  "youtubeId"    TEXT         NOT NULL,
  "categoria"    TEXT,
  "ordem"        INTEGER      NOT NULL DEFAULT 0,
  "ativo"        BOOLEAN      NOT NULL DEFAULT true,
  "criadoPorId"  TEXT,
  "criadoEm"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "atualizadoEm" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Treinamento_pkey" PRIMARY KEY ("id")
);

-- A listagem da tela é sempre por empresa + ativos + ordem.
CREATE INDEX IF NOT EXISTS "Treinamento_empresaId_ativo_ordem_idx"
  ON "Treinamento"("empresaId", "ativo", "ordem");

-- CASCADE na empresa (o tenant sai, os treinamentos dele saem junto);
-- SET NULL no autor, porque quem cadastrou pode deixar a empresa e o vídeo fica.
ALTER TABLE "Treinamento"
  ADD CONSTRAINT "Treinamento_empresaId_fkey"
  FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Treinamento"
  ADD CONSTRAINT "Treinamento_criadoPorId_fkey"
  FOREIGN KEY ("criadoPorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;
