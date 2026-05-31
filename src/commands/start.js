export default function register(bot, { log, dbHelpers }) {
  bot.start((ctx) => {
    const userId = ctx.from.id;
    const hasApiKey = dbHelpers.hasApiKey(userId);
    log.user(userId, '/start command', { hasApiKey });

    if (hasApiKey) {
      return ctx.reply(
        '👋 Selamat datang kembali!\n\n' +
          'Perintah yang tersedia:\n' +
          '/create - Buat transaksi baru\n' +
          '/balance - Lihat saldo akun\n' +
          '/reset - Ganti API Key\n' +
          '/delete - Hapus API Key\n' +
          '/toggle_categories - Aktifkan/nonaktifkan pemilihan kategori',
      );
    }

    return ctx.reply(
      '👋 Selamat datang!\n\n' +
        'Untuk memulai, silakan atur API Key Anda dengan perintah /reset',
    );
  });
}
