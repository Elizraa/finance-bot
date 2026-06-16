export default function register(bot, { log, dbHelpers }) {
  bot.command('toggle_categories', (ctx) => {
    const userId = ctx.from.id;
    const { t } = ctx.state.i18n;
    log.user(userId, '/toggle_categories command');

    if (!dbHelpers.hasApiKey(userId)) {
      return ctx.reply(t('common.noApiKey'));
    }

    const nowEnabled = dbHelpers.toggleCategories(userId);

    return ctx.reply(
      nowEnabled ? t('cmd.toggle.enabled') : t('cmd.toggle.disabled'),
      { parse_mode: 'Markdown' },
    );
  });
}
