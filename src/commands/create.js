export default function register(bot, { log, dbHelpers }) {
  bot.command('create', (ctx) => {
    const userId = ctx.from.id;
    const { t } = ctx.state.i18n;
    log.user(userId, '/create command');
    if (!dbHelpers.hasApiKey(userId)) {
      return ctx.reply(t('common.noApiKey'));
    }
    return ctx.scene.enter('transaction-wizard');
  });
}
