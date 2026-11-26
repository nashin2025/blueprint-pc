import type { Difficulty } from '@shared/types'

export function currency(amount: number | undefined): string {
  if (amount === undefined || amount === null) return '—'
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2
  }).format(amount)
}

export function shortDate(ts: number): string {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric'
  }).format(new Date(ts))
}

export function relativeTime(ts: number): string {
  const diff = Date.now() - ts
  const minutes = Math.round(diff / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  if (days < 30) return `${days}d ago`
  return shortDate(ts)
}

export const DIFFICULTY_STYLES: Record<Difficulty, string> = {
  beginner: 'text-ok border-ok/30 bg-ok/10',
  intermediate: 'text-warn border-warn/30 bg-warn/10',
  advanced: 'text-danger border-danger/30 bg-danger/10'
}

export const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  beginner: 'Beginner',
  intermediate: 'Intermediate',
  advanced: 'Advanced'
}