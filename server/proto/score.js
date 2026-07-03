/* Heuristic title-quality scorer across questionnaires.
 * A title is WEAK if: >6 words, junk chars, empty, a bare generic word,
 * or a duplicate within the same questionnaire (non-distinctive). */
const { segment } = require('./segment');
const { makeTitle } = require('./titleEngine');

const GENERIC = new Set(['brands','activities','sources','most','planning','behave','survey','mediums',
  'relatives','months','stores','sports','favourite','laptop','features','budget','platforms','improvements',
  'factors','household','products used','drain cleaners','pack shots','cleaning services','decision-making',
  'aware','statement describes','biggest contribution']);

function isWeak(title, seen) {
  const t = (title || '').trim();
  const w = t.split(/\s+/).filter(Boolean);
  if (!t) return 'empty';
  if (w.length > 10) return 'too-long';   // full sentences allowed; only flag runaway titles
  if (/[_…]|,\s*$|^\W|\b(the|a|an)\b.*\b(the|a|an)\b/i.test(t)) return 'junk';
  if (GENERIC.has(t.toLowerCase())) return 'generic';
  if (seen.has(t.toLowerCase())) return 'duplicate';
  return null;
}

const files = {
  Goldline:'../Goldline_25047513_Consumer Questionnaire (Client & internal use)_v9.docx',
  Incline:'../Incline_26-039634_Questionnaire (Client  internal use)_v8 (Repaired).docx',
  Blaze:'../Blaze_26-012605-01_RQ+MQ_Quant (Internal Client use only)_V2.docx',
  Pure2:'../Pure 2_25-078284-01_Questionnaire (Client & internal use)_V3 2.docx',
  Sakaar:'../Sakaar_26-026309-01_Questionnaire (Internal and Client Use only) _V13.docx',
};

(async () => {
  const showWeak = process.argv[2] === '-v';
  for (const [name, path] of Object.entries(files)) {
    const blocks = await segment(path);
    const seen = new Set();
    let good = 0; const weak = [];
    for (const b of blocks) {
      const title = makeTitle(b.text, b.heading);
      const reason = isWeak(title, seen);
      seen.add((title || '').toLowerCase());
      if (reason) weak.push(`${b.id}: "${title}" [${reason}]  <= ${b.text.slice(0, 55)}`);
      else good++;
    }
    const pct = Math.round((good / blocks.length) * 100);
    console.log(`${name.padEnd(9)} ${good}/${blocks.length} good = ${pct}%  ${pct >= 75 ? 'OK' : 'BELOW 75'}`);
    if (showWeak) weak.forEach(w => console.log('   ' + w));
  }
})();
