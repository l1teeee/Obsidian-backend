import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { ResultSetHeader, RowDataPacket } from 'mysql2';
import { pool } from '../../config/db';
import { env } from '../../config/env';
import { uid } from '../../lib/uid';

interface UserRow extends RowDataPacket {
  id:                         string;
  email:                      string;
  password_hash:              string;
  name:                       string | null;
  first_login:                number;
  profile_completed:          number;
  email_verified:             number;
  email_verification_token:   string | null;
  max_sessions:               number;
  sessions_invalidated_at:    Date | null;
}

interface RefreshTokenRow extends RowDataPacket {
  id:          number;
  user_id:     string;
  token:       string;
  device_info: string | null;
  created_at:  Date;
}

export interface ActiveSession {
  id:          number;
  device_info: string | null;
  created_at:  string;
}

export interface SessionConflict {
  conflict:        true;
  active_sessions: ActiveSession[];
}

export interface TokenPair {
  accessToken:      string;
  refreshToken:     string;
  isFirstLogin:     boolean;
  profileCompleted: boolean;
}

export interface RegisterResult {
  email:           string;
  devVerifyToken?: string;   // only included outside production
}

function appError(errorCode: string, message: string, statusCode: number): Error {
  return Object.assign(new Error(message), { errorCode, statusCode });
}

// pc = profileCompleted baked into the access token so the frontend
// can read it without an extra round-trip after every refresh.
function signTokens(userId: string, email: string, profileCompleted: boolean): Omit<TokenPair, 'isFirstLogin' | 'profileCompleted'> {
  const accessToken = jwt.sign(
    { id: userId, email, pc: profileCompleted ? 1 : 0 },
    env.JWT_SECRET,
    { algorithm: 'HS256', expiresIn: '15m' },
  );
  const refreshToken = jwt.sign({ id: userId }, env.JWT_REFRESH_SECRET, {
    algorithm: 'HS256',
    expiresIn: '7d',
  });
  return { accessToken, refreshToken };
}

async function storeRefreshToken(userId: string, token: string, deviceInfo?: string): Promise<void> {
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await pool.query<ResultSetHeader>(
    'INSERT INTO refresh_tokens (user_id, token, device_info, expires_at) VALUES (?, ?, ?, ?)',
    [userId, token, deviceInfo ?? null, expiresAt],
  );
}

export async function register(
  email: string,
  password: string,
): Promise<RegisterResult> {
  const [existing] = await pool.query<UserRow[]>(
    'SELECT id FROM users WHERE email = ? LIMIT 1',
    [email],
  );

  if (existing.length > 0) {
    throw appError('EMAIL_ALREADY_EXISTS', 'Email is already registered', 409);
  }

  const id                = uid();
  const passwordHash      = await bcrypt.hash(password, env.BCRYPT_ROUNDS);
  const verificationCode = String(Math.floor(100000 + Math.random() * 900000)); // 6-digit code

  await pool.query<ResultSetHeader>(
    'INSERT INTO users (id, email, password_hash, email_verification_token) VALUES (?, ?, ?, ?)',
    [id, email, passwordHash, verificationCode],
  );

  // Mock email — in production this would call an email service (e.g. Resend, SendGrid)
  if (process.env['NODE_ENV'] !== 'production') {
    console.log(`[EMAIL MOCK] Verification code for <${email}>: ${verificationCode}`);
  }

  return {
    email,
    ...(process.env['NODE_ENV'] !== 'production' && { devVerifyToken: verificationCode }),
  };
}

export async function verifyEmail(email: string, code: string): Promise<TokenPair> {
  const [rows] = await pool.query<UserRow[]>(
    'SELECT id, email, profile_completed, email_verification_token FROM users WHERE email = ? AND email_verified = 0 LIMIT 1',
    [email],
  );

  if (rows.length === 0) {
    throw appError('INVALID_TOKEN', 'Email already verified or account does not exist', 400);
  }

  const user = rows[0];

  await pool.query(
    'UPDATE users SET email_verified = 1, email_verification_token = NULL WHERE id = ?',
    [user.id],
  );

  const profileCompleted = Boolean(user.profile_completed);
  const tokens           = signTokens(user.id, user.email, profileCompleted);
  await storeRefreshToken(user.id, tokens.refreshToken);

  return { ...tokens, isFirstLogin: true, profileCompleted };
}

export async function resendVerification(email: string): Promise<{ devVerifyToken?: string }> {
  const [rows] = await pool.query<UserRow[]>(
    'SELECT id FROM users WHERE email = ? AND email_verified = 0 LIMIT 1',
    [email],
  );

  // Always return success to avoid email enumeration
  if (rows.length === 0) return {};

  const user              = rows[0];
  const verificationCode = String(Math.floor(100000 + Math.random() * 900000));

  await pool.query(
    'UPDATE users SET email_verification_token = ? WHERE id = ?',
    [verificationCode, user.id],
  );

  if (process.env['NODE_ENV'] !== 'production') {
    console.log(`[EMAIL MOCK] New verification code for <${email}>: ${verificationCode}`);
  }

  return process.env['NODE_ENV'] !== 'production' ? { devVerifyToken: verificationCode } : {};
}

export async function login(
  email: string,
  password: string,
  deviceInfo?: string,
  force = false,
): Promise<TokenPair | SessionConflict> {
  const [rows] = await pool.query<UserRow[]>(
    'SELECT id, email, password_hash, first_login, profile_completed, email_verified, max_sessions FROM users WHERE email = ? LIMIT 1',
    [email],
  );

  const user = rows[0];

  if (!user) throw appError('INVALID_CREDENTIALS', 'Invalid email or password', 401);

  const passwordMatch = await bcrypt.compare(password, user.password_hash);
  if (!passwordMatch) throw appError('INVALID_CREDENTIALS', 'Invalid email or password', 401);
  if (!user.email_verified) throw appError('EMAIL_NOT_VERIFIED', 'Please verify your email address before signing in', 403);

  const maxSessions = user.max_sessions ?? 1;

  // Check active session count
  const [activeSessions] = await pool.query<RefreshTokenRow[]>(
    'SELECT id, device_info, created_at FROM refresh_tokens WHERE user_id = ? AND expires_at > NOW() ORDER BY created_at DESC',
    [user.id],
  );

  if (activeSessions.length >= maxSessions && !force) {
    return {
      conflict: true,
      active_sessions: activeSessions.map(s => ({
        id:          s.id,
        device_info: s.device_info,
        created_at:  s.created_at.toISOString(),
      })),
    };
  }

  // Force: revoke all existing sessions and stamp invalidation time
  if (force) {
    await pool.query('DELETE FROM refresh_tokens WHERE user_id = ?', [user.id]);
    await pool.query('UPDATE users SET sessions_invalidated_at = NOW() WHERE id = ?', [user.id]);
  }

  const profileCompleted = Boolean(user.profile_completed);
  const tokens = signTokens(user.id, user.email, profileCompleted);
  await storeRefreshToken(user.id, tokens.refreshToken, deviceInfo);

  return { ...tokens, isFirstLogin: Boolean(user.first_login), profileCompleted };
}

export async function refresh(refreshToken: string): Promise<TokenPair> {
  let payload: { id: string };

  try {
    payload = jwt.verify(refreshToken, env.JWT_REFRESH_SECRET, {
      algorithms: ['HS256'],
    }) as { id: string };
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      throw appError('TOKEN_EXPIRED', 'Refresh token has expired', 401);
    }
    throw appError('INVALID_TOKEN', 'Invalid refresh token', 401);
  }

  const [tokenRows] = await pool.query<RefreshTokenRow[]>(
    'SELECT id, user_id FROM refresh_tokens WHERE token = ? AND user_id = ? AND expires_at > NOW() LIMIT 1',
    [refreshToken, payload.id],
  );

  if (tokenRows.length === 0) {
    await pool.query('DELETE FROM refresh_tokens WHERE user_id = ?', [payload.id]);
    throw appError('INVALID_TOKEN', 'Refresh token has been revoked. Please log in again.', 401);
  }

  const [userRows] = await pool.query<UserRow[]>(
    'SELECT id, email, profile_completed FROM users WHERE id = ? LIMIT 1',
    [payload.id],
  );

  const user = userRows[0];

  if (!user) {
    throw appError('INVALID_TOKEN', 'User associated with token no longer exists', 401);
  }

  await pool.query('DELETE FROM refresh_tokens WHERE token = ?', [refreshToken]);

  const profileCompleted = Boolean(user.profile_completed);
  const tokens = signTokens(user.id, user.email, profileCompleted);
  await storeRefreshToken(user.id, tokens.refreshToken);

  return { ...tokens, isFirstLogin: false, profileCompleted };
}

export async function logout(userId: string): Promise<void> {
  await pool.query('DELETE FROM refresh_tokens WHERE user_id = ?', [userId]);
}

export async function getSessions(userId: string): Promise<ActiveSession[]> {
  const [rows] = await pool.query<RefreshTokenRow[]>(
    'SELECT id, device_info, created_at FROM refresh_tokens WHERE user_id = ? AND expires_at > NOW() ORDER BY created_at DESC',
    [userId],
  );
  return rows.map(r => ({
    id:          r.id,
    device_info: r.device_info,
    created_at:  r.created_at.toISOString(),
  }));
}

export async function forceLogoutAll(userId: string): Promise<void> {
  await pool.query('DELETE FROM refresh_tokens WHERE user_id = ?', [userId]);
}
