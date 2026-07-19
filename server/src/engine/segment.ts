/* Notation-agnostic questionnaire segmenter.
 * docx -> blocks: { id, text, heading, section, routingRaw, coding, options:[{text,code}] } */
import * as mammoth from 'mammoth';
import * as cheerio from 'cheerio';

export interface BlockOption {
  text: string;
  code: string;
}

/** One question recovered from the document, before titles/filters are derived. */
export interface Block {
  id: string;
  text: string;
  section: string;
  heading: string;
  routingRaw: string;
  /** Positional "ASK SECTION A-E TO THOSE ..." directive in force for this block. */
  sectionRouting: string;
  coding: CodingType;
  options: BlockOption[];
}

export type CodingType = 'open' | 'ranking' | 'multiple' | 'single' | 'grid' | 'numeric' | '';

/** Either a .docx buffer or a path to one. */
export type SegmentInput = Buffer | string;

// Question-ID at line start. Tolerates:
//   - internal space in the ID: "MQ 2a", "RQ 5"
//   - separator '.', ')', ':' OR a bare space before body ("B7 Out of...")
// When no punctuation separator, body must start like question text ([A-Z][a-z]) to avoid noise.
const Q_RE = /^\s*([A-Z]{1,4})\s?(\d+[a-zA-Z]?)(?:[.):]\s+|\s+(?=[A-Z][a-z]))(.+)/;
// DP / derived-variable artifacts that look like questions but aren't
const NOT_A_QUESTION = /^(variable|var\b|derived|net\b|taw\b|tub\b|tom\b)\b|=/i;
function matchQ(line: string): { id: string; body: string } | null {
  const m = line.match(Q_RE);
  if (!m) return null;
  const body = m[3];
  if (NOT_A_QUESTION.test(body) && body.length < 45) return null;   // skip "B4 Variable Taw= ..."
  return { id: (m[1] + m[2]).replace(/\s+/g, '').toUpperCase(), body };
}
const SECTION_RE = /^\s*(SECTION\b.*|MAIN QUESTIONNAIRE|CATEGORY UNDERSTANDING|MEDIA HABITS|RESPONDENT PROFILING)\s*$/i;
// Positional section-base directive, e.g.
//   "SN: ASK SECTION A – E TO THOSE CODED 5 FOR MOTOROLA IN Q1C (MOTOROLA OWNERS)"
// Sets the base filter for every following question until the next directive.
const SECTION_ROUTING_RE = /ASK\s+SECTION[\s\S]*?TO\s+THOSE\s+(.+?)\s*(?:\([^)]*\))?\s*$/i;
const ROUTING_RE = /\b(ASK ALL|ASK (?:THOSE|IF|FOR|ONLY|PAST)[^.\n]*|SHOW[^.\n]*CODED[^.\n]*IN\s+[A-Z]{1,4}\d+)/i;
const CODING_LINE_RE = /^\s*(SINGLE|MULTIPLE|MULTI|OPEN[\s-]?END(ED)?|RECORD VERBATIM|RANKING|GRID|NUMERIC)\b/i;

// coding notations -> canonical type
function detectCoding(text: string): CodingType {
  const s = text.toUpperCase();
  if (/\[OE\]|\bOPEN[\s-]?END|RECORD VERBATIM|\(OPEN-?ENDED\)/.test(s)) return 'open';
  if (/\[RANK|RANKING|RANK\s*[–-]?\s*TOP/.test(s)) return 'ranking';
  if (/\[(MC|MA)\]|MULTIPLE CODING|MULTI CODING|ALLOW MULTIPLE|MULTIPLE POSSIBLE/.test(s)) return 'multiple';
  if (/\[(SC|SA)\]|SINGLE CODING|SINGLE CODE/.test(s)) return 'single';
  if (/GRID/.test(s)) return 'grid';
  if (/NUMERIC/.test(s)) return 'numeric';
  return '';
}

/** An ordered paragraph or table, flattened out of the converted HTML. */
type Item = { type: 'text'; text: string } | { type: 'table'; rows: string[][] };

export async function segment(input: SegmentInput): Promise<Block[]> {
  const arg = Buffer.isBuffer(input) ? { buffer: input } : { path: input };
  const { value: html } = await mammoth.convertToHtml(arg);
  const $ = cheerio.load(html);
  const els = $('body').children().toArray();

  // flatten to ordered items
  const items: Item[] = [];
  for (const el of els) {
    const tag = el.tagName.toLowerCase();
    if (tag === 'table') {
      const rows = $(el).find('tr').toArray().map(r =>
        $(r).find('td,th').toArray().map(c => $(c).text().trim().replace(/\s+/g, ' ')));
      items.push({ type: 'table', rows });
    } else {
      let txt = $(el).text().trim().replace(/\s+/g, ' ');
      // un-glue coding keywords mammoth fuses onto routing: "IN D3OPEN END" -> "IN D3 OPEN END"
      txt = txt.replace(/([A-Z]{1,4}\d+)(OPEN|SINGLE|MULTIPLE|RANDOMIZE|GRID)/g, '$1 $2');
      if (txt) items.push({ type: 'text', text: txt });
    }
  }

  const blocks: Block[] = [];
  let pending: string[] = [];   // recent non-question text lines (routing/coding/headings)
  let section = '';
  let sectionRouting = '';      // positional section-base ("ASK THOSE <cond>"), inherited by questions
  let cur: Block | null = null; // current question block awaiting its options table

  const flushOptionsFrom = (rows: string[][]): void => {
    if (!cur || cur.options.length) return;
    for (const r of rows) {
      const cells = r.filter((c, i) => i === 0 || c !== r[i - 1]); // dedup merged
      if (!cells.length || cells.every(c => !c)) continue;
      // find a text + a numeric code
      let text = '', code = '';
      for (const c of cells) {
        if (/^\d{1,3}$/.test(c) && !code) code = c;
        else if (c && !text && !/^(code|route|instruction|terminate)$/i.test(c)) text = c;
      }
      if (text) cur.options.push({ text, code });
    }
  };

  for (const it of items) {
    if (it.type === 'table') {
      // A question can be authored AS a table: first cell = QID, second cell = question text,
      // remaining rows = its options. (Recruitment screeners RQ1..RQ5A use this layout.)
      const head = it.rows[0] || [];
      const idCell = (head[0] || '').trim();
      const bodyCell = (head[1] || '').replace(/\s+/g, ' ').trim();
      if (/^[A-Z]{1,4}\s?\d+[A-Z]?$/i.test(idCell) && !/^R\d+$/i.test(idCell) && bodyCell.length >= 6) {
        const id = idCell.replace(/\s+/g, '').toUpperCase();
        let routingRaw = ''; const inlineR = bodyCell.match(ROUTING_RE); if (inlineR) routingRaw = inlineR[1];
        cur = { id, text: bodyCell, section, heading: '', routingRaw, sectionRouting, coding: detectCoding(bodyCell), options: [] };
        blocks.push(cur);
        flushOptionsFrom(it.rows.slice(1));
        pending = [];
        continue;
      }
      flushOptionsFrom(it.rows); pending = []; continue;
    }
    const line = it.text;

    // positional section-base directive: sets base for all following questions
    const sr = line.match(SECTION_ROUTING_RE);
    if (sr) { sectionRouting = 'ASK THOSE ' + sr[1].trim(); pending = []; continue; }

    if (SECTION_RE.test(line) && line.length < 60) { section = line.replace(/\s+/g, ' ').trim(); pending = []; continue; }

    const mq = matchQ(line);
    if (mq) {
      const id = mq.id;
      const body = mq.body;
      // routing: from pending lines OR inline in body
      let routingRaw = '';
      for (const p of pending) { const r = p.match(ROUTING_RE); if (r) routingRaw = r[1]; }
      const inlineR = body.match(ROUTING_RE); if (inlineR) routingRaw = inlineR[1];
      // coding: pending coding line, inline, or bracket/paren tag
      let coding = detectCoding(body);
      if (!coding) for (const p of pending) { if (CODING_LINE_RE.test(p) || detectCoding(p)) { coding = detectCoding(p); break; } }
      // heading: nearest short ALLCAPS pending line
      let heading = '';
      for (let k = pending.length - 1; k >= 0; k--) {
        const p = pending[k];
        if (p === p.toUpperCase() && p.split(/\s+/).length <= 5 && !ROUTING_RE.test(p) && !/CODING|SHOW|RANDOM/i.test(p)) { heading = p; break; }
      }
      cur = { id, text: body, section, heading, routingRaw, sectionRouting, coding, options: [] };
      blocks.push(cur);
      pending = [];
    } else {
      pending.push(line);
      if (pending.length > 6) pending.shift();
    }
  }
  return blocks;
}


