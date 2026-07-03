import * as fs from 'fs';
import * as path from 'path';
import ExcelJS from 'exceljs';
import { parseDocx } from './parser';
import {
  generateTableTitle,
  inferStudyType,
  normalizeForMatch,
  StudyType,
} from './tableTitleEngine';
import { detectArchetype, extractKeyphrase } from './titleComposer';
import corpus from './data/titleTrainingCorpus.json';

interface QuestionnaireSpec {
  name: string;
  file: string;
  study?: StudyType;
  apFile?: string;
}

const QUESTIONNAIRES: QuestionnaireSpec[] = [
  {
    name: 'Goldline Consumer',
    file: 'Goldline_25047513_Consumer Questionnaire (Client & internal use)_v9.docx',
    study: 'consumer',
    apFile: 'AP FOR GOLDLINE CONSUMER.xlsx',
  },
  {
    name: 'Goldline Retailer',
    file: 'Goldline_25047513_Retailer Questionnaire (Client & internal use)_v7 (1).docx',
    study: 'retailer',
    apFile: 'AP FOR GOLDLINE RETAILER 1.xlsx',
  },
  {
    name: 'Incline',
    file: 'Incline_26-039634_Questionnaire (Client  internal use)_v8 (Repaired).docx',
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

  const norm = normalizeForMatch(text);
  if (study && id) {
    const exact = corpus.find(
      (c) => c.study === study && c.id === id.toUpperCase() && normalizeForMatch(c.text) === norm
    );
    if (exact && exact.expected.toLowerCase() === finalTitle.toLowerCase()) return 'corpus';
  }

  for (const c of corpus) {
    if (normalizeForMatch(c.text) === norm && c.expected.toLowerCase() === finalTitle.toLowerCase()) {
      return 'corpus';
    }
  }

  if (heading && !/^(RANDOMIZE|SHOW|DISPLAY)/i.test(heading)) {
    const h = heading.trim().toLowerCase();
    if (finalTitle.toLowerCase() === h || finalTitle.toLowerCase().includes(h.split(' ')[0])) {
      return 'heading';
    }
  }

  if (finalTitle === 'Open end' || finalTitle === 'NCCS classification') return 'pattern';

  const composerTitle = generateTableTitle({ id, heading, text, study: undefined });
  // If only composer would produce this without study-specific corpus - rough heuristic
  if (composerTitle.toLowerCase() === finalTitle.toLowerCase()) return 'composer';

  return 'pattern';
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
  const badStarts = /^(please|which|what|how|could|mentioned|observation|activities|spend|content|places)$/i;
  const looksLikeFragment =
    words.length > 7 ||
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

  const bySource: Record<string, number> = {};
  for (const r of rows) bySource[r.source] = (bySource[r.source] ?? 0) + 1;

  const byArchetype: Record<string, number> = {};
  for (const r of rows) byArchetype[r.archetype] = (byArchetype[r.archetype] ?? 0) + 1;

  console.log(`\n${'='.repeat(72)}`);
  console.log(name);
  console.log(`${'='.repeat(72)}`);
  console.log(`Parsed questions: ${total}`);
  if (hasAp) {
    console.log(`AP TabSpec match: ${verified}/${inAp.length} (${pct(verified, inAp.length)})`);
    if (notInAp.length) console.log(`In DOCX only (no AP row): ${notInAp.map((r) => r.id).join(', ')}`);
  } else {
    const inclineRows = rows.filter((r) => r.textPreview.trim());
    const acceptable = inclineRows.filter((r) => r.quality === 'good' || r.quality === 'fair').length;
    console.log(`Estimated good+fair: ${acceptable}/${inclineRows.length} (${pct(acceptable, inclineRows.length)})`);
    console.log(`  good: ${good}  fair: ${fair}  poor: ${poor}  empty: ${empty}`);
    const corpusLeak = rows.filter((r) => r.source === 'corpus');
    if (corpusLeak.length) {
      console.log(`  (includes ${corpusLeak.length} titles borrowed from Goldline corpus via text match)`);
    }
  }

  console.log('\nBy source:', Object.entries(bySource).map(([k, v]) => `${k}=${v}`).join(', '));
  console.log('Top archetypes:', Object.entries(byArchetype).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => `${k}=${v}`).join(', '));

  const problems = hasAp
    ? inAp.filter((r) => r.quality !== 'verified')
    : rows.filter((r) => r.quality === 'poor');
  if (problems.length > 0) {
    console.log(`\nIssues (${problems.length}):`);
    for (const r of problems.slice(0, 12)) {
      console.log(`  [${r.id}] "${r.title}" (${r.source}/${r.archetype})`);
      if (r.expected) console.log(`         expected: "${r.expected}"`);
      console.log(`         Q: ${r.textPreview}...`);
    }
  } else {
    console.log('\nNo issues — all AP titles matched.');
  }

  return { total, verified: hasAp ? verified : good + fair, inAp: inAp.length, poor, empty };
}

function pct(n: number, d: number): string {
  return d === 0 ? '0%' : `${((n / d) * 100).toFixed(1)}%`;
}

async function main() {
  const root = path.resolve(__dirname, '../..');
  const allStats: { name: string; stats: ReturnType<typeof summarize> }[] = [];

  console.log('TABLE TITLE QUALITY ANALYSIS — ALL 3 QUESTIONNAIRES');
  console.log(`Date: ${new Date().toISOString().slice(0, 10)}`);

  for (const spec of QUESTIONNAIRES) {
    const rows = await analyzeQuestionnaire(spec, root);
    const stats = summarize(spec.name, rows, !!spec.apFile);
    allStats.push({ name: spec.name, stats });

    const outFile = path.join(
      __dirname,
      `analysis_${spec.name.toLowerCase().replace(/\s+/g, '_')}.json`
    );
    fs.writeFileSync(outFile, JSON.stringify(rows, null, 2));
    console.log(`\nFull results → ${outFile}`);
  }

  console.log(`\n${'='.repeat(72)}`);
  console.log('OVERALL SUMMARY');
  console.log(`${'='.repeat(72)}`);
  for (const { name, stats } of allStats) {
    const label = name.includes('Incline')
      ? `${stats.verified}/${stats.total - stats.empty} est. good+fair`
      : `${stats.verified}/${stats.inAp} AP TabSpec match`;
    console.log(`  ${name.padEnd(22)} ${label}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
