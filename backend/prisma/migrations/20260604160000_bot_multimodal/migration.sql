-- Bot multimodal: transcrição de áudio + visão de imagem. Aditivo.
ALTER TABLE "MullerBotPersona"
  ADD COLUMN "transcreverAudio" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "analisarImagem" BOOLEAN NOT NULL DEFAULT false;
