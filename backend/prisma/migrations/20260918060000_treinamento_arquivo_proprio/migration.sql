-- TREINAMENTO PODE VIR DE DUAS FONTES (decisão do Léo, 18/09).
--
-- YouTube continua sendo o padrão — banda e transcodificação por conta deles,
-- custo zero pra nós. O que ele NÃO dá é controle de acesso: "não listado" some
-- da busca, mas quem tiver o link assiste, logado ou não.
--
-- Por isso entra a segunda fonte: arquivo no nosso Storage, servido por link
-- ASSINADO que expira. Custa banda nossa a cada exibição e não troca de
-- qualidade sozinho em rede ruim — por isso é a exceção, não o padrão.
--
-- 🔴 O critério de escolha é por vídeo: se este vídeo vazar pra um concorrente,
-- isso custa alguma coisa? Pitch, margem e processo custam; "como instalar"
-- normalmente não.
CREATE TYPE "TreinamentoFonte" AS ENUM ('YOUTUBE', 'ARQUIVO');

ALTER TABLE "Treinamento"
  ADD COLUMN IF NOT EXISTS "fonte" "TreinamentoFonte" NOT NULL DEFAULT 'YOUTUBE',
  -- Guardamos o PATH no bucket, nunca a URL: a URL de leitura é assinada e
  -- expira, então gravá-la criaria um link permanente pra um arquivo que
  -- deveria exigir login — exatamente o problema que esta fonte veio resolver.
  ADD COLUMN IF NOT EXISTS "arquivoPath"    TEXT,
  ADD COLUMN IF NOT EXISTS "arquivoTamanho" INTEGER,
  ADD COLUMN IF NOT EXISTS "arquivoTipo"    TEXT;

-- `youtubeId` deixa de ser obrigatório: treinamento de arquivo não tem um.
-- Os que já existem continuam válidos — todos são YOUTUBE e têm o id preenchido.
ALTER TABLE "Treinamento" ALTER COLUMN "youtubeId" DROP NOT NULL;

-- Coerência entre fonte e conteúdo, no BANCO e não só no serviço.
--
-- ⚠️ Sem isto, um bug no serviço grava um treinamento YOUTUBE sem `youtubeId` e
-- o defeito só aparece na frente do funcionário, como um player em branco: a
-- lista carrega, o card aparece, e o erro é silencioso até alguém clicar.
ALTER TABLE "Treinamento"
  DROP CONSTRAINT IF EXISTS "Treinamento_fonte_conteudo_check";
ALTER TABLE "Treinamento"
  ADD CONSTRAINT "Treinamento_fonte_conteudo_check" CHECK (
    ("fonte" = 'YOUTUBE' AND "youtubeId"   IS NOT NULL) OR
    ("fonte" = 'ARQUIVO' AND "arquivoPath" IS NOT NULL)
  );
