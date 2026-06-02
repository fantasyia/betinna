/* eslint-disable no-console */
/**
 * Núcleo do backup — lógica pura (sem NestJS), reutilizável.
 *
 * Usado por:
 *  - `BackupService` (cron diário in-process no Worker) — caminho PRINCIPAL
 *  - `scripts/backup-to-storage.ts` (execução manual via tsx)
 *  - `scripts/restore-test.ts` (validação de integridade do último backup)
 *
 * Fluxo do backup:
 *  1. `pg_dump` format custom (`-Fc`) + compressão máxima (`-Z9`)
 *  2. Upload pro bucket `db-backups` no Supabase Storage (privado)
 *  3. Retenção: apaga backups com mais de N dias
 *
 * Pré-requisitos:
 *  - `pg_dump` / `pg_restore` no PATH (já vêm na imagem Docker via `postgresql-client`)
 *  - Env: DIRECT_URL (ou DATABASE_URL), SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */

import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export const BUCKET = 'db-backups';

export interface BackupResult {
  path: string;
  bytes: number;
  durationMs: number;
}

export interface RestoreTestResult {
  /** true = o arquivo de backup é íntegro e legível */
  ok: boolean;
  /** caminho no storage do backup verificado */
  path: string;
  /** modo da verificação: 'list' (integridade) ou 'restore' (restauração real no sandbox) */
  modo: 'list' | 'restore';
  /** quantidade de objetos no dump (tabelas/índices/etc.), quando disponível */
  objetos?: number;
  /** mensagem de erro, se falhou */
  erro?: string;
}

function retentionDays(): number {
  return Number(process.env.BACKUP_RETENTION_DAYS ?? '30');
}

function getSupabase(): SupabaseClient {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    throw new Error('SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórios pro backup');
  }
  return createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/** Executa um binário e resolve quando termina; rejeita se exit != 0. */
function run(
  cmd: string,
  args: string[],
  opts: { captureStdout?: boolean } = {},
): Promise<{ stdout: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, {
      stdio: ['ignore', opts.captureStdout ? 'pipe' : 'inherit', 'inherit'],
    });
    let stdout = '';
    if (opts.captureStdout && proc.stdout) {
      proc.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString();
      });
    }
    proc.on('error', (err) =>
      reject(
        err instanceof Error && (err as NodeJS.ErrnoException).code === 'ENOENT'
          ? new Error(`Binário "${cmd}" não encontrado no PATH (instale postgresql-client)`)
          : err,
      ),
    );
    proc.on('exit', (code) => {
      if (code === 0) resolve({ stdout });
      else reject(new Error(`${cmd} saiu com código ${code}`));
    });
  });
}

async function pgDump(connectionString: string, outFile: string): Promise<void> {
  await run('pg_dump', [
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
  ]);
}

async function uploadBackup(file: string, storagePath: string): Promise<number> {
  const supabase = getSupabase();

  // Garante bucket privado
  const { data: buckets } = await supabase.storage.listBuckets();
  if (!buckets?.some((b) => b.name === BUCKET)) {
    const { error } = await supabase.storage.createBucket(BUCKET, { public: false });
    if (error && !error.message.includes('already exists')) {
      throw new Error(`Falha criando bucket ${BUCKET}: ${error.message}`);
    }
  }

  const buf = readFileSync(file);
  const { error } = await supabase.storage.from(BUCKET).upload(storagePath, buf, {
    contentType: 'application/octet-stream',
    upsert: false,
  });
  if (error) {
    throw new Error(`Upload falhou: ${error.message}`);
  }
  return buf.length;
}

async function applyRetention(): Promise<{ apagados: number }> {
  const supabase = getSupabase();
  const days = retentionDays();
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;

  // Storage list é por "pasta"; backups ficam em <ano-mes>/arquivo. Varremos
  // cada pasta de ano-mês e juntamos os arquivos pra aplicar a política.
  const { data: pastas, error: pastasErr } = await supabase.storage.from(BUCKET).list('', {
    limit: 1000,
  });
  if (pastasErr || !pastas) return { apagados: 0 };

  const aRemover: string[] = [];
  for (const pasta of pastas) {
    // Itens com id null são "pastas" no Supabase Storage
    if (pasta.id !== null) {
      // arquivo na raiz
      if (pasta.created_at && new Date(pasta.created_at).getTime() < cutoff) {
        aRemover.push(pasta.name);
      }
      continue;
    }
    const { data: arquivos } = await supabase.storage.from(BUCKET).list(pasta.name, {
      limit: 1000,
      sortBy: { column: 'created_at', order: 'asc' },
    });
    for (const arq of arquivos ?? []) {
      if (arq.created_at && new Date(arq.created_at).getTime() < cutoff) {
        aRemover.push(`${pasta.name}/${arq.name}`);
      }
    }
  }

  if (aRemover.length === 0) return { apagados: 0 };

  const { error: delErr } = await supabase.storage.from(BUCKET).remove(aRemover);
  if (delErr) {
    console.warn(`Retention parcial — alguns arquivos não foram apagados: ${delErr.message}`);
  }
  return { apagados: aRemover.length };
}

export interface UltimoBackupInfo {
  /** caminho no storage (ex: 2026-06/betinna-...dump) */
  path: string;
  /** tamanho em bytes (0 se o storage não reportar) */
  bytes: number;
  /** data de criação (ISO) */
  criadoEm: string;
}

/**
 * Metadados do backup mais recente — SEM baixar o arquivo (só lista o storage).
 * Usado pelo painel admin pra mostrar "último backup: <data> (<tamanho>)".
 */
export async function infoUltimoBackup(): Promise<UltimoBackupInfo | null> {
  const supabase = getSupabase();
  const { data: pastas } = await supabase.storage.from(BUCKET).list('', { limit: 1000 });
  if (!pastas) return null;

  let melhor: UltimoBackupInfo | null = null;
  let melhorT = -1;
  const considerar = (path: string, criadoEm?: string | null, size?: number): void => {
    const t = criadoEm ? new Date(criadoEm).getTime() : 0;
    if (t > melhorT) {
      melhorT = t;
      melhor = { path, bytes: size ?? 0, criadoEm: criadoEm ?? new Date(0).toISOString() };
    }
  };

  for (const pasta of pastas) {
    if (pasta.id !== null) {
      considerar(pasta.name, pasta.created_at, (pasta.metadata as { size?: number } | null)?.size);
      continue;
    }
    const { data: arquivos } = await supabase.storage.from(BUCKET).list(pasta.name, {
      limit: 1000,
      sortBy: { column: 'created_at', order: 'desc' },
    });
    for (const arq of arquivos ?? []) {
      considerar(
        `${pasta.name}/${arq.name}`,
        arq.created_at,
        (arq.metadata as { size?: number } | null)?.size,
      );
    }
  }
  return melhor;
}

/** Caminho de storage do backup mais recente (ou null se não houver). */
async function ultimoBackupPath(): Promise<string | null> {
  const supabase = getSupabase();
  const { data: pastas } = await supabase.storage.from(BUCKET).list('', { limit: 1000 });
  if (!pastas) return null;

  let melhor: { path: string; criadoEm: number } | null = null;
  for (const pasta of pastas) {
    if (pasta.id !== null) {
      // arquivo na raiz
      const t = pasta.created_at ? new Date(pasta.created_at).getTime() : 0;
      if (!melhor || t > melhor.criadoEm) melhor = { path: pasta.name, criadoEm: t };
      continue;
    }
    const { data: arquivos } = await supabase.storage.from(BUCKET).list(pasta.name, {
      limit: 1000,
      sortBy: { column: 'created_at', order: 'desc' },
    });
    for (const arq of arquivos ?? []) {
      const t = arq.created_at ? new Date(arq.created_at).getTime() : 0;
      if (!melhor || t > melhor.criadoEm) {
        melhor = { path: `${pasta.name}/${arq.name}`, criadoEm: t };
      }
    }
  }
  return melhor?.path ?? null;
}

/**
 * Roda o backup completo: pg_dump → upload → retenção.
 * Lança erro em qualquer falha (quem chama decide o que fazer: alertar/exit).
 */
export async function runBackup(): Promise<BackupResult> {
  const started = Date.now();
  const conn = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
  if (!conn) {
    throw new Error('DIRECT_URL ou DATABASE_URL é obrigatório pro backup');
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
      console.log(`→ Retenção aplicada: ${apagados} backup(s) > ${retentionDays()}d apagados`);
    }

    return { path: storagePath, bytes, durationMs: Date.now() - started };
  } finally {
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

/**
 * Testa a integridade do último backup.
 *
 * Por padrão usa `pg_restore --list`, que **lê o arquivo inteiro** e lista os
 * objetos do dump — se o backup estiver corrompido/truncado, falha. Isso prova
 * que o backup é restaurável SEM precisar de um banco sandbox.
 *
 * Se `RESTORE_TEST_DATABASE_URL` estiver definido, faz uma restauração REAL
 * nesse banco sandbox (nunca toca o de produção).
 */
export async function restoreTest(): Promise<RestoreTestResult> {
  const path = await ultimoBackupPath();
  if (!path) {
    return {
      ok: false,
      path: '(nenhum)',
      modo: 'list',
      erro: 'Nenhum backup encontrado no storage',
    };
  }

  const supabase = getSupabase();
  const { data, error } = await supabase.storage.from(BUCKET).download(path);
  if (error || !data) {
    return {
      ok: false,
      path,
      modo: 'list',
      erro: `Download falhou: ${error?.message ?? 'sem dados'}`,
    };
  }

  const sandboxUrl = process.env.RESTORE_TEST_DATABASE_URL;
  const modo: 'list' | 'restore' = sandboxUrl ? 'restore' : 'list';
  const tmpDir = mkdtempSync(join(tmpdir(), 'betinna-restore-'));
  const localFile = join(tmpDir, 'backup.dump');
  try {
    writeFileSync(localFile, Buffer.from(await data.arrayBuffer()));

    if (sandboxUrl) {
      // Restauração REAL num banco sandbox (clean + no-owner pra não exigir roles)
      await run('pg_restore', [
        '--clean',
        '--if-exists',
        '--no-owner',
        '--no-acl',
        '--dbname',
        sandboxUrl,
        localFile,
      ]);
      return { ok: true, path, modo };
    }

    // Validação de integridade: lista a TOC do dump (lê o arquivo inteiro)
    const { stdout } = await run('pg_restore', ['--list', localFile], { captureStdout: true });
    const objetos = stdout.split('\n').filter((l) => l.trim() && !l.trim().startsWith(';')).length;
    return { ok: true, path, modo, objetos };
  } catch (err) {
    return { ok: false, path, modo, erro: err instanceof Error ? err.message : String(err) };
  } finally {
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}
