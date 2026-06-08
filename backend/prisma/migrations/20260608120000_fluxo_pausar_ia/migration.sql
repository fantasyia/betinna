-- Ação de fluxo nova: PAUSAR_IA (desliga o bot na conversa do lead).
-- Aditivo e seguro: só acrescenta um valor ao enum, não toca em dado.
ALTER TYPE "FluxoAcaoTipo" ADD VALUE IF NOT EXISTS 'PAUSAR_IA';
