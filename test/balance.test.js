import { describe, it, expect, vi } from 'vitest';
import register from '../src/commands/balance.js';

const KEY_REQUIRED =
  '❌ API Key belum diatur.\n\nGunakan /reset untuk mengatur API Key terlebih dahulu.';

function setup() {
  const bot = { command: vi.fn() };
  const log = { user: vi.fn(), userError: vi.fn() };
  const dbHelpers = { getApiKey: vi.fn() };
  const api = { get: vi.fn() };
  const createApiInstance = vi.fn(() => api);

  register(bot, { log, dbHelpers, createApiInstance });
  const handler = bot.command.mock.calls[0][1];

  function createCtx(overrides = {}) {
    return {
      from: { id: 123 },
      reply: vi.fn(),
      ...overrides,
    };
  }

  return { bot, log, dbHelpers, createApiInstance, api, handler, createCtx };
}

describe('balance', () => {
  it('should reply noApiKey when user has no API key', async () => {
    const { handler, dbHelpers, createCtx } = setup();
    dbHelpers.getApiKey.mockReturnValue(null);

    const ctx = createCtx();
    await handler(ctx);

    expect(ctx.reply).toHaveBeenCalledWith(KEY_REQUIRED);
  });

  it('should reply noAccounts when API returns empty accounts array', async () => {
    const { handler, dbHelpers, api, createCtx } = setup();

    dbHelpers.getApiKey.mockReturnValue('test-key');
    api.get.mockResolvedValue({ data: { accounts: [] } });

    const ctx = createCtx();
    await handler(ctx);

    expect(ctx.reply).toHaveBeenCalledWith('📊 Tidak ada akun ditemukan.');
  });

  it('should render accounts and reply with formatted message', async () => {
    const { handler, dbHelpers, api, createCtx } = setup();

    dbHelpers.getApiKey.mockReturnValue('test-key');
    api.get.mockResolvedValue({
      data: {
        accounts: [
          {
            name: 'Cash',
            balance: 'Rp100,000',
            account_type: 'cash',
            classification: 'asset',
            currency: 'IDR',
          },
          {
            name: 'Credit Card',
            balance: 'Rp50,000',
            account_type: 'credit_card',
            classification: 'liability',
            currency: 'IDR',
          },
        ],
      },
    });

    const ctx = createCtx();
    await handler(ctx);

    expect(ctx.reply).toHaveBeenCalledOnce();
    const [message, opts] = ctx.reply.mock.calls[0];
    expect(message).toContain('💰 *Saldo Akun Anda*');
    expect(message).toContain('Cash');
    expect(message).toContain('Rp100,000');
    expect(message).toContain('Credit Card');
    expect(message).toContain('Rp50,000');
    expect(message).toContain('Total:');
    expect(message).toMatch(/Rp\s*50/);
    expect(opts).toEqual({ parse_mode: 'Markdown' });
  });

  it('should handle API error gracefully', async () => {
    const { handler, dbHelpers, api, log, createCtx } = setup();

    dbHelpers.getApiKey.mockReturnValue('test-key');
    const err = new Error('Network failure');
    api.get.mockRejectedValue(err);

    const ctx = createCtx();
    await handler(ctx);

    expect(log.userError).toHaveBeenCalledWith(123, 'Failed to fetch balance', {
      reason: 'Network failure',
    });
    expect(ctx.reply).toHaveBeenCalledWith(
      '❌ Gagal mengambil data saldo.\n\nError: Network failure',
    );
  });

  it('should handle API error with response data', async () => {
    const { handler, dbHelpers, api, createCtx } = setup();

    dbHelpers.getApiKey.mockReturnValue('test-key');
    const err = new Error('Server error');
    err.response = { data: { message: 'Internal error' } };
    api.get.mockRejectedValue(err);

    const ctx = createCtx();
    await handler(ctx);

    expect(ctx.reply).toHaveBeenCalledWith(
      '❌ Gagal mengambil data saldo.\n\nError: Internal error',
    );
  });

  it('should handle non-IDR currency accounts', async () => {
    const { handler, dbHelpers, api, createCtx } = setup();

    dbHelpers.getApiKey.mockReturnValue('test-key');
    api.get.mockResolvedValue({
      data: {
        accounts: [
          {
            name: 'USD Account',
            balance: '$500',
            account_type: 'savings',
            classification: 'asset',
            currency: 'USD',
          },
        ],
      },
    });

    const ctx = createCtx();
    await handler(ctx);

    expect(ctx.reply).toHaveBeenCalledOnce();
    const [message] = ctx.reply.mock.calls[0];
    expect(message).toContain('USD Account');
    expect(message).toContain('Total:');
    expect(message).toMatch(/Rp\s*0/);
  });

  it('should log user command', async () => {
    const { handler, log, dbHelpers, api, createCtx } = setup();

    dbHelpers.getApiKey.mockReturnValue('test-key');
    api.get.mockResolvedValue({ data: { accounts: [] } });

    const ctx = createCtx();
    await handler(ctx);

    expect(log.user).toHaveBeenCalledWith(123, '/balance command');
  });

  it('should handle accounts from data.accounts object', async () => {
    const { handler, dbHelpers, api, createCtx } = setup();

    dbHelpers.getApiKey.mockReturnValue('test-key');
    api.get.mockResolvedValue({
      data: {
        accounts: [
          {
            name: 'Cash',
            balance: 'Rp100,000',
            account_type: 'cash',
            classification: 'asset',
            currency: 'IDR',
          },
        ],
      },
    });

    const ctx = createCtx();
    await handler(ctx);

    expect(ctx.reply).toHaveBeenCalledOnce();
    const [message] = ctx.reply.mock.calls[0];
    expect(message).toContain('Cash');
    expect(message).toContain('Total:');
  });

  it('should handle data.accounts being undefined (fallback to empty array)', async () => {
    const { handler, dbHelpers, api, createCtx } = setup();

    dbHelpers.getApiKey.mockReturnValue('test-key');
    api.get.mockResolvedValue({ data: {} });

    const ctx = createCtx();
    await handler(ctx);

    expect(ctx.reply).toHaveBeenCalledWith('📊 Tidak ada akun ditemukan.');
  });
});
