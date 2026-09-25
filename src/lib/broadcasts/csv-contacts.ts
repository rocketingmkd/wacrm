/**
 * Parses a CSV/TSV file the user uploads for the "CSV" broadcast
 * audience (Step 2 of the wizard). Deliberately tolerant rather than
 * strict — this is a marketing operator pasting an export from Excel
 * or Google Contacts, not a machine-generated feed:
 *
 *   - Delimiter is auto-detected per line (comma or semicolon —
 *     pt-BR locale Excel exports default to semicolon).
 *   - A header row is recognized by column name ("phone"/"telefone",
 *     "name"/"nome") and used to map columns; otherwise the first two
 *     columns are assumed to be phone, name.
 *   - Rows with no phone at all are skipped and counted, not thrown.
 *   - Phone values are stripped down to leading `+` and digits only —
 *     full E.164 validation happens downstream at send time
 *     (sanitizePhoneForMeta / isValidE164), this just clears out
 *     stray parentheses/dashes/spaces from a typical export.
 */

export interface ParsedCsvContact {
  phone: string;
  name?: string;
}

export interface ParseCsvResult {
  contacts: ParsedCsvContact[];
  /** Rows that had no usable phone number — not fatal, just dropped. */
  skipped: number;
}

const HEADER_ALIASES = {
  phone: ['phone', 'telefone', 'celular', 'whatsapp', 'numero', 'número'],
  name: ['name', 'nome'],
};

function detectDelimiter(line: string): string {
  const commas = (line.match(/,/g) ?? []).length;
  const semicolons = (line.match(/;/g) ?? []).length;
  return semicolons > commas ? ';' : ',';
}

/** Splits one line on the delimiter, stripping surrounding quotes per field. */
function splitLine(line: string, delimiter: string): string[] {
  return line
    .split(delimiter)
    .map((cell) => cell.trim().replace(/^["']|["']$/g, '').trim());
}

function normalizePhone(raw: string): string {
  const trimmed = raw.trim();
  const hasPlus = trimmed.startsWith('+');
  const digits = trimmed.replace(/[^\d]/g, '');
  if (!digits) return '';
  return hasPlus ? `+${digits}` : digits;
}

export function parseCsvContacts(text: string): ParseCsvResult {
  const lines = text
    .split(/\r\n|\r|\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length === 0) return { contacts: [], skipped: 0 };

  const delimiter = detectDelimiter(lines[0]);
  const firstRowCells = splitLine(lines[0], delimiter).map((c) => c.toLowerCase());

  let phoneIdx = 0;
  let nameIdx: number | null = 1;
  let dataLines = lines;

  const headerPhoneIdx = firstRowCells.findIndex((c) => HEADER_ALIASES.phone.includes(c));
  if (headerPhoneIdx !== -1) {
    phoneIdx = headerPhoneIdx;
    const headerNameIdx = firstRowCells.findIndex((c) => HEADER_ALIASES.name.includes(c));
    nameIdx = headerNameIdx !== -1 ? headerNameIdx : null;
    dataLines = lines.slice(1);
  }

  const contacts: ParsedCsvContact[] = [];
  let skipped = 0;

  for (const line of dataLines) {
    const cells = splitLine(line, delimiter);
    const phone = normalizePhone(cells[phoneIdx] ?? '');
    if (!phone) {
      skipped++;
      continue;
    }
    const name = nameIdx != null ? cells[nameIdx]?.trim() || undefined : undefined;
    contacts.push({ phone, name });
  }

  return { contacts, skipped };
}
