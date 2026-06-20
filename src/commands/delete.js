export default function register(bot, { log, dbHelpers }) {
  bot.command('delete', (ctx) => {
    const userId = ctx.from.id;
    const { t } = ctx.state.i18n;
    log.user(userId, '/delete command');
    if (!dbHelpers.hasApiKey(userId)) {
      return ctx.reply(t('cmd.delete.noKey'));
    }
    dbHelpers.deleteApiKey(userId);
    return ctx.reply(t('cmd.delete.deleted'));
  });
}
