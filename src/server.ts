import { buildApp } from './app';
import { env } from './config/env';

async function start(): Promise<void> {
  const app = buildApp();

  // Warn if running in production without a reverse proxy configured.
  // The server listens on plain HTTP; TLS must be terminated by nginx/Cloudflare/etc.
  if (process.env['NODE_ENV'] === 'production' && !process.env['TRUST_PROXY']) {
    app.log.warn(
      '[security] NODE_ENV=production but TRUST_PROXY is not set. ' +
      'Ensure TLS is terminated by a reverse proxy (nginx, Cloudflare, etc.) ' +
      'and set TRUST_PROXY=true once it is configured.',
    );
  }

  try {
    await app.listen({ port: env.PORT, host: '0.0.0.0' });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

start();
