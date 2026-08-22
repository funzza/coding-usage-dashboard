import { describe, expect, it } from 'vitest'
import type { QuotaWindow } from '../../../main/quota/types'
import { cycleStart } from './cycle'

const now = new Date('2026-08-21T12:00:00')

function win(key: string, resetsAt: string | null): QuotaWindow {
  return { key, label: key, usedPercent: 50, resetsAt }
}

describe('cycleStart', () => {
  it('returns null without resetsAt or on invalid date', () => {
    expect(cycleStart(win('weekly', null), now)).toBeNull()
    expect(cycleStart(win('weekly', 'not-a-date'), now)).toBeNull()
  })

  it('weekly / daily / Nd windows subtract days', () => {
    expect(cycleStart(win('weekly', '2026-08-24T12:00:00'), now)).toEqual(
      new Date('2026-08-17T12:00:00')
    )
    expect(cycleStart(win('daily', '2026-08-22T00:00:00'), now)).toEqual(
      new Date('2026-08-21T00:00:00')
    )
    expect(cycleStart(win('3d', '2026-08-22T00:00:00'), now)).toEqual(
      new Date('2026-08-19T00:00:00')
    )
  })

  it('Nh / Nm windows subtract hours / minutes', () => {
    expect(cycleStart(win('5h', '2026-08-21T17:00:00'), now)).toEqual(
      new Date('2026-08-21T12:00:00')
    )
    expect(cycleStart(win('30m', '2026-08-21T12:30:00'), now)).toEqual(
      new Date('2026-08-21T12:00:00')
    )
  })

  it('monthly / credits subtract one calendar month', () => {
    expect(cycleStart(win('monthly', '2026-09-01T00:00:00'), now)).toEqual(
      new Date('2026-08-01T00:00:00')
    )
    expect(cycleStart(win('credits', '2026-09-01T00:00:00'), now)).toEqual(
      new Date('2026-08-01T00:00:00')
    )
  })

  it('returns null for unrecognized keys', () => {
    expect(cycleStart(win('unknown', '2026-08-24T12:00:00'), now)).toBeNull()
    expect(cycleStart(win('window', '2026-08-24T12:00:00'), now)).toBeNull()
  })

  it('returns null when the inferred start is still in the future', () => {
    // reset 10 天后 → weekly 起点在 3 天后,周期尚未开始
    expect(cycleStart(win('weekly', '2026-08-31T12:00:00'), now)).toBeNull()
  })
})
