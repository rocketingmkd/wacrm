import { describe, expect, it, vi } from 'vitest';

import { phoneVariants } from './phone-utils';
import { sendToFirstWorkingCandidate, sendToFirstWorkingPhone } from './send-candidates';

const notAllowed = () => new Error('(#131030) Recipient phone number not in allowed list');

const candidates = [
  { kind: 'user_id', value: 'bsuid-1' },
  { kind: 'phone', value: '+5511999990001' },
  { kind: 'phone', value: '+551199990001' },
];

describe('sendToFirstWorkingCandidate', () => {
  it('returns the first success with the candidate that worked, without trying the rest', async () => {
    const attempt = vi.fn().mockResolvedValue('wamid.1');
    const res = await sendToFirstWorkingCandidate(candidates, attempt);
    expect(res).toEqual({ result: 'wamid.1', candidate: candidates[0] });
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it('moves to the next candidate on "recipient not allowed"', async () => {
    const attempt = vi
      .fn()
      .mockRejectedValueOnce(notAllowed())
      .mockResolvedValueOnce('wamid.2');
    const res = await sendToFirstWorkingCandidate(candidates, attempt);
    expect(res.candidate).toBe(candidates[1]);
    expect(res.result).toBe('wamid.2');
  });

  it('rethrows at once on any other error, without trying the next candidate', async () => {
    const boom = new Error('Invalid parameter');
    const attempt = vi.fn().mockRejectedValue(boom);
    await expect(sendToFirstWorkingCandidate(candidates, attempt)).rejects.toBe(boom);
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it('throws the last error when every candidate was rejected', async () => {
    const last = notAllowed();
    const attempt = vi
      .fn()
      .mockRejectedValueOnce(notAllowed())
      .mockRejectedValueOnce(notAllowed())
      .mockRejectedValueOnce(last);
    await expect(sendToFirstWorkingCandidate(candidates, attempt)).rejects.toBe(last);
    expect(attempt).toHaveBeenCalledTimes(3);
  });

  it('lets a custom rule keep going on a failure specific to one candidate', async () => {
    // A stale BSUID falls through on ANY error; a phone only on "not allowed".
    const attempt = vi
      .fn()
      .mockRejectedValueOnce(new Error('user not found'))
      .mockResolvedValueOnce('wamid.3');
    const onSkipped = vi.fn();
    const res = await sendToFirstWorkingCandidate(candidates, attempt, {
      fallThrough: (c, message) => c.kind !== 'phone' || /131030/.test(message),
      onSkipped,
    });
    expect(res.candidate).toBe(candidates[1]);
    expect(onSkipped).toHaveBeenCalledWith(candidates[0], 'user not found');

    const attempt2 = vi.fn().mockRejectedValue(new Error('Invalid parameter'));
    await expect(
      sendToFirstWorkingCandidate([candidates[1], candidates[2]], attempt2, {
        fallThrough: (c, message) => c.kind !== 'phone' || /131030/.test(message),
      })
    ).rejects.toThrow('Invalid parameter');
    expect(attempt2).toHaveBeenCalledTimes(1);
  });

  it('throws a clear error when there is nobody to send to', async () => {
    const attempt = vi.fn();
    await expect(sendToFirstWorkingCandidate([], attempt)).rejects.toThrow(
      'No recipient address to send to'
    );
    expect(attempt).not.toHaveBeenCalled();
  });
});

describe('sendToFirstWorkingPhone', () => {
  const phone = '+5511999990001';

  it('tries the number as given first and reports the variant that worked', async () => {
    const variants = phoneVariants(phone);
    expect(variants.length).toBeGreaterThan(1);

    const attempt = vi.fn().mockImplementation(async (variant: string) => {
      if (variant !== variants[1]) throw notAllowed();
      return 'wamid.9';
    });
    const res = await sendToFirstWorkingPhone(phone, attempt);
    expect(res).toEqual({ result: 'wamid.9', phone: variants[1] });
    expect(attempt.mock.calls.map((c) => c[0])).toEqual([variants[0], variants[1]]);
  });

  it('does not try another variant after an unrelated error', async () => {
    const attempt = vi.fn().mockRejectedValue(new Error('Template not found'));
    await expect(sendToFirstWorkingPhone(phone, attempt)).rejects.toThrow('Template not found');
    expect(attempt).toHaveBeenCalledTimes(1);
  });
});
