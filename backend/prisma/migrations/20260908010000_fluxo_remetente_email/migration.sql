-- Endereço de envio POR FLUXO.
--
-- Até aqui o From era UMA env da instância inteira: régua fria e confirmação de
-- pedido saíam do mesmo endereço. Reclamação de spam numa base de 30 mil derruba
-- a reputação do domínio, e quem para de chegar junto é o transacional — o
-- e-mail que sustenta a venda derrubado pelo que prospecta.
--
-- NULL = comportamento de hoje (RESEND_FROM_EMAIL do ambiente). Sem migração de
-- dado: fluxo existente continua saindo de onde saía.
ALTER TABLE "Fluxo" ADD COLUMN IF NOT EXISTS "remetenteEmail" TEXT;
