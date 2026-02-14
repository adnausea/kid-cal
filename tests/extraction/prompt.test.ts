import { describe, it, expect } from 'vitest';
import { buildSystemPrompt, buildUserPrompt } from '../../src/extraction/prompt.js';
import type { ParsedEmail } from '../../src/types.js';

function makeEmail(overrides: Partial<ParsedEmail> = {}): ParsedEmail {
  return {
    messageId: 'test-id',
    from: 'teacher@school.org',
    fromDomain: 'school.org',
    subject: 'Field Trip',
    date: new Date('2025-04-01T10:00:00Z'),
    textBody: 'Plain text fallback',
    htmlBody: '<p>Hello</p>',
    cleanText: 'Hello cleaned',
    ...overrides,
  };
}

describe('buildSystemPrompt', () => {
  it('is a non-empty string', () => {
    const prompt = buildSystemPrompt('5');
    expect(prompt).toBeTruthy();
    expect(typeof prompt).toBe('string');
    expect(prompt.length).toBeGreaterThan(100);
  });

  it('includes the child grade in filtering instructions', () => {
    const prompt = buildSystemPrompt('5');
    expect(prompt).toContain('grade 5');
    expect(prompt).toContain('middle school');
  });

  it('uses the provided grade value', () => {
    const prompt = buildSystemPrompt('3');
    expect(prompt).toContain('grade 3');
  });
});

describe('buildUserPrompt', () => {
  it('contains email from, subject, date, and timezone', () => {
    const prompt = buildUserPrompt(makeEmail(), 'America/New_York');

    expect(prompt).toContain('teacher@school.org');
    expect(prompt).toContain('Field Trip');
    expect(prompt).toContain('2025-04-01');
    expect(prompt).toContain('America/New_York');
  });

  it('uses cleanText when available', () => {
    const prompt = buildUserPrompt(makeEmail({ cleanText: 'Cleaned content', textBody: 'Raw text' }), 'UTC');
    expect(prompt).toContain('Cleaned content');
  });

  it('falls back to textBody when cleanText is empty', () => {
    const prompt = buildUserPrompt(makeEmail({ cleanText: '', textBody: 'Fallback text body' }), 'UTC');
    expect(prompt).toContain('Fallback text body');
  });
});
