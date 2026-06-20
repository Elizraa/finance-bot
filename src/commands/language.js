import { Markup } from 'telegraf';

export default function register(bot, { log, dbHelpers }) {
  bot.command('language', (ctx) => {
    const userId = ctx.from.id;
    log.user(userId, '/language command');

    const currentLang = dbHelpers.getLanguage(userId);
    const { t } = ctx.state.i18n;

    return ctx.reply(
      t('cmd.language.prompt'),
      Markup.inlineKeyboard([
        [
          Markup.button.callback(
            `${currentLang === 'id' ? '✅ ' : ''}Bahasa Indonesia`,
            'lang:id',
          ),
          Markup.button.callback(
            `${currentLang === 'en' ? '✅ ' : ''}English`,
            'lang:en',
          ),
        ],
      ]),
    );
  });

  bot.action(/^lang:(.+)$/, async (ctx) => {
    const userId = ctx.from.id;
    const lang = ctx.match[1];

    const available = ['id', 'en'];
    if (!available.includes(lang)) {
      await ctx.answerCbQuery(ctx.state.i18n.t('cmd.language.invalid'));
      return;
    }

    dbHelpers.setLanguage(userId, lang);
    ctx.state.i18n = (await import('../lib/i18n.js')).createI18n(lang);
    log.user(userId, 'Language changed via button', { language: lang });

    await ctx.answerCbQuery(ctx.state.i18n.t('cmd.language.changed'));
    await ctx.deleteMessage();
  });
}
