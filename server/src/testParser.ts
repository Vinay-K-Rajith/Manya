import * as fs from 'fs';
import * as path from 'path';
import { parseDocx } from './parser';

async function runTest() {
  const files = [
    'Goldline_25047513_Consumer Questionnaire (Client & internal use)_v9.docx',
    'Goldline_25047513_Retailer Questionnaire (Client & internal use)_v7 (1).docx',
    'Incline_26-039634_Questionnaire (Client  internal use)_v8 (Repaired).docx'
  ];

  const workspaceDir = path.resolve(__dirname, '../..');

  for (const file of files) {
    const filePath = path.join(workspaceDir, file);
    if (!fs.existsSync(filePath)) {
      console.log(`File not found: ${filePath}`);
      continue;
    }

    console.log(`\n======================================`);
    console.log(`Parsing file: ${file}`);
    console.log(`======================================`);

    try {
      const buffer = fs.readFileSync(filePath);
      const questions = await parseDocx(buffer);
      console.log(`Successfully parsed ${questions.length} items (questions & sections).`);
      
      const sections = questions.filter(q => q.isSection);
      const standardQuestions = questions.filter(q => !q.isSection);
      
      console.log(`Sections: ${sections.length}`);
      console.log(`Questions: ${standardQuestions.length}`);

      console.log(`\nSample of parsed questions (first 10):`);
      standardQuestions.slice(0, 10).forEach(q => {
        console.log(`- [${q.id}] (${q.coding}) - Heading: "${q.heading || '(None)'}"`);
        console.log(`  Text: "${q.text.substring(0, 80)}${q.text.length > 80 ? '...' : ''}"`);
        console.log(`  Options count: ${q.options ? q.options.length : 0}`);
      });
      
      const questionsWithoutOptions = standardQuestions.filter(q => (!q.options || q.options.length === 0) && q.coding !== 'RECORD VERBATIM');
      if (questionsWithoutOptions.length > 0) {
        console.log(`\nWarning: Found ${questionsWithoutOptions.length} questions without options that are not RECORD VERBATIM (e.g. might be missing table options):`);
        questionsWithoutOptions.slice(0, 5).forEach(q => {
          console.log(`- [${q.id}] (${q.coding}) - text: "${q.text.substring(0, 60)}"`);
        });
      }

    } catch (err: any) {
      console.error(`Error parsing ${file}:`, err);
    }
  }
}

runTest();
