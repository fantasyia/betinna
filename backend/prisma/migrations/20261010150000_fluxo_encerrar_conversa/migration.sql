-- Ação de fluxo nova: ENCERRAR_CONVERSA (fecha a conversa do lead — RESOLVIDA).
-- Ribelt, 10/10: lead em Perdido/Nutrição não acumula conversa aberta.
ALTER TYPE "FluxoAcaoTipo" ADD VALUE IF NOT EXISTS 'ENCERRAR_CONVERSA';
