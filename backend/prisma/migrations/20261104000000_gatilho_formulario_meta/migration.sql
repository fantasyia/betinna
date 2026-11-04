-- Gatilho novo: formulário do Meta recebido, de lead novo ou existente (03/11).
ALTER TYPE "FluxoTriggerTipo" ADD VALUE IF NOT EXISTS 'LEAD_FORMULARIO_META';
