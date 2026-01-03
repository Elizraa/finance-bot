import { Telegraf, Scenes, session, Markup } from 'telegraf';
import dotenv from 'dotenv';
import { Calendar } from 'telegram-inline-calendar';
import axios from 'axios';
import Database from 'better-sqlite3';
import crypto from 'crypto';

dotenv.config();

const { TELEGRAM_BOT_TOKEN, API_BASE_URL, ENCRYPTION_KEY } = process.env;

if (!TELEGRAM_BOT_TOKEN || !API_BASE_URL) {
  console.error('Please set TELEGRAM_BOT_TOKEN and API_BASE_URL in .env');
  process.exit(1);
}

// Warn if encryption key is missing
if (!ENCRYPTION_KEY) {
  console.warn(
    '⚠️  WARNING: ENCRYPTION_KEY not set. API keys will be stored in plain text!'
  );
}

// Initialize SQLite database
const db = new Database('bot_data.db');
db.pragma('journal_mode = WAL'); // Better concurrency

// Create table if not exists
db.exec(`
  CREATE TABLE IF NOT EXISTS user_api_keys (
    user_id INTEGER PRIMARY KEY,
    api_key TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// Database helper functions
const dbHelpers = {
  // Encrypt API key before storing
  encrypt(text) {
    if (!ENCRYPTION_KEY) return text; // Store plain if no key
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(
      'aes-256-cbc',
      Buffer.from(ENCRYPTION_KEY, 'hex'),
      iv
    );
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return iv.toString('hex') + ':' + encrypted;
  },

  // Decrypt API key when retrieving
  decrypt(text) {
    if (!ENCRYPTION_KEY) return text; // Return plain if no key
    const parts = text.split(':');
    const iv = Buffer.from(parts[0], 'hex');
    const encrypted = parts[1];
    const decipher = crypto.createDecipheriv(
      'aes-256-cbc',
      Buffer.from(ENCRYPTION_KEY, 'hex'),
      iv
    );
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  },

  saveApiKey(userId, apiKey) {
    const encrypted = this.encrypt(apiKey);
    const stmt = db.prepare(`
      INSERT INTO user_api_keys (user_id, api_key, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(user_id) DO UPDATE SET
        api_key = excluded.api_key,
        updated_at = CURRENT_TIMESTAMP
    `);
    stmt.run(userId, encrypted);
  },

  getApiKey(userId) {
    const stmt = db.prepare(
      'SELECT api_key FROM user_api_keys WHERE user_id = ?'
    );
    const row = stmt.get(userId);
    return row ? this.decrypt(row.api_key) : null;
  },

  deleteApiKey(userId) {
    const stmt = db.prepare('DELETE FROM user_api_keys WHERE user_id = ?');
    stmt.run(userId);
  },

  hasApiKey(userId) {
    const stmt = db.prepare('SELECT 1 FROM user_api_keys WHERE user_id = ?');
    return stmt.get(userId) !== undefined;
  },
};

const bot = new Telegraf(TELEGRAM_BOT_TOKEN);

// Helper to create API instance for a user
const createApiInstance = (apiKey) => {
  return axios.create({
    baseURL: API_BASE_URL,
    headers: {
      'x-api-key': apiKey,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
  });
};

const calendar = new Calendar(bot, {
  date_format: 'DD-MM-YYYY',
  language: 'id',
  bot_api: 'telegraf',
  custom_start_msg: 'Pilih tanggal: (tidak bisa pilih tanggal di masa depan)',
});

// Helpers
const parseAmount = (text) => {
  const normalized = String(text)
    .replace(/[^\d.,-]/g, '')
    .replace(',', '.');
  const n = Number(normalized);
  return Number.isFinite(n) ? n : NaN;
};

function isTheFuture(dateStr) {
  const [day, month, year] = dateStr.split('-');
  const date = new Date(year, month - 1, day);
  return date > new Date();
}

function decreaseCurrency(currentStr, amount) {
  const numeric = parseFloat(
    currentStr.replace(/[Rp\s.]/g, '').replace(',', '.')
  );
  const newValue = numeric - amount;
  return newValue.toLocaleString('id-ID', {
    style: 'currency',
    currency: 'IDR',
  });
}

async function fetchAccounts(api) {
  const { data } = await api.get('/accounts');
  return Array.isArray(data) ? data : data.accounts || [];
}

// API Key setup wizard
const apiKeyWizard = new Scenes.WizardScene(
  'api-key-wizard',

  async (ctx) => {
    await ctx.reply(
      '🔑 Silakan masukkan API Key Anda:\n\n' +
        '(API Key akan disimpan dengan enkripsi dan digunakan untuk semua transaksi Anda)'
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

    // Delete the message containing API key for security
    try {
      await ctx.deleteMessage(ctx.message.message_id);
    } catch (e) {
      // Ignore if bot doesn't have permission
    }

    // Test the API key
    try {
      const testApi = createApiInstance(apiKey);
      await testApi.get('/accounts');

      // Save the API key to database
      dbHelpers.saveApiKey(userId, apiKey);

      await ctx.reply(
        '✅ API Key berhasil disimpan!\n\n' +
          'Gunakan /create untuk membuat transaksi baru.'
      );
    } catch (e) {
      await ctx.reply(
        '❌ API Key tidak valid atau gagal terhubung ke server.\n\n' +
          'Error: ' +
          (e.response?.data?.message || e.message) +
          '\n\n' +
          'Silakan coba lagi dengan /reset'
      );
    }

    return ctx.scene.leave();
  }
);

// Transaction wizard
const transactionWizard = new Scenes.WizardScene(
  'transaction-wizard',

  async (ctx) => {
    const userId = ctx.from.id;
    const apiKey = dbHelpers.getApiKey(userId);

    if (!apiKey) {
      await ctx.reply(
        '❌ API Key belum diatur.\n\n' +
          'Gunakan /reset untuk mengatur API Key terlebih dahulu.'
      );
      return ctx.scene.leave();
    }

    ctx.wizard.state.tx = {};
    ctx.wizard.state.apiKey = apiKey;
    await ctx.reply(
      'Deskripsi transaksi? (ketik bebas)',
      Markup.inlineKeyboard([[Markup.button.callback('❌ Batal', 'cancel')]])
    );
    return ctx.wizard.next();
  },

  async (ctx) => {
    // Handle cancel button
    if (ctx.callbackQuery?.data === 'cancel') {
      await ctx.editMessageText('❌ Transaksi dibatalkan.');
      return ctx.scene.leave();
    }

    if (!ctx.message?.text) return;

    ctx.wizard.state.tx.name = ctx.message.text.trim();
    await ctx.reply(
      'Nominal transaksi? (angka)',
      Markup.inlineKeyboard([[Markup.button.callback('❌ Batal', 'cancel')]])
    );
    return ctx.wizard.next();
  },

  async (ctx) => {
    if (ctx.callbackQuery?.data === 'cancel') {
      await ctx.editMessageText('❌ Transaksi dibatalkan.');
      return ctx.scene.leave();
    }

    if (!ctx.message?.text) return;

    const amount = parseFloat(ctx.message.text.replace(/[^\d.-]/g, ''));
    if (isNaN(amount)) {
      await ctx.reply('Nominal tidak valid. Coba lagi.');
      return;
    }

    ctx.wizard.state.tx.amount = parseAmount(amount);
    calendar.startNavCalendar(ctx);
    return ctx.wizard.next();
  },

  async (ctx) => {
    const selected = calendar.clickButtonCalendar(ctx);
    if (selected === -1) return;

    if (isTheFuture(selected)) {
      await ctx.reply(
        '❌ Dibatalkan, Tidak bisa memilih tanggal di masa depan.'
      );
      return ctx.scene.leave();
    }

    ctx.wizard.state.tx.date = selected;

    const api = createApiInstance(ctx.wizard.state.apiKey);
    let accounts;
    try {
      accounts = await fetchAccounts(api);
    } catch (e) {
      console.error(e?.response?.data || e.message);
      await ctx.reply(
        'Gagal mengambil daftar sumber dari API. Coba lagi /create.'
      );
      return ctx.scene.leave();
    }

    if (!accounts.length) {
      await ctx.reply(
        'Tidak ada sumber tersedia. Tambahkan sumber dulu di aplikasi.'
      );
      return ctx.scene.leave();
    }
    ctx.wizard.state.accounts = accounts;
    ctx.wizard.state.selected = { account: null, category: null };

    await showAccounts(ctx);
    return ctx.wizard.next();
  },

  async (ctx) => {
    // Handle cancel button on account selection
    if (ctx.callbackQuery?.data === 'cancel') {
      await ctx.editMessageText('❌ Transaksi dibatalkan.');
      return ctx.scene.leave();
    }

    if (!ctx.callbackQuery?.data.startsWith('account:')) return;

    const accountId = ctx.callbackQuery.data.split(':')[1];
    const accountName = ctx.callbackQuery.data.split(':')[2];
    ctx.wizard.state.selected.account = { id: accountId, name: accountName };

    await showConfirm(ctx);
    return ctx.wizard.next();
  },

  async (ctx) => {
    if (!ctx.callbackQuery?.data.startsWith('confirm:')) return;

    const action = ctx.callbackQuery.data.split(':')[1];
    if (action === 'no') {
      await ctx.editMessageText('❌ Dibatalkan.');
      return ctx.scene.leave();
    }

    const { tx, selected, accounts, apiKey } = ctx.wizard.state;
    const payload = {
      transaction: {
        account_id: selected.account.id,
        description: tx.name,
        date: tx.date,
        amount: tx.amount,
        nature: 'expense',
      },
    };

    try {
      const api = createApiInstance(apiKey);
      const { status } = await api.post('/transactions', payload);
      if (status === 200 || status === 201) {
        const prevBalance = accounts.find(
          (a) => a.id === selected.account.id
        ).balance;
        const newBalance = decreaseCurrency(
          prevBalance,
          payload.transaction.amount
        );
        await ctx.editMessageText(
          `✅ Tersimpan!\n\n` +
            `Deskripsi: ${payload.transaction.description}\n` +
            `Sumber: ${selected.account.name}\n` +
            `Tanggal: ${payload.transaction.date}\n` +
            `Jumlah: ${payload.transaction.amount}\n` +
            `Saldo sebelumnya: ${prevBalance}\n` +
            `Saldo baru: ${newBalance}`
        );
      } else {
        await ctx.editMessageText(`Terjadi kesalahan (status ${status}).`);
      }
    } catch (e) {
      await ctx.editMessageText(
        '❌ Gagal simpan: ' + (e.response?.data?.message || e.message)
      );
    }

    return ctx.scene.leave();
  }
);

// Helper functions
async function showAccounts(ctx) {
  const { tx } = ctx.wizard.state;
  const text =
    `Deskripsi: ${tx.name}\n` +
    `Nominal: ${tx.amount}\n` +
    `Tanggal: ${tx.date}\n` +
    'Pilih Sumber:';

  const { accounts } = ctx.wizard.state;
  const rowSize = 3;
  const buttons = accounts.map((a) =>
    Markup.button.callback(a.name, `account:${a.id}:${a.name}`)
  );

  // Split into rows
  const keyboard = [];
  for (let i = 0; i < buttons.length; i += rowSize) {
    keyboard.push(buttons.slice(i, i + rowSize));
  }

  // Add cancel button at the bottom
  keyboard.push([Markup.button.callback('❌ Batal', 'cancel')]);

  await ctx.reply(text, Markup.inlineKeyboard(keyboard));
}

async function showConfirm(ctx) {
  const { tx, selected } = ctx.wizard.state;
  const accountName = selected.account?.name || '-';

  const text =
    `Deskripsi: ${tx.name}\n` +
    `Nominal: ${tx.amount}\n` +
    `Tanggal: ${tx.date}\n` +
    `Sumber: ${accountName}\n`;

  const buttons = [
    [Markup.button.callback('✅ Simpan', 'confirm:yes')],
    [Markup.button.callback('❌ Batal', 'confirm:no')],
  ];

  await ctx.editMessageText(text, Markup.inlineKeyboard(buttons));
}

const stage = new Scenes.Stage([apiKeyWizard, transactionWizard], { ttl: 600 });

bot.use(session());
bot.use(stage.middleware());

// Commands
bot.start((ctx) => {
  const userId = ctx.from.id;
  const hasApiKey = dbHelpers.hasApiKey(userId);

  if (hasApiKey) {
    return ctx.reply(
      '👋 Selamat datang kembali!\n\n' +
        'Perintah yang tersedia:\n' +
        '/create - Buat transaksi baru\n' +
        '/balance - Lihat saldo akun\n' +
        '/reset - Ganti API Key\n' +
        '/delete - Hapus API Key'
    );
  } else {
    return ctx.reply(
      '👋 Selamat datang!\n\n' +
        'Untuk memulai, silakan atur API Key Anda dengan perintah /reset'
    );
  }
});

bot.command('create', (ctx) => {
  const userId = ctx.from.id;
  if (!dbHelpers.hasApiKey(userId)) {
    return ctx.reply(
      '❌ API Key belum diatur.\n\n' +
        'Gunakan /reset untuk mengatur API Key terlebih dahulu.'
    );
  }
  return ctx.scene.enter('transaction-wizard');
});

bot.command('reset', (ctx) => ctx.scene.enter('api-key-wizard'));

bot.command('balance', async (ctx) => {
  const userId = ctx.from.id;
  const apiKey = dbHelpers.getApiKey(userId);

  if (!apiKey) {
    return ctx.reply(
      '❌ API Key belum diatur.\n\n' +
        'Gunakan /reset untuk mengatur API Key terlebih dahulu.'
    );
  }

  try {
    const api = createApiInstance(apiKey);
    const { data } = await api.get('/accounts');
    const accounts = Array.isArray(data) ? data : data.accounts || [];

    if (!accounts.length) {
      return ctx.reply('📊 Tidak ada akun ditemukan.');
    }

    // Calculate total balance
    let totalBalance = 0;

    // Helper function to escape Markdown special characters
    const escapeMarkdown = (text) => {
      return text.replace(/[_*[\]()~`>#+=|{}.!-]/g, ' ');
    };

    // Format message
    let message = '💰 *Saldo Akun Anda*\n\n';

    accounts.forEach((account, index) => {
      const accountName = escapeMarkdown(account.name);
      const balance = escapeMarkdown(account.balance);
      const accountType = escapeMarkdown(account.account_type);
      const classification =
        account.classification === 'liability' ? '💳' : '💰';
      const numeric = parseFloat(
        account.balance.replace(/[Rp\s.]/g, '').replace(',', '.')
      );
      if (account.classification === 'liability') {
        totalBalance -= numeric;
      } else {
        totalBalance += numeric;
      }
      message += `${index + 1}. *${accountName}*\n`;
      message += `   ${balance} ${classification}\n`;
      message += `   _${accountType}_\n\n`;
    });

    message += '━━━━━━━━━━━━━━━━\n';
    message += `*Total: ${totalBalance.toLocaleString('id-ID', {
      style: 'currency',
      currency: 'IDR',
    })}*`;

    await ctx.reply(message, { parse_mode: 'Markdown' });
  } catch (e) {
    console.error(e?.response?.data || e.message);
    await ctx.reply(
      '❌ Gagal mengambil data saldo.\n\n' +
        'Error: ' +
        (e.response?.data?.message || e.message)
    );
  }
});

bot.command('delete', (ctx) => {
  const userId = ctx.from.id;
  if (!dbHelpers.hasApiKey(userId)) {
    return ctx.reply('❌ Anda belum memiliki API Key yang tersimpan.');
  }

  dbHelpers.deleteApiKey(userId);
  return ctx.reply(
    '✅ API Key berhasil dihapus.\n\n' +
      'Gunakan /reset untuk mengatur API Key baru.'
  );
});

bot.command('new', (ctx) => {
  return ctx.reply(
    'ℹ️  Perintah /new sudah tidak digunakan.\n' +
      'Gunakan /create untuk membuat transaksi baru.'
  );
});

bot.on('message', (ctx) => {
  if (!ctx.scene?.current) {
    return ctx.reply(
      'Perintah yang tersedia:\n' +
        '/create - Buat transaksi baru\n' +
        '/balance - Lihat saldo akun\n' +
        '/reset - Ganti API Key'
    );
  }
});

bot.launch().then(() => console.log('Bot running…'));

// Graceful shutdown
process.once('SIGINT', () => {
  db.close();
  bot.stop('SIGINT');
});
process.once('SIGTERM', () => {
  db.close();
  bot.stop('SIGTERM');
});
