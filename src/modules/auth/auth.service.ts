import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { OAuth2Client } from 'google-auth-library';
import { ResultSetHeader, RowDataPacket } from 'mysql2';
import { pool } from '../../config/db';
import { env } from '../../config/env';
import { uid } from '../../lib/uid';
import { sendLoginNotification, sendVerificationEmail, sendPasswordResetEmail } from '../../lib/email';

const googleClient = new OAuth2Client(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET);

interface UserRow extends RowDataPacket {
  id:                           string;
  email:                        string;
  password_hash:                string;
  name:                         string | null;
  first_login:                  number;
  profile_completed:            number;
  email_verified:               number;
  email_verification_token:     string | null;
  max_sessions:                 number;
  sessions_invalidated_at:      Date | null;
  is_active:                    number;
  is_banned:                    number;
  password_reset_otp:           string | null;
  password_reset_expires_at:    Date | null;
}

interface RefreshTokenRow extends RowDataPacket {
  id:          number;
  user_id:     string;
  token:       string;
  device_info: string | null;
  created_at:  Date;
  is_active:   number;
}

interface PasswordHistoryRow extends RowDataPacket {
  id:            number;
  password_hash: string;
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
    'INSERT INTO refresh_tokens (user_id, token, device_info, expires_at, is_active) VALUES (?, ?, ?, ?, 1)',
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

  sendVerificationEmail(email, verificationCode);

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
  await pool.query('UPDATE users SET is_active = 1 WHERE id = ?', [user.id]);

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

  sendVerificationEmail(email, verificationCode);

  return process.env['NODE_ENV'] !== 'production' ? { devVerifyToken: verificationCode } : {};
}

export async function login(
  email: string,
  password: string,
  deviceInfo?: string,
  force = false,
): Promise<TokenPair | SessionConflict> {
  const [rows] = await pool.query<UserRow[]>(
    'SELECT id, email, password_hash, name, first_login, profile_completed, email_verified, max_sessions, is_active, is_banned FROM users WHERE email = ? LIMIT 1',
    [email],
  );

  const user = rows[0];

  if (!user) throw appError('INVALID_CREDENTIALS', 'Invalid email or password', 401);

  const passwordMatch = await bcrypt.compare(password, user.password_hash);
  if (!passwordMatch) throw appError('INVALID_CREDENTIALS', 'Invalid email or password', 401);
  if (!user.email_verified) throw appError('EMAIL_NOT_VERIFIED', 'Please verify your email address before signing in', 403);
  if (user.is_banned) throw appError('ACCOUNT_DISABLED', 'Your account has been deactivated. Please contact support.', 403);

  // Si is_active = 0 el usuario ya cerró sesión — dejar pasar sin conflicto
  if (!user.is_active && !force) {
    const profileCompleted = Boolean(user.profile_completed);
    const tokens = signTokens(user.id, user.email, profileCompleted);
    await storeRefreshToken(user.id, tokens.refreshToken, deviceInfo);
    await pool.query('UPDATE users SET is_active = 1 WHERE id = ?', [user.id]);
    sendLoginNotification(user.email, user.name ?? undefined);
    return { ...tokens, isFirstLogin: Boolean(user.first_login), profileCompleted };
  }

  const maxSessions = user.max_sessions ?? 1;

  // Check active session count
  const [activeSessions] = await pool.query<RefreshTokenRow[]>(
    'SELECT id, device_info, created_at FROM refresh_tokens WHERE user_id = ? AND expires_at > NOW() AND is_active = 1 ORDER BY created_at DESC',
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
    await pool.query('UPDATE refresh_tokens SET is_active = 0 WHERE user_id = ?', [user.id]);
    await pool.query('UPDATE users SET sessions_invalidated_at = NOW() WHERE id = ?', [user.id]);
  }

  const profileCompleted = Boolean(user.profile_completed);
  const tokens = signTokens(user.id, user.email, profileCompleted);
  await storeRefreshToken(user.id, tokens.refreshToken, deviceInfo);
  await pool.query('UPDATE users SET is_active = 1 WHERE id = ?', [user.id]);
  sendLoginNotification(user.email, user.name ?? undefined);

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
    'SELECT id, user_id FROM refresh_tokens WHERE token = ? AND user_id = ? AND expires_at > NOW() AND is_active = 1 LIMIT 1',
    [refreshToken, payload.id],
  );

  if (tokenRows.length === 0) {
    await pool.query('UPDATE refresh_tokens SET is_active = 0 WHERE user_id = ?', [payload.id]);
    throw appError('INVALID_TOKEN', 'Refresh token has been revoked. Please log in again.', 401);
  }

  const [userRows] = await pool.query<UserRow[]>(
    'SELECT id, email, profile_completed, is_banned FROM users WHERE id = ? LIMIT 1',
    [payload.id],
  );

  const user = userRows[0];

  if (!user) {
    throw appError('INVALID_TOKEN', 'User associated with token no longer exists', 401);
  }

  if (user.is_banned) {
    await pool.query('UPDATE refresh_tokens SET is_active = 0 WHERE user_id = ?', [payload.id]);
    throw appError('ACCOUNT_DISABLED', 'Your account has been deactivated. Please contact support.', 403);
  }

  await pool.query('UPDATE refresh_tokens SET is_active = 0 WHERE token = ?', [refreshToken]);

  const profileCompleted = Boolean(user.profile_completed);
  const tokens = signTokens(user.id, user.email, profileCompleted);
  await storeRefreshToken(user.id, tokens.refreshToken);

  return { ...tokens, isFirstLogin: false, profileCompleted };
}

export async function logout(userId: string): Promise<void> {
  await pool.query('UPDATE refresh_tokens SET is_active = 0 WHERE user_id = ?', [userId]);
  await pool.query('UPDATE users SET is_active = 0, sessions_invalidated_at = NOW() WHERE id = ?', [userId]);
}

export async function logoutByRefreshToken(refreshToken: string): Promise<void> {
  // Decode without verifying expiry — we just need the userId to close the session
  let userId: string | undefined;
  try {
    const payload = jwt.decode(refreshToken) as { id?: string } | null;
    userId = payload?.id;
  } catch {
    return;
  }
  if (!userId) return;
  await pool.query('UPDATE refresh_tokens SET is_active = 0 WHERE user_id = ?', [userId]);
  await pool.query('UPDATE users SET is_active = 0, sessions_invalidated_at = NOW() WHERE id = ?', [userId]);
}

export async function getSessions(userId: string): Promise<ActiveSession[]> {
  const [rows] = await pool.query<RefreshTokenRow[]>(
    'SELECT id, device_info, created_at FROM refresh_tokens WHERE user_id = ? AND expires_at > NOW() AND is_active = 1 ORDER BY created_at DESC',
    [userId],
  );
  return rows.map(r => ({
    id:          r.id,
    device_info: r.device_info,
    created_at:  r.created_at.toISOString(),
  }));
}

export async function loginWithGoogle(code: string, deviceInfo?: string): Promise<TokenPair> {
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id:     env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri:  'postmessage',
      grant_type:    'authorization_code',
    }),
  });

  const tokenData = await tokenRes.json() as { id_token?: string; error?: string };

  if (!tokenRes.ok || !tokenData.id_token) {
    throw appError('GOOGLE_AUTH_FAILED', tokenData.error ?? 'Google token exchange failed', 400);
  }

  const ticket = await googleClient.verifyIdToken({
    idToken:  tokenData.id_token,
    audience: env.GOOGLE_CLIENT_ID,
  });

  const payload = ticket.getPayload();
  if (!payload?.email) {
    throw appError('GOOGLE_AUTH_FAILED', 'Could not retrieve email from Google account', 400);
  }

  const { email, name } = payload;

  const [rows] = await pool.query<UserRow[]>(
    'SELECT id, email, profile_completed, first_login, is_active, is_banned FROM users WHERE email = ? LIMIT 1',
    [email],
  );

  let userId: string;
  let isFirstLogin: boolean;
  let profileCompleted: boolean;

  if (rows.length > 0) {
    const user = rows[0];
    if (user.is_banned) throw appError('ACCOUNT_DISABLED', 'Your account has been deactivated. Please contact support.', 403);
    userId           = user.id;
    isFirstLogin     = Boolean(user.first_login);
    profileCompleted = Boolean(user.profile_completed);
  } else {
    userId           = uid();
    isFirstLogin     = true;
    profileCompleted = false;
    const placeholderHash = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), env.BCRYPT_ROUNDS);
    await pool.query<ResultSetHeader>(
      'INSERT INTO users (id, email, password_hash, name, email_verified, is_active) VALUES (?, ?, ?, ?, 1, 1)',
      [userId, email, placeholderHash, name ?? null],
    );
  }

  const tokens = signTokens(userId, email, profileCompleted);
  await storeRefreshToken(userId, tokens.refreshToken, deviceInfo);
  await pool.query('UPDATE users SET is_active = 1 WHERE id = ?', [userId]);
  sendLoginNotification(email, name ?? undefined);

  return { ...tokens, isFirstLogin, profileCompleted };
}

export async function verifyResetOtp(email: string, otp: string): Promise<void> {
  const [rows] = await pool.query<UserRow[]>(
    'SELECT id, password_reset_otp, password_reset_expires_at FROM users WHERE email = ? LIMIT 1',
    [email],
  );

  if (rows.length === 0 || !rows[0].password_reset_otp || !rows[0].password_reset_expires_at) {
    throw appError('INVALID_OTP', 'Invalid or expired code', 400);
  }

  const user = rows[0];

  if (new Date() > user.password_reset_expires_at!) {
    await pool.query(
      'UPDATE users SET password_reset_otp = NULL, password_reset_expires_at = NULL WHERE id = ?',
      [user.id],
    );
    throw appError('OTP_EXPIRED', 'Code has expired. Request a new one.', 400);
  }

  const hash = crypto.createHash('sha256').update(otp).digest('hex');
  if (hash !== user.password_reset_otp) {
    throw appError('INVALID_OTP', 'Invalid or expired code', 400);
  }
}

export async function requestPasswordReset(email: string): Promise<{ devOtp?: string }> {
  const [rows] = await pool.query<UserRow[]>(
    'SELECT id FROM users WHERE email = ? AND email_verified = 1 LIMIT 1',
    [email],
  );

  // Always return success — never reveal whether the email exists
  if (rows.length === 0) return {};

  const otp       = String(Math.floor(100000 + Math.random() * 900000));
  const hash      = crypto.createHash('sha256').update(otp).digest('hex');
  const expiresAt = new Date(Date.now() + 60 * 1000); // 1 minute

  await pool.query(
    'UPDATE users SET password_reset_otp = ?, password_reset_expires_at = ? WHERE id = ?',
    [hash, expiresAt, rows[0].id],
  );

  sendPasswordResetEmail(email, otp);

  return process.env['NODE_ENV'] !== 'production' ? { devOtp: otp } : {};
}

export async function resetPassword(email: string, otp: string, newPassword: string): Promise<void> {
  const [rows] = await pool.query<UserRow[]>(
    'SELECT id, password_reset_otp, password_reset_expires_at FROM users WHERE email = ? LIMIT 1',
    [email],
  );

  if (rows.length === 0 || !rows[0].password_reset_otp || !rows[0].password_reset_expires_at) {
    throw appError('INVALID_OTP', 'Invalid or expired code', 400);
  }

  const user = rows[0];

  if (new Date() > user.password_reset_expires_at!) {
    await pool.query(
      'UPDATE users SET password_reset_otp = NULL, password_reset_expires_at = NULL WHERE id = ?',
      [user.id],
    );
    throw appError('OTP_EXPIRED', 'Code has expired. Request a new one.', 400);
  }

  const hash = crypto.createHash('sha256').update(otp).digest('hex');
  if (hash !== user.password_reset_otp) {
    throw appError('INVALID_OTP', 'Invalid or expired code', 400);
  }

  // Fetch current password + last 5 from history and check for reuse
  const [currentRow] = await pool.query<UserRow[]>(
    'SELECT password_hash FROM users WHERE id = ? LIMIT 1',
    [user.id],
  );
  const [historyRows] = await pool.query<PasswordHistoryRow[]>(
    'SELECT password_hash FROM password_history WHERE user_id = ? ORDER BY created_at DESC LIMIT 4',
    [user.id],
  );

  const recentHashes = [
    ...(currentRow[0]?.password_hash ? [currentRow[0].password_hash] : []),
    ...historyRows.map(r => r.password_hash),
  ];

  for (const recentHash of recentHashes) {
    if (await bcrypt.compare(newPassword, recentHash)) {
      throw appError('PASSWORD_PREVIOUSLY_USED', 'This password has been used recently. Please choose a different one.', 400);
    }
  }

  // Archive current hash before overwriting
  if (currentRow[0]?.password_hash) {
    await pool.query(
      'INSERT INTO password_history (user_id, password_hash) VALUES (?, ?)',
      [user.id, currentRow[0].password_hash],
    );
    // Keep only last 5 entries
    await pool.query(
      'DELETE FROM password_history WHERE user_id = ? AND id NOT IN (SELECT id FROM (SELECT id FROM password_history WHERE user_id = ? ORDER BY created_at DESC LIMIT 5) AS t)',
      [user.id, user.id],
    );
  }

  const passwordHash = await bcrypt.hash(newPassword, env.BCRYPT_ROUNDS);
  await pool.query(
    'UPDATE users SET password_hash = ?, password_reset_otp = NULL, password_reset_expires_at = NULL WHERE id = ?',
    [passwordHash, user.id],
  );

  // Invalidate all sessions after password change
  await pool.query('UPDATE refresh_tokens SET is_active = 0 WHERE user_id = ?', [user.id]);
  await pool.query('UPDATE users SET is_active = 0, sessions_invalidated_at = NOW() WHERE id = ?', [user.id]);
}

export async function forceLogoutAll(userId: string): Promise<void> {
  await pool.query('UPDATE refresh_tokens SET is_active = 0 WHERE user_id = ?', [userId]);
  await pool.query('UPDATE users SET is_active = 0, sessions_invalidated_at = NOW() WHERE id = ?', [userId]);
}
