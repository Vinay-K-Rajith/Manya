// @ts-nocheck
// Adapter: questionnaire buffer -> AP rows in the server/client response shape.
const { segment } = require('./segment');
const { makeTitle } = require('./titleEngine');
const { buildFilter } = require('./filterEngine');

/** Build the parsed-questions payload consumed by /api/parse and the client grid. */
async function buildAP(input) {
  const blocks = await segment(input);
  const byId = new Map(blocks.map((b) => [b.id, b]));
  const resolver = (q) => {
    const b = byId.get(q);
    if (!b) return null;
    return { codes: new Set(b.options.map((o) => o.code).filter(Boolean)), texts: b.options.map((o) => o.text) };
  };

  const questions = [];
  let seq = 0;
  let lastSection = null;

  for (const b of blocks) {
    if (b.section && b.section !== lastSection) {
      lastSection = b.section;
      questions.push({
        id: '', isSection: true, no: 0, heading: b.section, text: '',
        tableTitle: b.section, baseTitle: '', baseFilter: '', headerTitle: '', comment: '', remark: '',
        options: [],
      });
    }

    const f = buildFilter([b.sectionRouting, b.text, b.routingRaw], resolver);

    questions.push({
      id: b.id,
      isSection: false,
      no: ++seq,
      heading: b.heading || '',
      text: b.text,
      coding: b.coding,
      options: b.options,
      tableTitle: makeTitle(b.text, b.heading),
      baseTitle: 'Ask All',
      baseFilter: f.baseFilter,            // '' = ask all
      headerTitle: 'All Headers',
      comment: '%, Sum',                   // house default for all question rows
      remark: '',                          // deliverable stays clean; self-check is internal only
    });
  }
  return questions;
}

module.exports = { buildAP };
