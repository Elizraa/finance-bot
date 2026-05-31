export default function register(bot, { log }) {
  bot.command('new', (ctx) => {
    log.user(ctx.from.id, '/new command (deprecated)');
    return ctx.reply(
      'ℹ️  Perintah /new sudah tidak digunakan.\n' +
        'Gunakan /create untuk membuat transaksi baru.',
    );
  });
}
