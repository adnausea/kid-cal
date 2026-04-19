import { getCalendarProvider } from './provider.js';
import type { ExtractedEvent, ExtractedActionItem } from '../types.js';

export async function createCalendarEvent(event: ExtractedEvent): Promise<string> {
  return getCalendarProvider().createEvent(event);
}

export async function createActionItemReminder(item: ExtractedActionItem): Promise<string | null> {
  return getCalendarProvider().createActionItemReminder(item);
}
