/* eslint-disable no-console */
/**
 * Backup manual do banco → Supabase Storage.
 *
 * Em produção o backup roda sozinho (cron `backup-diario` 03:00 UTC no Worker).
 * Este script é pro disparo MANUAL / emergência:
 *
 *   npx tsx scripts/backup-to-storage.ts
 *
 * A lógica vive em `src/modules/backup/backup-core.ts` (fonte única, também
 * usada pelo cron). Pré-requisitos: `pg_dump` no PATH + env DIRECT_URL/
 * DATABASE_URL + SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
 */
import { runBackup } from '../src/modules/backup/backup-core';

runBackup()
  .then((r) => {
    const mb = (r.bytes / 1024 / 1024).toFixed(2);
    console.log(`✅ Backup OK: ${r.path} (${mb} MB em ${r.durationMs}ms)`);
    process.exit(0);
  })
  .catch((err) => {
    console.error('❌ Backup falhou:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
