export default function register(bot, { log, dbHelpers }) {
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
}
