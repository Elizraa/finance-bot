export default function register(bot, { log }) {
  bot.command('reset', (ctx) => {
    log.user(ctx.from.id, '/reset command');
    return ctx.scene.enter('api-key-wizard');
  });
}
