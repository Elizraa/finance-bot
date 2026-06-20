export default function register(bot, { log }) {
  bot.command('new', (ctx) => {
    const { t } = ctx.state.i18n;
    log.user(ctx.from.id, '/new command (deprecated)');
    return ctx.reply(t('cmd.new.deprecated'));
  });
}
