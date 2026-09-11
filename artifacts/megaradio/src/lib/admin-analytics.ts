import { endOfDay, format, startOfDay } from 'date-fns';

export function analyticsParams(range: { from: Date; to: Date }, event: string): URLSearchParams {
  const params = new URLSearchParams({
    startDate: startOfDay(range.from).toISOString(),
    endDate: endOfDay(range.to).toISOString(),
    limit: '100',
  });
  if (event && event !== 'all') params.set('event', event);
  return params;
}

export function analyticsTimestamp(timestamp: string): string {
  if (!timestamp) return 'Unknown time';
  const date = new Date(timestamp);
  return Number.isFinite(date.getTime()) ? format(date, 'MMM dd, HH:mm') : 'Unknown time';
}
