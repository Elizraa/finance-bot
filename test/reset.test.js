import { describe, it, expect, vi } from 'vitest';
import register from '../src/commands/reset.js';

function setup() {
  const bot = { command: vi.fn() };
  const log = { user: vi.fn() };

  register(bot, { log });
  const handler = bot.command.mock.calls[0][1];

  function createCtx(overrides = {}) {
    return {
      from: { id: 123 },
      scene: { enter: vi.fn() },
      ...overrides,
    };
  }

  return { bot, log, handler, createCtx };
}

describe('reset', () => {
  it('should enter api-key-wizard scene', async () => {
    const { handler, createCtx } = setup();

    const ctx = createCtx();
    await handler(ctx);

    expect(ctx.scene.enter).toHaveBeenCalledWith('api-key-wizard');
  });

  it('should log user command', async () => {
    const { handler, log, createCtx } = setup();

    const ctx = createCtx();
    await handler(ctx);

    expect(log.user).toHaveBeenCalledWith(123, '/reset command');
  });
});
