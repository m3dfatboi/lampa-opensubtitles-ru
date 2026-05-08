import { createConfig } from './config.js';
import { Store } from './db.js';
import { Robokassa } from './robokassa.js';
import { createServer } from './server.js';
import { LampaTranslateService } from './service.js';
import { TelegramBot } from './bot.js';
import { Translator } from './translator.js';

const config = createConfig(process.cwd());
const store = new Store(config.dbPath, config);
const translator = new Translator(config);
const robokassa = new Robokassa(config);
const service = new LampaTranslateService({ config, store, translator, robokassa });
const bot = new TelegramBot(config, service, store);
const server = createServer(service, bot, config);

service.start();
bot.start();

server.listen(config.port, () => {
  console.log(`[service] listening on :${config.port}`);
  console.log(`[service] public base URL: ${config.publicBaseUrl}`);
  console.log(`[service] telegram bot: ${bot.enabled ? 'enabled' : 'disabled'}`);
  console.log(`[service] robokassa: ${robokassa.isConfigured() ? 'configured' : 'not configured'}`);
});

function shutdown(signal) {
  console.log(`[service] ${signal}, shutting down`);
  bot.stop();
  server.close(() => {
    store.close();
    process.exit(0);
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
