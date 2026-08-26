require('dotenv').config({ path: '.env.local' });
const { Queue } = require('bullmq');
const IORedis = require('ioredis');
(async () => {
  const url = process.env.REDIS_URL;
  const conn = new IORedis(url, { maxRetriesPerRequest: null, tls: url.startsWith('rediss') ? {} : undefined });
  const q = new Queue('fluxo-execucao', { connection: conn });
  for (let i = 0; i < 40; i++) {
    const w = await q.getWorkers();
    if (w.length > 0) { console.log('WORKER VOLTOU:', w.length, 'conectado(s)'); break; }
    await new Promise((r) => setTimeout(r, 15000));
  }
  await q.close(); conn.disconnect();
})();
