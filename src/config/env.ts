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
  PORT: optionalInt('PORT', 3000),
  DB_HOST: required('DB_HOST'),
  DB_PORT: optionalInt('DB_PORT', 3306),
  DB_USER: required('DB_USER'),
  DB_PASSWORD: process.env['DB_PASSWORD'] ?? '',
  DB_NAME: required('DB_NAME'),
  JWT_SECRET: required('JWT_SECRET'),
  JWT_REFRESH_SECRET: required('JWT_REFRESH_SECRET'),
  BCRYPT_ROUNDS: optionalInt('BCRYPT_ROUNDS', 10),
} as const;
