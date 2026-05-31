/* eslint-disable no-console */
/**
 * Teste de restauração do último backup — NÃO toca o banco de produção.
 *
 *   npx tsx scripts/restore-test.ts
 *
 * Por padrão valida a INTEGRIDADE do último backup com `pg_restore --list`
 * (lê o arquivo inteiro e lista os objetos — se estiver corrompido, falha).
 *
 * Se `RESTORE_TEST_DATABASE_URL` estiver setado, faz uma restauração REAL nesse
 * banco sandbox (cuidado: ele é sobrescrito; jamais aponte pra produção).
 *
 * Pré-requisitos: `pg_restore` no PATH + SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
 */
import { restoreTest } from '../src/modules/backup/backup-core';

restoreTest()
  .then((r) => {
    if (r.ok) {
      const detalhe =
        r.modo === 'restore'
          ? 'restauração real concluída no banco sandbox'
          : `integridade OK · ${r.objetos ?? '?'} objetos no dump`;
      console.log(`✅ Backup válido: ${r.path} (${detalhe})`);
      process.exit(0);
    } else {
      console.error(`❌ Backup INVÁLIDO (${r.path}): ${r.erro}`);
      process.exit(1);
    }
  })
  .catch((err) => {
    console.error('❌ restore-test falhou:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
