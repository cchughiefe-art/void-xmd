import process from 'node:process';

try {
  process.loadEnvFile?.('.env');
} catch (error) {
  if (error?.code !== 'ENOENT') {
    console.error('Failed to load .env:', error.message);
  }
}

const { config, validateConfig } = await import('./config.js');
const { startBot } = await import('./bot.js');
const { loadStore } = await import('./store.js');
const { loadPlugins } = await import('./plugin-loader.js');
const { startWebServer } = await import('./web-server.js');

validateConfig();
loadStore();
await loadPlugins();
startWebServer();

async function connectWhatsApp() {
  try {
    await startBot();
  } catch (error) {
    console.error('Initial WhatsApp connection failed:', error.message);
    setTimeout(connectWhatsApp, 5000);
  }
}

connectWhatsApp();

process.on('unhandledRejection', error =>
  console.error('Unhandled rejection:', error)
);

process.on('uncaughtException', error =>
  console.error('Uncaught exception:', error)
);
