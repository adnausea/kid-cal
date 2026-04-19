import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/config.js', () => ({
  getConfig: () => ({
    EMAIL_PROVIDER: 'yahoo',
    IMAP_USER: 'user@yahoo.com',
    CALENDAR_PROVIDER: 'google',
    LOG_LEVEL: 'error',
  }),
}));
vi.mock('../src/logger.js', () => ({
  getLogger: () => ({
    info: () => {},
    debug: () => {},
    warn: () => {},
    error: () => {},
  }),
}));

import {
  HealthTracker,
  getHealthTracker,
  resetHealthTracker,
  formatStatusMessage,
  type HealthStats,
  type DbStats,
} from '../src/health.js';

function makeDbStats(overrides: Partial<DbStats> = {}): DbStats {
  return {
    totalEvents: 10,
    totalActionItems: 5,
    totalProcessedEmails: 20,
    failedEmails: 2,
    orphanedEvents: 1,
    orphanedActionItems: 0,
    upcomingEvents: 3,
    upcomingActionItems: 2,
    ...overrides,
  };
}

describe('HealthTracker', () => {
  it('initializes with zero state', () => {
    const tracker = new HealthTracker(new Date('2025-01-01T00:00:00Z'));
    const stats = tracker.getStats();

    expect(stats.startedAt).toEqual(new Date('2025-01-01T00:00:00Z'));
    expect(stats.lastPollAt).toBeNull();
    expect(stats.lastSuccessfulPollAt).toBeNull();
    expect(stats.lastExtractionAt).toBeNull();
    expect(stats.totalPolls).toBe(0);
    expect(stats.totalExtractions).toBe(0);
    expect(stats.consecutiveImapFailures).toBe(0);
    expect(stats.imapConnected).toBe(false);
  });

  it('records poll start and increments total polls', () => {
    const tracker = new HealthTracker();
    tracker.recordPollStart();
    tracker.recordPollStart();
    tracker.recordPollStart();

    const stats = tracker.getStats();
    expect(stats.totalPolls).toBe(3);
    expect(stats.lastPollAt).not.toBeNull();
  });

  it('recordPollSuccess sets lastSuccessfulPollAt and resets failures', () => {
    const tracker = new HealthTracker();
    tracker.recordPollFailure();
    tracker.recordPollFailure();
    expect(tracker.getConsecutiveImapFailures()).toBe(2);

    tracker.recordPollSuccess();
    const stats = tracker.getStats();
    expect(stats.lastSuccessfulPollAt).not.toBeNull();
    expect(stats.consecutiveImapFailures).toBe(0);
  });

  it('recordPollFailure increments consecutive failures', () => {
    const tracker = new HealthTracker();
    tracker.recordPollFailure();
    expect(tracker.getConsecutiveImapFailures()).toBe(1);
    tracker.recordPollFailure();
    expect(tracker.getConsecutiveImapFailures()).toBe(2);
    tracker.recordPollFailure();
    expect(tracker.getConsecutiveImapFailures()).toBe(3);
  });

  it('recordExtraction increments total and sets lastExtractionAt', () => {
    const tracker = new HealthTracker();
    tracker.recordExtraction();
    tracker.recordExtraction();

    const stats = tracker.getStats();
    expect(stats.totalExtractions).toBe(2);
    expect(stats.lastExtractionAt).not.toBeNull();
  });

  it('setImapConnected updates connection state', () => {
    const tracker = new HealthTracker();
    expect(tracker.getStats().imapConnected).toBe(false);

    tracker.setImapConnected(true);
    expect(tracker.getStats().imapConnected).toBe(true);

    tracker.setImapConnected(false);
    expect(tracker.getStats().imapConnected).toBe(false);
  });

  it('uptimeMs increases over time', () => {
    const start = new Date(Date.now() - 60000); // 1 minute ago
    const tracker = new HealthTracker(start);

    const stats = tracker.getStats();
    expect(stats.uptimeMs).toBeGreaterThanOrEqual(59000);
    expect(stats.uptimeMs).toBeLessThan(120000);
  });

  it('poll success resets failures accumulated from multiple failures', () => {
    const tracker = new HealthTracker();
    for (let i = 0; i < 10; i++) {
      tracker.recordPollFailure();
    }
    expect(tracker.getConsecutiveImapFailures()).toBe(10);

    tracker.recordPollSuccess();
    expect(tracker.getConsecutiveImapFailures()).toBe(0);
    expect(tracker.getStats().consecutiveImapFailures).toBe(0);
  });

  it('interleaved success and failure tracking', () => {
    const tracker = new HealthTracker();

    tracker.recordPollStart();
    tracker.recordPollSuccess();
    expect(tracker.getConsecutiveImapFailures()).toBe(0);

    tracker.recordPollStart();
    tracker.recordPollFailure();
    expect(tracker.getConsecutiveImapFailures()).toBe(1);

    tracker.recordPollStart();
    tracker.recordPollFailure();
    expect(tracker.getConsecutiveImapFailures()).toBe(2);

    tracker.recordPollStart();
    tracker.recordPollSuccess();
    expect(tracker.getConsecutiveImapFailures()).toBe(0);

    expect(tracker.getStats().totalPolls).toBe(4);
  });
});

describe('getHealthTracker / resetHealthTracker', () => {
  beforeEach(() => {
    resetHealthTracker();
  });

  it('returns a singleton', () => {
    const a = getHealthTracker();
    const b = getHealthTracker();
    expect(a).toBe(b);
  });

  it('resetHealthTracker clears the singleton', () => {
    const a = getHealthTracker();
    resetHealthTracker();
    const b = getHealthTracker();
    expect(a).not.toBe(b);
  });

  it('new tracker after reset has clean state', () => {
    const first = getHealthTracker();
    first.recordPollStart();
    first.recordPollFailure();
    first.recordExtraction();

    resetHealthTracker();
    const second = getHealthTracker();
    const stats = second.getStats();

    expect(stats.totalPolls).toBe(0);
    expect(stats.totalExtractions).toBe(0);
    expect(stats.consecutiveImapFailures).toBe(0);
  });
});

describe('formatStatusMessage', () => {
  function makeHealthStats(overrides: Partial<HealthStats> = {}): HealthStats {
    return {
      startedAt: new Date('2025-01-01T00:00:00Z'),
      uptimeMs: 3661000, // 1h 1m 1s
      lastPollAt: new Date('2025-01-01T01:00:00Z'),
      lastSuccessfulPollAt: new Date('2025-01-01T01:00:00Z'),
      lastExtractionAt: new Date('2025-01-01T00:30:00Z'),
      totalPolls: 12,
      totalExtractions: 3,
      consecutiveImapFailures: 0,
      imapConnected: true,
      ...overrides,
    };
  }

  it('includes all key status fields', () => {
    const msg = formatStatusMessage(makeHealthStats(), makeDbStats());

    expect(msg).toContain('kid-cal status');
    expect(msg).toContain('Uptime:');
    expect(msg).toContain('IMAP:');
    expect(msg).toContain('Email:');
    expect(msg).toContain('Calendar:');
    expect(msg).toContain('Last poll:');
    expect(msg).toContain('Last success:');
    expect(msg).toContain('Last extraction:');
    expect(msg).toContain('polls');
    expect(msg).toContain('extractions');
  });

  it('shows green icon when IMAP connected', () => {
    const msg = formatStatusMessage(makeHealthStats({ imapConnected: true }), makeDbStats());
    expect(msg).toContain('🟢');
    expect(msg).toContain('connected');
  });

  it('shows red icon when IMAP disconnected', () => {
    const msg = formatStatusMessage(makeHealthStats({ imapConnected: false }), makeDbStats());
    expect(msg).toContain('🔴');
    expect(msg).toContain('disconnected');
  });

  it('shows consecutive failures warning', () => {
    const msg = formatStatusMessage(
      makeHealthStats({ consecutiveImapFailures: 5, imapConnected: false }),
      makeDbStats(),
    );
    expect(msg).toContain('5 consecutive failures');
  });

  it('no failure warning when zero failures', () => {
    const msg = formatStatusMessage(
      makeHealthStats({ consecutiveImapFailures: 0 }),
      makeDbStats(),
    );
    expect(msg).not.toContain('consecutive failures');
  });

  it('shows "never" for null dates', () => {
    const msg = formatStatusMessage(
      makeHealthStats({
        lastPollAt: null,
        lastSuccessfulPollAt: null,
        lastExtractionAt: null,
      }),
      makeDbStats(),
    );
    expect(msg).toContain('never');
  });

  it('formats uptime in days/hours/minutes', () => {
    // 2 days, 3 hours, 15 minutes
    const ms = (2 * 24 * 60 * 60 + 3 * 60 * 60 + 15 * 60) * 1000;
    const msg = formatStatusMessage(makeHealthStats({ uptimeMs: ms }), makeDbStats());
    expect(msg).toContain('2d 3h 15m');
  });

  it('formats uptime in hours/minutes for sub-day', () => {
    const ms = (5 * 60 * 60 + 30 * 60) * 1000;
    const msg = formatStatusMessage(makeHealthStats({ uptimeMs: ms }), makeDbStats());
    expect(msg).toContain('5h 30m');
  });

  it('formats uptime in minutes/seconds for sub-hour', () => {
    const ms = (45 * 60 + 10) * 1000;
    const msg = formatStatusMessage(makeHealthStats({ uptimeMs: ms }), makeDbStats());
    expect(msg).toContain('45m 10s');
  });

  it('formats uptime in seconds for sub-minute', () => {
    const msg = formatStatusMessage(makeHealthStats({ uptimeMs: 42000 }), makeDbStats());
    expect(msg).toContain('42s');
  });

  it('includes DB stats in output', () => {
    const msg = formatStatusMessage(makeHealthStats(), makeDbStats({
      totalProcessedEmails: 50,
      failedEmails: 3,
      totalEvents: 25,
      orphanedEvents: 2,
      totalActionItems: 15,
      orphanedActionItems: 1,
      upcomingEvents: 4,
      upcomingActionItems: 6,
    }));

    expect(msg).toContain('50 emails');
    expect(msg).toContain('3 failed');
    expect(msg).toContain('25');
    expect(msg).toContain('2 pending sync');
    expect(msg).toContain('15');
    expect(msg).toContain('4 events');
    expect(msg).toContain('6 deadlines');
  });

  it('shows email provider and user', () => {
    const msg = formatStatusMessage(makeHealthStats(), makeDbStats());
    expect(msg).toContain('yahoo');
    expect(msg).toContain('user@yahoo.com');
  });

  it('shows calendar provider', () => {
    const msg = formatStatusMessage(makeHealthStats(), makeDbStats());
    expect(msg).toContain('google');
  });

  it('includes poll and extraction counts', () => {
    const msg = formatStatusMessage(
      makeHealthStats({ totalPolls: 100, totalExtractions: 42 }),
      makeDbStats(),
    );
    expect(msg).toContain('100 polls');
    expect(msg).toContain('42 extractions');
  });
});
