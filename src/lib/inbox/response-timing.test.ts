import { describe, it, expect } from 'vitest'
import { computeResponseTiming, formatDurationPtBr } from './response-timing'

const T0 = new Date('2026-08-28T10:00:00Z').getTime()
const at = (minutes: number) =>
  new Date(T0 + minutes * 60_000).toISOString()

describe('computeResponseTiming', () => {
  it('reports how long the customer has been waiting when their message is last', () => {
    const now = T0 + 20 * 60_000
    const r = computeResponseTiming(
      [
        { sender_type: 'customer', created_at: at(0) },
        { sender_type: 'agent', created_at: at(2) },
        { sender_type: 'customer', created_at: at(15) },
      ],
      now,
    )
    expect(r.awaitingReplyMs).toBe(5 * 60_000)
    expect(r.firstResponseMs).toBe(2 * 60_000)
  })

  it('measures the wait from the START of an unanswered customer burst', () => {
    const now = T0 + 30 * 60_000
    const r = computeResponseTiming(
      [
        { sender_type: 'customer', created_at: at(10) },
        { sender_type: 'customer', created_at: at(12) },
        { sender_type: 'customer', created_at: at(13) },
      ],
      now,
    )
    expect(r.awaitingReplyMs).toBe(20 * 60_000)
  })

  it('has no awaiting time when the business replied last', () => {
    const r = computeResponseTiming(
      [
        { sender_type: 'customer', created_at: at(0) },
        { sender_type: 'agent', created_at: at(3) },
      ],
      T0 + 60 * 60_000,
    )
    expect(r.awaitingReplyMs).toBeNull()
    expect(r.firstResponseMs).toBe(3 * 60_000)
  })

  it('null first response when nobody replied yet', () => {
    const r = computeResponseTiming(
      [{ sender_type: 'customer', created_at: at(0) }],
      T0 + 5 * 60_000,
    )
    expect(r.firstResponseMs).toBeNull()
    expect(r.awaitingReplyMs).toBe(5 * 60_000)
  })

  it('ignores an agent message that predates the first customer message', () => {
    const r = computeResponseTiming(
      [
        { sender_type: 'agent', created_at: at(0) }, // outbound-first
        { sender_type: 'customer', created_at: at(10) },
        { sender_type: 'agent', created_at: at(14) },
      ],
      T0 + 20 * 60_000,
    )
    expect(r.firstResponseMs).toBe(4 * 60_000)
  })

  it('is order-independent', () => {
    const msgs = [
      { sender_type: 'agent', created_at: at(2) },
      { sender_type: 'customer', created_at: at(0) },
    ]
    expect(computeResponseTiming(msgs, T0).firstResponseMs).toBe(2 * 60_000)
  })

  it('handles an empty thread', () => {
    const r = computeResponseTiming([], T0)
    expect(r).toEqual({ awaitingReplyMs: null, firstResponseMs: null })
  })
})

describe('formatDurationPtBr', () => {
  it('seconds', () => expect(formatDurationPtBr(45_000)).toBe('45 s'))
  it('minutes', () => expect(formatDurationPtBr(12 * 60_000)).toBe('12 min'))
  it('hours + minutes', () =>
    expect(formatDurationPtBr(65 * 60_000)).toBe('1 h 5 min'))
  it('whole hours', () => expect(formatDurationPtBr(3 * 3600_000)).toBe('3 h'))
  it('one day', () => expect(formatDurationPtBr(24 * 3600_000)).toBe('1 dia'))
  it('days + hours', () =>
    expect(formatDurationPtBr(50 * 3600_000)).toBe('2 dias 2 h'))
})
