import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/logger.js', () => ({
  getLogger: () => ({
    info: () => {},
    debug: () => {},
    warn: () => {},
    error: () => {},
  }),
}));

// Mock both providers to avoid real API calls
vi.mock('../../src/calendar/google.js', () => {
  const MockGoogleCalendarProvider = class {
    _type = 'google' as const;
    createEvent = vi.fn().mockResolvedValue('google-event-id');
    createActionItemReminder = vi.fn().mockResolvedValue('google-action-id');
  };
  return { GoogleCalendarProvider: MockGoogleCalendarProvider };
});

vi.mock('../../src/calendar/icloud.js', () => {
  const MockICloudCalendarProvider = class {
    _type = 'icloud' as const;
    createEvent = vi.fn().mockResolvedValue('icloud-event-uid');
    createActionItemReminder = vi.fn().mockResolvedValue('icloud-action-uid');
  };
  return { ICloudCalendarProvider: MockICloudCalendarProvider };
});

const mockConfig = {
  CALENDAR_PROVIDER: 'google' as 'google' | 'icloud',
};

vi.mock('../../src/config.js', () => ({
  getConfig: () => mockConfig,
}));

import { getCalendarProvider, resetCalendarProvider } from '../../src/calendar/provider.js';

describe('getCalendarProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetCalendarProvider();
  });

  it('returns GoogleCalendarProvider when CALENDAR_PROVIDER is google', () => {
    mockConfig.CALENDAR_PROVIDER = 'google';
    const provider = getCalendarProvider();

    expect((provider as any)._type).toBe('google');
    expect(provider.createEvent).toBeDefined();
    expect(provider.createActionItemReminder).toBeDefined();
  });

  it('returns ICloudCalendarProvider when CALENDAR_PROVIDER is icloud', () => {
    mockConfig.CALENDAR_PROVIDER = 'icloud';
    const provider = getCalendarProvider();

    expect((provider as any)._type).toBe('icloud');
  });

  it('caches the provider across calls', () => {
    mockConfig.CALENDAR_PROVIDER = 'google';
    const first = getCalendarProvider();
    const second = getCalendarProvider();

    expect(first).toBe(second);
  });

  it('resetCalendarProvider clears cache and creates new instance', () => {
    mockConfig.CALENDAR_PROVIDER = 'google';
    const first = getCalendarProvider();

    resetCalendarProvider();
    const second = getCalendarProvider();

    expect(first).not.toBe(second);
  });

  it('provider switch works after reset', () => {
    mockConfig.CALENDAR_PROVIDER = 'google';
    const googleProvider = getCalendarProvider();
    expect((googleProvider as any)._type).toBe('google');

    resetCalendarProvider();
    mockConfig.CALENDAR_PROVIDER = 'icloud';
    const icloudProvider = getCalendarProvider();
    expect((icloudProvider as any)._type).toBe('icloud');
  });
});
