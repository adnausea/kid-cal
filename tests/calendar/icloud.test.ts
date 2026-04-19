import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../src/config.js', () => ({
  getConfig: () => ({
    ICLOUD_USERNAME: 'user@icloud.com',
    ICLOUD_APP_PASSWORD: 'test-app-password',
    TIMEZONE: 'America/New_York',
    EMAIL_PROVIDER: 'icloud',
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

const mockLogin = vi.fn().mockResolvedValue(undefined);
const mockFetchCalendars = vi.fn();
const mockFetchCalendarObjects = vi.fn();
const mockCreateCalendarObject = vi.fn();

vi.mock('tsdav', () => {
  const MockDAVClient = class {
    login = mockLogin;
    fetchCalendars = mockFetchCalendars;
    fetchCalendarObjects = mockFetchCalendarObjects;
    createCalendarObject = mockCreateCalendarObject;
    constructor() {}
  };
  return { DAVClient: MockDAVClient };
});

import { ICloudCalendarProvider, resetICloudClient } from '../../src/calendar/icloud.js';
import type { ExtractedEvent, ExtractedActionItem } from '../../src/types.js';

function makeEvent(overrides: Partial<ExtractedEvent> = {}): ExtractedEvent {
  return {
    title: 'Field Trip',
    description: 'Zoo visit',
    startDate: '2025-04-15T09:00:00',
    endDate: '2025-04-15T14:00:00',
    allDay: false,
    location: 'City Zoo',
    sourceEmailId: 'email-1',
    sourceEmailSubject: 'Field Trip Permission',
    ...overrides,
  };
}

function makeActionItem(overrides: Partial<ExtractedActionItem> = {}): ExtractedActionItem {
  return {
    title: 'Permission Slip',
    description: 'Sign and return',
    deadline: '2025-04-10',
    priority: 'high',
    sourceEmailId: 'email-1',
    sourceEmailSubject: 'Permission Slip Due',
    ...overrides,
  };
}

describe('ICloudCalendarProvider', () => {
  let provider: ICloudCalendarProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    resetICloudClient();
    provider = new ICloudCalendarProvider();

    // Default: one calendar available, no existing events
    mockFetchCalendars.mockResolvedValue([{
      displayName: 'Kid Calendar',
      url: 'https://caldav.icloud.com/12345/calendars/kid-cal/',
    }]);
    mockFetchCalendarObjects.mockResolvedValue([]);
    mockCreateCalendarObject.mockResolvedValue({ ok: true });
  });

  describe('createEvent', () => {
    it('connects to iCloud CalDAV and creates event', async () => {
      const id = await provider.createEvent(makeEvent());

      expect(mockLogin).toHaveBeenCalled();
      expect(mockFetchCalendars).toHaveBeenCalled();
      expect(mockCreateCalendarObject).toHaveBeenCalledTimes(1);
      expect(id).toMatch(/^evt-[a-f0-9]+@kid-cal$/);
    });

    it('generates valid iCal data with VEVENT', async () => {
      await provider.createEvent(makeEvent());

      const call = mockCreateCalendarObject.mock.calls[0][0];
      const ical = call.iCalString;

      expect(ical).toContain('BEGIN:VCALENDAR');
      expect(ical).toContain('BEGIN:VEVENT');
      expect(ical).toContain('END:VEVENT');
      expect(ical).toContain('END:VCALENDAR');
      expect(ical).toContain('SUMMARY:Field Trip');
      expect(ical).toContain('LOCATION:City Zoo');
      expect(ical).toContain('DESCRIPTION:Zoo visit');
    });

    it('uses DTSTART with TZID for timed events', async () => {
      await provider.createEvent(makeEvent());

      const ical = mockCreateCalendarObject.mock.calls[0][0].iCalString;
      expect(ical).toContain('DTSTART;TZID=America/New_York:');
      expect(ical).toContain('DTEND;TZID=America/New_York:');
      expect(ical).not.toContain('VALUE=DATE');
    });

    it('uses VALUE=DATE for all-day events', async () => {
      await provider.createEvent(makeEvent({
        allDay: true,
        startDate: '2025-04-15T00:00:00',
        endDate: null,
      }));

      const ical = mockCreateCalendarObject.mock.calls[0][0].iCalString;
      expect(ical).toContain('DTSTART;VALUE=DATE:20250415');
      expect(ical).toContain('DTEND;VALUE=DATE:20250416'); // next day
    });

    it('uses explicit end date for all-day events when provided', async () => {
      await provider.createEvent(makeEvent({
        allDay: true,
        startDate: '2025-04-15T00:00:00',
        endDate: '2025-04-17T00:00:00',
      }));

      const ical = mockCreateCalendarObject.mock.calls[0][0].iCalString;
      expect(ical).toContain('DTSTART;VALUE=DATE:20250415');
      expect(ical).toContain('DTEND;VALUE=DATE:20250417');
    });

    it('defaults timed event end to 1 hour after start when no endDate', async () => {
      await provider.createEvent(makeEvent({
        allDay: false,
        startDate: '2025-04-15T09:00:00',
        endDate: null,
      }));

      const ical = mockCreateCalendarObject.mock.calls[0][0].iCalString;
      expect(ical).toContain('DTSTART;TZID=America/New_York:20250415T090000');
      expect(ical).toContain('DTEND;TZID=America/New_York:20250415T100000');
    });

    it('generates deterministic UID for same inputs', async () => {
      const id1 = await provider.createEvent(makeEvent());

      resetICloudClient();
      mockFetchCalendars.mockResolvedValue([{
        displayName: 'Kid Calendar',
        url: 'https://caldav.icloud.com/12345/calendars/kid-cal/',
      }]);
      mockFetchCalendarObjects.mockResolvedValue([]);

      const id2 = await provider.createEvent(makeEvent());
      expect(id1).toBe(id2);
    });

    it('generates different UIDs for different events', async () => {
      const id1 = await provider.createEvent(makeEvent({ title: 'Event A' }));

      resetICloudClient();
      mockFetchCalendars.mockResolvedValue([{
        displayName: 'Kid Calendar',
        url: 'https://caldav.icloud.com/12345/calendars/kid-cal/',
      }]);
      mockFetchCalendarObjects.mockResolvedValue([]);

      const id2 = await provider.createEvent(makeEvent({ title: 'Event B' }));
      expect(id1).not.toBe(id2);
    });

    it('skips creation when event with same UID already exists', async () => {
      const event = makeEvent();
      // First call creates
      const id1 = await provider.createEvent(event);

      // Now mock that the event exists in CalDAV
      mockFetchCalendarObjects.mockResolvedValue([{
        data: `BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:${id1}\r\nEND:VEVENT\r\nEND:VCALENDAR`,
      }]);

      mockCreateCalendarObject.mockClear();
      const id2 = await provider.createEvent(event);

      expect(id2).toBe(id1);
      expect(mockCreateCalendarObject).not.toHaveBeenCalled();
    });

    it('escapes special iCal characters in text fields', async () => {
      await provider.createEvent(makeEvent({
        title: 'Event; with, special\\chars',
        description: 'Line1\nLine2',
        location: 'Room 101; Building A',
      }));

      const ical = mockCreateCalendarObject.mock.calls[0][0].iCalString;
      expect(ical).toContain('SUMMARY:Event\\; with\\, special\\\\chars');
      expect(ical).toContain('DESCRIPTION:Line1\\nLine2');
      expect(ical).toContain('LOCATION:Room 101\\; Building A');
    });

    it('omits LOCATION when null', async () => {
      await provider.createEvent(makeEvent({ location: null }));

      const ical = mockCreateCalendarObject.mock.calls[0][0].iCalString;
      expect(ical).not.toContain('LOCATION:');
    });

    it('includes email source in description', async () => {
      await provider.createEvent(makeEvent({
        sourceEmailSubject: 'April Newsletter',
      }));

      const ical = mockCreateCalendarObject.mock.calls[0][0].iCalString;
      expect(ical).toContain('iCloud Mail');
      expect(ical).toContain('April Newsletter');
    });

    it('uses .ics filename matching the UID', async () => {
      const id = await provider.createEvent(makeEvent());

      const call = mockCreateCalendarObject.mock.calls[0][0];
      expect(call.filename).toBe(`${id}.ics`);
    });

    it('throws when no calendars found in iCloud account', async () => {
      resetICloudClient();
      mockFetchCalendars.mockResolvedValue([]);

      await expect(provider.createEvent(makeEvent()))
        .rejects.toThrow('No calendars found in iCloud account');
    });

    it('caches the DAV client across calls', async () => {
      await provider.createEvent(makeEvent({ title: 'First' }));

      mockFetchCalendarObjects.mockResolvedValue([]);
      await provider.createEvent(makeEvent({ title: 'Second' }));

      // login should only be called once (cached)
      expect(mockLogin).toHaveBeenCalledTimes(1);
    });

    it('includes VTIMEZONE block for timed events', async () => {
      await provider.createEvent(makeEvent());

      const ical = mockCreateCalendarObject.mock.calls[0][0].iCalString;
      expect(ical).toContain('BEGIN:VTIMEZONE');
      expect(ical).toContain('TZID:America/New_York');
      expect(ical).toContain('END:VTIMEZONE');
    });

    it('omits VTIMEZONE block for all-day events', async () => {
      await provider.createEvent(makeEvent({ allDay: true, startDate: '2025-04-15' }));

      const ical = mockCreateCalendarObject.mock.calls[0][0].iCalString;
      expect(ical).not.toContain('BEGIN:VTIMEZONE');
    });
  });

  describe('createActionItemReminder', () => {
    it('creates all-day todo with priority emoji', async () => {
      const id = await provider.createActionItemReminder(makeActionItem({ priority: 'high' }));

      expect(id).toMatch(/^act-[a-f0-9]+@kid-cal$/);
      const ical = mockCreateCalendarObject.mock.calls[0][0].iCalString;
      expect(ical).toContain('🔴');
      expect(ical).toContain('TODO:');
      expect(ical).toContain('DTSTART;VALUE=DATE:');
    });

    it('uses medium priority emoji', async () => {
      await provider.createActionItemReminder(makeActionItem({ priority: 'medium' }));
      const ical = mockCreateCalendarObject.mock.calls[0][0].iCalString;
      expect(ical).toContain('🟡');
    });

    it('uses low priority emoji', async () => {
      await provider.createActionItemReminder(makeActionItem({ priority: 'low' }));
      const ical = mockCreateCalendarObject.mock.calls[0][0].iCalString;
      expect(ical).toContain('🟢');
    });

    it('returns null for action items without deadline', async () => {
      const id = await provider.createActionItemReminder(makeActionItem({ deadline: null }));
      expect(id).toBeNull();
      expect(mockCreateCalendarObject).not.toHaveBeenCalled();
    });

    it('skips creation when action item already exists', async () => {
      const item = makeActionItem();
      const id1 = await provider.createActionItemReminder(item);

      mockFetchCalendarObjects.mockResolvedValue([{
        data: `BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:${id1}\r\nEND:VEVENT\r\nEND:VCALENDAR`,
      }]);
      mockCreateCalendarObject.mockClear();

      const id2 = await provider.createActionItemReminder(item);
      expect(id2).toBe(id1);
      expect(mockCreateCalendarObject).not.toHaveBeenCalled();
    });

    it('includes priority in description', async () => {
      await provider.createActionItemReminder(makeActionItem({ priority: 'high' }));
      const ical = mockCreateCalendarObject.mock.calls[0][0].iCalString;
      expect(ical).toContain('Priority: high');
    });

    it('sets correct end date (day after deadline)', async () => {
      await provider.createActionItemReminder(makeActionItem({ deadline: '2025-04-10' }));
      const ical = mockCreateCalendarObject.mock.calls[0][0].iCalString;
      expect(ical).toContain('DTSTART;VALUE=DATE:20250410');
      expect(ical).toContain('DTEND;VALUE=DATE:20250411');
    });
  });
});
