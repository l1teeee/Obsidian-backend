import { RowDataPacket, ResultSetHeader } from 'mysql2';
import { pool } from '../../config/db';
import { uid } from '../../lib/uid';
import { env } from '../../config/env';
import { cache } from '../../lib/cache';
import { encryptToken, decryptToken } from '../../lib/crypto';
import { sendPlatformConnectedEmail } from '../../lib/email';

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
  account_type:       string | null;
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
/**
 * Tries to resolve the Instagram account ID linked to a Facebook page.
 * Handles both classic pages (ig_business_id already in DB) and New Pages Experience (NPE)
 * pages that don't return IG info via /me/accounts.
 *
 * Resolution order:
 *  1. ig_business_id already stored in the FB row
 *  2. GET /{page_id}?fields=instagram_business_account  (NPE business)
 *  3. GET /{page_id}?fields=connected_instagram_account (NPE creator)
 *  4. GET /me/instagram_accounts                        (personal IG linked to page token)
 */
async function resolveIgAccountId(
  pageId:     string | null,
  pageToken:  string,
  storedIgId: string | null,
): Promise<string | null> {
  // 1. Already stored
  if (storedIgId) return storedIgId;
  if (!pageId) return null;

  // 2. instagram_business_account (NPE business pages)
  try {
    const res = await fbGet<{ instagram_business_account?: { id: string } }>(
      `/${pageId}`, pageToken, { fields: 'instagram_business_account' },
    );
    if (res.instagram_business_account?.id) return res.instagram_business_account.id;
  } catch { /* try next */ }

  // 3. connected_instagram_account (NPE creator pages)
  try {
    const res = await fbGet<{ connected_instagram_account?: { id: string } }>(
      `/${pageId}`, pageToken, { fields: 'connected_instagram_account' },
    );
    if (res.connected_instagram_account?.id) return res.connected_instagram_account.id;
  } catch { /* try next */ }

  // 4. /me/instagram_accounts with the page token
  try {
    const res = await fbGet<{ data?: { id: string }[] }>(
      '/me/instagram_accounts', pageToken,
    );
    if (res.data && res.data.length > 0) return res.data[0].id;
  } catch { /* no IG found */ }

  return null;
}

export async function linkInstagramFromExistingPages(userId: string, workspaceId?: string | null): Promise<number> {
  const [rows] = await pool.query<SocialConnectionRow[]>(
    `SELECT id, user_id, platform, platform_account_id, account_name, account_picture,
            access_token, token_expires_at, page_id, page_name, ig_business_id, scopes
     FROM social_connections
     WHERE user_id = ? AND platform = 'facebook' AND is_active = 1
       AND (workspace_id = ? OR ? IS NULL)`,
    [userId, workspaceId ?? null, workspaceId ?? null],
  );

  if (rows.length === 0) return 0;

  let count = 0;
  const dbConn = await pool.getConnection();
  try {
    await dbConn.beginTransaction();

    for (const fbConn of rows) {
      const pageToken = decryptToken(fbConn.access_token);

      // Resolve IG account ID using all available strategies
      const igAccountId = await resolveIgAccountId(
        fbConn.page_id,
        pageToken,
        fbConn.ig_business_id,
      );

      if (!igAccountId) continue; // this FB row has no linked IG — skip

      // Fetch IG profile details
      let igName      = fbConn.page_name ?? 'Instagram';
      let igPicture:  string | null = null;
      let accountType: string | null = null;

      try {
        const igInfo = await fbGet<{
          username?:            string;
          name?:                string;
          profile_picture_url?: string;
          account_type?:        string;
        }>(
          `/${igAccountId}`, pageToken,
          { fields: 'id,name,username,profile_picture_url,account_type' },
        );
        igName      = igInfo.username ?? igInfo.name ?? igName;
        igPicture   = igInfo.profile_picture_url ?? null;
        accountType = igInfo.account_type ?? null;
      } catch { /* use fallbacks */ }

      const igId = uid();
      await dbConn.query(
        `INSERT INTO social_connections
           (id, user_id, workspace_id, platform, platform_account_id, account_name, account_picture,
            access_token, token_expires_at, page_id, page_name, ig_business_id, account_type, scopes)
         VALUES (?, ?, ?, 'instagram', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           account_name     = VALUES(account_name),
           account_picture  = VALUES(account_picture),
           access_token     = VALUES(access_token),
           token_expires_at = VALUES(token_expires_at),
           page_id          = VALUES(page_id),
           page_name        = VALUES(page_name),
           ig_business_id   = VALUES(ig_business_id),
           account_type     = VALUES(account_type),
           is_active        = 1,
           scopes           = VALUES(scopes),
           updated_at       = CURRENT_TIMESTAMP`,
        [
          igId, userId, workspaceId ?? null, igAccountId, igName, igPicture,
          encryptToken(pageToken), null,
          fbConn.page_id, fbConn.page_name, igAccountId, accountType,
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

// ─── Instagram direct OAuth (Camino B) ───────────────────────────────────────

/**
 * Handle the Instagram direct OAuth callback:
 * 1. Exchange code → short-lived token (api.instagram.com)
 * 2. Extend to long-lived token (~60 days, graph.instagram.com)
 * 3. Fetch IG profile (/me with fields)
 * 4. Upsert in social_connections
 *
 * Uses the same Facebook App ID/Secret (add the Instagram product to the Meta app).
 */
export async function handleInstagramDirectCallback(userId: string, code: string, workspaceId?: string | null): Promise<void> {
  // 1. Exchange code for short-lived token
  const shortRes = await fetch('https://api.instagram.com/oauth/access_token', {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    new URLSearchParams({
      client_id:     env.FACEBOOK_CLIENT_ID,
      client_secret: env.FACEBOOK_CLIENT_SECRET,
      grant_type:    'authorization_code',
      redirect_uri:  env.INSTAGRAM_REDIRECT_URL,
      code,
    }),
  });

  if (!shortRes.ok) {
    const err = await shortRes.json().catch(() => ({})) as { error_message?: string; error_description?: string };
    throw new Error(err.error_message ?? err.error_description ?? `Instagram token exchange failed (${shortRes.status})`);
  }

  const { access_token: shortToken } = await shortRes.json() as { access_token: string; user_id: string };

  // 2. Exchange for long-lived token (~60 days)
  const longUrl = new URL('https://graph.instagram.com/access_token');
  longUrl.searchParams.set('grant_type',    'ig_exchange_token');
  longUrl.searchParams.set('client_secret', env.FACEBOOK_CLIENT_SECRET);
  longUrl.searchParams.set('access_token',  shortToken);

  const longRes = await fetch(longUrl.toString());
  if (!longRes.ok) {
    const err = await longRes.json().catch(() => ({})) as { error?: { message: string } };
    throw new Error(err.error?.message ?? `Instagram token extension failed (${longRes.status})`);
  }

  const { access_token: longToken, expires_in } = await longRes.json() as {
    access_token: string;
    token_type:   string;
    expires_in:   number;
  };

  const expiresAt = new Date(Date.now() + (expires_in ?? 5_184_000) * 1000);

  // 3. Fetch IG profile
  const meUrl = new URL('https://graph.instagram.com/me');
  meUrl.searchParams.set('fields',       'id,name,username,profile_picture_url,account_type');
  meUrl.searchParams.set('access_token', longToken);

  const meRes = await fetch(meUrl.toString());
  if (!meRes.ok) {
    const err = await meRes.json().catch(() => ({})) as { error?: { message: string } };
    throw new Error(err.error?.message ?? `Instagram profile fetch failed (${meRes.status})`);
  }

  const me = await meRes.json() as {
    id:                    string;
    name?:                 string;
    username?:             string;
    profile_picture_url?:  string;
    account_type?:         string;
  };

  // 4. Upsert in social_connections
  const id = uid();
  await pool.query(
    `INSERT INTO social_connections
       (id, user_id, workspace_id, platform, platform_account_id, account_name, account_picture,
        access_token, token_expires_at, page_id, page_name, ig_business_id, account_type, scopes)
     VALUES (?, ?, ?, 'instagram', ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       account_name     = VALUES(account_name),
       account_picture  = VALUES(account_picture),
       access_token     = VALUES(access_token),
       token_expires_at = VALUES(token_expires_at),
       account_type     = VALUES(account_type),
       is_active        = 1,
       scopes           = VALUES(scopes),
       updated_at       = CURRENT_TIMESTAMP`,
    [
      id, userId, workspaceId ?? null,
      me.id,
      me.username ?? me.name ?? 'Instagram',
      me.profile_picture_url ?? null,
      encryptToken(longToken),
      expiresAt,
      me.id,
      me.account_type ?? null,
      'instagram_business_basic,instagram_business_content_publish',
    ],
  );

  // Fire-and-forget email
  const [userRows] = await pool.query<(RowDataPacket & { email: string; name: string | null })[]>(
    'SELECT email, name FROM users WHERE id = ? LIMIT 1',
    [userId],
  );
  if (userRows[0]) {
    sendPlatformConnectedEmail(userRows[0].email, {
      name:        userRows[0].name ?? undefined,
      platform:    'instagram',
      accountName: me.username ?? me.name ?? 'Instagram',
    });
  }
}

export async function listConnections(userId: string, workspaceId?: string | null): Promise<SocialConnection[]> {
  const [rows] = await pool.query<SocialConnectionRow[]>(
    `SELECT id, user_id, platform, platform_account_id, account_name, account_picture,
            token_expires_at, page_id, page_name, ig_business_id, account_type, scopes, created_at, updated_at
     FROM social_connections
     WHERE user_id = ? AND is_active = 1
       AND (workspace_id = ? OR (? IS NULL AND workspace_id IS NULL))
     ORDER BY created_at ASC`,
    [userId, workspaceId ?? null, workspaceId ?? null],
  );
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
  // Invalidate FB and dashboard caches — platform list changed
  cache.deleteByPrefix(`fb:summary:${userId}`);
  cache.deleteByPrefix(`fb:posts:${userId}`);
  cache.delete(`dashboard:summary:${userId}`);
}

/**
 * After receiving the OAuth callback:
 * 1. Exchange code → short-lived token
 * 2. Extend to long-lived token
 * 3. Fetch user profile + pages (+ IG accounts linked to pages)
 * 4. Upsert one row per FB page (platform=facebook) and one per IG account (platform=instagram)
 */
export async function handleFacebookCallback(userId: string, code: string, grantedScopes?: string, workspaceId?: string | null): Promise<void> {
  // 1. Short-lived token
  const shortToken = await exchangeCodeForToken(code);

  // 2. Long-lived token
  const longToken  = await extendToken(shortToken.access_token);

  const userToken    = longToken.access_token;
  const expiresInSec = longToken.expires_in ?? 5_184_000; // 60 days default
  const expiresAt    = new Date(Date.now() + expiresInSec * 1000);
  // Use scopes Facebook actually confirmed granting (return_scopes=true in OAuth URL)
  const actualScopes = grantedScopes ?? 'pages_show_list,pages_read_engagement,pages_manage_posts';

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
           AND page_id IS NOT NULL
         ORDER BY updated_at DESC LIMIT 1`,
        [userId, me.id],
      );

      if (existing.length > 0) {
        // /me/accounts returned empty but we have a previously saved page_id.
        // Fetch the Page Access Token directly from the Graph API using the page_id —
        // this works even for NPE pages that don't appear in /me/accounts.
        const [existingRow] = await dbConn.query<SocialConnectionRow[]>(
          `SELECT page_id FROM social_connections WHERE id = ?`,
          [existing[0].id],
        );
        const pageId    = existingRow[0]?.page_id;
        let   pageToken = userToken;          // fallback to user token if exchange fails
        let   pageExpiry: Date | null = expiresAt; // user token expiry as fallback

        if (pageId) {
          try {
            const pageTokenUrl = new URL(`https://graph.facebook.com/v21.0/${pageId}`);
            pageTokenUrl.searchParams.set('fields',       'access_token');
            pageTokenUrl.searchParams.set('access_token', userToken);
            const ptRes = await fetch(pageTokenUrl.toString());
            if (ptRes.ok) {
              const ptData = await ptRes.json() as { access_token?: string };
              if (ptData.access_token) {
                pageToken  = ptData.access_token;
                pageExpiry = null; // Page Tokens don't expire
              }
            }
          } catch { /* use userToken fallback */ }
        }

        await dbConn.query(
          `UPDATE social_connections
           SET is_active = 1, access_token = ?, user_access_token = ?, token_expires_at = ?,
               account_name = ?, account_picture = ?, updated_at = NOW()
           WHERE id = ?`,
          [encryptToken(pageToken), encryptToken(userToken), pageExpiry, me.name, me.picture?.data?.url ?? null, existing[0].id],
        );
      } else {
        // Truly no pages — save personal FB profile as fallback
        const fbId = uid();
        await dbConn.query(
          `INSERT INTO social_connections
             (id, user_id, workspace_id, platform, platform_account_id, account_name, account_picture,
              access_token, token_expires_at, page_id, page_name, ig_business_id, scopes)
           VALUES (?, ?, ?, 'facebook', ?, ?, ?, ?, ?, NULL, NULL, NULL, ?)
           ON DUPLICATE KEY UPDATE
             account_name     = VALUES(account_name),
             account_picture  = VALUES(account_picture),
             access_token     = VALUES(access_token),
             token_expires_at = VALUES(token_expires_at),
             is_active        = 1,
             scopes           = VALUES(scopes),
             updated_at       = CURRENT_TIMESTAMP`,
          [fbId, userId, workspaceId ?? null, me.id, me.name, me.picture?.data?.url ?? null, encryptToken(userToken), expiresAt, 'public_profile,email'],
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
           (id, user_id, workspace_id, platform, platform_account_id, account_name, account_picture,
            access_token, user_access_token, token_expires_at, page_id, page_name, ig_business_id, scopes)
         VALUES (?, ?, ?, 'facebook', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           account_name       = VALUES(account_name),
           account_picture    = VALUES(account_picture),
           access_token       = VALUES(access_token),
           user_access_token  = VALUES(user_access_token),
           token_expires_at   = VALUES(token_expires_at),
           page_id            = VALUES(page_id),
           page_name          = VALUES(page_name),
           ig_business_id     = VALUES(ig_business_id),
           is_active          = 1,
           scopes             = VALUES(scopes),
           updated_at         = CURRENT_TIMESTAMP`,
        [
          fbId, userId, workspaceId ?? null, me.id, me.name, me.picture?.data?.url ?? null,
          encryptToken(page.access_token), encryptToken(userToken), null,
          page.id, page.name, igAccountId,
          actualScopes,
        ],
      );

      if (igAccountId) {
        const igId = uid();

        let igName       = page.name;
        let igPicture    = me.picture?.data?.url ?? null;
        let igAccType:   string | null = null;
        try {
          const igInfo = await fbGet<{
            username?:            string;
            name?:                string;
            profile_picture_url?: string;
            account_type?:        string;
          }>(
            `/${igAccountId}`, page.access_token,
            { fields: 'username,name,profile_picture_url,account_type' },
          );
          igName    = igInfo.username ?? igInfo.name ?? page.name;
          igPicture = igInfo.profile_picture_url ?? igPicture;
          igAccType = igInfo.account_type ?? null;
        } catch { /* use fallbacks */ }

        await dbConn.query(
          `INSERT INTO social_connections
             (id, user_id, workspace_id, platform, platform_account_id, account_name, account_picture,
              access_token, token_expires_at, page_id, page_name, ig_business_id, account_type, scopes)
           VALUES (?, ?, ?, 'instagram', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             account_name     = VALUES(account_name),
             account_picture  = VALUES(account_picture),
             access_token     = VALUES(access_token),
             token_expires_at = VALUES(token_expires_at),
             page_id          = VALUES(page_id),
             page_name        = VALUES(page_name),
             account_type     = VALUES(account_type),
             is_active        = 1,
             scopes           = VALUES(scopes),
             updated_at       = CURRENT_TIMESTAMP`,
          [
            igId, userId, workspaceId ?? null, igAccountId, igName, igPicture,
            encryptToken(page.access_token), null,
            page.id, page.name, igAccountId, igAccType,
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
             (id, user_id, workspace_id, platform, platform_account_id, account_name, account_picture,
              access_token, token_expires_at, page_id, page_name, ig_business_id, scopes)
           VALUES (?, ?, ?, 'instagram', ?, ?, ?, ?, ?, NULL, NULL, ?, ?)
           ON DUPLICATE KEY UPDATE
             account_name     = VALUES(account_name),
             account_picture  = VALUES(account_picture),
             access_token     = VALUES(access_token),
             token_expires_at = VALUES(token_expires_at),
             is_active        = 1,
             scopes           = VALUES(scopes),
             updated_at       = CURRENT_TIMESTAMP`,
          [
            igId, userId, workspaceId ?? null,
            igAcct.id,
            igAcct.username ?? igAcct.name ?? 'Instagram',
            igAcct.profile_picture_url ?? null,
            encryptToken(userToken),
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

  // Fire-and-forget email
  const [userRows] = await pool.query<(RowDataPacket & { email: string; name: string | null })[]>(
    'SELECT email, name FROM users WHERE id = ? LIMIT 1',
    [userId],
  );
  if (userRows[0]) {
    sendPlatformConnectedEmail(userRows[0].email, {
      name:        userRows[0].name ?? undefined,
      platform:    'facebook',
      accountName: me.name,
    });
  }
}
