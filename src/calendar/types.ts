import type { ExtractedEvent, ExtractedActionItem } from '../types.js';

/**
 * Calendar provider interface.
 * Both Google Calendar and iCloud CalDAV implement this contract.
 */
export interface CalendarProvider {
  /**
   * Create a calendar event. Returns the provider's event ID.
   * Must be idempotent — calling with the same event data should not create duplicates.
   */
  createEvent(event: ExtractedEvent): Promise<string>;

  /**
   * Create a calendar entry for an action item deadline.
   * Returns the event ID, or null if the action item has no deadline.
   */
  createActionItemReminder(item: ExtractedActionItem): Promise<string | null>;
}
