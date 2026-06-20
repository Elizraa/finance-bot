import { describe, it, expect, vi } from 'vitest';
import register from '../src/commands/toggle_categories.js';

const KEY_REQUIRED =
  '❌ API Key belum diatur.\n\nGunakan /reset untuk mengatur API Key terlebih dahulu.';
const ENABLED =
  '✅ Pemilihan kategori *diaktifkan*.\n\nSetiap transaksi baru akan meminta Anda memilih kategori.';
const DISABLED =
  '🔕 Pemilihan kategori *dinonaktifkan*.\n\nTransaksi akan dibuat tanpa kategori.';

function setup() {
  const bot = { command: vi.fn() };
  const log = { user: vi.fn() };
  const dbHelpers = { hasApiKey: vi.fn(), toggleCategories: vi.fn() };

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

describe('toggle_categories', () => {
  it('should reply noApiKey when user has no API key', async () => {
    const { handler, dbHelpers, createCtx } = setup();
    dbHelpers.hasApiKey.mockReturnValue(false);

    const ctx = createCtx();
    await handler(ctx);

    expect(ctx.reply).toHaveBeenCalledWith(KEY_REQUIRED);
  });

  it('should enable categories and reply enabled message', async () => {
    const { handler, dbHelpers, createCtx } = setup();
    dbHelpers.hasApiKey.mockReturnValue(true);
    dbHelpers.toggleCategories.mockReturnValue(true);

    const ctx = createCtx();
    await handler(ctx);

    expect(dbHelpers.toggleCategories).toHaveBeenCalledWith(123);
    expect(ctx.reply).toHaveBeenCalledWith(ENABLED, { parse_mode: 'Markdown' });
  });

  it('should disable categories and reply disabled message', async () => {
    const { handler, dbHelpers, createCtx } = setup();
    dbHelpers.hasApiKey.mockReturnValue(true);
    dbHelpers.toggleCategories.mockReturnValue(false);

    const ctx = createCtx();
    await handler(ctx);

    expect(dbHelpers.toggleCategories).toHaveBeenCalledWith(123);
    expect(ctx.reply).toHaveBeenCalledWith(DISABLED, { parse_mode: 'Markdown' });
  });

  it('should log user command', async () => {
    const { handler, log, dbHelpers, createCtx } = setup();
    dbHelpers.hasApiKey.mockReturnValue(true);
    dbHelpers.toggleCategories.mockReturnValue(true);

    const ctx = createCtx();
    await handler(ctx);

    expect(log.user).toHaveBeenCalledWith(123, '/toggle_categories command');
  });
});
