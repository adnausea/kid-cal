import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { getConfig } from '../config.js';
import { getLogger } from '../logger.js';
import type { ParsedEmail, ExtractionResult, ExtractedEvent, ExtractedActionItem } from '../types.js';
import { extractionResultSchema } from './schemas.js';
import { buildSystemPrompt, buildUserPrompt } from './prompt.js';

export function filterByKeywords<T extends { title: string; description: string }>(
  items: T[],
  excludeKeywords: string[],
  label: string,
): T[] {
  if (excludeKeywords.length === 0) return items;

  const logger = getLogger();
  return items.filter((item) => {
    const text = `${item.title} ${item.description}`.toLowerCase();
    const matchedKeyword = excludeKeywords.find((kw) => text.includes(kw.toLowerCase()));
    if (matchedKeyword) {
      logger.info({ title: item.title, matchedKeyword, label }, 'Filtered out by exclude keyword');
      return false;
    }
    return true;
  });
}

let _client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!_client) {
    _client = new Anthropic({ apiKey: getConfig().ANTHROPIC_API_KEY });
  }
  return _client;
}

export async function extractFromEmail(email: ParsedEmail): Promise<ExtractionResult> {
  const config = getConfig();
  const logger = getLogger();
  const client = getClient();

  logger.info(
    { messageId: email.messageId, subject: email.subject },
    'Extracting events from email',
  );

  const message = await client.messages.parse({
    model: config.CLAUDE_MODEL,
    max_tokens: 4096,
    system: buildSystemPrompt(config.CHILD_GRADE),
    messages: [
      {
        role: 'user',
        content: buildUserPrompt(email, config.TIMEZONE),
      },
    ],
    output_config: {
      format: zodOutputFormat(extractionResultSchema),
    },
  });

  const parsed = message.parsed_output;
  if (!parsed) {
    logger.warn({ messageId: email.messageId, stopReason: message.stop_reason }, 'No parsed output from Claude');
    return { events: [], actionItems: [], summary: 'Could not extract information from this email.', extractionFailed: true };
  }

  // Map snake_case schema output to camelCase application types
  const events: ExtractedEvent[] = parsed.events.map((e) => ({
    title: e.title,
    description: e.description,
    startDate: e.start_date,
    endDate: e.end_date,
    allDay: e.all_day,
    location: e.location,
    sourceEmailId: email.messageId,
    sourceEmailSubject: email.subject,
  }));

  const actionItems: ExtractedActionItem[] = parsed.action_items.map((a) => ({
    title: a.title,
    description: a.description,
    deadline: a.deadline,
    priority: a.priority,
    sourceEmailId: email.messageId,
    sourceEmailSubject: email.subject,
  }));

  // Post-extraction keyword filter
  const excludeKeywords = config.EXCLUDE_KEYWORDS;
  const filteredEvents = filterByKeywords(events, excludeKeywords, 'event');
  const filteredActionItems = filterByKeywords(actionItems, excludeKeywords, 'action_item');

  logger.info(
    {
      messageId: email.messageId,
      eventCount: filteredEvents.length,
      actionItemCount: filteredActionItems.length,
      filteredEvents: events.length - filteredEvents.length,
      filteredActionItems: actionItems.length - filteredActionItems.length,
      summary: parsed.summary,
    },
    'Extraction complete',
  );

  return {
    events: filteredEvents,
    actionItems: filteredActionItems,
    summary: parsed.summary,
  };
}
