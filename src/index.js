import { Telegraf, Scenes, session, Markup } from 'telegraf';
import dotenv from 'dotenv';
import { Calendar } from 'telegram-inline-calendar';
import axios from 'axios';

// import { CATEGORIES } from './constant.js';

dotenv.config();

const { TELEGRAM_BOT_TOKEN, API_BASE_URL, API_KEY } = process.env;

if (!TELEGRAM_BOT_TOKEN || !API_BASE_URL || !API_KEY) {
  console.error('Please set BOT_TOKEN, API_BASE_URL, and API_BEARER in .env');
  process.exit(1);
}

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'x-api-key': `${API_KEY}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  },
});

const bot = new Telegraf(TELEGRAM_BOT_TOKEN);

const calendar = new Calendar(bot, {
  date_format: 'DD-MM-YYYY',
  language: 'id',
  bot_api: 'telegraf',
  custom_start_msg: 'Pilih tanggal: (tidak bisa pilih tanggal di masa depan)',
});

// Helpers
const parseAmount = (text) => {
  // strip non-digits except dot/comma, then parse
  const normalized = String(text)
    .replace(/[^\d.,-]/g, '')
    .replace(',', '.');
  const n = Number(normalized);
  return Number.isFinite(n) ? n : NaN;
};
function isTheFuture(dateStr) {
  // dateStr is in format "DD-MM-YYYY"
  const [day, month, year] = dateStr.split('-');
  const date = new Date(year, month - 1, day); // month is 0-based in JS
  return date > new Date();
}
function decreaseCurrency(currentStr, amount) {
  // Remove "Rp", dots, and replace comma with dot for decimal
  const numeric = parseFloat(
    currentStr.replace(/[Rp\s.]/g, '').replace(',', '.')
  );

  const newValue = numeric - amount;

  return newValue.toLocaleString('id-ID', {
    style: 'currency',
    currency: 'IDR',
  });
}

async function fetchAccounts() {
  const { data } = await api.get('/accounts');
  return Array.isArray(data) ? data : data.accounts || [];
}

// async function fetchCategories() {
//   return CATEGORIES;
// }

// Wizard steps
const transactionWizard = new Scenes.WizardScene(
  'transaction-wizard',

  async (ctx) => {
    ctx.wizard.state.tx = {};
    await ctx.reply('Deskripsi transaksi? (ketik bebas)');
    return ctx.wizard.next();
  },

  async (ctx) => {
    ctx.wizard.state.tx.name = ctx.message.text.trim();
    await ctx.reply('Nominal transaksi? (angka)');
    return ctx.wizard.next();
  },

  async (ctx) => {
    if (!ctx.message?.text) return;

    const amount = parseFloat(ctx.message.text.replace(/[^\d.-]/g, ''));
    if (isNaN(amount)) {
      await ctx.reply('Nominal tidak valid. Coba lagi.');
      return; // stay in same step
    }

    ctx.wizard.state.tx.amount = parseAmount(amount);

    // Show inline calendar right away
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

    let accounts;
    try {
      accounts = await fetchAccounts();
    } catch (e) {
      console.error(e?.response?.data || e.message);
      await ctx.reply(
        'Gagal mengambil daftar sumber dari API. Coba lagi /start.'
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
    if (!ctx.callbackQuery?.data.startsWith('account:')) return;

    const accountId = ctx.callbackQuery.data.split(':')[1];
    const accountName = ctx.callbackQuery.data.split(':')[2];
    ctx.wizard.state.selected.account = { id: accountId, name: accountName };
    // let categories;
    // try {
    //   categories = await fetchCategories();
    // } catch (e) {
    //   console.error(e?.response?.data || e.message);
    //   await ctx.reply('Gagal mengambil kategori dari API. Coba lagi /start.');
    //   return ctx.scene.leave();
    // }

    // if (!categories.length) {
    //   await ctx.reply(
    //     'Tidak ada kategori. Tambahkan kategori dulu di aplikasi.'
    //   );
    //   return ctx.scene.leave();
    // }

    // ctx.wizard.state.categories = categories;

    // await showCategories(ctx); // ganti halaman ke kategori
    await showConfirm(ctx); // ganti halaman ke confirm

    return ctx.wizard.next();
  },

  // Step 5: handle kategori → lanjut konfirmasi
  // async (ctx) => {
  //   if (!ctx.callbackQuery?.data.startsWith('category:')) return;

  //   const categoryId = ctx.callbackQuery.data.split(':')[1];
  //   const categoryName =
  //     ctx.wizard.state.categories.find((c) => c.id === categoryId)?.name || '';
  //   ctx.wizard.state.selected.category = { id: categoryId, name: categoryName };

  // await showConfirm(ctx); // ganti halaman ke confirm
  //   return ctx.wizard.next();
  // },

  // 5) Capture CATEGORY → POST to Rails
  async (ctx) => {
    if (!ctx.callbackQuery?.data.startsWith('confirm:')) return;

    const action = ctx.callbackQuery.data.split(':')[1];
    if (action === 'no') {
      await ctx.editMessageText('❌ Dibatalkan.');
      return ctx.scene.leave();
    }

    const { tx, selected, accounts } = ctx.wizard.state;
    const payload = {
      transaction: {
        account_id: selected.account.id,
        description: tx.name,
        date: tx.date,
        amount: tx.amount,
        nature: 'expense',
        // category_id: selected.category.id,
        // tag_ids: [],
      },
    };

    try {
      const { status } = await api.post('/transactions', payload);
      if (status === 200 || status === 201) {
        const prevBalanace = accounts.find(
          (a) => a.id === selected.account.id
        ).balance;
        const newBalance = decreaseCurrency(
          prevBalanace,
          payload.transaction.amount
        );
        await ctx.editMessageText(
          `✅ Tersimpan!\n\n` +
            `Deskripsi: ${payload.transaction.description}\n` +
            `Sumber: ${selected.account.name}\n` +
            `Tanggal: ${payload.transaction.date}\n` +
            `Jumlah: ${payload.transaction.amount}\n` +
            // `Kategori: ${selected.category.name}\n` +
            `Saldo sebelumnya: ${prevBalanace}\n` +
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

// === Helper functions ===
async function showAccounts(ctx) {
  const { tx } = ctx.wizard.state;
  const text =
    `Deskripsi: ${tx.name}\n` +
    `Nominal: ${tx.amount}\n` +
    `Tanggal: ${tx.date}\n` +
    'Pilih Sumber:';

  const { accounts } = ctx.wizard.state;
  const rowSize = 3; // how many buttons per row
  const buttons = accounts.map((a) =>
    Markup.button.callback(a.name, `account:${a.id}:${a.name}`)
  );

  // Split into rows
  const keyboard = [];
  for (let i = 0; i < buttons.length; i += rowSize) {
    keyboard.push(buttons.slice(i, i + rowSize));
  }
  await ctx.reply(text, Markup.inlineKeyboard(keyboard));
}

// async function showCategories(ctx) {
//   const { tx, selected } = ctx.wizard.state;
//   const accountName = selected.account?.name || '-';
//   const text =
//     `Deskripsi: ${tx.name}\n` +
//     `Nominal: ${tx.amount}\n` +
//     `Tanggal: ${tx.date}\n` +
//     `Sumber: ${accountName}\n` +
//     'Pilih kategori:';

//   const { categories } = ctx.wizard.state;
//   const rowSize = 3; // how many buttons per row
//   const buttons = categories.map((c) =>
//     Markup.button.callback(c.name, `category:${c.id}`)
//   );

//   // Split into rows
//   const keyboard = [];
//   for (let i = 0; i < buttons.length; i += rowSize) {
//     keyboard.push(buttons.slice(i, i + rowSize));
//   }
//   await ctx.editMessageText(text, Markup.inlineKeyboard(keyboard));
// }

async function showConfirm(ctx) {
  const { tx, selected } = ctx.wizard.state;
  const accountName = selected.account?.name || '-';
  // const categoryName = selected.category?.name || '-';

  const text =
    `Deskripsi: ${tx.name}\n` +
    `Nominal: ${tx.amount}\n` +
    `Tanggal: ${tx.date}\n` +
    `Sumber: ${accountName}\n`;
  // `Kategori: ${categoryName}`;

  const buttons = [
    [Markup.button.callback('✅ Simpan', 'confirm:yes')],
    [Markup.button.callback('❌ Batal', 'confirm:no')],
  ];

  await ctx.editMessageText(text, Markup.inlineKeyboard(buttons));
}

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
