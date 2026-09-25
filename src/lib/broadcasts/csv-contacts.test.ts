import { describe, expect, it } from 'vitest';
import { parseCsvContacts } from './csv-contacts';

describe('parseCsvContacts', () => {
  it('parses a comma-separated file with a phone,name header', () => {
    const csv = 'phone,name\n+5511999998888,Ana\n5511988887777,Bruno';
    const { contacts, skipped } = parseCsvContacts(csv);
    expect(skipped).toBe(0);
    expect(contacts).toEqual([
      { phone: '+5511999998888', name: 'Ana' },
      { phone: '5511988887777', name: 'Bruno' },
    ]);
  });

  it('recognizes pt-BR header aliases and semicolon delimiter', () => {
    const csv = 'telefone;nome\n11999998888;Carla';
    const { contacts } = parseCsvContacts(csv);
    expect(contacts).toEqual([{ phone: '11999998888', name: 'Carla' }]);
  });

  it('falls back to phone-then-name column order with no header', () => {
    const csv = '11999998888,Diego\n11988887777,Elis';
    const { contacts } = parseCsvContacts(csv);
    expect(contacts).toEqual([
      { phone: '11999998888', name: 'Diego' },
      { phone: '11988887777', name: 'Elis' },
    ]);
  });

  it('accepts a phone-only column (no name)', () => {
    const csv = 'phone\n11999998888\n11988887777';
    const { contacts } = parseCsvContacts(csv);
    expect(contacts).toEqual([
      { phone: '11999998888', name: undefined },
      { phone: '11988887777', name: undefined },
    ]);
  });

  it('strips formatting characters from phone numbers', () => {
    const csv = 'phone,name\n(11) 99999-8888,Fabio';
    const { contacts } = parseCsvContacts(csv);
    expect(contacts).toEqual([{ phone: '11999998888', name: 'Fabio' }]);
  });

  it('skips rows with no usable phone and counts them', () => {
    const csv = 'phone,name\n11999998888,Gina\n,Sem telefone\n11988887777,Hugo';
    const { contacts, skipped } = parseCsvContacts(csv);
    expect(skipped).toBe(1);
    expect(contacts).toHaveLength(2);
  });

  it('returns empty for blank input', () => {
    expect(parseCsvContacts('')).toEqual({ contacts: [], skipped: 0 });
    expect(parseCsvContacts('   \n  \n')).toEqual({ contacts: [], skipped: 0 });
  });
});
