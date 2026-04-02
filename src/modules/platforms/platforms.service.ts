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
  instagram_business_account?: { id: string };
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

export async function listConnections(userId: string): Promise<SocialConnection[]> {
  const [rows] = await pool.query<SocialConnectionRow[]>(
    `SELECT id, user_id, platform, platform_account_id, account_name, account_picture,
            token_expires_at, page_id, page_name, ig_business_id, scopes, created_at, updated_at
     FROM social_connections WHERE user_id = ? ORDER BY created_at ASC`,
    [userId],
  );
  // Don't expose access_token in list
  return rows;
}

export async function deleteConnection(id: string, userId: string): Promise<void> {
  const [result] = await pool.query<ResultSetHeader>(
    'DELETE FROM social_connections WHERE id = ? AND user_id = ?',
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

  // 4. Pages (+ instagram_business_account)
  const pagesResp = await fbGet<FbPagesResponse>('/me/accounts', userToken, {
    fields: 'id,name,access_token,instagram_business_account',
  });

  // 5. IG account name for each page's IG account
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    for (const page of pagesResp.data) {
      // Upsert Facebook page connection
      const fbId = uid();
      await conn.query(
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
           scopes           = VALUES(scopes),
           updated_at       = CURRENT_TIMESTAMP`,
        [
          fbId,
          userId,
          me.id,                           // FB user id as account id
          me.name,
          me.picture?.data?.url ?? null,
          page.access_token,               // Page Access Token (never expires)
          null,                            // Page tokens don't expire
          page.id,
          page.name,
          page.instagram_business_account?.id ?? null,
          'pages_show_list,pages_read_engagement,instagram_basic,instagram_content_publish',
        ],
      );

      // Upsert Instagram connection if this page has a linked IG business account
      if (page.instagram_business_account?.id) {
        const igId   = uid();
        const igAcct = page.instagram_business_account.id;

        // Fetch IG username
        let igName = page.name;
        try {
          const igInfo = await fbGet<{ username?: string; name?: string }>(
            `/${igAcct}`, page.access_token, { fields: 'username,name' },
          );
          igName = igInfo.username ?? igInfo.name ?? page.name;
        } catch { /* ignore, use page name as fallback */ }

        await conn.query(
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
            igId,
            userId,
            igAcct,
            igName,
            me.picture?.data?.url ?? null,
            page.access_token,
            null,
            page.id,
            page.name,
            igAcct,
            'instagram_basic,instagram_content_publish',
          ],
        );
      }
    }

    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}
