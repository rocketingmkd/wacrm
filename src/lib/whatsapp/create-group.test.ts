import { beforeEach, describe, expect, it, vi } from 'vitest';

const createGroup = vi.fn();
const fetchInviteLink = vi.fn();
const storeGroupJoined = vi.fn();
const resolveGroupSend = vi.fn();

vi.mock('@/lib/whatsapp/evolution-api', () => ({
  createGroup: (...a: unknown[]) => createGroup(...a),
  fetchInviteLink: (...a: unknown[]) => fetchInviteLink(...a),
}));
vi.mock('@/lib/whatsapp/evolution-group-inbound', () => ({
  storeGroupJoined: (...a: unknown[]) => storeGroupJoined(...a),
}));
vi.mock('@/lib/whatsapp/unofficial-guard', () => ({
  resolveGroupSend: (...a: unknown[]) => resolveGroupSend(...a),
}));

import { createWhatsAppGroup } from './create-group';

const db = {} as never;

beforeEach(() => {
  vi.clearAllMocks();
  resolveGroupSend.mockResolvedValue({ instance_name: 'crm-abc' });
  storeGroupJoined.mockResolvedValue('conv-1');
  fetchInviteLink.mockResolvedValue('https://chat.whatsapp.com/XYZ');
});

describe('createWhatsAppGroup', () => {
  it('creates the group and reports who was added and who was not', async () => {
    createGroup.mockResolvedValue({
      id: '1203@g.us',
      subject: 'Rocketing e Cliente',
      participants: ['5515996170494'],
    });
    const r = await createWhatsAppGroup(db, 'acc', {
      subject: ' Rocketing e Cliente ',
      participants: ['+55 15 99617-0494', '(11) 98888-7777'.replace(/\D/g, '').replace(/^/, '55')],
    });
    expect(r.added).toEqual(['5515996170494']);
    expect(r.notAdded).toEqual(['5511988887777']);
    expect(r.verified).toBe(true);
    expect(r.inviteLink).toBe('https://chat.whatsapp.com/XYZ');
    expect(r.conversationId).toBe('conv-1');
    expect(createGroup.mock.calls[0][0].participants).toEqual(['5515996170494', '5511988887777']);
  });

  it('still succeeds without invite link', async () => {
    createGroup.mockResolvedValue({ id: '1@g.us', subject: 'G', participants: ['5515996170494'] });
    fetchInviteLink.mockRejectedValue(new Error('x'));
    const r = await createWhatsAppGroup(db, 'acc', { subject: 'G', participants: ['5515996170494'] });
    expect(r.inviteLink).toBeNull();
  });

  it('marks unverified when participants cannot be matched', async () => {
    createGroup.mockResolvedValue({ id: '1@g.us', subject: 'G', participants: [] });
    const r = await createWhatsAppGroup(db, 'acc', { subject: 'G', participants: ['5515996170494'] });
    expect(r.verified).toBe(false);
    expect(r.added).toEqual([]);
    expect(r.notAdded).toEqual([]);
  });

  it('rejects bad input before calling Evolution', async () => {
    await expect(createWhatsAppGroup(db, 'acc', { subject: '', participants: ['5515996170494'] })).rejects.toThrow();
    await expect(createWhatsAppGroup(db, 'acc', { subject: 'G', participants: [] })).rejects.toThrow();
    await expect(createWhatsAppGroup(db, 'acc', { subject: 'G', participants: ['abc'] })).rejects.toThrow();
    await expect(
      createWhatsAppGroup(db, 'acc', { subject: 'x'.repeat(101), participants: ['5515996170494'] })
    ).rejects.toThrow();
    await expect(
      createWhatsAppGroup(db, 'acc', {
        subject: 'G',
        participants: Array.from({ length: 11 }, (_, i) => `551599000${String(1000 + i)}`),
      })
    ).rejects.toThrow();
    expect(createGroup).not.toHaveBeenCalled();
  });

  it('turns an Evolution failure into a 502', async () => {
    createGroup.mockRejectedValue(new Error('boom'));
    await expect(
      createWhatsAppGroup(db, 'acc', { subject: 'G', participants: ['5515996170494'] })
    ).rejects.toMatchObject({ status: 502 });
    expect(storeGroupJoined).not.toHaveBeenCalled();
  });
});
