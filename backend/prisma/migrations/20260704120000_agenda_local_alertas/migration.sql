-- AgendaItem: campos estilo Google Calendar
--   local   = endereço/local do compromisso (→ location no Google)
--   alertas = lembretes em MINUTOS antes do início (→ reminders.overrides no Google)
ALTER TABLE "AgendaItem" ADD COLUMN "local" TEXT;
ALTER TABLE "AgendaItem" ADD COLUMN "alertas" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[];
