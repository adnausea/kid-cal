import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/config.js', () => ({
  getConfig: () => ({
    TELEGRAM_BOT_TOKEN: 'test-bot-token',
    TELEGRAM_CHAT_ID: '123456789',
    LOG_LEVEL: 'error',
  }),
}));
vi.mock('../../src/logger.js', () => ({
  getLogger: () => ({
    info: () => {},
    debug: () => {},
    warn: () => {},
    error: () => {},
  }),
}));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import { sendNotification, pollCommands, resetUpdateOffset } from '../../src/reminders/telegram.js';

describe('sendNotification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sends successfully and returns message ID', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ result: { message_id: 42 } }),
    });

    const id = await sendNotification('Test message');

    expect(id).toBe('42');
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.telegram.org/bottest-bot-token/sendMessage',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: '123456789',
          text: 'Test message',
        }),
      },
    );
  });

  it('throws on API error response', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 400,
      text: () => Promise.resolve('Bad Request: chat not found'),
    });

    await expect(sendNotification('Test')).rejects.toThrow('Telegram API error 400');
  });

  it('throws on network error', async () => {
    mockFetch.mockRejectedValue(new Error('Network error'));

    await expect(sendNotification('Test')).rejects.toThrow('Network error');
  });
});

describe('pollCommands', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetUpdateOffset();
  });

  it('returns commands from configured chat', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        ok: true,
        result: [
          {
            update_id: 100,
            message: { chat: { id: 123456789 }, text: '/status' },
          },
        ],
      }),
    });

    const commands = await pollCommands();
    expect(commands).toEqual(['/status']);
  });

  it('ignores messages from other chats', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        ok: true,
        result: [
          {
            update_id: 101,
            message: { chat: { id: 999999 }, text: '/status' },
          },
        ],
      }),
    });

    const commands = await pollCommands();
    expect(commands).toEqual([]);
  });

  it('ignores non-command messages', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        ok: true,
        result: [
          {
            update_id: 102,
            message: { chat: { id: 123456789 }, text: 'just a regular message' },
          },
        ],
      }),
    });

    const commands = await pollCommands();
    expect(commands).toEqual([]);
  });

  it('returns empty array when no updates', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ok: true, result: [] }),
    });

    const commands = await pollCommands();
    expect(commands).toEqual([]);
  });

  it('returns empty array on API failure', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
    });

    const commands = await pollCommands();
    expect(commands).toEqual([]);
  });

  it('returns empty array on network error', async () => {
    mockFetch.mockRejectedValue(new Error('network down'));

    const commands = await pollCommands();
    expect(commands).toEqual([]);
  });

  it('normalizes command to lowercase', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        ok: true,
        result: [
          {
            update_id: 103,
            message: { chat: { id: 123456789 }, text: '/STATUS' },
          },
        ],
      }),
    });

    const commands = await pollCommands();
    expect(commands).toEqual(['/status']);
  });

  it('extracts only the command part (ignores args)', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        ok: true,
        result: [
          {
            update_id: 104,
            message: { chat: { id: 123456789 }, text: '/status verbose' },
          },
        ],
      }),
    });

    const commands = await pollCommands();
    expect(commands).toEqual(['/status']);
  });

  it('handles multiple commands in one poll', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        ok: true,
        result: [
          {
            update_id: 105,
            message: { chat: { id: 123456789 }, text: '/status' },
          },
          {
            update_id: 106,
            message: { chat: { id: 123456789 }, text: '/help' },
          },
        ],
      }),
    });

    const commands = await pollCommands();
    expect(commands).toEqual(['/status', '/help']);
  });

  it('advances offset after processing updates', async () => {
    // First poll returns update_id 200
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        ok: true,
        result: [
          {
            update_id: 200,
            message: { chat: { id: 123456789 }, text: '/status' },
          },
        ],
      }),
    });

    await pollCommands();

    // Second poll should include offset=201
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ ok: true, result: [] }),
    });

    await pollCommands();

    const secondCallUrl = mockFetch.mock.calls[1][0] as string;
    expect(secondCallUrl).toContain('offset=201');
  });

  it('handles updates without message field', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        ok: true,
        result: [
          { update_id: 107 }, // no message
        ],
      }),
    });

    const commands = await pollCommands();
    expect(commands).toEqual([]);
  });

  it('handles messages without text field', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        ok: true,
        result: [
          {
            update_id: 108,
            message: { chat: { id: 123456789 } }, // no text (photo, sticker, etc.)
          },
        ],
      }),
    });

    const commands = await pollCommands();
    expect(commands).toEqual([]);
  });
});
