import type Database from 'better-sqlite3';
import type {
  ExtractedEvent,
  ExtractedActionItem,
  StoredEvent,
  StoredActionItem,
  StoredProcessedEmail,
  ReminderType,
  DueReminder,
} from '../types.js';
import { getLogger } from '../logger.js';
import type { DbStats } from '../health.js';

function calcDaysUntil(target: Date, now: Date): number {
  return Math.floor((target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

export class StateManager {
  private db: Database.Database;
  private logger = getLogger();

  constructor(db: Database.Database) {
    this.db = db;
  }

  isProcessed(messageId: string): boolean {
    const row = this.db.prepare(
      'SELECT 1 FROM processed_emails WHERE message_id = ?'
    ).get(messageId);
    return !!row;
  }

  saveProcessedEmail(email: StoredProcessedEmail): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO processed_emails
        (message_id, "from", subject, processed_at, status, error_message, event_count, action_item_count)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      email.messageId,
      email.from,
      email.subject,
      email.processedAt,
      email.status,
      email.errorMessage,
      email.eventCount,
      email.actionItemCount,
    );
  }

  saveEvent(event: ExtractedEvent): StoredEvent {
    const result = this.db.prepare(`
      INSERT INTO events (email_message_id, title, description, start_date, end_date, all_day, location)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      event.sourceEmailId,
      event.title,
      event.description,
      event.startDate,
      event.endDate,
      event.allDay ? 1 : 0,
      event.location,
    );

    this.logger.info({ eventId: result.lastInsertRowid, title: event.title }, 'Saved event');

    return this.db.prepare('SELECT * FROM events WHERE id = ?').get(result.lastInsertRowid) as StoredEvent;
  }

  saveActionItem(item: ExtractedActionItem): StoredActionItem {
    const result = this.db.prepare(`
      INSERT INTO action_items (email_message_id, title, description, deadline, priority)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      item.sourceEmailId,
      item.title,
      item.description,
      item.deadline,
      item.priority,
    );

    this.logger.info({ actionItemId: result.lastInsertRowid, title: item.title }, 'Saved action item');

    return this.db.prepare('SELECT * FROM action_items WHERE id = ?').get(result.lastInsertRowid) as StoredActionItem;
  }

  findDuplicateEvent(title: string, startDate: string): StoredEvent | null {
    const dateOnly = startDate.split('T')[0];
    const row = this.db.prepare(`
      SELECT * FROM events
      WHERE LOWER(title) = LOWER(?)
        AND DATE(start_date) = DATE(?)
      LIMIT 1
    `).get(title, dateOnly) as StoredEvent | undefined;
    return row ?? null;
  }

  findDuplicateActionItem(title: string, deadline: string | null): StoredActionItem | null {
    if (!deadline) return null;
    const dateOnly = deadline.split('T')[0];
    const row = this.db.prepare(`
      SELECT * FROM action_items
      WHERE LOWER(title) = LOWER(?)
        AND DATE(deadline) = DATE(?)
      LIMIT 1
    `).get(title, dateOnly) as StoredActionItem | undefined;
    return row ?? null;
  }

  updateEventCalendarId(eventId: number, calendarEventId: string): void {
    this.db.prepare(
      'UPDATE events SET calendar_event_id = ? WHERE id = ?'
    ).run(calendarEventId, eventId);
  }

  updateActionItemCalendarId(actionItemId: number, calendarEventId: string): void {
    this.db.prepare(
      'UPDATE action_items SET calendar_event_id = ? WHERE id = ?'
    ).run(calendarEventId, actionItemId);
  }

  /** Run a function inside a SQLite transaction (auto-rollback on throw). */
  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  isReminderSent(eventId: number | null, actionItemId: number | null, reminderType: ReminderType): boolean {
    if (eventId) {
      const row = this.db.prepare(
        'SELECT 1 FROM sent_reminders WHERE event_id = ? AND reminder_type = ?'
      ).get(eventId, reminderType);
      return !!row;
    }
    if (actionItemId) {
      const row = this.db.prepare(
        'SELECT 1 FROM sent_reminders WHERE action_item_id = ? AND reminder_type = ?'
      ).get(actionItemId, reminderType);
      return !!row;
    }
    return false;
  }

  private pushDueReminders(
    into: DueReminder[],
    checks: { type: ReminderType; condition: boolean }[],
    eventId: number | null,
    actionItemId: number | null,
    base: Omit<DueReminder, 'reminderType'>,
  ): void {
    for (const check of checks) {
      if (check.condition && !this.isReminderSent(eventId, actionItemId, check.type)) {
        into.push({ ...base, reminderType: check.type });
      }
    }
  }

  saveReminder(
    eventId: number | null,
    actionItemId: number | null,
    reminderType: ReminderType,
    notificationSid: string | null,
  ): void {
    this.db.prepare(`
      INSERT INTO sent_reminders (event_id, action_item_id, reminder_type, notification_sid)
      VALUES (?, ?, ?, ?)
    `).run(eventId, actionItemId, reminderType, notificationSid);
  }

  getUpcomingEvents(withinDays: number): StoredEvent[] {
    return this.db.prepare(`
      SELECT * FROM events
      WHERE start_date >= strftime('%Y-%m-%dT%H:%M:%S', 'now', 'localtime')
        AND start_date <= strftime('%Y-%m-%dT%H:%M:%S', 'now', 'localtime', ? || ' days')
      ORDER BY start_date ASC
    `).all(withinDays) as StoredEvent[];
  }

  getUpcomingActionItems(withinDays: number): StoredActionItem[] {
    return this.db.prepare(`
      SELECT * FROM action_items
      WHERE deadline IS NOT NULL
        AND deadline >= strftime('%Y-%m-%dT%H:%M:%S', 'now', 'localtime')
        AND deadline <= strftime('%Y-%m-%dT%H:%M:%S', 'now', 'localtime', ? || ' days')
      ORDER BY deadline ASC
    `).all(withinDays) as StoredActionItem[];
  }

  private getEventsInMinuteWindow(fromMinutes: number, toMinutes: number): StoredEvent[] {
    return this.db.prepare(`
      SELECT * FROM events
      WHERE all_day = 0
        AND start_date >= strftime('%Y-%m-%dT%H:%M:%S', 'now', 'localtime', ? || ' minutes')
        AND start_date <= strftime('%Y-%m-%dT%H:%M:%S', 'now', 'localtime', ? || ' minutes')
      ORDER BY start_date ASC
    `).all(fromMinutes, toMinutes) as StoredEvent[];
  }

  getEmailSubject(messageId: string): string {
    const row = this.db.prepare(
      'SELECT subject FROM processed_emails WHERE message_id = ?'
    ).get(messageId) as { subject: string } | undefined;
    return row?.subject ?? '(unknown)';
  }

  getOrphanedEvents(): StoredEvent[] {
    return this.db.prepare(
      'SELECT * FROM events WHERE calendar_event_id IS NULL'
    ).all() as StoredEvent[];
  }

  getOrphanedActionItems(): StoredActionItem[] {
    return this.db.prepare(
      'SELECT * FROM action_items WHERE calendar_event_id IS NULL'
    ).all() as StoredActionItem[];
  }

  getDueReminders(now: Date, timezone: string): DueReminder[] {
    const reminders: DueReminder[] = [];

    // Get events within the next day (morning_of only)
    const events = this.getUpcomingEvents(1);
    for (const event of events) {
      const days = calcDaysUntil(new Date(event.start_date), now);
      this.pushDueReminders(reminders, [
        { type: 'morning_of', condition: days <= 0 && days > -1 },
      ], event.id, null, {
        type: 'event',
        itemId: event.id,
        title: event.title,
        description: event.description,
        date: event.start_date,
        location: event.location,
      });
    }

    // Get action items within the next day (deadline_today only)
    const actionItems = this.getUpcomingActionItems(1);
    for (const item of actionItems) {
      if (!item.deadline) continue;
      const days = calcDaysUntil(new Date(item.deadline), now);
      this.pushDueReminders(reminders, [
        { type: 'deadline_today', condition: days <= 0 && days > -1 },
      ], null, item.id, {
        type: 'action_item',
        itemId: item.id,
        title: item.title,
        description: item.description,
        date: item.deadline,
        location: null,
      });
    }

    // fifteen_min_before: timed events starting within next 20 min or up to 30 min ago.
    // The SQL window is a coarse filter; the minutesUntil check is defense-in-depth using
    // JS Date arithmetic (both use local time via new Date(unzoned string)).
    // nowSec truncates sub-second precision to match the second-level resolution of stored start_date strings.
    const nowSec = Math.floor(now.getTime() / 1000) * 1000;
    const nearEvents = this.getEventsInMinuteWindow(-30, 20);
    for (const event of nearEvents) {
      const minutesUntil = (new Date(event.start_date).getTime() - nowSec) / 60_000;
      this.pushDueReminders(reminders, [
        { type: 'fifteen_min_before', condition: minutesUntil >= -30 && minutesUntil <= 20 },
      ], event.id, null, {
        type: 'event',
        itemId: event.id,
        title: event.title,
        description: event.description,
        date: event.start_date,
        location: event.location,
      });
    }

    return reminders;
  }

  getDbStats(): DbStats {
    const count = (sql: string): number => {
      const row = this.db.prepare(sql).get() as { c: number };
      return row.c;
    };

    return {
      totalEvents: count('SELECT COUNT(*) as c FROM events'),
      totalActionItems: count('SELECT COUNT(*) as c FROM action_items'),
      totalProcessedEmails: count('SELECT COUNT(*) as c FROM processed_emails'),
      failedEmails: count("SELECT COUNT(*) as c FROM processed_emails WHERE status = 'failed'"),
      orphanedEvents: count('SELECT COUNT(*) as c FROM events WHERE calendar_event_id IS NULL'),
      orphanedActionItems: count('SELECT COUNT(*) as c FROM action_items WHERE calendar_event_id IS NULL'),
      upcomingEvents: count(`
        SELECT COUNT(*) as c FROM events
        WHERE start_date >= strftime('%Y-%m-%dT%H:%M:%S', 'now', 'localtime')
          AND start_date <= strftime('%Y-%m-%dT%H:%M:%S', 'now', 'localtime', '7 days')
      `),
      upcomingActionItems: count(`
        SELECT COUNT(*) as c FROM action_items
        WHERE deadline IS NOT NULL
          AND deadline >= strftime('%Y-%m-%dT%H:%M:%S', 'now', 'localtime')
          AND deadline <= strftime('%Y-%m-%dT%H:%M:%S', 'now', 'localtime', '7 days')
      `),
    };
  }
}
