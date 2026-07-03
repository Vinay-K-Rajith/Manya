const { segment } = require('./segment');
const { makeTitle } = require('./titleEngine');
const { buildFilter } = require('./filterEngine');

const CODING_LABEL = { single:'SC', multiple:'MC', open:'OE', ranking:'RANK', grid:'GRID', numeric:'NUM', '':'?' };

async function buildAP(docxPath) {
  const blocks = await segment(docxPath);
  const byId = new Map(blocks.map(b => [b.id, b]));
  // resolver: real options for a QID. null = missing; else {codes, texts}
  const resolver = (q) => {
    const b = byId.get(q);
    if (!b) return null;
    return { codes: new Set(b.options.map(o => o.code).filter(Boolean)), texts: b.options.map(o => o.text) };
  };

  const rows = blocks.map((b, i) => {
    const title = makeTitle(b.text, b.heading);
    // priority: explicit per-question routing > inline in text > inherited section base
    const f = buildFilter([b.sectionRouting, b.text, b.routingRaw], resolver);
    const flags = [];
    // ---- self-check vs questionnaire ----
    if (f.status === 'assumed') flags.push('ROUTING-ASSUMED');
    if (f.status === 'review') flags.push('FILTER-REVIEW' + (f.note ? `(${f.note})` : ''));
    if (!title || title.split(' ').length > 6) flags.push('TITLE-LONG');
    if (/^(open end|single|multiple|coding)$/i.test(title)) flags.push('TITLE=CODING');
    if (b.coding !== 'open' && b.coding !== 'numeric' && b.options.length === 0) flags.push('NO-OPTIONS');
    return { no:i+1, id:b.id, title, type:CODING_LABEL[b.coding], base:f.baseFilter || '(Ask all)', section:b.section, flags };
  });
  // ---- sequence-gap detection per prefix ----
  const gaps = [];
  const byPrefix = {};
  for (const b of blocks) { const p = b.id.match(/^([A-Z]+)/)[1]; const n = parseInt(b.id.match(/(\d+)/)[1],10);
    (byPrefix[p] ||= []).push(n); }
  for (const [p, nums] of Object.entries(byPrefix)) {
    const u = [...new Set(nums)].sort((a,b)=>a-b);
    for (let n=u[0]; n<u[u.length-1]; n++) if (!u.includes(n)) gaps.push(`${p}${n}`);
  }
  return { rows, gaps };
}

(async () => {
  const files = {
    Incline: 'Incline_26-039634_Questionnaire (Client  internal use)_v8 (Repaired).docx',
    Blaze:   'Blaze_26-012605-01_RQ+MQ_Quant (Internal Client use only)_V2.docx',
    Pure2:   'Pure 2_25-078284-01_Questionnaire (Client & internal use)_V3 2.docx',
    Sakaar:  'Sakaar_26-026309-01_Questionnaire (Internal and Client Use only) _V13.docx',
  };
  const only = process.argv[2];
  for (const [name, rel] of Object.entries(files)) {
    if (only && name !== only) continue;
    const { rows, gaps } = await buildAP('../' + rel);
    console.log('\n' + '='.repeat(90) + `\n${name}   (${rows.length} questions)`);
    console.log('='.repeat(90));
    let sec = '';
    for (const r of rows) {
      if (r.section !== sec) { sec = r.section; console.log(`\n  ▶ ${sec}`); }
      const fl = r.flags.length ? '  ⚠ ' + r.flags.join(' ') : '';
      console.log(`  ${r.id.padEnd(6)} [${r.type.padEnd(4)}] ${r.title.padEnd(34)} | ${r.base.padEnd(30)}${fl}`);
    }
    if (gaps.length) console.log(`\n  MISSING (sequence gaps): ${gaps.join(', ')}`);
  }
})();
