// One-off generator for public/templates/modelo-lista-de-leads.xlsx —
// the downloadable template for the broadcast wizard's XLSX audience
// upload. Not run at build/deploy time; re-run manually if the
// expected columns ever change:
//
//   node scripts/generate-broadcast-template.cjs
//
// The `telefone` column is formatted as Text (numFmt '@') on both the
// header and the data rows so a user typing/pasting numbers into this
// template in Excel never gets silently auto-converted to scientific
// notation (the exact corruption that broke a real broadcast — see
// project memory on the CSV-to-XLSX migration).
const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');

const rows = [
  ['telefone', 'nome'],
  ['5511999999999', 'Nome do lead (exemplo, apague esta linha)'],
];

const sheet = XLSX.utils.aoa_to_sheet(rows);

// Force the whole `telefone` column (A) to the Text format so Excel
// never reinterprets it as a number, this row or any the user adds.
const phoneColRange = XLSX.utils.decode_range(sheet['!ref']);
for (let r = phoneColRange.s.r; r <= 200; r++) {
  const addr = XLSX.utils.encode_cell({ r, c: 0 });
  if (!sheet[addr]) {
    sheet[addr] = { t: 's', v: '' };
  }
  sheet[addr].z = '@';
  sheet[addr].t = 's';
  if (sheet[addr].v !== '' && sheet[addr].v != null) {
    sheet[addr].v = String(sheet[addr].v);
  }
}
sheet['!ref'] = XLSX.utils.encode_range({
  s: { r: 0, c: 0 },
  e: { r: 200, c: 1 },
});
sheet['!cols'] = [{ wch: 18 }, { wch: 32 }];

const workbook = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(workbook, sheet, 'Leads');

const outDir = path.join(__dirname, '..', 'public', 'templates');
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, 'modelo-lista-de-leads.xlsx');
XLSX.writeFile(workbook, outPath);

console.log('Written:', outPath);
