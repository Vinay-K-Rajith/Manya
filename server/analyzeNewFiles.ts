import * as fs from 'fs';
import * as path from 'path';
import ExcelJS from 'exceljs';
import { parseDocx } from './src/parser';
import {
  generateTableTitle,
  inferStudyType,
  normalizeForMatch,
  StudyType,
} from './src/tableTitleEngine';
import { detectArchetype, extractKeyphrase } from './src/titleComposer';

interface QuestionnaireSpec {
  name: string;
  file: string;
  study?: StudyType;
  apFile?: string;
}

const QUESTIONNAIRES: QuestionnaireSpec[] = [
  {
    name: 'Aqua Shopper',
    file: 'New/Aqua_25-04519501_Shopper QRE (Client & Internal use only)_V1 1.docx',
    study: 'consumer',
    apFile: 'New/Aqua Shoppers_25-045195-01_AP_ (Internal use only)_V2.xlsx',
  },
  {
    name: 'Aqua Retailer',
    file: 'New/Aqua_25-04519501_Reatiler QRE (Client  Internal use only)_V2.docx',
    study: 'retailer',
  },
  {
    name: 'Aqua BHT',
    file: 'New/Aqua_25-04519501_BHT QRE (Client  Internal use only)_V1.docx',
    study: 'consumer',
    apFile: 'New/Aqua_BHT_25-045195-01_AP_(Internal use only)_V2.xlsx',
  },
  {
    name: 'Palmer Main',
    file: 'New/Palmer_24-035643-01_Main Questionnaire_ Internal Use_ Post Phase _V2 1.docx',
    study: 'consumer',
    apFile: 'New/Palmer_24-035463-01_AP_V2_Post Phase 1.xlsx',
  },
  {
    name: 'Palmer RQ',
    file: 'New/Palmer_24-035643-01_RQ_Client & Internal Use_V2.docx',
    study: 'retailer',
  },
  {
    name: 'Shadow',
    file: 'New/Shadow-24-050959-01_RQ MQ_V5.docx',
    study: 'consumer',
    apFile: 'New/Shadow_AP_V3 - Copy (2).xlsx',
  },
];

type TitleSource = 'corpus' | 'heading' | 'pattern' | 'composer' | 'fallback' | 'empty';

interface RowResult {
  id: string;
  title: string;
  source: TitleSource;
  archetype: string;
  quality: 'verified' | 'good' | 'fair' | 'poor' | 'empty';
  expected?: string;
  heading: string;
  textPreview: string;
}

async function readTabSpec(apPath: string): Promise<Map<string, string>> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(apPath);
  const sheet = workbook.getWorksheet('TabSpec');
  if (!sheet) return new Map();

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

function classifySource(
  id: string,
  heading: string,
  text: string,
  study: StudyType | undefined,
  finalTitle: string
): TitleSource {
  if (!text.trim() && !heading.trim()) return 'empty';
  return 'composer'; // Placeholder for analysis
}

function scoreQuality(
  title: string,
  text: string,
  expected: string | undefined,
  source: TitleSource
): RowResult['quality'] {
  if (!text.trim() && !title.trim()) return 'empty';
  if (expected) {
    return title.toLowerCase() === expected.toLowerCase() ? 'verified' : 'poor';
  }

  const t = title.trim();
  if (!t) return 'poor';
  if (t === 'Open end') return 'good';

  const words = t.split(/\s+/);
  const badStarts = /^(please|which|what|how|could|mentioned|observation)$/i;
  const looksLikeFragment =
    words.length > 8 ||
    badStarts.test(words[0]) ||
    /pick top|per option|slide \d/i.test(t) ||
    (words.length >= 4 && /^(you|your|the|that|this)$/i.test(words[0]));

  const archetype = detectArchetype(text);
  const keyphrase = extractKeyphrase(text);
  const hasTopicOverlap =
    keyphrase.length > 0 &&
    keyphrase.split(' ').some((w) => t.toLowerCase().includes(w));

  if (looksLikeFragment) return 'poor';
  if (source === 'corpus' || source === 'pattern' || source === 'heading') return 'good';
  if (words.length >= 2 && words.length <= 6 && hasTopicOverlap) return 'good';
  if (words.length <= 8 && archetype !== 'unknown') return 'fair';
  return 'fair';
}

async function analyzeQuestionnaire(spec: QuestionnaireSpec, root: string): Promise<RowResult[]> {
  const docxPath = path.join(root, spec.file);
  const questions = await parseDocx(fs.readFileSync(docxPath));
  const tabSpec = spec.apFile ? await readTabSpec(path.join(root, spec.apFile)) : null;
  const study = spec.study ?? inferStudyType(spec.file);

  const results: RowResult[] = [];

  for (const q of questions.filter((x) => !x.isSection)) {
    const title = generateTableTitle({
      id: q.id,
      heading: q.heading,
      text: q.text,
      study: spec.apFile ? study : undefined,
    });
    const expected = tabSpec?.get(q.id.toUpperCase());
    const source = classifySource(q.id, q.heading, q.text, spec.apFile ? study : undefined, title);

    results.push({
      id: q.id,
      title,
      source,
      archetype: detectArchetype(q.text),
      quality: scoreQuality(title, q.text, expected, source),
      expected,
      heading: q.heading || '',
      textPreview: q.text.slice(0, 100).replace(/\s+/g, ' '),
    });
  }

  return results;
}

function summarize(name: string, rows: RowResult[], hasAp: boolean) {
  const inAp = rows.filter((r) => r.expected !== undefined);
  const notInAp = rows.filter((r) => r.expected === undefined);
  const total = rows.length;

  const verified = inAp.filter((r) => r.quality === 'verified').length;
  const good = rows.filter((r) => r.quality === 'good').length;
  const fair = rows.filter((r) => r.quality === 'fair').length;
  const poor = rows.filter((r) => r.quality === 'poor').length;
  const empty = rows.filter((r) => r.quality === 'empty').length;

  const byArchetype: Record<string, number> = {};
  for (const r of rows) byArchetype[r.archetype] = (byArchetype[r.archetype] ?? 0) + 1;

  console.log(`\n${'='.repeat(72)}`);
  console.log(name);
  console.log(`${'='.repeat(72)}`);
  console.log(`Parsed questions: ${total}`);
  if (hasAp) {
    const pct = inAp.length > 0 ? (verified / inAp.length * 100).toFixed(1) + '%' : '0%';
    console.log(`AP TabSpec match: ${verified}/${inAp.length} (${pct})`);
    if (notInAp.length) console.log(`In DOCX only (no AP row): ${notInAp.map((r) => r.id).join(', ')}`);
  } else {
    const inclineRows = rows.filter((r) => r.textPreview.trim());
    const acceptable = inclineRows.filter((r) => r.quality === 'good' || r.quality === 'fair').length;
    const pct = inclineRows.length > 0 ? (acceptable / inclineRows.length * 100).toFixed(1) + '%' : '0%';
    console.log(`Estimated good+fair: ${acceptable}/${inclineRows.length} (${pct})`);
    console.log(`  good: ${good}  fair: ${fair}  poor: ${poor}  empty: ${empty}`);
  }

  const problems = hasAp
    ? inAp.filter((r) => r.quality !== 'verified')
    : rows.filter((r) => r.quality === 'poor');
  if (problems.length > 0) {
    console.log(`\nIssues (${problems.length}):`);
    for (const r of problems.slice(0, 12)) {
      console.log(`  [${r.id}] Generated: "${r.title}" (${r.archetype})`);
      if (r.expected) console.log(`         Expected : "${r.expected}"`);
      console.log(`         Text     : ${r.textPreview}...`);
    }
  } else {
    console.log('\nNo issues — all titles matched.');
  }

  return { total, verified: hasAp ? verified : good + fair, inAp: inAp.length, poor, empty };
}

async function main() {
  const root = path.resolve(__dirname, '..');
  const allStats: { name: string; stats: ReturnType<typeof summarize> }[] = [];

  for (const spec of QUESTIONNAIRES) {
    const rows = await analyzeQuestionnaire(spec, root);
    const stats = summarize(spec.name, rows, !!spec.apFile);
    allStats.push({ name: spec.name, stats });
  }

  console.log(`\n${'='.repeat(72)}`);
  console.log('OVERALL SUMMARY');
  console.log(`${'='.repeat(72)}`);
  for (const { name, stats } of allStats) {
    const hasAp = !!QUESTIONNAIRES.find((q) => q.name === name)?.apFile;
    const label = hasAp
      ? `${stats.verified}/${stats.inAp} AP TabSpec match`
      : `${stats.verified}/${stats.total - stats.empty} est. good+fair`;
    console.log(`  ${name.padEnd(22)} ${label}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
