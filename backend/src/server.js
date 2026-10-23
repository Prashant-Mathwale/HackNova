import mongoose from 'mongoose';
import app from './app.js';
import { env } from './config/env.js';
import { connectDatabase, disconnectDatabase, failInterruptedAnalyses } from './config/database.js';

let server;

async function shutdown(signal) {
  console.info(JSON.stringify({ level: 'info', event: 'shutdown_started', signal }));
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
  await disconnectDatabase();
  process.exit(0);
}

async function start() {
  await connectDatabase();
  await failInterruptedAnalyses();
  server = app.listen(env.PORT, () => {
    console.info(JSON.stringify({
      level: 'info',
      event: 'server_listening',
      port: env.PORT,
      nodeEnv: env.NODE_ENV
    }));
  });
}

mongoose.connection.on('disconnected', () => {
  console.error(JSON.stringify({ level: 'error', event: 'database_disconnected' }));
});

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));

start().catch((error) => {
  console.error(JSON.stringify({ level: 'error', event: 'startup_failed', error: error.message }));
  process.exitCode = 1;
});
