import { Telegraf, Scenes, session, Markup } from 'telegraf';
import dotenv from 'dotenv';
import { Calendar } from 'telegram-inline-calendar';
import axios from 'axios';
import Database from 'better-sqlite3';
import crypto from 'crypto';
import pino from 'pino';
import pinoRoll from 'pino-roll';

dotenv.config();

// ─── Logger Setup ────────────────────────────────────────────────────────────
// pino-roll writes one file per day: logs/bot.2025-01-24.log
// Files also rotate mid-day if they exceed 20 MB.

const fileStream = await pinoRoll({
  file: 'logs/app',
  frequency: 'daily',
  mkdir: true,
  size: '20m',
  dateFormat: 'yyyy-MM-dd',
});

const logger = pino(
  {
    level: process.env.LOG_LEVEL || 'debug',
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level(label) {
        return { level: label };
      },
    },
  },
  pino.multistream([
    // Structured JSON → file (info and above)
    { stream: fileStream, level: 'info' },
    // Human-readable → console (debug and above)
    {
      stream: pino.transport({
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'HH:MM:ss',
          ignore: 'pid,hostname',
        },
      }),
      level: 'debug',
    },
  ]),
);

// Convenience wrappers — keeps call sites tidy and attaches userId context
const log = {
  info: (msg, meta = {}) => logger.info(meta, msg),
  warn: (msg, meta = {}) => logger.warn(meta, msg),
  error: (msg, meta = {}) => logger.error(meta, msg),
  debug: (msg, meta = {}) => logger.debug(meta, msg),
  user: (userId, msg, meta = {}) => logger.info({ userId, ...meta }, msg),
  userError: (userId, msg, meta = {}) => logger.error({ userId, ...meta }, msg),
};

// ─── Environment ─────────────────────────────────────────────────────────────

const { TELEGRAM_BOT_TOKEN, API_BASE_URL, ENCRYPTION_KEY } = process.env;

if (!TELEGRAM_BOT_TOKEN || !API_BASE_URL) {
  log.error('Missing required env vars: TELEGRAM_BOT_TOKEN and API_BASE_URL');
  process.exit(1);
}

if (!ENCRYPTION_KEY) {
  log.warn('ENCRYPTION_KEY not set — API keys will be stored in plain text!');
}

// ─── Database ────────────────────────────────────────────────────────────────

const db = new Database('bot_data.db');
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS user_api_keys (
    user_id INTEGER PRIMARY KEY,
    api_key TEXT NOT NULL,
    categories_enabled INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// Migrate existing tables that don't have the categories_enabled column yet
try {
  db.exec(
    `ALTER TABLE user_api_keys ADD COLUMN categories_enabled INTEGER NOT NULL DEFAULT 0`,
  );
  log.info('Migrated user_api_keys: added categories_enabled column');
} catch {
  // Column already exists — safe to ignore
}

log.info('Database initialised', { file: 'bot_data.db' });

const dbHelpers = {
  encrypt(text) {
    if (!ENCRYPTION_KEY) return text;
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(
      'aes-256-cbc',
      Buffer.from(ENCRYPTION_KEY, 'hex'),
      iv,
    );
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return iv.toString('hex') + ':' + encrypted;
  },

  decrypt(text) {
    if (!ENCRYPTION_KEY) return text;
    const parts = text.split(':');
    const iv = Buffer.from(parts[0], 'hex');
    const encrypted = parts[1];
    const decipher = crypto.createDecipheriv(
      'aes-256-cbc',
      Buffer.from(ENCRYPTION_KEY, 'hex'),
      iv,
    );
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  },

  saveApiKey(userId, apiKey) {
    const encrypted = this.encrypt(apiKey);
    db.prepare(
      `
      INSERT INTO user_api_keys (user_id, api_key, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(user_id) DO UPDATE SET
        api_key = excluded.api_key,
        updated_at = CURRENT_TIMESTAMP
    `,
    ).run(userId, encrypted);
    log.user(userId, 'API key saved/updated');
  },

  getApiKey(userId) {
    const row = db
      .prepare('SELECT api_key FROM user_api_keys WHERE user_id = ?')
      .get(userId);
    return row ? this.decrypt(row.api_key) : null;
  },

  deleteApiKey(userId) {
    db.prepare('DELETE FROM user_api_keys WHERE user_id = ?').run(userId);
    log.user(userId, 'API key deleted');
  },

  hasApiKey(userId) {
    return (
      db
        .prepare('SELECT 1 FROM user_api_keys WHERE user_id = ?')
        .get(userId) !== undefined
    );
  },

  // ── Category toggle helpers ──────────────────────────────────────────────

  getCategoriesEnabled(userId) {
    const row = db
      .prepare('SELECT categories_enabled FROM user_api_keys WHERE user_id = ?')
      .get(userId);
    return row ? row.categories_enabled === 1 : false;
  },

  toggleCategories(userId) {
    const current = this.getCategoriesEnabled(userId);
    const next = current ? 0 : 1;
    db.prepare(
      `UPDATE user_api_keys SET categories_enabled = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?`,
    ).run(next, userId);
    log.user(userId, 'Categories toggled', { enabled: next === 1 });
    return next === 1;
  },
};

// ─── Bot & API ───────────────────────────────────────────────────────────────

const bot = new Telegraf(TELEGRAM_BOT_TOKEN);

const createApiInstance = (apiKey) =>
  axios.create({
    baseURL: API_BASE_URL,
    headers: {
      'x-api-key': apiKey,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
  });

const calendar = new Calendar(bot, {
  date_format: 'DD-MM-YYYY',
  language: 'id',
  bot_api: 'telegraf',
  custom_start_msg: 'Pilih tanggal: (tidak bisa pilih tanggal di masa depan)',
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

const parseAmount = (text) => {
  const normalized = String(text)
    .replace(/[^\d.,-]/g, '')
    .replace(',', '.');
  const n = Number(normalized);
  return Number.isFinite(n) ? n : NaN;
};

function isTheFuture(dateStr) {
  const [day, month, year] = dateStr.split('-');
  return new Date(year, month - 1, day) > new Date();
}

function decreaseCurrency(currentStr, amount) {
  const numeric = parseFloat(
    currentStr.replace(/[Rp\s.]/g, '').replace(',', '.'),
  );
  return (numeric - amount).toLocaleString('id-ID', {
    style: 'currency',
    currency: 'IDR',
  });
}

function increaseCurrency(currentStr, amount) {
  const numeric = parseFloat(
    currentStr.replace(/[Rp\s.]/g, '').replace(',', '.'),
  );
  return (numeric + amount).toLocaleString('id-ID', {
    style: 'currency',
    currency: 'IDR',
  });
}

async function fetchAccounts(api) {
  const { data } = await api.get('/accounts');
  return Array.isArray(data) ? data : data.accounts || [];
}

async function fetchCategories(api) {
  const { data } = await api.get('/categories');
  return Array.isArray(data) ? data : data.categories || [];
}

// ─── API Key Wizard ───────────────────────────────────────────────────────────

const apiKeyWizard = new Scenes.WizardScene(
  'api-key-wizard',

  async (ctx) => {
    log.user(ctx.from.id, 'Entered api-key-wizard');
    await ctx.reply(
      '🔑 Silakan masukkan API Key Anda:\n\n' +
        '(API Key akan disimpan dengan enkripsi dan digunakan untuk semua transaksi Anda)',
    );
    return ctx.wizard.next();
  },

  async (ctx) => {
    if (!ctx.message?.text) {
      await ctx.reply('❌ Harap kirim API Key dalam bentuk teks.');
      return;
    }

    const apiKey = ctx.message.text.trim();
    const userId = ctx.from.id;

    try {
      await ctx.deleteMessage(ctx.message.message_id);
    } catch (e) {
      log.debug('Could not delete API key message', {
        userId,
        reason: e.message,
      });
    }

    try {
      const testApi = createApiInstance(apiKey);
      await testApi.get('/accounts');

      dbHelpers.saveApiKey(userId, apiKey);
      log.user(userId, 'API key validated and saved');

      await ctx.reply(
        '✅ API Key berhasil disimpan!\n\n' +
          'Gunakan /create untuk membuat transaksi baru.',
      );
    } catch (e) {
      const reason = e.response?.data?.message || e.message;
      log.userError(userId, 'API key validation failed', { reason });
      await ctx.reply(
        '❌ API Key tidak valid atau gagal terhubung ke server.\n\n' +
          'Error: ' +
          reason +
          '\n\n' +
          'Silakan coba lagi dengan /reset',
      );
    }

    return ctx.scene.leave();
  },
);

// ─── Transaction Wizard ───────────────────────────────────────────────────────
//
// Step layout:
//   0 → guard + ask description
//   1 → save description, ask amount
//   2 → save amount, show calendar
//   3 → save date
//         categories ON  → fetch & show categories → next (step 4: cat handler)
//         categories OFF → fetch & show accounts   → next (step 4: acc handler)
//   4 → categories ON:  save category → fetch & show accounts → next (step 5: acc handler)
//       categories OFF: save account  → show confirm          → next (step 5: confirm)
//   5 → categories ON:  save account → show confirm → next (step 6: confirm)
//       categories OFF: confirm → submit → leave
//   6 → categories ON:  confirm → submit → leave

const transactionWizard = new Scenes.WizardScene(
  'transaction-wizard',

  // ── Step 0 ─────────────────────────────────────────────────────────────────
  async (ctx) => {
    const userId = ctx.from.id;
    const apiKey = dbHelpers.getApiKey(userId);

    if (!apiKey) {
      log.user(userId, 'Attempted /create without API key');
      await ctx.reply(
        '❌ API Key belum diatur.\n\n' +
          'Gunakan /reset untuk mengatur API Key terlebih dahulu.',
      );
      return ctx.scene.leave();
    }

    log.user(userId, 'Entered transaction-wizard');
    ctx.wizard.state.tx = {};
    ctx.wizard.state.apiKey = apiKey;
    ctx.wizard.state.categoriesEnabled = dbHelpers.getCategoriesEnabled(userId);

    await ctx.reply(
      'Deskripsi transaksi? (ketik bebas)',
      Markup.inlineKeyboard([[Markup.button.callback('❌ Batal', 'cancel')]]),
    );
    return ctx.wizard.next();
  },

  // ── Step 1 ─────────────────────────────────────────────────────────────────
  async (ctx) => {
    if (ctx.callbackQuery?.data === 'cancel') {
      log.user(ctx.from.id, 'Transaction cancelled at description step');
      await ctx.editMessageText('❌ Transaksi dibatalkan.');
      return ctx.scene.leave();
    }
    if (!ctx.message?.text) return;

    ctx.wizard.state.tx.name = ctx.message.text.trim();
    log.user(ctx.from.id, 'Description set', {
      description: ctx.wizard.state.tx.name,
    });

    await ctx.reply(
      'Nominal transaksi? (angka)',
      Markup.inlineKeyboard([[Markup.button.callback('❌ Batal', 'cancel')]]),
    );
    return ctx.wizard.next();
  },

  // ── Step 2 ─────────────────────────────────────────────────────────────────
  async (ctx) => {
    if (ctx.callbackQuery?.data === 'cancel') {
      log.user(ctx.from.id, 'Transaction cancelled at amount step');
      await ctx.editMessageText('❌ Transaksi dibatalkan.');
      return ctx.scene.leave();
    }
    if (!ctx.message?.text) return;

    const amount = parseFloat(ctx.message.text.replace(/[^\d.-]/g, ''));
    if (isNaN(amount)) {
      log.user(ctx.from.id, 'Invalid amount entered', {
        raw: ctx.message.text,
      });
      await ctx.reply('Nominal tidak valid. Coba lagi.');
      return;
    }

    ctx.wizard.state.tx.amount = parseAmount(amount);
    log.user(ctx.from.id, 'Amount set', { amount: ctx.wizard.state.tx.amount });

    calendar.options.stop_date = new Date().toISOString().split('T')[0];
    calendar.startNavCalendar(ctx);
    return ctx.wizard.next();
  },

  // ── Step 3: date → branch on categories toggle ─────────────────────────────
  async (ctx) => {
    if (!ctx.callbackQuery) return;

    const selected = calendar.clickButtonCalendar(ctx);
    if (selected === -1) return;

    if (isTheFuture(selected)) {
      log.user(ctx.from.id, 'Future date selected, aborting', {
        date: selected,
      });
      await ctx.reply(
        '❌ Dibatalkan, Tidak bisa memilih tanggal di masa depan.',
      );
      return ctx.scene.leave();
    }

    ctx.wizard.state.tx.date = selected;
    ctx.wizard.state.selected = { account: null, category: null };
    log.user(ctx.from.id, 'Date selected', { date: selected });

    const api = createApiInstance(ctx.wizard.state.apiKey);

    if (ctx.wizard.state.categoriesEnabled) {
      // ── Fetch categories ──
      let categories;
      try {
        categories = await fetchCategories(api);
      } catch (e) {
        log.userError(ctx.from.id, 'Failed to fetch categories', {
          reason: e?.response?.data || e.message,
        });
        await ctx.reply(
          'Gagal mengambil daftar kategori dari API. Coba lagi /create.',
        );
        return ctx.scene.leave();
      }

      ctx.wizard.state.categories = categories;

      if (!categories.length) {
        // No categories — skip straight to accounts
        log.user(
          ctx.from.id,
          'No categories available, skipping category step',
        );
        await _loadAndShowAccounts(ctx, api);
        ctx.wizard.state.skipCategoryStep = true;
      } else {
        await showCategories(ctx);
        ctx.wizard.state.skipCategoryStep = false;
      }
    } else {
      // ── Fetch accounts directly ──
      await _loadAndShowAccounts(ctx, api);
    }

    return ctx.wizard.next(); // → step 4
  },

  // ── Step 4 ─────────────────────────────────────────────────────────────────
  async (ctx) => {
    if (ctx.callbackQuery?.data === 'cancel') {
      await ctx.editMessageText('❌ Transaksi dibatalkan.');
      return ctx.scene.leave();
    }

    const { categoriesEnabled, skipCategoryStep } = ctx.wizard.state;

    if (categoriesEnabled && !skipCategoryStep) {
      // Expect a category: callback
      if (!ctx.callbackQuery?.data?.startsWith('category:')) return;

      const categoryId = ctx.callbackQuery.data.split(':')[1];
      const cat = ctx.wizard.state.categories.find((c) => c.id === categoryId);
      if (!cat) {
        await ctx.answerCbQuery('❌ Kategori tidak ditemukan');
        return;
      }

      ctx.wizard.state.selected.category = { id: categoryId, name: cat.name };
      log.user(ctx.from.id, 'Category selected', {
        categoryId,
        categoryName: cat.name,
      });

      // Now fetch + show accounts (same bubble as category picker)
      const api = createApiInstance(ctx.wizard.state.apiKey);
      await _loadAndShowAccounts(ctx, api, { replaceMessage: true });
      return ctx.wizard.next(); // → step 5
    }

    // categories OFF  OR  categories ON but skipCategoryStep=true
    // Expect an account: callback
    if (!ctx.callbackQuery?.data?.startsWith('account:')) return;

    const accountId = ctx.callbackQuery.data.split(':')[1];
    const acc = ctx.wizard.state.accounts.find((a) => a.id === accountId);
    if (!acc) {
      await ctx.answerCbQuery('❌ Akun tidak ditemukan');
      return;
    }

    ctx.wizard.state.selected.account = { id: accountId, name: acc.name };
    log.user(ctx.from.id, 'Account selected', {
      accountId,
      accountName: acc.name,
    });

    await showConfirm(ctx);
    return ctx.wizard.next(); // → step 5
  },

  // ── Step 5 ─────────────────────────────────────────────────────────────────
  async (ctx) => {
    if (ctx.callbackQuery?.data === 'cancel') {
      await ctx.editMessageText('❌ Transaksi dibatalkan.');
      return ctx.scene.leave();
    }

    const { categoriesEnabled, skipCategoryStep } = ctx.wizard.state;

    if (categoriesEnabled && !skipCategoryStep) {
      // Expect an account: callback (categories were just selected in step 4)
      if (!ctx.callbackQuery?.data?.startsWith('account:')) return;

      const accountId = ctx.callbackQuery.data.split(':')[1];
      const acc = ctx.wizard.state.accounts.find((a) => a.id === accountId);
      if (!acc) {
        await ctx.answerCbQuery('❌ Akun tidak ditemukan');
        return;
      }

      ctx.wizard.state.selected.account = { id: accountId, name: acc.name };
      log.user(ctx.from.id, 'Account selected (after category)', {
        accountId,
        accountName: acc.name,
      });

      await showConfirm(ctx);
      return ctx.wizard.next(); // → step 6
    }

    // categories OFF or skipCategoryStep: expect confirm callback
    if (!ctx.callbackQuery?.data?.startsWith('confirm:')) return;
    if (ctx.callbackQuery.data === 'confirm:no') {
      await ctx.editMessageText('❌ Dibatalkan.');
      return ctx.scene.leave();
    }

    return submitTransaction(ctx);
  },

  // ── Step 6 (categories ON only) ────────────────────────────────────────────
  async (ctx) => {
    if (!ctx.callbackQuery?.data?.startsWith('confirm:')) return;
    if (ctx.callbackQuery.data === 'confirm:no') {
      await ctx.editMessageText('❌ Dibatalkan.');
      return ctx.scene.leave();
    }

    return submitTransaction(ctx);
  },
);

// ─── Shared wizard helpers ────────────────────────────────────────────────────

async function _loadAndShowAccounts(ctx, api, options = {}) {
  const replaceMessage = options.replaceMessage === true;

  const notifyAndLeave = async (text) => {
    if (replaceMessage && ctx.callbackQuery) {
      await ctx.answerCbQuery();
      await ctx.editMessageText(text);
    } else {
      await ctx.reply(text);
    }
    return ctx.scene.leave();
  };

  let accounts;
  try {
    accounts = await fetchAccounts(api);
  } catch (e) {
    log.userError(ctx.from.id, 'Failed to fetch accounts', {
      reason: e?.response?.data || e.message,
    });
    return notifyAndLeave(
      'Gagal mengambil daftar sumber dari API. Coba lagi /create.',
    );
  }

  if (!accounts.length) {
    log.user(ctx.from.id, 'No accounts available');
    return notifyAndLeave(
      'Tidak ada sumber tersedia. Tambahkan sumber dulu di aplikasi.',
    );
  }

  ctx.wizard.state.accounts = accounts;
  await showAccounts(ctx, { edit: replaceMessage });
}

async function submitTransaction(ctx) {
  const { tx, selected, accounts, apiKey } = ctx.wizard.state;

  const payload = {
    transaction: {
      account_id: selected.account.id,
      description: tx.name,
      date: tx.date,
      amount: tx.amount,
      nature: 'expense',
      ...(selected.category?.id ? { category_id: selected.category.id } : {}),
    },
  };

  log.user(ctx.from.id, 'Submitting transaction', {
    description: tx.name,
    amount: tx.amount,
    date: tx.date,
    accountId: selected.account.id,
    categoryId: selected.category?.id ?? null,
  });

  try {
    const api = createApiInstance(apiKey);
    const { status } = await api.post('/transactions', payload);

    if (status === 200 || status === 201) {
      const selectedAccount = accounts.find(
        (a) => a.id === selected.account.id,
      );
      const prevBalance = selectedAccount.balance;
      const newBalance =
        selectedAccount.classification === 'liability'
          ? increaseCurrency(prevBalance, payload.transaction.amount)
          : decreaseCurrency(prevBalance, payload.transaction.amount);

      log.user(ctx.from.id, 'Transaction saved successfully', {
        status,
        description: tx.name,
        amount: tx.amount,
      });

      const categoryLine = selected.category
        ? `Kategori: ${selected.category.name}\n`
        : '';

      await ctx.editMessageText(
        `✅ Tersimpan!\n\n` +
          `Deskripsi: ${payload.transaction.description}\n` +
          `Sumber: ${selected.account.name}\n` +
          categoryLine +
          `Tanggal: ${payload.transaction.date}\n` +
          `Jumlah: ${payload.transaction.amount}\n` +
          `Saldo sebelumnya: ${prevBalance}\n` +
          `Saldo baru: ${newBalance}`,
      );
    } else {
      log.userError(ctx.from.id, 'Unexpected status from API', { status });
      await ctx.editMessageText(`Terjadi kesalahan (status ${status}).`);
    }
  } catch (e) {
    const reason = e.response?.data?.message || e.message;
    log.userError(ctx.from.id, 'Transaction submission failed', { reason });
    await ctx.editMessageText('❌ Gagal simpan: ' + reason);
  }

  return ctx.scene.leave();
}

// ─── UI Helpers ───────────────────────────────────────────────────────────────

async function showCategories(ctx) {
  const { tx, categories } = ctx.wizard.state;
  const text =
    `Deskripsi: ${tx.name}\n` +
    `Nominal: ${tx.amount}\n` +
    `Tanggal: ${tx.date}\n` +
    'Pilih Kategori:';

  const rowSize = 2;
  const buttons = categories.map((c) =>
    Markup.button.callback(c.name, `category:${c.id}`),
  );
  const keyboard = [];
  for (let i = 0; i < buttons.length; i += rowSize) {
    keyboard.push(buttons.slice(i, i + rowSize));
  }
  keyboard.push([Markup.button.callback('❌ Batal', 'cancel')]);

  await ctx.reply(text, Markup.inlineKeyboard(keyboard));
}

async function showAccounts(ctx, options = {}) {
  const { tx, accounts, selected } = ctx.wizard.state;
  const categoryLine = selected?.category
    ? `Kategori: ${selected.category.name}\n`
    : '';

  const text =
    `Deskripsi: ${tx.name}\n` +
    `Nominal: ${tx.amount}\n` +
    `Tanggal: ${tx.date}\n` +
    categoryLine +
    'Pilih Sumber:';

  const rowSize = 2;
  const buttons = accounts.map((a) =>
    Markup.button.callback(a.name, `account:${a.id}`),
  );
  const keyboard = [];
  for (let i = 0; i < buttons.length; i += rowSize) {
    keyboard.push(buttons.slice(i, i + rowSize));
  }
  keyboard.push([Markup.button.callback('❌ Batal', 'cancel')]);

  const markup = Markup.inlineKeyboard(keyboard);
  if (options.edit && ctx.callbackQuery) {
    await ctx.answerCbQuery();
    await ctx.editMessageText(text, markup);
  } else {
    await ctx.reply(text, markup);
  }
}

async function showConfirm(ctx) {
  const { tx, selected } = ctx.wizard.state;
  const categoryLine = selected.category
    ? `Kategori: ${selected.category.name}\n`
    : '';

  const text =
    `Deskripsi: ${tx.name}\n` +
    `Nominal: ${tx.amount}\n` +
    `Tanggal: ${tx.date}\n` +
    categoryLine +
    `Sumber: ${selected.account?.name || '-'}\n`;

  await ctx.editMessageText(
    text,
    Markup.inlineKeyboard([
      [Markup.button.callback('✅ Simpan', 'confirm:yes')],
      [Markup.button.callback('❌ Batal', 'confirm:no')],
    ]),
  );
}

// ─── Stage & Middleware ───────────────────────────────────────────────────────

const stage = new Scenes.Stage([apiKeyWizard, transactionWizard], { ttl: 600 });

bot.use(session());
bot.use(stage.middleware());

bot.use((ctx, next) => {
  const userId = ctx.from?.id;
  const type = ctx.updateType;
  const text = ctx.message?.text || ctx.callbackQuery?.data || '';
  log.debug('Incoming update', { userId, type, text });
  return next();
});

// ─── Commands ────────────────────────────────────────────────────────────────

bot.start((ctx) => {
  const userId = ctx.from.id;
  const hasApiKey = dbHelpers.hasApiKey(userId);
  log.user(userId, '/start command', { hasApiKey });

  if (hasApiKey) {
    return ctx.reply(
      '👋 Selamat datang kembali!\n\n' +
        'Perintah yang tersedia:\n' +
        '/create - Buat transaksi baru\n' +
        '/balance - Lihat saldo akun\n' +
        '/reset - Ganti API Key\n' +
        '/delete - Hapus API Key\n' +
        '/toggle_categories - Aktifkan/nonaktifkan pemilihan kategori',
    );
  } else {
    return ctx.reply(
      '👋 Selamat datang!\n\n' +
        'Untuk memulai, silakan atur API Key Anda dengan perintah /reset',
    );
  }
});

bot.command('create', (ctx) => {
  const userId = ctx.from.id;
  log.user(userId, '/create command');
  console.log(
    '!dbHelpers.hasApiKey(userId) :>> ',
    !dbHelpers.hasApiKey(userId),
  );
  if (!dbHelpers.hasApiKey(userId)) {
    return ctx.reply(
      '❌ API Key belum diatur.\n\n' +
        'Gunakan /reset untuk mengatur API Key terlebih dahulu.',
    );
  }
  return ctx.scene.enter('transaction-wizard');
});

bot.command('reset', (ctx) => {
  log.user(ctx.from.id, '/reset command');
  return ctx.scene.enter('api-key-wizard');
});

bot.command('balance', async (ctx) => {
  const userId = ctx.from.id;
  log.user(userId, '/balance command');
  const apiKey = dbHelpers.getApiKey(userId);

  if (!apiKey) {
    return ctx.reply(
      '❌ API Key belum diatur.\n\n' +
        'Gunakan /reset untuk mengatur API Key terlebih dahulu.',
    );
  }

  try {
    const api = createApiInstance(apiKey);
    const { data } = await api.get('/accounts');
    const accounts = Array.isArray(data) ? data : data.accounts || [];

    log.user(userId, 'Balance fetched', { accountCount: accounts.length });

    if (!accounts.length) {
      return ctx.reply('📊 Tidak ada akun ditemukan.');
    }

    let totalBalance = 0;
    const escapeMarkdown = (text) =>
      text.replace(/[_*[\]()~`>#+=|{}.!-]/g, ' ');

    let message = '💰 *Saldo Akun Anda*\n\n';
    accounts.forEach((account, index) => {
      const accountName = escapeMarkdown(account.name);
      const classification =
        account.classification === 'liability' ? '💳' : '💰';
      const numeric = parseFloat(
        account.balance.replace(/[Rp\s.]/g, '').replace(',', '.'),
      );
      if (account.classification === 'liability') {
        totalBalance -= numeric;
      } else {
        totalBalance += numeric;
      }
      message += `${index + 1}. *${accountName}*\n`;
      message += `    ${account.balance} ${classification}\n`;
      message += `    _${escapeMarkdown(account.account_type)}_\n\n`;
    });

    message += '━━━━━━━━━━━━━━━━\n';
    message += `*Total: ${totalBalance.toLocaleString('id-ID', {
      style: 'currency',
      currency: 'IDR',
    })}*`;

    await ctx.reply(message, { parse_mode: 'Markdown' });
  } catch (e) {
    const reason = e?.response?.data || e.message;
    log.userError(userId, 'Failed to fetch balance', { reason });
    await ctx.reply(
      '❌ Gagal mengambil data saldo.\n\n' +
        'Error: ' +
        (e.response?.data?.message || e.message),
    );
  }
});

bot.command('delete', (ctx) => {
  const userId = ctx.from.id;
  log.user(userId, '/delete command');
  if (!dbHelpers.hasApiKey(userId)) {
    return ctx.reply('❌ Anda belum memiliki API Key yang tersimpan.');
  }
  dbHelpers.deleteApiKey(userId);
  return ctx.reply(
    '✅ API Key berhasil dihapus.\n\n' +
      'Gunakan /reset untuk mengatur API Key baru.',
  );
});

// ─── /toggle_categories ───────────────────────────────────────────────────────

bot.command('toggle_categories', (ctx) => {
  const userId = ctx.from.id;
  log.user(userId, '/toggle_categories command');

  if (!dbHelpers.hasApiKey(userId)) {
    return ctx.reply(
      '❌ API Key belum diatur.\n\n' +
        'Gunakan /reset untuk mengatur API Key terlebih dahulu.',
    );
  }

  const nowEnabled = dbHelpers.toggleCategories(userId);

  return ctx.reply(
    nowEnabled
      ? '✅ Pemilihan kategori *diaktifkan*.\n\nSetiap transaksi baru akan meminta Anda memilih kategori.'
      : '🔕 Pemilihan kategori *dinonaktifkan*.\n\nTransaksi akan dibuat tanpa kategori.',
    { parse_mode: 'Markdown' },
  );
});

bot.command('new', (ctx) => {
  log.user(ctx.from.id, '/new command (deprecated)');
  return ctx.reply(
    'ℹ️  Perintah /new sudah tidak digunakan.\n' +
      'Gunakan /create untuk membuat transaksi baru.',
  );
});

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

// ─── Launch ───────────────────────────────────────────────────────────────────

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
