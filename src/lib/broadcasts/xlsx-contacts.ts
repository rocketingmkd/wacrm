/**
 * Parses an .xlsx file the user uploads for the "Planilha" broadcast
 * audience (Step 2 of the wizard). Replaces the earlier CSV upload —
 * a CSV export from Excel loses long phone numbers permanently when
 * Excel displays them in scientific notation (e.g. a 12-digit phone
 * becomes "5.16E+11" in the exported text, and the real digits are
 * gone for good). Reading the native .xlsx binary instead sidesteps
 * that: a numeric cell's underlying value has full precision even
 * when Excel *displays* it in scientific notation, so converting that
 * number with a plain `toString()` (never exponential for a
 * phone-length integer — JS only switches to exponential at 1e21)
 * recovers the real digits.
 *
 * Tolerant like the CSV parser it replaces: a header row is
 * recognized by column name ("phone"/"telefone", "name"/"nome") and
 * used to map columns; otherwise the first two columns are assumed to
 * be phone, name. Rows with no phone at all are skipped and counted,
 * not thrown.
 */
import * as XLSX from 'xlsx';

export interface ParsedXlsxContact {
  phone: string;
  name?: string;
}

export interface ParseXlsxResult {
  contacts: ParsedXlsxContact[];
  skipped: number;
}

const HEADER_ALIASES = {
  phone: ['phone', 'telefone', 'celular', 'whatsapp', 'numero', 'número'],
  name: ['name', 'nome'],
};

/**
 * A numeric cell's raw value (not its possibly-scientific-notation
 * display string) converted to a plain digit string. Phone-length
 * integers are far below JS's 1e21 exponential-notation threshold, so
 * this never loses digits the way a CSV export of the same cell can.
 */
function cellToRawString(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(Math.trunc(value)) : '';
  }
  return String(value).trim();
}

function normalizePhone(raw: string): string {
  const trimmed = raw.trim();
  const hasPlus = trimmed.startsWith('+');
  const digits = trimmed.replace(/[^\d]/g, '');
  if (!digits) return '';
  return hasPlus ? `+${digits}` : digits;
}

export async function parseXlsxContacts(file: File): Promise<ParseXlsxResult> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array' });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return { contacts: [], skipped: 0 };

  const sheet = workbook.Sheets[sheetName];
  // header: 1 → array-of-arrays, raw: true → underlying cell values
  // (numbers stay numbers) instead of Excel's formatted display text.
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: true,
    defval: '',
  });
  if (rows.length === 0) return { contacts: [], skipped: 0 };

  const firstRowCells = (rows[0] ?? []).map((c) =>
    String(c ?? '').trim().toLowerCase()
  );

  let phoneIdx = 0;
  let nameIdx: number | null = 1;
  let dataRows = rows;

  const headerPhoneIdx = firstRowCells.findIndex((c) =>
    HEADER_ALIASES.phone.includes(c)
  );
  if (headerPhoneIdx !== -1) {
    phoneIdx = headerPhoneIdx;
    const headerNameIdx = firstRowCells.findIndex((c) =>
      HEADER_ALIASES.name.includes(c)
    );
    nameIdx = headerNameIdx !== -1 ? headerNameIdx : null;
    dataRows = rows.slice(1);
  }

  const contacts: ParsedXlsxContact[] = [];
  let skipped = 0;

  for (const row of dataRows) {
    if (!row || row.every((c) => c === '' || c == null)) continue; // blank row
    const phone = normalizePhone(cellToRawString(row[phoneIdx]));
    if (!phone) {
      skipped++;
      continue;
    }
    const name =
      nameIdx != null
        ? cellToRawString(row[nameIdx]).trim() || undefined
        : undefined;
    contacts.push({ phone, name });
  }

  return { contacts, skipped };
}
