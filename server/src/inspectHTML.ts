import * as fs from 'fs';
import * as path from 'path';
import * as mammoth from 'mammoth';

async function run() {
  const filePath = path.join(__dirname, '../../Incline_26-039634_Questionnaire (Client  internal use)_v8 (Repaired).docx');
  const result = await mammoth.convertToHtml({ buffer: fs.readFileSync(filePath) });
  fs.writeFileSync(path.join(__dirname, 'incline_html.html'), result.value);
  console.log('HTML written to incline_html.html');
}

run();
