import { createHash } from 'crypto';
import { DAVClient, type DAVCalendar } from 'tsdav';
import { getConfig } from '../config.js';
import { getLogger } from '../logger.js';
import type { ExtractedEvent, ExtractedActionItem } from '../types.js';
import type { CalendarProvider } from './types.js';

const logger = getLogger();

let _client: DAVClient | null = null;
let _calendar: DAVCalendar | null = null;

function generateUID(prefix: string, sourceEmailId: string, title: string): string {
  const hash = createHash('sha256')
    .update(`${prefix}:${sourceEmailId}:${title}`)
    .digest('hex')
    .substring(0, 24);
  return `${prefix}-${hash}@kid-cal`;
}

function formatDateForICal(isoDate: string, allDay: boolean): string {
  if (allDay) {
    // VALUE=DATE format: YYYYMMDD
    return isoDate.split('T')[0]!.replace(/-/g, '');
  }
  // DATETIME format: YYYYMMDDTHHMMSS
  const d = new Date(isoDate);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function escapeICalText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

function buildVEvent(opts: {
  uid: string;
  summary: string;
  description: string;
  dtstart: string;
  dtend: string;
  allDay: boolean;
  location?: string | null;
  timezone: string;
}): string {
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//kid-cal//EN',
    'CALSCALE:GREGORIAN',
  ];

  if (!opts.allDay) {
    lines.push(
      'BEGIN:VTIMEZONE',
      `TZID:${opts.timezone}`,
      'END:VTIMEZONE',
    );
  }

  lines.push('BEGIN:VEVENT');
  lines.push(`UID:${opts.uid}`);
  lines.push(`DTSTAMP:${formatDateForICal(new Date().toISOString(), false)}Z`);

  if (opts.allDay) {
    lines.push(`DTSTART;VALUE=DATE:${opts.dtstart}`);
    lines.push(`DTEND;VALUE=DATE:${opts.dtend}`);
  } else {
    lines.push(`DTSTART;TZID=${opts.timezone}:${opts.dtstart}`);
    lines.push(`DTEND;TZID=${opts.timezone}:${opts.dtend}`);
  }

  lines.push(`SUMMARY:${escapeICalText(opts.summary)}`);
  lines.push(`DESCRIPTION:${escapeICalText(opts.description)}`);

  if (opts.location) {
    lines.push(`LOCATION:${escapeICalText(opts.location)}`);
  }

  lines.push('END:VEVENT');
  lines.push('END:VCALENDAR');

  return lines.join('\r\n');
}

async function getClient(): Promise<DAVClient> {
  if (!_client) {
    const config = getConfig();

    const client = new DAVClient({
      serverUrl: 'https://caldav.icloud.com',
      credentials: {
        username: config.ICLOUD_USERNAME!,
        password: config.ICLOUD_APP_PASSWORD!,
      },
      authMethod: 'Basic',
      defaultAccountType: 'caldav',
    });

    await client.login();
    _client = client;

    logger.info('iCloud CalDAV client connected');
  }
  return _client;
}

async function getCalendar(): Promise<DAVCalendar> {
  if (!_calendar) {
    const client = await getClient();
    const calendars = await client.fetchCalendars();

    if (calendars.length === 0) {
      throw new Error('No calendars found in iCloud account');
    }

    // Use the first calendar (default), or let user specify later
    _calendar = calendars[0]!;
    logger.info(
      { calendarName: _calendar.displayName, url: _calendar.url },
      'Using iCloud calendar',
    );
  }
  return _calendar;
}

async function findExistingEvent(uid: string): Promise<string | null> {
  const client = await getClient();
  const calendar = await getCalendar();

  try {
    const objects = await client.fetchCalendarObjects({ calendar });
    for (const obj of objects) {
      if (obj.data && obj.data.includes(`UID:${uid}`)) {
        logger.info({ uid }, 'iCloud calendar event already exists');
        return uid;
      }
    }
  } catch (error) {
    logger.debug({ error, uid }, 'Error checking for existing event (proceeding with create)');
  }

  return null;
}

export class ICloudCalendarProvider implements CalendarProvider {
  async createEvent(event: ExtractedEvent): Promise<string> {
    const config = getConfig();
    const client = await getClient();
    const calendar = await getCalendar();
    const uid = generateUID('evt', event.sourceEmailId, event.title);

    // Check for existing event
    const existingId = await findExistingEvent(uid);
    if (existingId) return existingId;

    let dtstart: string;
    let dtend: string;

    if (event.allDay) {
      dtstart = formatDateForICal(event.startDate, true);
      if (event.endDate) {
        dtend = formatDateForICal(event.endDate, true);
      } else {
        const start = new Date(event.startDate.split('T')[0]!);
        start.setDate(start.getDate() + 1);
        dtend = formatDateForICal(start.toISOString(), true);
      }
    } else {
      dtstart = formatDateForICal(event.startDate, false);
      if (event.endDate) {
        dtend = formatDateForICal(event.endDate, false);
      } else {
        const start = new Date(event.startDate);
        start.setHours(start.getHours() + 1);
        dtend = formatDateForICal(start.toISOString(), false);
      }
    }

    const emailProvider = config.EMAIL_PROVIDER === 'icloud' ? 'iCloud Mail' : 'Yahoo Mail';
    const icalData = buildVEvent({
      uid,
      summary: event.title,
      description: `${event.description}\n\nFrom ${emailProvider}: "${event.sourceEmailSubject}"`,
      dtstart,
      dtend,
      allDay: event.allDay,
      location: event.location,
      timezone: config.TIMEZONE,
    });

    await client.createCalendarObject({
      calendar,
      filename: `${uid}.ics`,
      iCalString: icalData,
    });

    logger.info({ uid, title: event.title }, 'Created iCloud calendar event');
    return uid;
  }

  async createActionItemReminder(item: ExtractedActionItem): Promise<string | null> {
    if (!item.deadline) {
      logger.debug({ title: item.title }, 'Skipping action item without deadline');
      return null;
    }

    const config = getConfig();
    const client = await getClient();
    const calendar = await getCalendar();
    const uid = generateUID('act', item.sourceEmailId, item.title);

    // Check for existing event
    const existingId = await findExistingEvent(uid);
    if (existingId) return existingId;

    const dtstart = formatDateForICal(item.deadline, true);
    const endDate = new Date(item.deadline.split('T')[0]!);
    endDate.setDate(endDate.getDate() + 1);
    const dtend = formatDateForICal(endDate.toISOString(), true);

    const priorityEmoji = item.priority === 'high' ? '🔴' : item.priority === 'medium' ? '🟡' : '🟢';
    const emailProvider = config.EMAIL_PROVIDER === 'icloud' ? 'iCloud Mail' : 'Yahoo Mail';

    const icalData = buildVEvent({
      uid,
      summary: `${priorityEmoji} TODO: ${item.title}`,
      description: `${item.description}\n\nPriority: ${item.priority}\nFrom ${emailProvider}: "${item.sourceEmailSubject}"`,
      dtstart,
      dtend,
      allDay: true,
      timezone: config.TIMEZONE,
    });

    await client.createCalendarObject({
      calendar,
      filename: `${uid}.ics`,
      iCalString: icalData,
    });

    logger.info({ uid, title: item.title }, 'Created iCloud action item calendar event');
    return uid;
  }
}

/** Reset the cached client and calendar (used in tests). */
export function resetICloudClient(): void {
  _client = null;
  _calendar = null;
}
