import { pool } from '../config/db';
import { runScheduledPublishing } from '../modules/posts/posts.service';

async function main(): Promise<void> {
  const startedAt = new Date().toISOString();
  console.log(`[cron] publish-scheduled started at ${startedAt}`);

  try {
    const stats = await runScheduledPublishing();
    console.log(
      `[cron] done — processed: ${stats.processed}, succeeded: ${stats.succeeded}, failed: ${stats.failed}`,
    );
  } catch (err) {
    console.error('[cron] fatal error:', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
