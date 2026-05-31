export default function register(bot, { log, dbHelpers, createApiInstance }) {
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
}
