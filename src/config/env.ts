import dotenv from 'dotenv';

dotenv.config();

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optionalInt(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value) return fallback;
  const parsed = parseInt(value, 10);
  if (isNaN(parsed)) throw new Error(`Environment variable ${name} must be an integer`);
  return parsed;
}

export const env = {
  PORT:               optionalInt('PORT', 3000),
  DB_HOST:            required('DB_HOST'),
  DB_PORT:            optionalInt('DB_PORT', 3306),
  DB_USER:            required('DB_USER'),
  DB_PASSWORD:        process.env['DB_PASSWORD'] ?? '',
  DB_NAME:            required('DB_NAME'),
  JWT_SECRET:         required('JWT_SECRET'),
  JWT_REFRESH_SECRET: required('JWT_REFRESH_SECRET'),
  BCRYPT_ROUNDS:      optionalInt('BCRYPT_ROUNDS', 10),
  OPENAI_API_KEY:     process.env['OPENAI_API_KEY'] ?? '',
  OPENAI_MODEL:       process.env['OPENAI_MODEL']   ?? 'gpt-4o-mini',
  // CORS: comma-separated list of allowed origins, e.g. "http://localhost:5173,https://app.example.com"
  CORS_ORIGINS:       process.env['CORS_ORIGINS'] ?? 'http://localhost:5173',
  COOKIE_SECRET:      required('COOKIE_SECRET'),
  // Facebook / Instagram OAuth
  FACEBOOK_CLIENT_ID:     process.env['FACEBOOK_CLIENT_ID']     ?? '',
  FACEBOOK_CLIENT_SECRET: process.env['FACEBOOK_CLIENT_SECRET'] ?? '',
  FACEBOOK_REDIRECT_URL:  process.env['FACEBOOK_REDIRECT_URL']  ?? 'http://localhost:3000/platforms/connect/facebook/callback',
  FRONTEND_URL:           process.env['FRONTEND_URL']           ?? 'http://localhost:5173',
  COOKIE_DOMAIN:          process.env['COOKIE_DOMAIN']          ?? '',
  // Instagram direct OAuth (Camino B — same App ID/Secret as Facebook, different redirect URI)
  INSTAGRAM_REDIRECT_URL: process.env['INSTAGRAM_REDIRECT_URL'] ?? 'http://localhost:3000/platforms/connect/instagram/oauth/callback',
  // AES-256-GCM key for encrypting OAuth access tokens at rest (64 hex chars = 32 bytes)
  TOKEN_ENCRYPTION_KEY: required('TOKEN_ENCRYPTION_KEY'),
  // AWS S3
  AWS_REGION:            required('AWS_REGION'),
  AWS_ACCESS_KEY_ID:     required('AWS_ACCESS_KEY_ID'),
  AWS_SECRET_ACCESS_KEY: required('AWS_SECRET_ACCESS_KEY'),
  S3_BUCKET:             required('S3_BUCKET'),
  // Base public URL for S3 objects — use CloudFront URL if CDN is configured,
  // otherwise the default S3 URL: https://{bucket}.s3.{region}.amazonaws.com
  S3_PUBLIC_URL:         required('S3_PUBLIC_URL'),
} as const;

// ── Secret strength validation ─────────────────────────────────────────────────
// Fail fast at startup rather than silently accepting weak secrets.

if (env.JWT_SECRET.length < 32) {
  throw new Error('JWT_SECRET must be at least 32 characters');
}
if (env.JWT_REFRESH_SECRET.length < 32) {
  throw new Error('JWT_REFRESH_SECRET must be at least 32 characters');
}
if (env.COOKIE_SECRET.length < 32) {
  throw new Error('COOKIE_SECRET must be at least 32 characters');
}
if (!/^[0-9a-f]{64}$/i.test(env.TOKEN_ENCRYPTION_KEY)) {
  throw new Error('TOKEN_ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes). Generate with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
}
if (env.AWS_ACCESS_KEY_ID.length < 16) {
  throw new Error('AWS_ACCESS_KEY_ID appears invalid (too short)');
}
if (env.AWS_SECRET_ACCESS_KEY.length < 32) {
  throw new Error('AWS_SECRET_ACCESS_KEY appears invalid (too short)');
}
