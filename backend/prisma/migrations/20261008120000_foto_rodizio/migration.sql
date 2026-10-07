-- Rodízio da foto de abertura (Léo, 07/10): o cadastro marca as fotos que
-- podem abrir a vitrine; cada cliente vê uma delas primeiro (sempre a mesma
-- pra ele). Só ADICIONA coluna — nada destrutivo; tudo nasce desmarcado.
ALTER TABLE "CatalogoFoto" ADD COLUMN IF NOT EXISTS "rodizio" BOOLEAN NOT NULL DEFAULT false;
