import { Scenes } from 'telegraf';

export function createApiKeyWizard({ log, createApiInstance, dbHelpers }) {
  return new Scenes.WizardScene(
    'api-key-wizard',

    async (ctx) => {
      log.user(ctx.from.id, 'Entered api-key-wizard');
      await ctx.reply(
        '🔑 Silakan masukkan API Key Anda:\n\n' +
          '(API Key akan disimpan dengan enkripsi dan digunakan untuk semua transaksi Anda)',
      );
      return ctx.wizard.next();
    },

    async (ctx) => {
      if (!ctx.message?.text) {
        await ctx.reply('❌ Harap kirim API Key dalam bentuk teks.');
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

        await ctx.reply(
          '✅ API Key berhasil disimpan!\n\n' +
            'Gunakan /create untuk membuat transaksi baru.',
        );
      } catch (e) {
        const reason = e.response?.data?.message || e.message;
        log.userError(userId, 'API key validation failed', { reason });
        await ctx.reply(
          '❌ API Key tidak valid atau gagal terhubung ke server.\n\n' +
            'Error: ' +
            reason +
            '\n\n' +
            'Silakan coba lagi dengan /reset',
        );
      }

      return ctx.scene.leave();
    },
  );
}
