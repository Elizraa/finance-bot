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
      const { t } = ctx.state.i18n;
      const userId = ctx.from.id;
      const apiKey = dbHelpers.getApiKey(userId);

      if (!apiKey) {
        log.user(userId, 'Attempted /create without API key');
        await ctx.reply(t('common.noApiKey'));
        return ctx.scene.leave();
      }

      log.user(userId, 'Entered transaction-wizard');
      ctx.wizard.state.tx = {};
      ctx.wizard.state.apiKey = apiKey;
      ctx.wizard.state.categoriesEnabled = dbHelpers.getCategoriesEnabled(userId);

      await ctx.reply(
        t('wizard.transaction.askDescription'),
        Markup.inlineKeyboard([[Markup.button.callback(t('btn.cancel'), 'cancel')]]),
      );
      return ctx.wizard.next();
    },

    // ── Step 1 ─────────────────────────────────────────────────────────────────
    async (ctx) => {
      const { t } = ctx.state.i18n;
      if (ctx.callbackQuery?.data === 'cancel') {
        log.user(ctx.from.id, 'Transaction cancelled at description step');
        await ctx.editMessageText(t('wizard.transaction.cancelled'));
        return ctx.scene.leave();
      }
      if (!ctx.message?.text) return;

      ctx.wizard.state.tx.name = ctx.message.text.trim();
      log.user(ctx.from.id, 'Description set', {
        description: ctx.wizard.state.tx.name,
      });

      await ctx.reply(
        t('wizard.transaction.askAmount'),
        Markup.inlineKeyboard([[Markup.button.callback(t('btn.cancel'), 'cancel')]]),
      );
      return ctx.wizard.next();
    },

    // ── Step 2 ─────────────────────────────────────────────────────────────────
    async (ctx) => {
      const { t } = ctx.state.i18n;
      if (ctx.callbackQuery?.data === 'cancel') {
        log.user(ctx.from.id, 'Transaction cancelled at amount step');
        await ctx.editMessageText(t('wizard.transaction.cancelled'));
        return ctx.scene.leave();
      }
      if (!ctx.message?.text) return;

      const amount = parseFloat(ctx.message.text.replace(/[^\d.-]/g, ''));
      if (isNaN(amount)) {
        log.user(ctx.from.id, 'Invalid amount entered', {
          raw: ctx.message.text,
        });
        await ctx.reply(t('wizard.transaction.invalidAmount'));
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
      const { t } = ctx.state.i18n;
      if (!ctx.callbackQuery) return;

      const selected = calendar.clickButtonCalendar(ctx);
      if (selected === -1) return;

      if (isTheFuture(selected)) {
        log.user(ctx.from.id, 'Future date selected, aborting', {
          date: selected,
        });
        await ctx.reply(t('wizard.transaction.futureDate'));
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
          await ctx.reply(t('wizard.transaction.failedCategories'));
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
      const { t } = ctx.state.i18n;
      if (ctx.callbackQuery?.data === 'cancel') {
        await ctx.editMessageText(t('wizard.transaction.cancelled'));
        return ctx.scene.leave();
      }

      const { categoriesEnabled, skipCategoryStep } = ctx.wizard.state;

      if (categoriesEnabled && !skipCategoryStep) {
        if (!ctx.callbackQuery?.data?.startsWith('category:')) return;

        const categoryId = ctx.callbackQuery.data.split(':')[1];
        const cat = ctx.wizard.state.categories.find((c) => c.id === categoryId);
        if (!cat) {
          await ctx.answerCbQuery(t('btn.categoryNotFound'));
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
        await ctx.answerCbQuery(t('btn.accountNotFound'));
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
      const { t } = ctx.state.i18n;
      if (ctx.callbackQuery?.data === 'cancel') {
        await ctx.editMessageText(t('wizard.transaction.cancelled'));
        return ctx.scene.leave();
      }

      const { categoriesEnabled, skipCategoryStep } = ctx.wizard.state;

      if (categoriesEnabled && !skipCategoryStep) {
        if (!ctx.callbackQuery?.data?.startsWith('account:')) return;

        const accountId = ctx.callbackQuery.data.split(':')[1];
        const acc = ctx.wizard.state.accounts.find((a) => a.id === accountId);
        if (!acc) {
          await ctx.answerCbQuery(t('btn.accountNotFound'));
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
        await ctx.editMessageText(t('wizard.transaction.confirm.cancelled'));
        return ctx.scene.leave();
      }

      return _submitTransaction(ctx);
    },

    // ── Step 6 ─────────────────────────────────────────────────────────────────
    async (ctx) => {
      const { t } = ctx.state.i18n;
      if (!ctx.callbackQuery?.data?.startsWith('confirm:')) return;
      if (ctx.callbackQuery.data === 'confirm:no') {
        await ctx.editMessageText(t('wizard.transaction.confirm.cancelled'));
        return ctx.scene.leave();
      }

      return _submitTransaction(ctx);
    },
  );

  // ─── UI Helpers ────────────────────────────────────────────────────────────────

  function _lbl(ctx, path, params) {
    return ctx.state.i18n.t(path, params);
  }

  async function _showCategories(ctx) {
    const { tx, categories } = ctx.wizard.state;
    const t = (path) => ctx.state.i18n.t(path);
    const lbl = (path) => ctx.state.i18n.t(`wizard.transaction.labels.${path}`);

    const text =
      `${lbl('description')}: ${tx.name}\n` +
      `${lbl('nominal')}: ${tx.amount}\n` +
      `${lbl('date')}: ${tx.date}\n` +
      lbl('selectCategory');

    const rowSize = 3;
    const buttons = categories.map((c) =>
      Markup.button.callback(c.name, `category:${c.id}`),
    );
    const keyboard = [];
    for (let i = 0; i < buttons.length; i += rowSize) {
      keyboard.push(buttons.slice(i, i + rowSize));
    }
    keyboard.push([Markup.button.callback(t('btn.cancel'), 'cancel')]);

    await ctx.reply(text, Markup.inlineKeyboard(keyboard));
  }

  async function _showAccounts(ctx, options = {}) {
    const { tx, accounts, selected } = ctx.wizard.state;
    const t = (path) => ctx.state.i18n.t(path);
    const lbl = (path) => ctx.state.i18n.t(`wizard.transaction.labels.${path}`);

    const categoryLine = selected?.category
      ? `${lbl('category')}: ${selected.category.name}\n`
      : '';

    const text =
      `${lbl('description')}: ${tx.name}\n` +
      `${lbl('nominal')}: ${tx.amount}\n` +
      `${lbl('date')}: ${tx.date}\n` +
      categoryLine +
      lbl('selectSource');

    const rowSize = 3;
    const buttons = accounts.map((a) =>
      Markup.button.callback(a.name, `account:${a.id}`),
    );
    const keyboard = [];
    for (let i = 0; i < buttons.length; i += rowSize) {
      keyboard.push(buttons.slice(i, i + rowSize));
    }
    keyboard.push([Markup.button.callback(t('btn.cancel'), 'cancel')]);

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
    const t = (path) => ctx.state.i18n.t(path);
    const lbl = (path) => ctx.state.i18n.t(`wizard.transaction.labels.${path}`);

    const categoryLine = selected.category
      ? `${lbl('category')}: ${selected.category.name}\n`
      : '';

    const text =
      `${lbl('description')}: ${tx.name}\n` +
      `${lbl('nominal')}: ${tx.amount}\n` +
      `${lbl('date')}: ${tx.date}\n` +
      categoryLine +
      `${lbl('source')}: ${selected.account?.name || '-'}\n`;

    await ctx.editMessageText(
      text,
      Markup.inlineKeyboard([
        [Markup.button.callback(t('btn.save'), 'confirm:yes')],
        [Markup.button.callback(t('btn.cancel'), 'confirm:no')],
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

    const t = (path) => ctx.state.i18n.t(path);

    let accounts;
    try {
      accounts = await fetchAccounts(api);
    } catch (e) {
      log.userError(ctx.from.id, 'Failed to fetch accounts', {
        reason: e?.response?.data || e.message,
      });
      return notifyAndLeave(t('wizard.transaction.failedAccounts'));
    }

    if (!accounts.length) {
      log.user(ctx.from.id, 'No accounts available');
      return notifyAndLeave(t('wizard.transaction.noAccounts'));
    }

    ctx.wizard.state.accounts = accounts;
    await _showAccounts(ctx, { edit: replaceMessage });
  }

  async function _submitTransaction(ctx) {
    const { tx, selected, accounts, apiKey } = ctx.wizard.state;
    const t = (path) => ctx.state.i18n.t(path);
    const lbl = (path) => ctx.state.i18n.t(`wizard.transaction.labels.${path}`);

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
          ? `${lbl('category')}: ${selected.category.name}\n`
          : '';

        await ctx.editMessageText(
          `${t('wizard.transaction.submitted')}\n\n` +
            `${lbl('description')}: ${payload.transaction.description}\n` +
            `${lbl('source')}: ${selected.account.name}\n` +
            categoryLine +
            `${lbl('date')}: ${payload.transaction.date}\n` +
            `${lbl('nominal')}: ${payload.transaction.amount}\n` +
            `${lbl('prevBalance')}: ${prevBalance}\n` +
            `${lbl('newBalance')}: ${newBalance}`,
        );
      } else {
        log.userError(ctx.from.id, 'Unexpected status from API', { status });
        await ctx.editMessageText(
          t('wizard.transaction.errorStatus', { status }),
        );
      }
    } catch (e) {
      const reason = e.response?.data?.message || e.message;
      log.userError(ctx.from.id, 'Transaction submission failed', { reason });
      await ctx.editMessageText(
        t('wizard.transaction.failedSubmit', { reason }),
      );
    }

    return ctx.scene.leave();
  }

  return wizard;
}
