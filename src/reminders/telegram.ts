import { getConfig } from '../config.js';
import { getLogger } from '../logger.js';

const logger = getLogger();

export async function sendNotification(body: string): Promise<string | null> {
  const config = getConfig();

  try {
    const response = await fetch(
      `https://api.telegram.org/bot${config.TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: config.TELEGRAM_CHAT_ID,
          text: body,
        }),
      },
    );

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Telegram API error ${response.status}: ${errorBody}`);
    }

    const data = (await response.json()) as { result: { message_id: number } };
    const messageId = String(data.result.message_id);

    logger.info({ messageId, bodyLength: body.length }, 'Telegram notification sent');
    return messageId;
  } catch (error) {
    logger.error({ error, bodyLength: body.length }, 'Failed to send Telegram notification');
    throw error;
  }
}

export interface TelegramUpdate {
  update_id: number;
  message?: {
    chat: { id: number };
    text?: string;
  };
}

let _lastUpdateId = 0;

/** Reset the update offset (used in tests). */
export function resetUpdateOffset(): void {
  _lastUpdateId = 0;
}

/**
 * Poll Telegram for new commands sent to the bot.
 * Returns an array of command strings (e.g. ['/status']) from the configured chat.
 */
export async function pollCommands(): Promise<string[]> {
  const config = getConfig();

  try {
    const url = new URL(`https://api.telegram.org/bot${config.TELEGRAM_BOT_TOKEN}/getUpdates`);
    url.searchParams.set('timeout', '0');
    url.searchParams.set('allowed_updates', JSON.stringify(['message']));
    if (_lastUpdateId > 0) {
      url.searchParams.set('offset', String(_lastUpdateId + 1));
    }

    const response = await fetch(url.toString());
    if (!response.ok) {
      logger.debug({ status: response.status }, 'Telegram getUpdates failed');
      return [];
    }

    const data = (await response.json()) as { ok: boolean; result: TelegramUpdate[] };
    if (!data.ok || !data.result.length) {
      return [];
    }

    const commands: string[] = [];
    for (const update of data.result) {
      _lastUpdateId = Math.max(_lastUpdateId, update.update_id);

      // Only process messages from the configured chat
      if (
        update.message?.text &&
        String(update.message.chat.id) === config.TELEGRAM_CHAT_ID
      ) {
        const text = update.message.text.trim();
        if (text.startsWith('/')) {
          commands.push(text.split(/\s+/)[0]!.toLowerCase());
        }
      }
    }

    if (commands.length > 0) {
      logger.info({ commands, updateId: _lastUpdateId }, 'Received Telegram commands');
    }

    return commands;
  } catch (error) {
    logger.debug({ error }, 'Failed to poll Telegram commands');
    return [];
  }
}
