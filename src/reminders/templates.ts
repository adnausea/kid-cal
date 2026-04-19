import { format, parseISO } from 'date-fns';
import type { DueReminder, ExtractedEvent, ExtractedActionItem } from '../types.js';

function formatDate(isoDate: string): string {
  try {
    const date = parseISO(isoDate);
    return format(date, 'EEE, MMM d');
  } catch {
    return isoDate;
  }
}

function formatDateTime(isoDate: string): string {
  try {
    const date = parseISO(isoDate);
    return format(date, 'EEE, MMM d \'at\' h:mm a');
  } catch {
    return isoDate;
  }
}

export function formatReminderMessage(reminder: DueReminder): string {
  const isAllDay = !reminder.date.includes('T');
  const dateStr = isAllDay ? formatDate(reminder.date) : formatDateTime(reminder.date);
  const locationStr = reminder.location ? `\n📍 ${reminder.location}` : '';

  switch (reminder.reminderType) {
    case 'week_before':
      return `📅 NEXT WEEK: ${reminder.title}\n${dateStr}${locationStr}\n${reminder.description}`;

    case 'day_before':
      if (reminder.type === 'event') {
        return `📅 TOMORROW: ${reminder.title}\n${dateStr}${locationStr}\n${reminder.description}`;
      }
      return `✅ DUE TOMORROW: ${reminder.title}\n${dateStr}\n${reminder.description}`;

    case 'morning_of':
      return `📅 TODAY: ${reminder.title}\n${dateStr}${locationStr}\n${reminder.description}`;

    case 'fifteen_min_before':
      return `🔔 STARTING SOON: ${reminder.title}\n${dateStr}${locationStr}\n${reminder.description}`;

    case 'deadline_approaching':
      return `⚠️ DEADLINE IN 2 DAYS: ${reminder.title}\n${dateStr}\n${reminder.description}`;

    case 'deadline_today':
      return `🔴 DUE TODAY: ${reminder.title}\n${dateStr}\n${reminder.description}`;

    default:
      return `📋 Reminder: ${reminder.title}\n${dateStr}\n${reminder.description}`;
  }
}

export function formatProcessedEmailMessage(
  subject: string,
  from: string,
  summary: string,
  events: ExtractedEvent[],
  actionItems: ExtractedActionItem[],
): string {
  const lines: string[] = [
    `📬 ${subject}`,
    `From: ${from}`,
    ``,
    summary,
  ];

  if (events.length > 0) {
    lines.push('');
    lines.push(`📅 ${events.length} event${events.length > 1 ? 's' : ''}:`);
    for (const e of events) {
      const isAllDay = !e.startDate.includes('T') || e.allDay;
      const dateStr = isAllDay ? formatDate(e.startDate) : formatDateTime(e.startDate);
      const loc = e.location ? ` — 📍 ${e.location}` : '';
      lines.push(`  • ${e.title}`);
      lines.push(`    ${dateStr}${loc}`);
    }
  }

  if (actionItems.length > 0) {
    lines.push('');
    const priorityIcon = (p: string) => p === 'high' ? '🔴' : p === 'medium' ? '🟡' : '🟢';
    lines.push(`✅ ${actionItems.length} action item${actionItems.length > 1 ? 's' : ''}:`);
    for (const a of actionItems) {
      const deadline = a.deadline
        ? ` — due ${formatDate(a.deadline)}`
        : '';
      lines.push(`  ${priorityIcon(a.priority)} ${a.title}${deadline}`);
    }
  }

  if (events.length === 0 && actionItems.length === 0) {
    lines.push('');
    lines.push('No events or action items found.');
  }

  return lines.join('\n');
}
