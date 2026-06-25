/**
 * api e worker carregam o MESMO AppModule. Os workers BullMQ (@Processor) e os crons
 * (ScheduleModule) só devem rodar no processo WORKER em produção — senão a API também consome
 * jobs da fila e dispara os crons (desperdício de CPU competindo com o tráfego HTTP, e
 * duplicação se o CronLock falhar). Em dev/test (processo único) tudo roda no mesmo processo.
 *
 * SERVICE_TYPE vem do ambiente (Railway / scripts/start.js), já setado quando o AppModule é
 * carregado. (#9/#16 da re-auditoria 2026-06)
 */
export const RODAR_BACKGROUND =
  process.env.SERVICE_TYPE === 'worker' || process.env.NODE_ENV !== 'production';
