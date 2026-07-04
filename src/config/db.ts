import mysql from 'mysql2/promise';
import { env } from './env';

const databaseUrl = new URL(env.DATABASE_URL);
const database = decodeURIComponent(databaseUrl.pathname.replace(/^\/+/, ''));
const port = databaseUrl.port ? Number.parseInt(databaseUrl.port, 10) : 3306;

if (!database) {
  throw new Error('DATABASE_URL must include a database name');
}

if (Number.isNaN(port)) {
  throw new Error('DATABASE_URL must include a valid MySQL port');
}

export const pool = mysql.createPool({
  host: databaseUrl.hostname,
  port,
  user: decodeURIComponent(databaseUrl.username),
  password: decodeURIComponent(databaseUrl.password),
  database,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  timezone: '+00:00',
});
