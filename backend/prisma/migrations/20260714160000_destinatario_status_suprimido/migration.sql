-- Supressão LGPD nas campanhas: destinatário com a tag "Não Reabordar - LGPD ⛔"
-- não é enviado e passa a ter status próprio (não vira ERRO no relatório).
ALTER TYPE "DestinatarioStatus" ADD VALUE IF NOT EXISTS 'SUPRIMIDO';
