export default function register(bot, { log, dbHelpers }) {
  bot.start((ctx) => {
    const userId = ctx.from.id;
    const hasApiKey = dbHelpers.hasApiKey(userId);
    const { t } = ctx.state.i18n;
    log.user(userId, '/start command', { hasApiKey });

    return ctx.reply(
      hasApiKey ? t('cmd.start.withKey') : t('cmd.start.withoutKey'),
    );
  });
}
