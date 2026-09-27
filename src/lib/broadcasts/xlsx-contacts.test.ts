import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { parseXlsxContacts } from './xlsx-contacts';

function makeXlsxFile(rows: (string | number)[][]): File {
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Sheet1');
  const buffer = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });
  return new File([buffer], 'test.xlsx', {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

describe('parseXlsxContacts', () => {
  it('parses a sheet with a phone,name header', async () => {
    const file = makeXlsxFile([
      ['phone', 'name'],
      ['+5511999998888', 'Ana'],
      ['5511988887777', 'Bruno'],
    ]);
    const { contacts, skipped } = await parseXlsxContacts(file);
    expect(skipped).toBe(0);
    expect(contacts).toEqual([
      { phone: '+5511999998888', name: 'Ana' },
      { phone: '5511988887777', name: 'Bruno' },
    ]);
  });

  it('recognizes pt-BR header aliases', async () => {
    const file = makeXlsxFile([
      ['telefone', 'nome'],
      ['11999998888', 'Carla'],
    ]);
    const { contacts } = await parseXlsxContacts(file);
    expect(contacts).toEqual([{ phone: '11999998888', name: 'Carla' }]);
  });

  it('falls back to phone-then-name column order with no header', async () => {
    const file = makeXlsxFile([
      ['11999998888', 'Diego'],
      ['11988887777', 'Elis'],
    ]);
    const { contacts } = await parseXlsxContacts(file);
    expect(contacts).toEqual([
      { phone: '11999998888', name: 'Diego' },
      { phone: '11988887777', name: 'Elis' },
    ]);
  });

  it('accepts a phone-only column (no name)', async () => {
    const file = makeXlsxFile([['phone'], ['11999998888'], ['11988887777']]);
    const { contacts } = await parseXlsxContacts(file);
    expect(contacts).toEqual([
      { phone: '11999998888', name: undefined },
      { phone: '11988887777', name: undefined },
    ]);
  });

  it('strips formatting characters from phone numbers', async () => {
    const file = makeXlsxFile([
      ['phone', 'name'],
      ['(11) 99999-8888', 'Fabio'],
    ]);
    const { contacts } = await parseXlsxContacts(file);
    expect(contacts).toEqual([{ phone: '11999998888', name: 'Fabio' }]);
  });

  it('skips rows with no usable phone and counts them', async () => {
    const file = makeXlsxFile([
      ['phone', 'name'],
      ['11999998888', 'Gina'],
      ['', 'Sem telefone'],
      ['11988887777', 'Hugo'],
    ]);
    const { contacts, skipped } = await parseXlsxContacts(file);
    expect(skipped).toBe(1);
    expect(contacts).toHaveLength(2);
  });

  it('returns empty for a blank sheet', async () => {
    const file = makeXlsxFile([]);
    expect(await parseXlsxContacts(file)).toEqual({ contacts: [], skipped: 0 });
  });

  // The whole reason to read .xlsx instead of a CSV export: a numeric
  // cell keeps full precision internally even when Excel *displays* it
  // in scientific notation. A CSV export bakes in that display text
  // and loses the real digits for good; reading the raw cell value
  // (as a JS number, well under the 1e21 exponential-notation
  // threshold) recovers them.
  it('recovers a long phone number stored as a numeric cell, not a display string', async () => {
    const file = makeXlsxFile([
      ['telefone', 'nome'],
      [554399239550, 'Cliente'],
    ]);
    const { contacts } = await parseXlsxContacts(file);
    expect(contacts).toEqual([{ phone: '554399239550', name: 'Cliente' }]);
  });
});
