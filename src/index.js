import process from 'node:process';

try {
  process.loadEnvFile?.('.env');
} catch (error) {
  if (error?.code !== 'ENOENT') {
    console.error('Failed to load .env:', error.message);
  }
}

const { installNetworkFallback } = await import('./network.js');
installNetworkFallback();

const { config, validateConfig } = await import('./config.js');
const { startBot } = await import('./bot.js');
const { loadStore } = await import('./store.js');
const { loadPlugins } = await import('./plugin-loader.js');
const { startWebServer } = await import('./web-server.js');

validateConfig();
loadStore();
await loadPlugins();
startWebServer();

// Install optional YouTube Node downloader dependencies on the server itself.
// This runs in the background so WhatsApp startup is not blocked.
import('./youtube-audio.js')
  .then(module => module.ensureYoutubeNodeDependencies())
  .then(result => {
    if (result?.installedNow) {
      console.log('YouTube Node downloader dependencies installed on server.');
    }
  })
  .catch(error => {
    console.error('YouTube Node downloader dependency bootstrap failed:', error.message);
  });

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
