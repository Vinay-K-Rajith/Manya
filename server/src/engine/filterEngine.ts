/* Base-Filter engine — first-principles design.
 *
 * PRINCIPLE: precision over recall. A base filter is either
 *   (a) parsed from an EXPLICIT routing statement and VALIDATED against the
 *       referenced question's real option codes  -> emitted as canonical text, or
 *   (b) not confidently derivable -> emitted as Ask all with an explicit flag.
 * We never emit a confident-but-unverified conditional filter.
 *
 * House format (from reference AP):
 *   Base Title  = "Ask All"      (constant)
 *   Base Filter = ""             when ask-all
 *               = "Ask Those coded 1,2 in RQ12"   when conditional
 *               = compound with " and " / " or ", negation "not coded"
 */

/** A single parsed routing condition: [NOT] coded <codes> [for <brand>] in <q>. */
export interface Clause {
  neg: boolean;
  q: string;
  codes: string[];
  brand: string;
  connector?: 'and' | 'or' | null;
}

/** What the caller knows about a referenced question, used to validate codes. */
export interface QuestionOptions {
  codes: Set<string>;
  texts: string[];
}

/** `null` when the referenced question does not exist. */
export type OptionResolver = (qid: string) => QuestionOptions | null;

export type FilterStatus = 'all' | 'conditional' | 'assumed' | 'review';

export interface FilterResult {
  baseTitle: string;
  baseFilter: string;
  status: FilterStatus;
  refs: { q: string; codes: string[]; neg: boolean }[];
  note?: string;
}

const QID = '[A-Z]{1,4}\\d+[A-Z]?[a-z]?';

// Pull the routing/base statement out of a raw line, if present.
// Ground truth shows the AP base-filter column carries ASK ... and SHOW ... / DO NOT SHOW ...
// (brand-grid display bases). We capture all of them and never blank an explicit instruction.
export function extractRouting(text: string): string {
  if (!text) return '';
  // cut coding keywords that may be glued on
  const t = text.replace(/\b(OPEN\s?END(ED)?|SINGLE CODING|MULTIPLE CODING|RANDOMIZE[D]?|GRID|TERMINATE)\b[\s\S]*$/i, '').trim();
  const m = t.match(/\b(?:DO NOT SHOW|SHOW|ASK)\b[^.?\n]*/i);
  if (!m) return '';
  const line = m[0].trim();
  // ignore display-only "show screen/card/pack/image" and data-validation "show error ..."
  // that carry no base logic
  if (/^show\s+(screen|card|pack|image|error|the following pack|these)/i.test(line)) return '';
  if (/\berror\s+response\b/i.test(line)) return '';
  return line;
}

// Light synonym normalisation seen between questionnaire and AP: SELECTED->coded, AT->in.
function normSynonyms(s: string): string {
  return s.replace(/\bselected\b/gi, 'coded').replace(/\bat\b(?=\s+[A-Z]{1,4}\d)/gi, 'in');
}

// Is the routing a clean, fully-parseable "ask (those|if) coded X in Q [and/or ...]"?
// If yes we canonicalise; otherwise we keep the original prose (matching the AP).
const CLEAN_RE = new RegExp(
  `^ask\\s+(?:those\\s+(?:who\\s+)?|if\\s+)?(?:not\\s+coded|coded)\\s+[\\d,\\s/&-]+(?:\\s*for\\s+[^,]+?)?\\s+in\\s+${QID}` +
  `(?:\\s+(?:and|or)\\s+(?:not\\s+coded|coded)\\s+[\\d,\\s/&-]+(?:\\s*for\\s+[^,]+?)?\\s+in\\s+${QID})*\\s*$`, 'i');

// ---- clause parsing ----------------------------------------------
// A clause: [NOT] CODED <codes> [FOR <brand>] IN <QID>   (order-tolerant)
export function parseClauses(routing: string): Clause[] {
  const clauses: Clause[] = [];
  // Protect code-list "or"/"and" BETWEEN NUMBERS (e.g. "1 or 2") so it isn't
  // mistaken for a clause connector. Loop to catch chains ("1 or 2 or 3").
  let r = routing;
  let prev: string;
  do { prev = r; r = r.replace(/(\d)\s+(?:or|and)\s+(?=\d)/gi, '$1,'); } while (r !== prev);
  // normalize connectors, keep AND/OR as delimiters
  const parts = r.split(/\b(and|or)\b/i);
  let connector: 'and' | 'or' = 'and';
  for (const seg of parts) {
    const s = seg.trim();
    if (/^(and|or)$/i.test(s)) { connector = s.toLowerCase() as 'and' | 'or'; continue; }
    const c = parseOneClause(s);
    if (c) { c.connector = clauses.length ? connector : null; clauses.push(c); }
  }
  return clauses;
}

// permissive code body: digits, ranges, quotes, and word-codes (YES/NO/text)
const CODEBODY = `['‘’"]?[\\w][\\w,\\s'‘’"“”\\-–/&]*?`;

function parseOneClause(s: string): Clause | null {
  const neg = /\bnot\s+coded\b|\bexcept\b|\bother than\b/i.test(s);
  // codes ... in QID   OR   in QID ... codes   (order-tolerant, "for BRAND" allowed)
  let m = s.match(new RegExp(`coded\\s+(${CODEBODY})\\s+(?:for\\s+([^,]+?)\\s+)?in\\s+(${QID})`, 'i'));
  let codesRaw: string;
  let q: string;
  let brand = '';
  if (m) { codesRaw = m[1]; brand = m[2] || ''; q = m[3]; }
  else {
    m = s.match(new RegExp(`in\\s+(${QID})\\s+coded\\s+(${CODEBODY})`, 'i'));
    if (m) { q = m[1]; codesRaw = m[2]; }
    else {
      // reversed: "<codes> coded in <QID>"  (e.g. "ASK IF 1 CODED IN MQ3")
      m = s.match(new RegExp(`(${CODEBODY})\\s+coded\\s+in\\s+(${QID})`, 'i'));
      if (!m) return null;
      codesRaw = m[1]; q = m[2];
    }
  }
  const codes = expandCodes(codesRaw);
  if (!codes.length) return null;
  return { neg, q: q.toUpperCase(), codes, brand: brand.trim() };
}

export function expandCodes(raw: string): string[] {
  const out: string[] = [];
  const cleaned = raw.replace(/['‘’"“”]/g, '').replace(/\bto\b/gi, '-').replace(/\bor\b/gi, ',');
  for (let tok of cleaned.split(/[,\s&/]+/)) {
    tok = tok.trim();
    if (!tok) continue;
    const range = tok.match(/^(\d+)\s*[-–]\s*(\d+)$/);
    if (range) { for (let n = +range[1]; n <= +range[2]; n++) out.push(String(n)); }
    else if (/^\d+$/.test(tok)) out.push(tok);
    else if (/^(yes|no)$/i.test(tok)) out.push(tok.charAt(0).toUpperCase() + tok.slice(1).toLowerCase()); // word-code
  }
  return [...new Set(out)];
}

// ---- rendering ---------------------------------------------------
function renderClause(c: Clause, first: boolean): string {
  const verb = first ? 'Ask Those' : '';
  const codeStr = c.codes.join(',');
  const brandStr = c.brand ? ` for ${c.brand}` : '';
  const body = `${c.neg ? 'not coded' : 'coded'} ${codeStr}${brandStr} in ${c.q}`;
  return (verb ? verb + ' ' : '') + body;
}

/**
 * @param rawSources strings that MIGHT contain routing (pending lines, inline text).
 *                   The last one that yields a routing statement wins.
 * @param resolver   looks up a referenced question's real options, for validation.
 */
export function buildFilter(rawSources: (string | undefined)[], resolver?: OptionResolver): FilterResult {
  let routing = '';
  for (const src of rawSources) { const r = extractRouting(src || ''); if (r) routing = r; }

  if (!routing) return { baseTitle: 'Ask All', baseFilter: '', status: 'assumed', refs: [] };
  if (/^ask\s+all\b/i.test(routing) && !/\bcoded|selected\b/i.test(routing))
    return { baseTitle: 'Ask All', baseFilter: '', status: 'all', refs: [] };

  const norm = normSynonyms(routing).replace(/\s+/g, ' ').trim();

  // Only canonicalise when the routing is a clean "ask (those|if) coded X in Q" pattern.
  // Anything with extra qualifiers, SHOW/DO NOT SHOW, or free prose is kept verbatim (as the AP does).
  if (!CLEAN_RE.test(norm))
    return { baseTitle: 'Ask All', baseFilter: cleanProse(routing), status: 'review', refs: [] };

  const clauses = parseClauses(norm);
  if (!clauses.length)
    return { baseTitle: 'Ask All', baseFilter: cleanProse(routing), status: 'review', refs: [] };

  // validate against the referenced question's REAL options.
  // resolver(q) -> null (missing) | { codes:Set<string>, texts:string[] }
  const badRefs: string[] = [];
  for (const c of clauses) {
    if (!resolver) continue;
    const real = resolver(c.q);
    if (real === null) { badRefs.push(`${c.q}?missing`); continue; }
    for (const code of c.codes) {
      if (/^\d+$/.test(code)) {
        if (real.codes.size && !real.codes.has(code)) badRefs.push(`${c.q}:${code}`);
      } else {
        // word-code (Yes/No): confirm an option text matches, else needs review
        const hit = real.texts.some(t => t.toLowerCase().startsWith(code.toLowerCase()));
        if (!hit) badRefs.push(`${c.q}:${code}?`);
      }
    }
  }

  let filter = '';
  clauses.forEach((c, i) => {
    if (i === 0) filter = renderClause(c, true);
    else filter += ` ${c.connector} ${renderClause(c, false)}`;
  });

  return {
    baseTitle: 'Ask All',
    baseFilter: filter,
    status: badRefs.length ? 'review' : 'conditional',
    refs: clauses.map(c => ({ q: c.q, codes: c.codes, neg: c.neg })),
    note: badRefs.length ? 'validation: ' + badRefs.join('; ') : '',
  };
}

function cleanProse(s: string): string {
  return s.replace(/\s+/g, ' ').replace(/^ask\s+/i, 'Ask ').replace(/[?.]+$/, '').trim();
}
