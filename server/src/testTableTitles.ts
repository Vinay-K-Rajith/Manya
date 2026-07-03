import * as fs from 'fs';
import * as path from 'path';
import ExcelJS from 'exceljs';
import { parseDocx } from './parser';
import { generateTableTitle, inferStudyType } from './tableTitleEngine';

const PAIRS = [
  {
    study: 'consumer' as const,
    docx: 'Goldline_25047513_Consumer Questionnaire (Client & internal use)_v9.docx',
    ap: 'AP FOR GOLDLINE CONSUMER.xlsx',
  },
  {
    study: 'retailer' as const,
    docx: 'Goldline_25047513_Retailer Questionnaire (Client & internal use)_v7 (1).docx',
    ap: 'AP FOR GOLDLINE RETAILER 1.xlsx',
  },
];

async function readTabSpec(xlsxPath: string): Promise<Map<string, string>> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(xlsxPath);
  const sheet = workbook.getWorksheet('TabSpec');
  if (!sheet) throw new Error(`TabSpec not found in ${xlsxPath}`);

  const map = new Map<string, string>();
  sheet.eachRow((row, rowNum) => {
    if (rowNum <= 5) return;
    const id = String(row.getCell(2).value ?? '').trim().toUpperCase();
    const title = String(row.getCell(3).value ?? '').trim();
    if (!id || id.startsWith('SECTION')) return;
    map.set(id, title);
  });
  return map;
}

async function run() {
  const root = path.resolve(__dirname, '../..');
  let total = 0;
  let matched = 0;
  const failures: string[] = [];

  for (const pair of PAIRS) {
    const tabSpec = await readTabSpec(path.join(root, pair.ap));
    const questions = await parseDocx(fs.readFileSync(path.join(root, pair.docx)));
    let pairMatched = 0;
    let pairTotal = 0;

    for (const [id, expected] of tabSpec) {
      const q = questions.find((x) => x.id.toUpperCase() === id);
      if (!q) continue;
      pairTotal++;
      total++;
      const got = generateTableTitle({
        id: q.id,
        heading: q.heading,
        text: q.text,
        study: pair.study,
      });
      if (got.toLowerCase() === expected.toLowerCase()) {
        matched++;
        pairMatched++;
      } else {
        failures.push(`[${pair.study}] ${id}: expected "${expected}", got "${got}"`);
      }
    }

    console.log(`${pair.study.toUpperCase()}: ${pairMatched}/${pairTotal} matched`);
  }

  if (failures.length) {
    console.log('\nFailures:');
    failures.forEach((f) => console.log(' ', f));
    process.exit(1);
  }

  console.log(`\nAll ${matched} titles match reference AP TabSpec.`);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
