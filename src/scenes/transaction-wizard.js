import { Scenes, Markup } from 'telegraf';

export function createTransactionWizard({
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
}) {
  const wizard = new Scenes.WizardScene(
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

    // ── Step 3 ─────────────────────────────────────────────────────────────────
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
          log.user(
            ctx.from.id,
            'No categories available, skipping category step',
          );
          await _loadAndShowAccounts(ctx, api);
          ctx.wizard.state.skipCategoryStep = true;
        } else {
          await _showCategories(ctx);
          ctx.wizard.state.skipCategoryStep = false;
        }
      } else {
        await _loadAndShowAccounts(ctx, api);
      }

      return ctx.wizard.next();
    },

    // ── Step 4 ─────────────────────────────────────────────────────────────────
    async (ctx) => {
      if (ctx.callbackQuery?.data === 'cancel') {
        await ctx.editMessageText('❌ Transaksi dibatalkan.');
        return ctx.scene.leave();
      }

      const { categoriesEnabled, skipCategoryStep } = ctx.wizard.state;

      if (categoriesEnabled && !skipCategoryStep) {
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

        const api = createApiInstance(ctx.wizard.state.apiKey);
        await _loadAndShowAccounts(ctx, api, { replaceMessage: true });
        return ctx.wizard.next();
      }

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

      await _showConfirm(ctx);
      return ctx.wizard.next();
    },

    // ── Step 5 ─────────────────────────────────────────────────────────────────
    async (ctx) => {
      if (ctx.callbackQuery?.data === 'cancel') {
        await ctx.editMessageText('❌ Transaksi dibatalkan.');
        return ctx.scene.leave();
      }

      const { categoriesEnabled, skipCategoryStep } = ctx.wizard.state;

      if (categoriesEnabled && !skipCategoryStep) {
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

        await _showConfirm(ctx);
        return ctx.wizard.next();
      }

      if (!ctx.callbackQuery?.data?.startsWith('confirm:')) return;
      if (ctx.callbackQuery.data === 'confirm:no') {
        await ctx.editMessageText('❌ Dibatalkan.');
        return ctx.scene.leave();
      }

      return _submitTransaction(ctx);
    },

    // ── Step 6 ─────────────────────────────────────────────────────────────────
    async (ctx) => {
      if (!ctx.callbackQuery?.data?.startsWith('confirm:')) return;
      if (ctx.callbackQuery.data === 'confirm:no') {
        await ctx.editMessageText('❌ Dibatalkan.');
        return ctx.scene.leave();
      }

      return _submitTransaction(ctx);
    },
  );

  // ─── UI Helpers ────────────────────────────────────────────────────────────────

  async function _showCategories(ctx) {
    const { tx, categories } = ctx.wizard.state;
    const text =
      `Deskripsi: ${tx.name}\n` +
      `Nominal: ${tx.amount}\n` +
      `Tanggal: ${tx.date}\n` +
      'Pilih Kategori:';

    const rowSize = 3;
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

  async function _showAccounts(ctx, options = {}) {
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

    const rowSize = 3;
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

  async function _showConfirm(ctx) {
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
    await _showAccounts(ctx, { edit: replaceMessage });
  }

  async function _submitTransaction(ctx) {
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

  return wizard;
}
