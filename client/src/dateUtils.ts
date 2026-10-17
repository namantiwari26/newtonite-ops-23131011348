/**
 * Utility functions for consistent date and relative time formatting with exact hover timestamps.
 */

export function formatRelativeTime(dateInput: string | Date | null | undefined): string {
  if (!dateInput) return '—';
  const date = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
  if (isNaN(date.getTime())) return '—';

  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.round(diffMs / 1000);
  const diffMin = Math.round(diffSec / 60);
  const diffHour = Math.round(diffMin / 60);
  const diffDay = Math.round(diffHour / 24);

  if (diffSec < 45) return 'just now';
  if (diffSec < 90) return '1 minute ago';
  if (diffMin < 45) return `${diffMin} minutes ago`;
  if (diffMin < 90) return '1 hour ago';
  if (diffHour < 24) return `${diffHour} hours ago`;
  if (diffHour < 48) return 'yesterday';
  if (diffDay < 30) return `${diffDay} days ago`;

  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function formatExactTime(dateInput: string | Date | null | undefined): string {
  if (!dateInput) return '';
  const date = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
  if (isNaN(date.getTime())) return '';
  return date.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'medium',
  });
}

export function formatDate(dateInput: string | Date | null | undefined): string {
  if (!dateInput) return '—';
  const date = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
  if (isNaN(date.getTime())) return '—';
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}
