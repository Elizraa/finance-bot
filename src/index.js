import { Telegraf, Scenes, session, Markup } from 'telegraf';
import { message } from 'telegraf/filters';
import dotenv from 'dotenv';

import { CATEGORIES } from './constant.js';

dotenv.config();

const { TELEGRAM_BOT_TOKEN } = process.env;

// Helpers
const today = () => new Date().toISOString().slice(0, 10);
const parseAmount = (text) => {
  // strip non-digits except dot/comma, then parse
  const normalized = String(text)
    .replace(/[^\d.,-]/g, '')
    .replace(',', '.');
  const n = Number(normalized);
  return Number.isFinite(n) ? n : NaN;
};

async function fetchAccounts() {
  // Adjust path to your API: e.g., GET /accounts?scope=family
  const { data } = await api.get('/accounts');
  // Expect an array like [{id, name}, ...]
  return Array.isArray(data) ? data : data.accounts || [];
}

async function fetchCategories() {
  return CATEGORIES;
}

function chunk(arr, size = 3) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// Wizard steps
const transactionWizard = new Scenes.WizardScene(
  'transaction-wizard',

  async (ctx) => {
    ctx.wizard.state.tx = {};
    await ctx.reply('Nama transaksi? (ketik bebas)');
    return ctx.wizard.next();
  },

  async (ctx) => {
    ctx.wizard.state.tx.name = ctx.message.text.trim();
    await ctx.reply('Nominal transaksi? (angka)');
    return ctx.wizard.next();
  },

  async (ctx) => {
    const amount = parseFloat(ctx.message.text.replace(/[^\d.-]/g, ''));
    if (isNaN(amount)) {
      await ctx.reply('Nominal tidak valid. Coba lagi.');
      return;
    }
    ctx.wizard.state.tx.amount = String(amount);

    let accounts;
    try {
      accounts = [
        { id: 1, name: 'Cash' },
        { id: 2, name: 'Bank' },
      ]; //await fetchAccounts();
    } catch (e) {
      console.error(e?.response?.data || e.message);
      await ctx.reply(
        'Gagal mengambil daftar akun dari API. Coba lagi /start.'
      );
      return ctx.scene.leave();
    }

    if (!accounts.length) {
      await ctx.reply(
        'Tidak ada akun tersedia. Tambahkan akun dulu di aplikasi.'
      );
      return ctx.scene.leave();
    }
    ctx.wizard.state.accounts = accounts;

    ctx.wizard.state.selected = { account: null, category: null };

    await showAccounts(ctx);
    return ctx.wizard.next();
  },

  async (ctx) => {
    if (!ctx.callbackQuery?.data.startsWith('account:')) return;

    const accountId = ctx.callbackQuery.data.split(':')[1];
    const accountName = ctx.callbackQuery.data.split(':')[2];
    ctx.wizard.state.selected.account = { id: accountId, name: accountName };
    let categories;
    try {
      categories = await fetchCategories();
    } catch (e) {
      console.error(e?.response?.data || e.message);
      await ctx.reply('Gagal mengambil kategori dari API. Coba lagi /start.');
      return ctx.scene.leave();
    }

    if (!categories.length) {
      await ctx.reply(
        'Tidak ada kategori. Tambahkan kategori dulu di aplikasi.'
      );
      return ctx.scene.leave();
    }

    ctx.wizard.state.categories = categories;

    await showCategories(ctx); // ganti halaman ke kategori
    return ctx.wizard.next();
  },

  // Step 5: handle kategori → lanjut konfirmasi
  async (ctx) => {
    if (!ctx.callbackQuery?.data.startsWith('category:')) return;

    const categoryId = ctx.callbackQuery.data.split(':')[1];
    const categoryName = ctx.callbackQuery.data.split(':')[2];
    ctx.wizard.state.selected.category = { id: categoryId, name: categoryName };

    await showConfirm(ctx); // ganti halaman ke confirm
    return ctx.wizard.next();
  },

  // 5) Capture CATEGORY → POST to Rails
  async (ctx) => {
    if (!ctx.callbackQuery?.data.startsWith('confirm:')) return;

    const action = ctx.callbackQuery.data.split(':')[1];
    if (action === 'no') {
      await ctx.editMessageText('❌ Dibatalkan.');
      return ctx.scene.leave();
    }

    const { tx, selected } = ctx.wizard.state;
    const payload = {
      transaction: {
        account_id: selected.account.id, // from selection
        name: tx.name, // typed by user
        date: today(), // you can swap to a selected date if needed
        amount: tx.amount, // will be signed by your Rails logic based on :nature
        nature: 'DEFAULT_NATURE', // "expense" by default
        currency: 'DEFAULT_CURRENCY', // optional; Rails will default to family currency if omitted
        category_id: selected.category.id, // from selection
        // tag_ids: [],
      },
    };

    try {
      // const { data, status } = await api.post('/transactions', payload);
      console.log('payload :>> ', payload);

      if (true) {
        await ctx.editMessageText(
          `✅ Tersimpan!\n\n` +
            `Nama: ${payload.transaction.name}\n` +
            `Akun: ${selected.account.name}\n` +
            `Tanggal: ${payload.transaction.date}\n` +
            `Jumlah: ${payload.transaction.amount}\n` +
            `Kategori: ${selected.category.name}\n`
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

// === Helper functions ===
async function showAccounts(ctx) {
  const { tx } = ctx.wizard.state;
  const text = `Nama: ${tx.name}\n` + `Nominal: ${tx.amount}\n` + 'Pilih akun:';

  const { accounts } = ctx.wizard.state;
  const buttons = accounts
    .slice(0, 5)
    .map((a) => [Markup.button.callback(a.name, `account:${a.id}:${a.name}`)]);
  await ctx.reply(text, Markup.inlineKeyboard(buttons));
}

async function showCategories(ctx) {
  const { tx, selected } = ctx.wizard.state;
  const accountName = selected.account?.name || '-';
  const text =
    `Nama: ${tx.name}\n` +
    `Nominal: ${tx.amount}\n` +
    `Akun: ${accountName}\n` +
    'Pilih kategori:';

  const { categories } = ctx.wizard.state;
  const buttons = categories
    .slice(0, 5)
    .map((c) => [Markup.button.callback(c.name, `category:${c.id}:${c.name}`)]);
  await ctx.editMessageText(text, Markup.inlineKeyboard(buttons));
}

async function showConfirm(ctx) {
  const { tx, selected, accounts, categories } = ctx.wizard.state;
  const accountName = selected.account?.name || '-';
  const categoryName = selected.category?.name || '-';

  const text =
    `Nama: ${tx.name}\n` +
    `Nominal: ${tx.amount}\n` +
    `Akun: ${accountName}\n` +
    `Kategori: ${categoryName}`;

  const buttons = [
    [Markup.button.callback('✅ Simpan', 'confirm:yes')],
    [Markup.button.callback('❌ Batal', 'confirm:no')],
  ];

  await ctx.editMessageText(text, Markup.inlineKeyboard(buttons));
}
const bot = new Telegraf(TELEGRAM_BOT_TOKEN);
const stage = new Scenes.Stage([transactionWizard], { ttl: 600 });

bot.use(session());
bot.use(stage.middleware());

bot.start((ctx) => ctx.scene.enter('transaction-wizard'));

bot.command('new', (ctx) => ctx.scene.enter('transaction-wizard'));

bot.on('message', (ctx) => {
  if (!ctx.scene?.current) {
    return ctx.reply('Ketik /start untuk membuat transaksi baru.');
  }
});

bot.launch().then(() => console.log('Bot running…'));

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
