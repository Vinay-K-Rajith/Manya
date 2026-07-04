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
    let filterCount = 0;
    let baseAskAll = 0;
    let falseAskAll = 0;
    for (const q of questions.filter(x => !x.isSection)) {
      let filterRaw = q.filter;
      if (filterRaw && filterRaw.toLowerCase() !== 'ask all') {
        filterCount++;
      } else {
        baseAskAll++;
        if (/(?:ask\s+(?:if|those)|base\s*:?)/i.test(q.text) && !/ask all/i.test(q.text)) {
           console.log(`[${q.id}] Missed filter? Text: ${q.text.substring(0, 100).replace(/\n/g, ' ')}`);
           falseAskAll++;
        }
      }
    }
    console.log(`Total non-section: ${questions.filter(x => !x.isSection).length}`);
    console.log(`Filters extracted: ${filterCount} (Ask All: ${baseAskAll})`);
    console.log(`Potential Missed Filters: ${falseAskAll}`);
  }
}
main().catch(console.error);
