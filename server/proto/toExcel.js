/* Build a styled TabSpec .xlsx from a questionnaire, in the house schema.
 * Reuses the existing compiled excelGen (dist/excelGen.js). */
const fs = require('fs');
const { segment } = require('./segment');
const { makeTitle } = require('./titleEngine');
const { buildFilter } = require('./filterEngine');
const { generateExcel } = require('../dist/excelGen');

async function buildRows(docxPath) {
  const blocks = await segment(docxPath);
  const byId = new Map(blocks.map(b => [b.id, b]));
  const resolver = (q) => {
    const b = byId.get(q);
    if (!b) return null;
    return { codes: new Set(b.options.map(o => o.code).filter(Boolean)), texts: b.options.map(o => o.text) };
  };

  const rows = [];
  let no = 0, lastSection = null;
  for (const b of blocks) {
    if (b.section && b.section !== lastSection) {
      lastSection = b.section;
      rows.push({ no: '', id: '', tableTitle: b.section, baseTitle: '', baseFilter: '',
                  headerTitle: '', comment: '', remark: '', isSection: true });
    }
    const f = buildFilter([b.sectionRouting, b.text, b.routingRaw], resolver);
    const remark = [];
    if (f.status === 'assumed') remark.push('routing assumed — verify');
    if (f.status === 'review') remark.push(f.note || 'routing needs review');
    rows.push({
      no: ++no,
      id: b.id,
      tableTitle: makeTitle(b.text, b.heading),
      baseTitle: 'Ask All',
      baseFilter: f.baseFilter,          // blank = ask all
      headerTitle: 'All Headers',
      comment: '%, Sum',
      remark: remark.join('; '),
      isSection: false,
    });
  }
  return rows;
}

(async () => {
  const map = {
    Incline: 'Incline_26-039634_Questionnaire (Client  internal use)_v8 (Repaired).docx',
    Blaze:   'Blaze_26-012605-01_RQ+MQ_Quant (Internal Client use only)_V2.docx',
    Pure2:   'Pure 2_25-078284-01_Questionnaire (Client & internal use)_V3 2.docx',
    Sakaar:  'Sakaar_26-026309-01_Questionnaire (Internal and Client Use only) _V13.docx',
  };
  const name = process.argv[2] || 'Incline';
  const rows = await buildRows('../' + map[name]);
  const buf = await generateExcel('', rows, [], undefined);
  const out = `d:/tmp/AP_${name}.xlsx`;
  fs.writeFileSync(out, buf);
  console.log(`Wrote ${out}  (${rows.filter(r => !r.isSection).length} questions, ${rows.filter(r => r.isSection).length} sections)`);
})();
