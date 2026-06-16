export default function register(bot, { log, dbHelpers, createApiInstance }) {
  bot.command('balance', async (ctx) => {
    const userId = ctx.from.id;
    const { t } = ctx.state.i18n;
    log.user(userId, '/balance command');
    const apiKey = dbHelpers.getApiKey(userId);

    if (!apiKey) {
      return ctx.reply(t('common.noApiKey'));
    }

    try {
      const api = createApiInstance(apiKey);
      const { data } = await api.get('/accounts');
      const accounts = Array.isArray(data) ? data : data.accounts || [];

      log.user(userId, 'Balance fetched', { accountCount: accounts.length });

      if (!accounts.length) {
        return ctx.reply(t('cmd.balance.noAccounts'));
      }

      let totalBalance = 0;
      const escapeMarkdown = (text) =>
        text.replace(/[_*[\]()~`>#+=|{}.!-]/g, ' ');

      let message = `${t('cmd.balance.title')}\n\n`;
      accounts.forEach((account, index) => {
        const accountName = escapeMarkdown(account.name);
        const classification =
          account.classification === 'liability' ? '💳' : '💰';
        message += `${index + 1}. *${accountName}*\n`;
        message += `    ${account.balance} ${classification}\n`;
        message += `    _${escapeMarkdown(account.account_type)}_\n\n`;
        if (account.currency !== 'IDR') return;
        const numeric = parseFloat(
          account.balance.replace(/[Rp\s.]/g, '').replace(',', '.'),
        );
        if (account.classification === 'liability') {
          totalBalance -= numeric;
        } else {
          totalBalance += numeric;
        }
      });

      const locale = ctx.state.i18n.locale === 'id' ? 'id-ID' : 'en-US';
      message += '━━━━━━━━━━━━━━━━\n';
      message += `*${t('cmd.balance.total')}: ${totalBalance.toLocaleString(locale, {
        style: 'currency',
        currency: 'IDR',
      })}*`;

      await ctx.reply(message, { parse_mode: 'Markdown' });
    } catch (e) {
      const reason = e?.response?.data || e.message;
      log.userError(userId, 'Failed to fetch balance', { reason });
      await ctx.reply(
        `${t('cmd.balance.error')}\n\n${e.response?.data?.message || e.message}`,
      );
    }
  });
}
