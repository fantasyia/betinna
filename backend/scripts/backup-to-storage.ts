/* eslint-disable no-console */
/**
 * Backup script — DB → Supabase Storage.
 *
 * Standalone (não precisa NestJS rodando). Pode ser invocado:
 *  - Local: `npx tsx scripts/backup-to-storage.ts`
 *  - CI: GitHub Action chamando o mesmo script
 *  - Manual de emergência (DBA)
 *
 * Fluxo:
 *  1. Executa `pg_dump` com format custom (`-Fc`) + compressão máxima (`-Z9`)
 *  2. Upload pro bucket `db-backups` no Supabase Storage (privado)
 *  3. Lista backups existentes e apaga os com >30 dias (retention)
 *
 * Pré-requisitos:
 *  - `pg_dump` no PATH (instalado por default em Postgres client)
 *  - Env vars: DATABASE_URL (ou DIRECT_URL), SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *
 * Output: imprime o storage path do backup criado.
 * Exit code: 0 sucesso, 1 falha (qualquer etapa).
 */

import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const BUCKET = 'db-backups';
const RETENTION_DAYS = Number(process.env.BACKUP_RETENTION_DAYS ?? '30');

interface BackupResult {
  path: string;
  bytes: number;
  durationMs: number;
}

async function pgDump(connectionString: string, outFile: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(
      'pg_dump',
      [
        '--dbname',
        connectionString,
        '--format',
        'custom',
        '--compress',
        '9',
        '--no-owner',
        '--no-acl',
        '--file',
        outFile,
      ],
      { stdio: ['ignore', 'inherit', 'inherit'] },
    );
    proc.on('error', reject);
    proc.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`pg_dump saiu com código ${code}`));
    });
  });
}

async function uploadBackup(file: string, storagePath: string): Promise<number> {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    throw new Error('SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórios');
  }

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Garante bucket
  const { data: buckets } = await supabase.storage.listBuckets();
  if (!buckets?.some((b) => b.name === BUCKET)) {
    const { error } = await supabase.storage.createBucket(BUCKET, {
      public: false,
      // fileSizeLimit não permite undefined; deixa default (gigantes ok)
    });
    if (error && !error.message.includes('already exists')) {
      throw new Error(`Falha criando bucket ${BUCKET}: ${error.message}`);
    }
  }

  const buf = readFileSync(file);
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, buf, {
      contentType: 'application/octet-stream',
      upsert: false,
    });
  if (error) {
    throw new Error(`Upload falhou: ${error.message}`);
  }
  return buf.length;
}

async function applyRetention(): Promise<{ apagados: number }> {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return { apagados: 0 };
  }
  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const { data: files, error } = await supabase.storage.from(BUCKET).list('', {
    limit: 1000,
    sortBy: { column: 'created_at', order: 'asc' },
  });
  if (error || !files) return { apagados: 0 };

  const toDelete = files
    .filter((f) => f.created_at && new Date(f.created_at).getTime() < cutoff)
    .map((f) => f.name);

  if (toDelete.length === 0) return { apagados: 0 };

  const { error: delErr } = await supabase.storage.from(BUCKET).remove(toDelete);
  if (delErr) {
    console.warn(`Retention parcial — alguns arquivos não foram apagados: ${delErr.message}`);
  }
  return { apagados: toDelete.length };
}

async function main(): Promise<BackupResult> {
  const started = Date.now();
  const conn = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
  if (!conn) {
    throw new Error('DIRECT_URL ou DATABASE_URL é obrigatório');
  }

  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const tmpDir = mkdtempSync(join(tmpdir(), 'betinna-backup-'));
  const fileName = `betinna-${ts}.dump`;
  const filePath = join(tmpDir, fileName);

  try {
    console.log(`→ pg_dump iniciado: ${fileName}`);
    await pgDump(conn, filePath);

    const yearMonth = new Date().toISOString().slice(0, 7); // 2026-05
    const storagePath = `${yearMonth}/${fileName}`;

    console.log(`→ Upload pra ${BUCKET}/${storagePath}`);
    const bytes = await uploadBackup(filePath, storagePath);

    const { apagados } = await applyRetention();
    if (apagados > 0) {
      console.log(`→ Retention aplicada: ${apagados} backup(s) > ${RETENTION_DAYS}d apagados`);
    }

    return { path: storagePath, bytes, durationMs: Date.now() - started };
  } finally {
    // Limpa temp dir
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

main()
  .then((r) => {
    const mb = (r.bytes / 1024 / 1024).toFixed(2);
    console.log(`✅ Backup OK: ${r.path} (${mb} MB em ${r.durationMs}ms)`);
    process.exit(0);
  })
  .catch((err) => {
    console.error('❌ Backup falhou:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
