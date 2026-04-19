import { describe, it, expect } from 'vitest';
import { formatReminderMessage, formatProcessedEmailMessage } from '../../src/reminders/templates.js';
import type { ExtractedEvent, ExtractedActionItem } from '../../src/types.js';
import type { DueReminder } from '../../src/types.js';

describe('formatReminderMessage', () => {
  const baseReminder: DueReminder = {
    type: 'event',
    reminderType: 'week_before',
    itemId: 1,
    title: 'Science Fair',
    description: 'Annual science fair in the gym',
    date: '2025-04-15',
    location: 'School Gymnasium',
  };

  it('formats week_before reminder', () => {
    const msg = formatReminderMessage(baseReminder);
    expect(msg).toContain('NEXT WEEK');
    expect(msg).toContain('Science Fair');
    expect(msg).toContain('School Gymnasium');
  });

  it('formats day_before event reminder', () => {
    const msg = formatReminderMessage({ ...baseReminder, reminderType: 'day_before' });
    expect(msg).toContain('TOMORROW');
    expect(msg).toContain('Science Fair');
  });

  it('formats morning_of reminder', () => {
    const msg = formatReminderMessage({ ...baseReminder, reminderType: 'morning_of' });
    expect(msg).toContain('TODAY');
  });

  it('formats day_before action item reminder', () => {
    const msg = formatReminderMessage({
      ...baseReminder,
      type: 'action_item',
      reminderType: 'day_before',
      title: 'Return permission slip',
    });
    expect(msg).toContain('DUE TOMORROW');
    expect(msg).toContain('Return permission slip');
  });

  it('formats deadline_approaching reminder', () => {
    const msg = formatReminderMessage({
      ...baseReminder,
      type: 'action_item',
      reminderType: 'deadline_approaching',
      title: 'Book order',
    });
    expect(msg).toContain('DEADLINE IN 2 DAYS');
    expect(msg).toContain('Book order');
  });

  it('formats deadline_today reminder', () => {
    const msg = formatReminderMessage({
      ...baseReminder,
      type: 'action_item',
      reminderType: 'deadline_today',
      title: 'Turn in form',
    });
    expect(msg).toContain('DUE TODAY');
  });

  it('includes time for datetime events', () => {
    const msg = formatReminderMessage({
      ...baseReminder,
      date: '2025-04-15T14:30:00',
    });
    expect(msg).toContain('2:30 PM');
  });

  it('omits location when null', () => {
    const msg = formatReminderMessage({ ...baseReminder, location: null });
    expect(msg).not.toContain('📍');
  });

  it('handles unknown reminder type with default format', () => {
    const msg = formatReminderMessage({
      ...baseReminder,
      reminderType: 'unknown_type' as DueReminder['reminderType'],
    });
    expect(msg).toContain('Reminder:');
    expect(msg).toContain('Science Fair');
  });

  it('handles invalid date gracefully in all-day format', () => {
    const msg = formatReminderMessage({
      ...baseReminder,
      date: 'not-a-valid-date',
    });
    // Should fall back to raw string
    expect(msg).toContain('not-a-valid-date');
  });

  it('handles invalid date gracefully in datetime format', () => {
    const msg = formatReminderMessage({
      ...baseReminder,
      date: 'not-a-valid-dateT12:00:00',
    });
    // Should fall back to raw string
    expect(msg).toContain('not-a-valid-dateT12:00:00');
  });

  it('formats fifteen_min_before reminder with location', () => {
    const msg = formatReminderMessage({
      type: 'event',
      reminderType: 'fifteen_min_before',
      itemId: 1,
      title: 'Staff Meeting',
      description: 'Weekly sync',
      date: '2026-03-23T14:30:00',
      location: 'Room 101',
    });
    expect(msg).toContain('🔔');
    expect(msg).toContain('STARTING SOON');
    expect(msg).toContain('Staff Meeting');
    expect(msg).toContain('2:30 PM');
    expect(msg).toContain('📍');
    expect(msg).toContain('Room 101');
    expect(msg).toContain('Weekly sync');
  });

  it('formats fifteen_min_before reminder without location', () => {
    const msg = formatReminderMessage({
      type: 'event',
      reminderType: 'fifteen_min_before',
      itemId: 1,
      title: 'Zoom Call',
      description: 'Parent-teacher conference',
      date: '2026-03-23T09:00:00',
      location: null,
    });
    expect(msg).toContain('STARTING SOON');
    expect(msg).not.toContain('📍');
  });
});

function makeEvent(overrides: Partial<ExtractedEvent> = {}): ExtractedEvent {
  return {
    title: 'Field Trip to Zoo',
    description: 'Grade 5 visits the zoo',
    startDate: '2025-04-15T09:00:00',
    endDate: '2025-04-15T14:00:00',
    allDay: false,
    location: 'City Zoo',
    sourceEmailId: 'msg-1',
    sourceEmailSubject: 'Newsletter',
    ...overrides,
  };
}

function makeActionItem(overrides: Partial<ExtractedActionItem> = {}): ExtractedActionItem {
  return {
    title: 'Return permission slip',
    description: 'Sign and return by Friday',
    deadline: '2025-04-10',
    priority: 'high',
    sourceEmailId: 'msg-1',
    sourceEmailSubject: 'Newsletter',
    ...overrides,
  };
}

describe('formatProcessedEmailMessage', () => {
  it('includes subject, from, and summary', () => {
    const msg = formatProcessedEmailMessage(
      'Spring Newsletter',
      'office@school.org',
      'Upcoming events for April.',
      [],
      [],
    );
    expect(msg).toContain('Spring Newsletter');
    expect(msg).toContain('office@school.org');
    expect(msg).toContain('Upcoming events for April.');
  });

  it('shows "no events or action items" when both empty', () => {
    const msg = formatProcessedEmailMessage('Subject', 'from@x.com', 'Summary', [], []);
    expect(msg).toContain('No events or action items found');
  });

  it('formats events with title, date, and location', () => {
    const msg = formatProcessedEmailMessage(
      'Newsletter',
      'office@school.org',
      'Summary',
      [makeEvent()],
      [],
    );
    expect(msg).toContain('1 event:');
    expect(msg).toContain('Field Trip to Zoo');
    expect(msg).toContain('Apr 15');
    expect(msg).toContain('9:00 AM');
    expect(msg).toContain('📍 City Zoo');
  });

  it('pluralizes events correctly', () => {
    const msg = formatProcessedEmailMessage(
      'Newsletter', 'from@x.com', 'Summary',
      [makeEvent(), makeEvent({ title: 'Concert' })],
      [],
    );
    expect(msg).toContain('2 events:');
  });

  it('formats all-day events without time', () => {
    const msg = formatProcessedEmailMessage(
      'Newsletter', 'from@x.com', 'Summary',
      [makeEvent({ allDay: true, startDate: '2025-04-15' })],
      [],
    );
    expect(msg).toContain('Apr 15');
    expect(msg).not.toContain('AM');
    expect(msg).not.toContain('PM');
  });

  it('omits location when null', () => {
    const msg = formatProcessedEmailMessage(
      'Newsletter', 'from@x.com', 'Summary',
      [makeEvent({ location: null })],
      [],
    );
    expect(msg).not.toContain('📍');
  });

  it('formats action items with priority icon and deadline', () => {
    const msg = formatProcessedEmailMessage(
      'Newsletter', 'from@x.com', 'Summary',
      [],
      [makeActionItem({ priority: 'high', deadline: '2025-04-10' })],
    );
    expect(msg).toContain('1 action item:');
    expect(msg).toContain('🔴');
    expect(msg).toContain('Return permission slip');
    expect(msg).toContain('Apr 10');
  });

  it('uses medium priority icon', () => {
    const msg = formatProcessedEmailMessage(
      'Newsletter', 'from@x.com', 'Summary',
      [],
      [makeActionItem({ priority: 'medium' })],
    );
    expect(msg).toContain('🟡');
  });

  it('uses low priority icon', () => {
    const msg = formatProcessedEmailMessage(
      'Newsletter', 'from@x.com', 'Summary',
      [],
      [makeActionItem({ priority: 'low' })],
    );
    expect(msg).toContain('🟢');
  });

  it('handles action items without deadline', () => {
    const msg = formatProcessedEmailMessage(
      'Newsletter', 'from@x.com', 'Summary',
      [],
      [makeActionItem({ deadline: null })],
    );
    expect(msg).toContain('Return permission slip');
    expect(msg).not.toContain('due');
  });

  it('pluralizes action items correctly', () => {
    const msg = formatProcessedEmailMessage(
      'Newsletter', 'from@x.com', 'Summary',
      [],
      [makeActionItem(), makeActionItem({ title: 'Pay fee' })],
    );
    expect(msg).toContain('2 action items:');
  });

  it('shows both events and action items together', () => {
    const msg = formatProcessedEmailMessage(
      'Big Newsletter',
      'office@school.org',
      'Lots happening this month.',
      [makeEvent(), makeEvent({ title: 'Concert', startDate: '2025-04-20T18:00:00', location: 'Auditorium' })],
      [makeActionItem(), makeActionItem({ title: 'Pay field trip fee', priority: 'medium', deadline: '2025-04-12' })],
    );
    expect(msg).toContain('2 events:');
    expect(msg).toContain('2 action items:');
    expect(msg).toContain('Field Trip to Zoo');
    expect(msg).toContain('Concert');
    expect(msg).toContain('Return permission slip');
    expect(msg).toContain('Pay field trip fee');
  });
});
