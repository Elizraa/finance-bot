import { describe, it, expect, vi } from 'vitest';
import register from '../src/commands/create.js';

const KEY_REQUIRED =
  '❌ API Key belum diatur.\n\nGunakan /reset untuk mengatur API Key terlebih dahulu.';

function setup() {
  const bot = { command: vi.fn() };
  const log = { user: vi.fn() };
  const dbHelpers = { hasApiKey: vi.fn() };

  register(bot, { log, dbHelpers });
  const handler = bot.command.mock.calls[0][1];

  function createCtx(overrides = {}) {
    return {
      from: { id: 123 },
      reply: vi.fn(),
      scene: { enter: vi.fn() },
      ...overrides,
    };
  }

  return { bot, log, dbHelpers, handler, createCtx };
}

describe('create', () => {
  it('should reply noApiKey when user has no API key', async () => {
    const { handler, dbHelpers, createCtx } = setup();
    dbHelpers.hasApiKey.mockReturnValue(false);

    const ctx = createCtx();
    await handler(ctx);

    expect(ctx.reply).toHaveBeenCalledWith(KEY_REQUIRED);
    expect(ctx.scene.enter).not.toHaveBeenCalled();
  });

  it('should enter transaction-wizard when user has API key', async () => {
    const { handler, dbHelpers, createCtx } = setup();
    dbHelpers.hasApiKey.mockReturnValue(true);

    const ctx = createCtx();
    await handler(ctx);

    expect(ctx.scene.enter).toHaveBeenCalledWith('transaction-wizard');
    expect(ctx.reply).not.toHaveBeenCalled();
  });

  it('should log user command', async () => {
    const { handler, log, dbHelpers, createCtx } = setup();
    dbHelpers.hasApiKey.mockReturnValue(true);

    const ctx = createCtx();
    await handler(ctx);

    expect(log.user).toHaveBeenCalledWith(123, '/create command');
  });
});
