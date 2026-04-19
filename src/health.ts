import { getConfig } from './config.js';

export interface HealthStats {
  startedAt: Date;
  uptimeMs: number;
  lastPollAt: Date | null;
  lastSuccessfulPollAt: Date | null;
  lastExtractionAt: Date | null;
  totalPolls: number;
  totalExtractions: number;
  consecutiveImapFailures: number;
  imapConnected: boolean;
}

export interface DbStats {
  totalEvents: number;
  totalActionItems: number;
  totalProcessedEmails: number;
  failedEmails: number;
  orphanedEvents: number;
  orphanedActionItems: number;
  upcomingEvents: number;
  upcomingActionItems: number;
}

let _tracker: HealthTracker | null = null;

export class HealthTracker {
  private startedAt: Date;
  private lastPollAt: Date | null = null;
  private lastSuccessfulPollAt: Date | null = null;
  private lastExtractionAt: Date | null = null;
  private totalPolls = 0;
  private totalExtractions = 0;
  private consecutiveImapFailures = 0;
  private imapConnected = false;

  constructor(startedAt: Date = new Date()) {
    this.startedAt = startedAt;
  }

  recordPollStart(): void {
    this.lastPollAt = new Date();
    this.totalPolls++;
  }

  recordPollSuccess(): void {
    this.lastSuccessfulPollAt = new Date();
    this.consecutiveImapFailures = 0;
  }

  recordPollFailure(): void {
    this.consecutiveImapFailures++;
  }

  recordExtraction(): void {
    this.lastExtractionAt = new Date();
    this.totalExtractions++;
  }

  setImapConnected(connected: boolean): void {
    this.imapConnected = connected;
  }

  getConsecutiveImapFailures(): number {
    return this.consecutiveImapFailures;
  }

  getStats(): HealthStats {
    const now = new Date();
    return {
      startedAt: this.startedAt,
      uptimeMs: now.getTime() - this.startedAt.getTime(),
      lastPollAt: this.lastPollAt,
      lastSuccessfulPollAt: this.lastSuccessfulPollAt,
      lastExtractionAt: this.lastExtractionAt,
      totalPolls: this.totalPolls,
      totalExtractions: this.totalExtractions,
      consecutiveImapFailures: this.consecutiveImapFailures,
      imapConnected: this.imapConnected,
    };
  }
}

export function getHealthTracker(): HealthTracker {
  if (!_tracker) {
    _tracker = new HealthTracker();
  }
  return _tracker;
}

export function resetHealthTracker(): void {
  _tracker = null;
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ${hours % 24}h ${minutes % 60}m`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

function formatAgo(date: Date | null): string {
  if (!date) return 'never';
  const ms = Date.now() - date.getTime();
  return `${formatDuration(ms)} ago`;
}

export function formatStatusMessage(health: HealthStats, db: DbStats): string {
  const config = getConfig();
  const imapStatus = health.imapConnected ? 'connected' : 'disconnected';
  const imapIcon = health.imapConnected ? '🟢' : '🔴';
  const failureWarning = health.consecutiveImapFailures > 0
    ? ` (${health.consecutiveImapFailures} consecutive failures)`
    : '';

  const lines = [
    `📊 kid-cal status`,
    ``,
    `⏱ Uptime: ${formatDuration(health.uptimeMs)}`,
    `${imapIcon} IMAP: ${imapStatus}${failureWarning}`,
    `📬 Email: ${config.EMAIL_PROVIDER} (${config.IMAP_USER})`,
    `📅 Calendar: ${config.CALENDAR_PROVIDER}`,
    ``,
    `🔄 Last poll: ${formatAgo(health.lastPollAt)}`,
    `✅ Last success: ${formatAgo(health.lastSuccessfulPollAt)}`,
    `🤖 Last extraction: ${formatAgo(health.lastExtractionAt)}`,
    ``,
    `📈 Totals: ${health.totalPolls} polls, ${health.totalExtractions} extractions`,
    `📧 Processed: ${db.totalProcessedEmails} emails (${db.failedEmails} failed)`,
    `📅 Events: ${db.totalEvents} (${db.orphanedEvents} pending sync)`,
    `✅ Action items: ${db.totalActionItems} (${db.orphanedActionItems} pending sync)`,
    `🔜 Upcoming: ${db.upcomingEvents} events, ${db.upcomingActionItems} deadlines (7d)`,
  ];

  return lines.join('\n');
}
