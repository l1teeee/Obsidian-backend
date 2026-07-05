import { ResultSetHeader, RowDataPacket } from 'mysql2';
import { pool } from '../config/db';
import { extendToken } from '../modules/platforms/platforms.service';
import { encryptToken, decryptToken } from '../lib/crypto';
import { sendTrialEndingSoonEmail, sendTrialExpiredEmail } from '../lib/email';

// ─── Scheduling helpers ───────────────────────────────────────────────────────

interface CronRunRow extends RowDataPacket { last_ran_at: Date }

const DAY  = 24 * 60 * 60 * 1000;
const WEEK = 7 * DAY;

async function isDue(job: string, intervalMs: number): Promise<boolean> {
  const [rows] = await pool.query<CronRunRow[]>(
    'SELECT last_ran_at FROM _cron_runs WHERE job_name = ? LIMIT 1',
    [job],
  );
  if (!rows[0]) return true;
  return Date.now() - rows[0].last_ran_at.getTime() >= intervalMs;
}

async function markDone(job: string): Promise<void> {
  await pool.query(
    'INSERT INTO _cron_runs (job_name, last_ran_at) VALUES (?, NOW()) ON DUPLICATE KEY UPDATE last_ran_at = NOW()',
    [job],
  );
}

// ─── Task 1: refresh expiring platform tokens (daily) ────────────────────────

interface FbTokenRow extends RowDataPacket {
  id:                string;
  user_access_token: string;
}

interface IgTokenRow extends RowDataPacket {
  id:           string;
  access_token: string;
}

async function refreshPlatformTokens(): Promise<void> {
  let refreshed = 0;
  let expired   = 0;

  // Facebook — re-extend the 60-day user token for all active connections
  const [fbRows] = await pool.query<FbTokenRow[]>(
    `SELECT id, user_access_token
     FROM social_connections
     WHERE platform = 'facebook' AND is_active = 1 AND user_access_token IS NOT NULL`,
  );

  for (const row of fbRows) {
    try {
      const current   = decryptToken(row.user_access_token);
      const result    = await extendToken(current);
      await pool.query(
        'UPDATE social_connections SET user_access_token = ?, updated_at = NOW() WHERE id = ?',
        [encryptToken(result.access_token), row.id],
      );
      refreshed++;
    } catch (err) {
      console.error(`[maintenance] FB token expired for connection ${row.id}:`, (err as Error).message);
      await pool.query(
        'UPDATE social_connections SET is_active = 0, updated_at = NOW() WHERE id = ?',
        [row.id],
      );
      expired++;
    }
  }

  // Instagram direct — refresh long-lived tokens expiring within 15 days
  const [igRows] = await pool.query<IgTokenRow[]>(
    `SELECT id, access_token
     FROM social_connections
     WHERE platform = 'instagram' AND is_active = 1
       AND token_expires_at IS NOT NULL
       AND token_expires_at < DATE_ADD(NOW(), INTERVAL 15 DAY)`,
  );

  for (const row of igRows) {
    try {
      const current = decryptToken(row.access_token);
      const url     = new URL('https://graph.instagram.com/refresh_access_token');
      url.searchParams.set('grant_type',   'ig_refresh_token');
      url.searchParams.set('access_token', current);

      const res = await fetch(url.toString());
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: { message: string } };
        throw new Error(body.error?.message ?? `Instagram refresh failed (${res.status})`);
      }
      const data      = await res.json() as { access_token: string; expires_in: number };
      const newExpiry = new Date(Date.now() + (data.expires_in ?? 5_184_000) * 1000);

      await pool.query(
        'UPDATE social_connections SET access_token = ?, token_expires_at = ?, updated_at = NOW() WHERE id = ?',
        [encryptToken(data.access_token), newExpiry, row.id],
      );
      refreshed++;
    } catch (err) {
      console.error(`[maintenance] IG token expired for connection ${row.id}:`, (err as Error).message);
      await pool.query(
        'UPDATE social_connections SET is_active = 0, updated_at = NOW() WHERE id = ?',
        [row.id],
      );
      expired++;
    }
  }

  console.log(`[maintenance] tokens: ${refreshed} refreshed, ${expired} marked inactive`);
}

// ─── Task 2: clean up stale auth data (weekly) ───────────────────────────────

async function cleanupAuth(): Promise<void> {
  const [rt] = await pool.query<ResultSetHeader>(
    'DELETE FROM refresh_tokens WHERE expires_at < DATE_SUB(NOW(), INTERVAL 1 DAY)',
  );
  const [otp] = await pool.query<ResultSetHeader>(
    'UPDATE users SET password_reset_otp = NULL, password_reset_expires_at = NULL WHERE password_reset_expires_at IS NOT NULL AND password_reset_expires_at < NOW()',
  );
  const [inv] = await pool.query<ResultSetHeader>(
    "UPDATE admin_invitations SET status = 'expired' WHERE status = 'pending' AND expires_at < NOW()",
  );
  const [ghost] = await pool.query<ResultSetHeader>(
    'DELETE FROM users WHERE email_verified = 0 AND is_active = 0 AND created_at < DATE_SUB(NOW(), INTERVAL 7 DAY)',
  );

  console.log(
    `[maintenance] cleanup: ${rt.affectedRows} tokens, ${otp.affectedRows} OTPs, ` +
    `${inv.affectedRows} invites expired, ${ghost.affectedRows} unverified users removed`,
  );
}

// ─── Task 3: trial reminder / expiry emails (daily) ──────────────────────────

interface TrialUserRow extends RowDataPacket {
  id:            string;
  email:         string;
  name:          string | null;
  trial_ends_at: Date;
}

async function sendTrialEmails(): Promise<void> {
  let reminders   = 0;
  let expirations = 0;

  // Reminder: trial ends within 3 days. plan_status = 'trialing' excludes
  // anyone who already subscribed (confirm/webhook set it to 'active').
  const [ending] = await pool.query<TrialUserRow[]>(
    `SELECT id, email, name, trial_ends_at
       FROM users
      WHERE plan_status = 'trialing'
        AND is_admin = 0
        AND email_verified = 1
        AND trial_ends_at BETWEEN NOW() AND DATE_ADD(NOW(), INTERVAL 3 DAY)
        AND trial_reminder_sent = 0`,
  );
  for (const user of ending) {
    try {
      const daysLeft = Math.max(1, Math.ceil((user.trial_ends_at.getTime() - Date.now()) / DAY));
      await sendTrialEndingSoonEmail(user.email, {
        ...(user.name && { name: user.name }),
        daysLeft,
      });
      await pool.query('UPDATE users SET trial_reminder_sent = 1 WHERE id = ?', [user.id]);
      reminders++;
    } catch (err) {
      // Flag stays 0 — retried on the next daily run
      console.error(`[maintenance] trial reminder failed for ${user.id}:`, (err as Error).message);
    }
  }

  const [expired] = await pool.query<TrialUserRow[]>(
    `SELECT id, email, name, trial_ends_at
       FROM users
      WHERE plan_status = 'trialing'
        AND is_admin = 0
        AND email_verified = 1
        AND trial_ends_at < NOW()
        AND trial_expired_notified = 0`,
  );
  for (const user of expired) {
    try {
      await sendTrialExpiredEmail(user.email, {
        ...(user.name && { name: user.name }),
      });
      await pool.query('UPDATE users SET trial_expired_notified = 1 WHERE id = ?', [user.id]);
      expirations++;
    } catch (err) {
      console.error(`[maintenance] trial expiry email failed for ${user.id}:`, (err as Error).message);
    }
  }

  console.log(`[maintenance] trial emails: ${reminders} reminders, ${expirations} expirations`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log(`[maintenance] started at ${new Date().toISOString()}`);
  try {
    if (await isDue('refresh-platform-tokens', DAY)) {
      await refreshPlatformTokens();
      await markDone('refresh-platform-tokens');
    }
    if (await isDue('cleanup-auth', WEEK)) {
      await cleanupAuth();
      await markDone('cleanup-auth');
    }
    if (await isDue('trial-emails', DAY)) {
      await sendTrialEmails();
      await markDone('trial-emails');
    }
  } catch (err) {
    console.error('[maintenance] fatal:', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
