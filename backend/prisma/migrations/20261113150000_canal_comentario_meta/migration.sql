-- Comentários de Facebook (Página) e Instagram viram conversa no inbox (13/11):
-- canal próprio, porque a resposta sai por outro endpoint (comentário público),
-- não pelo Direct/Messenger.
ALTER TYPE "MessageChannel" ADD VALUE IF NOT EXISTS 'FACEBOOK_COMENTARIO';
ALTER TYPE "MessageChannel" ADD VALUE IF NOT EXISTS 'INSTAGRAM_COMENTARIO';
