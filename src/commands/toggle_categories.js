export default function register(bot, { log, dbHelpers }) {
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
}
