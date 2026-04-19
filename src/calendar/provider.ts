import { getConfig } from '../config.js';
import { GoogleCalendarProvider } from './google.js';
import { ICloudCalendarProvider } from './icloud.js';
import type { CalendarProvider } from './types.js';

let _provider: CalendarProvider | null = null;

export function getCalendarProvider(): CalendarProvider {
  if (!_provider) {
    const config = getConfig();
    if (config.CALENDAR_PROVIDER === 'icloud') {
      _provider = new ICloudCalendarProvider();
    } else {
      _provider = new GoogleCalendarProvider();
    }
  }
  return _provider;
}

/** Reset the cached provider (used in tests). */
export function resetCalendarProvider(): void {
  _provider = null;
}
