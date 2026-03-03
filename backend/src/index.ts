import 'dotenv/config';
import { createApp } from './app.js';
import { env } from './config/env.js';
import { pool } from './db/pool.js';

const app = createApp();
const server = app.listen(env.PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Backend listening on http://localhost:${env.PORT}`);
});

async function shutdown(signal: string): Promise<void> {
  // eslint-disable-next-line no-console
  console.log(`Received ${signal}, shutting down...`);
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
}

process.on('SIGINT', () => {
  void shutdown('SIGINT');
});
process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});

