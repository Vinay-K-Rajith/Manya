import * as fs from 'fs';
import * as path from 'path';
import { parseDocx } from './parser';
import { generateTableTitle } from './tableTitleEngine';

async function main() {
  const f = path.join(
    __dirname,
    '../..',
    'Incline_26-039634_Questionnaire (Client  internal use)_v8 (Repaired).docx'
  );
  const qs = await parseDocx(fs.readFileSync(f));
  const items = qs.filter((q) => !q.isSection && q.id);

  let corpusLike = 0;
  let patternLike = 0;
  const samples: string[] = [];

  for (const q of items) {
    const title = generateTableTitle({ id: q.id, heading: q.heading, text: q.text });
    const looksGeneric =
      title.split(' ').length <= 2 ||
      /^(please|which|what|how|could|mentioned|observation)/i.test(title);
    if (looksGeneric) patternLike++;
    else corpusLike++;

    if (samples.length < 25) {
      samples.push(`${q.id}\t${title}\n  Q: ${q.text.slice(0, 90)}...`);
    }
  }

  console.log(`Incline: ${items.length} questions`);
  console.log(`Likely good titles: ~${corpusLike}, weaker/generic: ~${patternLike}`);
  console.log('\nSamples:\n');
  samples.forEach((s) => console.log(s + '\n'));
}

main();
