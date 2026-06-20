import { describe, it, expect, vi } from 'vitest';
import register from '../src/commands/new.js';

const DEPRECATED =
  'ℹ️  Perintah /new sudah tidak digunakan.\n' +
  'Gunakan /create untuk membuat transaksi baru.';

function setup() {
  const bot = { command: vi.fn() };
  const log = { user: vi.fn() };

  register(bot, { log });
  const handler = bot.command.mock.calls[0][1];

  function createCtx(overrides = {}) {
    return {
      from: { id: 123 },
      reply: vi.fn(),
      ...overrides,
    };
  }

  return { bot, log, handler, createCtx };
}

describe('new', () => {
  it('should reply deprecation message', async () => {
    const { handler, createCtx } = setup();

    const ctx = createCtx();
    await handler(ctx);

    expect(ctx.reply).toHaveBeenCalledWith(DEPRECATED);
  });

  it('should log user command', async () => {
    const { handler, log, createCtx } = setup();

    const ctx = createCtx();
    await handler(ctx);

    expect(log.user).toHaveBeenCalledWith(123, '/new command (deprecated)');
  });
});
