export default function register(bot, { log, dbHelpers }) {
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
}
