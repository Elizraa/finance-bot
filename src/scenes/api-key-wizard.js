import { Scenes } from 'telegraf';

export function createApiKeyWizard({ log, createApiInstance, dbHelpers }) {
  return new Scenes.WizardScene(
    'api-key-wizard',

    async (ctx) => {
      const { t } = ctx.state.i18n;
      log.user(ctx.from.id, 'Entered api-key-wizard');
      await ctx.reply(t('wizard.apiKey.ask'));
      return ctx.wizard.next();
    },

    async (ctx) => {
      const { t } = ctx.state.i18n;

      if (!ctx.message?.text) {
        await ctx.reply(t('wizard.apiKey.nonText'));
        return;
      }

      const apiKey = ctx.message.text.trim();
      const userId = ctx.from.id;

      try {
        await ctx.deleteMessage(ctx.message.message_id);
      } catch (e) {
        log.debug('Could not delete API key message', {
          userId,
          reason: e.message,
        });
      }

      try {
        const testApi = createApiInstance(apiKey);
        await testApi.get('/accounts');

        dbHelpers.saveApiKey(userId, apiKey);
        log.user(userId, 'API key validated and saved');

        await ctx.reply(t('wizard.apiKey.saved'));
      } catch (e) {
        const reason = e.response?.data?.message || e.message;
        log.userError(userId, 'API key validation failed', { reason });
        await ctx.reply(t('wizard.apiKey.invalid', { reason }));
      }

      return ctx.scene.leave();
    },
  );
}
