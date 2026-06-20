import { describe, it, expect, vi } from 'vitest';
import register from '../src/commands/start.js';

const WITH_KEY =
  '👋 Selamat datang kembali!\n\n' +
  'Perintah yang tersedia:\n' +
  '/create - Buat transaksi baru\n' +
  '/balance - Lihat saldo akun\n' +
  '/reset - Ganti API Key\n' +
  '/delete - Hapus API Key\n' +
  '/toggle_categories - Aktifkan/nonaktifkan pemilihan kategori';

const WITHOUT_KEY =
  '👋 Selamat datang!\n\n' +
  'Untuk memulai, silakan atur API Key Anda dengan perintah /reset';

function setup() {
  const bot = { start: vi.fn() };
  const log = { user: vi.fn() };
  const dbHelpers = { hasApiKey: vi.fn() };

  register(bot, { log, dbHelpers });
  const handler = bot.start.mock.calls[0][0];

  function createCtx(overrides = {}) {
    return {
      from: { id: 123 },
      reply: vi.fn(),
      ...overrides,
    };
  }

  return { bot, log, dbHelpers, handler, createCtx };
}

describe('start', () => {
  it('should reply welcome back message when user has API key', async () => {
    const { handler, dbHelpers, createCtx } = setup();
    dbHelpers.hasApiKey.mockReturnValue(true);

    const ctx = createCtx();
    await handler(ctx);

    expect(ctx.reply).toHaveBeenCalledWith(WITH_KEY);
  });

  it('should reply welcome message when user has no API key', async () => {
    const { handler, dbHelpers, createCtx } = setup();
    dbHelpers.hasApiKey.mockReturnValue(false);

    const ctx = createCtx();
    await handler(ctx);

    expect(ctx.reply).toHaveBeenCalledWith(WITHOUT_KEY);
  });

  it('should log user command with hasApiKey status', async () => {
    const { handler, log, dbHelpers, createCtx } = setup();
    dbHelpers.hasApiKey.mockReturnValue(true);

    const ctx = createCtx();
    await handler(ctx);

    expect(log.user).toHaveBeenCalledWith(123, '/start command', {
      hasApiKey: true,
    });
  });
});
