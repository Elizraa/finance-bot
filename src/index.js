import { Telegraf, Scenes, session } from 'telegraf';
import { Calendar } from 'telegram-inline-calendar';
import dotenv from 'dotenv';

dotenv.config();

import { log } from './lib/logger.js';
import db, { dbHelpers } from './lib/database.js';
import {
  createApiInstance,
  fetchAccounts,
  fetchCategories,
  parseAmount,
  isTheFuture,
  decreaseCurrency,
  increaseCurrency,
} from './lib/api.js';
import { createApiKeyWizard } from './scenes/api-key-wizard.js';
import { createTransactionWizard } from './scenes/transaction-wizard.js';
import registerStart from './commands/start.js';
import registerCreate from './commands/create.js';
import registerReset from './commands/reset.js';
import registerBalance from './commands/balance.js';
import registerDelete from './commands/delete.js';
import registerToggleCategories from './commands/toggle_categories.js';
import registerNew from './commands/new.js';

// ─── Environment ────────────────────────────────────────────────────────────────

const { TELEGRAM_BOT_TOKEN, API_BASE_URL } = process.env;

if (!TELEGRAM_BOT_TOKEN || !API_BASE_URL) {
  log.error('Missing required env vars: TELEGRAM_BOT_TOKEN and API_BASE_URL');
  process.exit(1);
}

if (!process.env.ENCRYPTION_KEY) {
  log.warn('ENCRYPTION_KEY not set — API keys will be stored in plain text!');
}

// ─── Bot ────────────────────────────────────────────────────────────────────────

const bot = new Telegraf(TELEGRAM_BOT_TOKEN);

const calendar = new Calendar(bot, {
  date_format: 'DD-MM-YYYY',
  language: 'id',
  bot_api: 'telegraf',
  custom_start_msg: 'Pilih tanggal: (tidak bisa pilih tanggal di masa depan)',
});

// ─── Scenes ─────────────────────────────────────────────────────────────────────

const scenes = [
  createApiKeyWizard({ log, createApiInstance, dbHelpers }),
  createTransactionWizard({
    log,
    dbHelpers,
    createApiInstance,
    fetchAccounts,
    fetchCategories,
    calendar,
    parseAmount,
    isTheFuture,
    decreaseCurrency,
    increaseCurrency,
  }),
];

const stage = new Scenes.Stage(scenes, { ttl: 600 });

bot.use(session());
bot.use(stage.middleware());

bot.use((ctx, next) => {
  const userId = ctx.from?.id;
  const type = ctx.updateType;
  const text = ctx.message?.text || ctx.callbackQuery?.data || '';
  log.debug('Incoming update', { userId, type, text });
  return next();
});

// ─── Commands ───────────────────────────────────────────────────────────────────

const deps = { log, dbHelpers, createApiInstance };

registerStart(bot, deps);
registerCreate(bot, deps);
registerReset(bot, deps);
registerBalance(bot, deps);
registerDelete(bot, deps);
registerToggleCategories(bot, deps);
registerNew(bot, deps);

// ─── Catch-all ──────────────────────────────────────────────────────────────────

bot.on('message', (ctx) => {
  if (!ctx.scene?.current) {
    log.user(ctx.from.id, 'Unhandled message outside scene', {
      text: ctx.message?.text,
    });
    return ctx.reply(
      'Perintah yang tersedia:\n' +
        '/create - Buat transaksi baru\n' +
        '/balance - Lihat saldo akun\n' +
        '/reset - Ganti API Key\n' +
        '/toggle_categories - Aktifkan/nonaktifkan kategori',
    );
  }
});

// ─── Launch ─────────────────────────────────────────────────────────────────────

bot.launch().then(() => log.info('Bot running…'));

process.once('SIGINT', () => {
  log.info('SIGINT received, shutting down…');
  db.close();
  bot.stop('SIGINT');
});
process.once('SIGTERM', () => {
  log.info('SIGTERM received, shutting down…');
  db.close();
  bot.stop('SIGTERM');
});
