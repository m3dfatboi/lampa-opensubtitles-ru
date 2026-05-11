// Аварийная отмена всех активных переводов с возвратом кредитов.
// Запускать как: cd /opt/lampa-opensubtitles/service && node scripts/abort-active-jobs.mjs
import { createConfig } from '../src/config.js';
import { Store } from '../src/db.js';

const config = createConfig(process.cwd());
const store = new Store(config.dbPath, config);

const active = store.db
  .prepare("SELECT * FROM translations WHERE status IN ('queued', 'in_progress', 'running', 'processing')")
  .all();

console.log(`Найдено активных переводов: ${active.length}`);

for (const row of active) {
  const job = {
    id: row.id,
    user_id: row.user_id,
    cache_key: row.cache_key,
    credits_reserved: row.credits_reserved || 0
  };
  console.log(`  → job ${job.id} (user ${job.user_id}, ${job.credits_reserved} кр.)`);
  try { store.failJob(job, 'aborted by admin'); }
  catch (error) { console.error(`     не удалось: ${error.message}`); }
}

console.log('Готово. Кредиты возвращены через ledger.');
store.close();
