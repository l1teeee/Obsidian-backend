import { RowDataPacket, ResultSetHeader } from 'mysql2';
import { pool } from '../../config/db';
import { uid } from '../../lib/uid';
import { env } from '../../config/env';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SocialConnection {
  id:                 string;
  user_id:            string;
  platform:           'facebook' | 'instagram';
  platform_account_id: string;
  account_name:       string;
  account_picture:    string | null;
  access_token:       string;
  token_expires_at:   Date | null;
  page_id:            string | null;
  page_name:          string | null;
  ig_business_id:     string | null;
  scopes:             string;
  created_at:         Date;
  updated_at:         Date;
}

interface SocialConnectionRow extends RowDataPacket, SocialConnection {}

// ─── Facebook API helpers ─────────────────────────────────────────────────────

interface FbMeResponse {
  id:   string;
  name: string;
  picture?: { data: { url: string } };
}

interface FbTokenResponse {
  access_token:  string;
  token_type:    string;
  expires_in?:   number;
}

interface FbPage {
  id:           string;
  name:         string;
  access_token: string;
  instagram_business_account?:  { id: string };
  connected_instagram_account?: { id: string };
}

interface FbPagesResponse {
  data: FbPage[];
}

async function fbGet<T>(path: string, token: string, params: Record<string, string> = {}): Promise<T> {
  const url = new URL(`https://graph.facebook.com/v21.0${path}`);
  url.searchParams.set('access_token', token);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url.toString());
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: { message: string } };
    throw new Error(err.error?.message ?? `Facebook API error ${res.status}`);
  }
  return res.json() as Promise<T>;
}

/**
 * Exchange a short-lived code for a long-lived user access token.
 * Long-lived tokens last ~60 days.
 */
export async function exchangeCodeForToken(code: string): Promise<FbTokenResponse> {
  const url = new URL('https://graph.facebook.com/v21.0/oauth/access_token');
  url.searchParams.set('client_id',     env.FACEBOOK_CLIENT_ID);
  url.searchParams.set('client_secret', env.FACEBOOK_CLIENT_SECRET);
  url.searchParams.set('redirect_uri',  env.FACEBOOK_REDIRECT_URL);
  url.searchParams.set('code',          code);

  const res = await fetch(url.toString());
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: { message: string } };
    throw new Error(err.error?.message ?? `Token exchange failed (${res.status})`);
  }
  return res.json() as Promise<FbTokenResponse>;
}

/**
 * Extend a short-lived token to a long-lived token (~60 days).
 */
export async function extendToken(shortToken: string): Promise<FbTokenResponse> {
  const url = new URL('https://graph.facebook.com/v21.0/oauth/access_token');
  url.searchParams.set('grant_type',        'fb_exchange_token');
  url.searchParams.set('client_id',         env.FACEBOOK_CLIENT_ID);
  url.searchParams.set('client_secret',     env.FACEBOOK_CLIENT_SECRET);
  url.searchParams.set('fb_exchange_token', shortToken);

  const res = await fetch(url.toString());
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: { message: string } };
    throw new Error(err.error?.message ?? `Token extension failed (${res.status})`);
  }
  return res.json() as Promise<FbTokenResponse>;
}

// ─── Service functions ────────────────────────────────────────────────────────

/**
 * Use existing Facebook Page tokens to detect and save linked Instagram accounts.
 * Returns the number of IG accounts upserted.
 */
export async function linkInstagramFromExistingPages(userId: string): Promise<number> {
  const [rows] = await pool.query<SocialConnectionRow[]>(
    `SELECT id, user_id, platform, platform_account_id, account_name, account_picture,
            access_token, token_expires_at, page_id, page_name, ig_business_id, scopes
     FROM social_connections
     WHERE user_id = ? AND platform = 'facebook' AND ig_business_id IS NOT NULL`,
    [userId],
  );

  if (rows.length === 0) return 0;

  let count = 0;
  const dbConn = await pool.getConnection();
  try {
    await dbConn.beginTransaction();

    for (const fbConn of rows) {
      const igAccountId = fbConn.ig_business_id!;
      const pageToken   = fbConn.access_token;

      let igName    = fbConn.page_name ?? 'Instagram';
      let igPicture: string | null = null;

      try {
        const igInfo = await fbGet<{ username?: string; name?: string; profile_picture_url?: string }>(
          `/${igAccountId}`, pageToken, { fields: 'username,name,profile_picture_url' },
        );
        igName    = igInfo.username ?? igInfo.name ?? igName;
        igPicture = igInfo.profile_picture_url ?? null;
      } catch { /* use fallbacks */ }

      const igId = uid();
      await dbConn.query(
        `INSERT INTO social_connections
           (id, user_id, platform, platform_account_id, account_name, account_picture,
            access_token, token_expires_at, page_id, page_name, ig_business_id, scopes)
         VALUES (?, ?, 'instagram', ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           account_name     = VALUES(account_name),
           account_picture  = VALUES(account_picture),
           access_token     = VALUES(access_token),
           token_expires_at = VALUES(token_expires_at),
           page_id          = VALUES(page_id),
           page_name        = VALUES(page_name),
           scopes           = VALUES(scopes),
           updated_at       = CURRENT_TIMESTAMP`,
        [
          igId, userId, igAccountId, igName, igPicture,
          pageToken, null,
          fbConn.page_id, fbConn.page_name, igAccountId,
          'instagram_basic,instagram_content_publish',
        ],
      );
      count++;
    }

    await dbConn.commit();
  } catch (err) {
    await dbConn.rollback();
    throw err;
  } finally {
    dbConn.release();
  }

  return count;
}

export async function listConnections(userId: string): Promise<SocialConnection[]> {
  const [rows] = await pool.query<SocialConnectionRow[]>(
    `SELECT id, user_id, platform, platform_account_id, account_name, account_picture,
            token_expires_at, page_id, page_name, ig_business_id, scopes, created_at, updated_at
     FROM social_connections WHERE user_id = ? AND is_active = 1 ORDER BY created_at ASC`,
    [userId],
  );
  // Don't expose access_token in list
  return rows;
}

export async function deleteConnection(id: string, userId: string): Promise<void> {
  const [result] = await pool.query<ResultSetHeader>(
    'UPDATE social_connections SET is_active = 0, updated_at = NOW() WHERE id = ? AND user_id = ? AND is_active = 1',
    [id, userId],
  );
  if (result.affectedRows === 0) {
    const err = new Error('Connection not found') as Error & { statusCode?: number };
    err.statusCode = 404;
    throw err;
  }
}

/**
 * After receiving the OAuth callback:
 * 1. Exchange code → short-lived token
 * 2. Extend to long-lived token
 * 3. Fetch user profile + pages (+ IG accounts linked to pages)
 * 4. Upsert one row per FB page (platform=facebook) and one per IG account (platform=instagram)
 */
export async function handleFacebookCallback(userId: string, code: string): Promise<void> {
  // 1. Short-lived token
  const shortToken = await exchangeCodeForToken(code);

  // 2. Long-lived token
  const longToken  = await extendToken(shortToken.access_token);

  const userToken    = longToken.access_token;
  const expiresInSec = longToken.expires_in ?? 5_184_000; // 60 days default
  const expiresAt    = new Date(Date.now() + expiresInSec * 1000);

  // 3. User profile
  const me = await fbGet<FbMeResponse>('/me', userToken, {
    fields: 'id,name,picture.type(large)',
  });

  // 4. Pages (+ instagram_business_account + connected_instagram_account for Creator/personal profiles)
  const pagesResp = await fbGet<FbPagesResponse>('/me/accounts', userToken, {
    fields: 'id,name,access_token,instagram_business_account,connected_instagram_account',
  });

  const dbConn = await pool.getConnection();
  try {
    await dbConn.beginTransaction();

    if (pagesResp.data.length === 0) {
      // No Facebook Pages returned — check if user had a previously disconnected row
      // with page_id set (e.g. Facebook API glitch on reconnect) and reactivate it.
      const [existing] = await dbConn.query<SocialConnectionRow[]>(
        `SELECT id FROM social_connections
         WHERE user_id = ? AND platform = 'facebook' AND platform_account_id = ?
           AND page_id IS NOT NULL AND is_active = 0
         ORDER BY updated_at DESC LIMIT 1`,
        [userId, me.id],
      );

      if (existing.length > 0) {
        // Reactivate the previous row, preserving page_id / page_name / ig_business_id
        await dbConn.query(
          `UPDATE social_connections
           SET is_active = 1, access_token = ?, account_name = ?, account_picture = ?,
               token_expires_at = ?, scopes = ?, updated_at = NOW()
           WHERE id = ?`,
          [userToken, me.name, me.picture?.data?.url ?? null, expiresAt,
           'pages_show_list,pages_read_engagement,pages_manage_posts', existing[0].id],
        );
      } else {
        // Truly no pages — save personal FB profile as fallback
        const fbId = uid();
        await dbConn.query(
          `INSERT INTO social_connections
             (id, user_id, platform, platform_account_id, account_name, account_picture,
              access_token, token_expires_at, page_id, page_name, ig_business_id, scopes)
           VALUES (?, ?, 'facebook', ?, ?, ?, ?, ?, NULL, NULL, NULL, ?)
           ON DUPLICATE KEY UPDATE
             account_name     = VALUES(account_name),
             account_picture  = VALUES(account_picture),
             access_token     = VALUES(access_token),
             token_expires_at = VALUES(token_expires_at),
             is_active        = 1,
             scopes           = VALUES(scopes),
             updated_at       = CURRENT_TIMESTAMP`,
          [fbId, userId, me.id, me.name, me.picture?.data?.url ?? null, userToken, expiresAt, 'public_profile,email'],
        );
      }
    }

    for (const page of pagesResp.data) {
      // instagram_business_account → Business account (full API)
      // connected_instagram_account → Creator / personal account linked to this Page
      const igAccountId = page.instagram_business_account?.id ?? page.connected_instagram_account?.id ?? null;

      const fbId = uid();

      await dbConn.query(
        `INSERT INTO social_connections
           (id, user_id, platform, platform_account_id, account_name, account_picture,
            access_token, token_expires_at, page_id, page_name, ig_business_id, scopes)
         VALUES (?, ?, 'facebook', ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           account_name     = VALUES(account_name),
           account_picture  = VALUES(account_picture),
           access_token     = VALUES(access_token),
           token_expires_at = VALUES(token_expires_at),
           page_id          = VALUES(page_id),
           page_name        = VALUES(page_name),
           ig_business_id   = VALUES(ig_business_id),
           is_active        = 1,
           scopes           = VALUES(scopes),
           updated_at       = CURRENT_TIMESTAMP`,
        [
          fbId, userId, me.id, me.name, me.picture?.data?.url ?? null,
          page.access_token, null,
          page.id, page.name, igAccountId,
          'pages_show_list,pages_read_engagement,pages_manage_posts',
        ],
      );

      if (igAccountId) {
        const igId = uid();

        let igName    = page.name;
        let igPicture = me.picture?.data?.url ?? null;
        try {
          const igInfo = await fbGet<{ username?: string; name?: string; profile_picture_url?: string }>(
            `/${igAccountId}`, page.access_token, { fields: 'username,name,profile_picture_url' },
          );
          igName    = igInfo.username ?? igInfo.name ?? page.name;
          igPicture = igInfo.profile_picture_url ?? igPicture;
        } catch { /* use fallbacks */ }

        await dbConn.query(
          `INSERT INTO social_connections
             (id, user_id, platform, platform_account_id, account_name, account_picture,
              access_token, token_expires_at, page_id, page_name, ig_business_id, scopes)
           VALUES (?, ?, 'instagram', ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             account_name     = VALUES(account_name),
             account_picture  = VALUES(account_picture),
             access_token     = VALUES(access_token),
             token_expires_at = VALUES(token_expires_at),
             page_id          = VALUES(page_id),
             page_name        = VALUES(page_name),
             is_active        = 1,
             scopes           = VALUES(scopes),
             updated_at       = CURRENT_TIMESTAMP`,
          [
            igId, userId, igAccountId, igName, igPicture,
            page.access_token, null,
            page.id, page.name, igAccountId,
            'instagram_basic,instagram_content_publish',
          ],
        );
      }
    }

    // Also check Instagram accounts linked directly to the Facebook profile
    // (personal / creator accounts not tied to any Page)
    interface PersonalIgAccount {
      id:                   string;
      name?:                string;
      username?:            string;
      profile_picture_url?: string;
    }
    interface UserIgResponse {
      instagram_accounts?: { data: PersonalIgAccount[] };
    }
    try {
      const userIgResp = await fbGet<UserIgResponse>('/me', userToken, {
        fields: 'instagram_accounts{id,name,username,profile_picture_url}',
      });
      for (const igAcct of userIgResp.instagram_accounts?.data ?? []) {
        const igId = uid();
        await dbConn.query(
          `INSERT INTO social_connections
             (id, user_id, platform, platform_account_id, account_name, account_picture,
              access_token, token_expires_at, page_id, page_name, ig_business_id, scopes)
           VALUES (?, ?, 'instagram', ?, ?, ?, ?, ?, NULL, NULL, ?, ?)
           ON DUPLICATE KEY UPDATE
             account_name     = VALUES(account_name),
             account_picture  = VALUES(account_picture),
             access_token     = VALUES(access_token),
             token_expires_at = VALUES(token_expires_at),
             is_active        = 1,
             scopes           = VALUES(scopes),
             updated_at       = CURRENT_TIMESTAMP`,
          [
            igId, userId,
            igAcct.id,
            igAcct.username ?? igAcct.name ?? 'Instagram',
            igAcct.profile_picture_url ?? null,
            userToken,
            expiresAt,
            igAcct.id,
            'instagram_basic,instagram_content_publish',
          ],
        );
      }
    } catch { /* scope not granted or no accounts — skip silently */ }

    await dbConn.commit();
  } catch (err) {
    await dbConn.rollback();
    throw err;
  } finally {
    dbConn.release();
  }
}
