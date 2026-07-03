/* Base-filter confidence audit. Classifies every question's filter into:
 *   VALIDATED  conditional, referenced Q exists AND all codes exist  -> trust
 *   REF-MISS   conditional, referenced Q not captured                -> check (recall or dangling)
 *   ASSUMED    blank Ask-all with NO explicit "ASK ALL" in source     -> check (possible silent miss)
 *   EXPLICIT   blank Ask-all backed by an explicit ASK ALL / section  -> trust
 */
const { segment } = require('./segment');
const { buildFilter, extractRouting } = require('./filterEngine');

const files = {
  Goldline:'../Goldline_25047513_Consumer Questionnaire (Client & internal use)_v9.docx',
  Incline:'../Incline_26-039634_Questionnaire (Client  internal use)_v8 (Repaired).docx',
  Blaze:'../Blaze_26-012605-01_RQ+MQ_Quant (Internal Client use only)_V2.docx',
  Pure2:'../Pure 2_25-078284-01_Questionnaire (Client & internal use)_V3 2.docx',
  Sakaar:'../Sakaar_26-026309-01_Questionnaire (Internal and Client Use only) _V13.docx',
};

(async () => {
  const showList = process.argv[2] === '-v';
  for (const [name, path] of Object.entries(files)) {
    const blocks = await segment(path);
    const byId = new Map(blocks.map((b) => [b.id, b]));
    const resolver = (q) => { const b = byId.get(q); if (!b) return null;
      return { codes: new Set(b.options.map((o) => o.code).filter(Boolean)), texts: b.options.map((o) => o.text) }; };

    let validated = 0, refMiss = 0, assumed = 0, explicit = 0;
    const assumedList = [], refMissList = [];
    for (const b of blocks) {
      const f = buildFilter([b.sectionRouting, b.text, b.routingRaw], resolver);
      if (f.baseFilter) {                         // conditional
        if (f.note && /missing/.test(f.note)) { refMiss++; refMissList.push(`${b.id} -> ${f.baseFilter}`); }
        else validated++;
      } else {                                    // blank = Ask all
        // did the source actually assert Ask all (or a section base), or did we just default?
        const hadExplicit = extractRouting(b.routingRaw || '') || extractRouting(b.text || '') || b.sectionRouting;
        if (hadExplicit) explicit++;
        else { assumed++; assumedList.push(b.id); }
      }
    }
    const trust = validated + explicit, check = refMiss + assumed;
    console.log(`\n${name}: ${blocks.length} Q | TRUST ${trust} (validated ${validated} + explicit-askall ${explicit}) | CHECK ${check} (ref-missing ${refMiss} + assumed-askall ${assumed})`);
    if (showList) {
      if (refMissList.length) console.log('   ref-missing:', refMissList.join(' ; '));
      if (assumedList.length) console.log('   assumed-askall:', assumedList.join(', '));
    }
  }
})();
