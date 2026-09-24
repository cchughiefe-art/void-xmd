import { config, validateConfig } from './config.js';
import { startBot } from './bot.js';
import { loadStore } from './store.js';
import { loadPlugins } from './plugin-loader.js';
import { startWebServer } from './web-server.js';

validateConfig(); loadStore(); await loadPlugins();
startWebServer();
async function connectWhatsApp(){
  try { await startBot(); }
  catch(error){ console.error('Initial WhatsApp connection failed:',error.message); setTimeout(connectWhatsApp,5000); }
}
connectWhatsApp();
process.on('unhandledRejection',error=>console.error('Unhandled rejection:',error));
process.on('uncaughtException',error=>console.error('Uncaught exception:',error));
