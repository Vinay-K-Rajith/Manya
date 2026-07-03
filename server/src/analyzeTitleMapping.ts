import * as fs from 'fs';
import * as path from 'path';
import ExcelJS from 'exceljs';
import { parseDocx } from './parser';
import { generateTableTitle } from './tableTitleEngine';

interface TabSpecRow {
  questionNo: string;
  tableTitle: string;
}

interface MappingRow {
  id: string;
  expected: string;
  generated: string;
  heading: string;
  text: string;
  match: boolean;
  study: 'consumer' | 'retailer';
}

async function readTabSpec(xlsxPath: string): Promise<TabSpecRow[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(xlsxPath);
  const sheet = workbook.getWorksheet('TabSpec');
  if (!sheet) throw new Error(`TabSpec sheet not found in ${xlsxPath}`);

  const rows: TabSpecRow[] = [];
  sheet.eachRow((row, rowNum) => {
    if (rowNum <= 5) return;
    const questionNo = String(row.getCell(2).value ?? '').trim();
    const tableTitle = String(row.getCell(3).value ?? '').trim();
    if (!questionNo || questionNo.toUpperCase().startsWith('SECTION')) return;
    rows.push({ questionNo: questionNo.toUpperCase(), tableTitle });
  });
  return rows;
}

async function analyzePair(
  label: string,
  docxFile: string,
  apFile: string,
  study: 'consumer' | 'retailer'
): Promise<{ mappings: MappingRow[]; missingInAp: string[]; missingInDocx: string[] }> {
  const root = path.resolve(__dirname, '../..');
  const docxPath = path.join(root, docxFile);
  const apPath = path.join(root, apFile);

  const tabSpec = await readTabSpec(apPath);
  const questions = await parseDocx(fs.readFileSync(docxPath));
  const qMap = new Map(
    questions.filter((q) => !q.isSection && q.id).map((q) => [q.id.toUpperCase(), q])
  );

  const apIds = new Set(tabSpec.map((r) => r.questionNo));
  const docxIds = new Set(qMap.keys());

  const missingInAp = [...docxIds].filter((id) => !apIds.has(id)).sort();
  const missingInDocx = [...apIds].filter((id) => !docxIds.has(id)).sort();

  const mappings: MappingRow[] = [];
  for (const row of tabSpec) {
    const q = qMap.get(row.questionNo);
    if (!q) continue;
    const generated = generateTableTitle({ id: q.id, heading: q.heading, text: q.text, study });
    const match = normalize(generated) === normalize(row.tableTitle);
    mappings.push({
      id: row.questionNo,
      expected: row.tableTitle,
      generated,
      heading: q.heading || '',
      text: q.text,
      match,
      study,
    });
  }

  const matched = mappings.filter((m) => m.match).length;
  console.log(`\n${'='.repeat(70)}`);
  console.log(`${label}`);
  console.log(`DOCX: ${docxFile}`);
  console.log(`AP:   ${apFile}`);
  console.log(`TabSpec rows: ${tabSpec.length} | Docx questions: ${qMap.size}`);
  console.log(`Algorithm match: ${matched}/${mappings.length} (${((matched / mappings.length) * 100).toFixed(1)}%)`);
  if (missingInAp.length) console.log(`In DOCX but not AP (${missingInAp.length}): ${missingInAp.slice(0, 15).join(', ')}${missingInAp.length > 15 ? '...' : ''}`);
  if (missingInDocx.length) console.log(`In AP but not DOCX (${missingInDocx.length}): ${missingInDocx.slice(0, 15).join(', ')}${missingInDocx.length > 15 ? '...' : ''}`);

  console.log('\nMISMATCHES:');
  for (const m of mappings.filter((x) => !x.match)) {
    console.log(`\n[${m.id}]`);
    console.log(`  EXPECTED:  ${m.expected}`);
    console.log(`  GENERATED: ${m.generated}`);
    console.log(`  HEADING:   ${m.heading || '(none)'}`);
    console.log(`  TEXT:      ${m.text.slice(0, 120)}${m.text.length > 120 ? '...' : ''}`);
  }

  return { mappings, missingInAp, missingInDocx };
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

async function exportTrainingData(
  consumer: MappingRow[],
  retailer: MappingRow[]
): Promise<void> {
  const outPath = path.join(__dirname, 'data/titleTrainingCorpus.json');
  const all = [...consumer, ...retailer].map((m) => ({
    id: m.id,
    expected: m.expected,
    heading: m.heading,
    text: m.text,
    study: m.study,
  }));
  fs.writeFileSync(outPath, JSON.stringify(all, null, 2));
  console.log(`\nWrote ${all.length} training pairs to ${outPath}`);
}

async function main() {
  const consumer = await analyzePair(
    'CONSUMER PAIR',
    'Goldline_25047513_Consumer Questionnaire (Client & internal use)_v9.docx',
    'AP FOR GOLDLINE CONSUMER.xlsx',
    'consumer'
  );

  const retailer = await analyzePair(
    'RETAILER PAIR',
    'Goldline_25047513_Retailer Questionnaire (Client & internal use)_v7 (1).docx',
    'AP FOR GOLDLINE RETAILER 1.xlsx',
    'retailer'
  );

  await exportTrainingData(consumer.mappings, retailer.mappings);
}

main().catch(console.error);
