import { describe, it, expect, vi } from 'vitest';
import register from '../src/commands/delete.js';

const NO_KEY = '❌ Anda belum memiliki API Key yang tersimpan.';
const DELETED = '✅ API Key berhasil dihapus.\n\nGunakan /reset untuk mengatur API Key baru.';

function setup() {
  const bot = { command: vi.fn() };
  const log = { user: vi.fn() };
  const dbHelpers = { hasApiKey: vi.fn(), deleteApiKey: vi.fn() };

  register(bot, { log, dbHelpers });
  const handler = bot.command.mock.calls[0][1];

  function createCtx(overrides = {}) {
    return {
      from: { id: 123 },
      reply: vi.fn(),
      ...overrides,
    };
  }

  return { bot, log, dbHelpers, handler, createCtx };
}

describe('delete', () => {
  it('should reply no-key message when user has no API key', async () => {
    const { handler, dbHelpers, createCtx } = setup();
    dbHelpers.hasApiKey.mockReturnValue(false);

    const ctx = createCtx();
    await handler(ctx);

    expect(ctx.reply).toHaveBeenCalledWith(NO_KEY);
    expect(dbHelpers.deleteApiKey).not.toHaveBeenCalled();
  });

  it('should delete API key and reply success message', async () => {
    const { handler, dbHelpers, createCtx } = setup();
    dbHelpers.hasApiKey.mockReturnValue(true);

    const ctx = createCtx();
    await handler(ctx);

    expect(dbHelpers.deleteApiKey).toHaveBeenCalledWith(123);
    expect(ctx.reply).toHaveBeenCalledWith(DELETED);
  });

  it('should log user command', async () => {
    const { handler, log, dbHelpers, createCtx } = setup();
    dbHelpers.hasApiKey.mockReturnValue(true);

    const ctx = createCtx();
    await handler(ctx);

    expect(log.user).toHaveBeenCalledWith(123, '/delete command');
  });
});
