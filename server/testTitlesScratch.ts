import * as fs from 'fs';
import * as path from 'path';
import { parseDocx } from './src/parser';
import { generateTableTitle } from './src/tableTitleEngine';

const root = 'd:/Manya';
const files = [
  'Blaze_26-012605-01_RQ+MQ_Quant (Internal Client use only)_V2.docx',
  'Goldline_25047513_Consumer Questionnaire (Client & internal use)_v9.docx',
  'Goldline_25047513_Retailer Questionnaire (Client & internal use)_v7 (1).docx',
  'Incline_26-039634_Questionnaire (Client  internal use)_v8 (Repaired).docx',
  'Pure 2_25-078284-01_Questionnaire (Client & internal use)_V3 2.docx',
  'Sakaar_26-026309-01_Questionnaire (Internal and Client Use only) _V13.docx'
];

async function main() {
  for (const file of files) {
    const docxPath = path.join(root, file);
    if (!fs.existsSync(docxPath)) {
      console.log(`Missing file: ${docxPath}`);
      continue;
    }
    const questions = await parseDocx(fs.readFileSync(docxPath));
    console.log(`\n=== File: ${file} ===`);
    let titleStats = { good: 0, bad: 0 };
    for (const q of questions.filter(x => !x.isSection)) {
      const title = generateTableTitle({ id: q.id, heading: q.heading, text: q.text });
      if (title && title.length > 3 && title.split(' ').length <= 15) {
        titleStats.good++;
      } else {
        titleStats.bad++;
      }
    }
    console.log(`Title Stats: Good/OK: ${titleStats.good}, Bad/Empty: ${titleStats.bad}`);
  }
}
main().catch(console.error);
