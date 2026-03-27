import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { ResultSetHeader, RowDataPacket } from 'mysql2';
import { pool } from '../../config/db';
import { env } from '../../config/env';
import { uid } from '../../lib/uid';

interface UserRow extends RowDataPacket {
  id:            string;
  email:         string;
  password_hash: string;
  name:          string | null;
  first_login:   number;
}

interface RefreshTokenRow extends RowDataPacket {
  id:      number;
  user_id: string;
  token:   string;
}

export interface TokenPair {
  accessToken:  string;
  refreshToken: string;
  isFirstLogin: boolean;
}

function appError(errorCode: string, message: string, statusCode: number): Error {
  return Object.assign(new Error(message), { errorCode, statusCode });
}

function signTokens(userId: string, email: string): Omit<TokenPair, 'isFirstLogin'> {
  const accessToken = jwt.sign({ id: userId, email }, env.JWT_SECRET, {
    expiresIn: '15m',
  });
  const refreshToken = jwt.sign({ id: userId }, env.JWT_REFRESH_SECRET, {
    expiresIn: '7d',
  });
  return { accessToken, refreshToken };
}

async function storeRefreshToken(userId: string, token: string): Promise<void> {
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await pool.query<ResultSetHeader>(
    'INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES (?, ?, ?)',
    [userId, token, expiresAt]
  );
}

export async function register(
  email: string,
  password: string,
  name: string
): Promise<TokenPair> {
  const [existing] = await pool.query<UserRow[]>(
    'SELECT id FROM users WHERE email = ? LIMIT 1',
    [email]
  );

  if (existing.length > 0) {
    throw appError('EMAIL_ALREADY_EXISTS', 'Email is already registered', 409);
  }

  const id           = uid();
  const passwordHash = await bcrypt.hash(password, env.BCRYPT_ROUNDS);

  await pool.query<ResultSetHeader>(
    'INSERT INTO users (id, email, password_hash, name) VALUES (?, ?, ?, ?)',
    [id, email, passwordHash, name]
  );

  const tokens = signTokens(id, email);
  await storeRefreshToken(id, tokens.refreshToken);

  return { ...tokens, isFirstLogin: true };
}

export async function login(email: string, password: string): Promise<TokenPair> {
  const [rows] = await pool.query<UserRow[]>(
    'SELECT id, email, password_hash, first_login FROM users WHERE email = ? LIMIT 1',
    [email]
  );

  const user = rows[0];

  if (!user) {
    throw appError('INVALID_CREDENTIALS', 'Invalid email or password', 401);
  }

  const passwordMatch = await bcrypt.compare(password, user.password_hash);

  if (!passwordMatch) {
    throw appError('INVALID_CREDENTIALS', 'Invalid email or password', 401);
  }

  const tokens = signTokens(user.id, user.email);
  await storeRefreshToken(user.id, tokens.refreshToken);

  return { ...tokens, isFirstLogin: Boolean(user.first_login) };
}

export async function refresh(refreshToken: string): Promise<TokenPair> {
  let payload: { id: string };

  try {
    payload = jwt.verify(refreshToken, env.JWT_REFRESH_SECRET) as { id: string };
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      throw appError('TOKEN_EXPIRED', 'Refresh token has expired', 401);
    }
    throw appError('INVALID_TOKEN', 'Invalid refresh token', 401);
  }

  const [tokenRows] = await pool.query<RefreshTokenRow[]>(
    'SELECT id, user_id FROM refresh_tokens WHERE token = ? AND user_id = ? AND expires_at > NOW() LIMIT 1',
    [refreshToken, payload.id]
  );

  if (tokenRows.length === 0) {
    throw appError('INVALID_TOKEN', 'Refresh token not found or has been revoked', 401);
  }

  const [userRows] = await pool.query<UserRow[]>(
    'SELECT id, email FROM users WHERE id = ? LIMIT 1',
    [payload.id]
  );

  const user = userRows[0];

  if (!user) {
    throw appError('INVALID_TOKEN', 'User associated with token no longer exists', 401);
  }

  await pool.query('DELETE FROM refresh_tokens WHERE token = ?', [refreshToken]);

  const tokens = signTokens(user.id, user.email);
  await storeRefreshToken(user.id, tokens.refreshToken);

  return { ...tokens, isFirstLogin: false };
}

export async function logout(userId: string): Promise<void> {
  await pool.query('DELETE FROM refresh_tokens WHERE user_id = ?', [userId]);
}
