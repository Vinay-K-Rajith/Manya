import * as mammoth from 'mammoth';
import * as cheerio from 'cheerio';

export interface QuestionnaireOption {
  code: string;
  text: string;
  route?: string;
}

export interface QuestionnaireQuestion {
  id: string;
  text: string;
  heading: string;
  coding: string;
  filter: string;
  options: QuestionnaireOption[];
  source: 'paragraph' | 'table';
  isSection?: boolean;
}

const Q_PARA_RE = /^\s*([A-Z]+\d+[a-z]*)\.?\s+(.*)/i;
const Q_CELL_RE = /^\s*([A-Z]+\d+[a-z]*)\s*$/i;
const SECTION_RE = /^\s*(SECTION\s+\d+.*|SECTION\s+[A-Z].*)/i;

const CODING_RE = /(SINGLE\s+CODING|MULTIPLE\s+CODING|RECORD\s+VERBATIM|RANKING|GRID|SINGLE\s+MULTIPLE\s+CODING|SINGLE\s+MULTIPLE\s+CODING\s*,\s*RANDOMIZE)/i;
const FILTER_RE = /(ASK\s+ALL|ASK\s+THOSE\s+[^.]*|ASK\s+IF\s+[^.]*|FILTER\s*:?\s*[^.]*)/i;


export { generateTableTitle, cleanTableTitle } from './tableTitleEngine';

export async function parseDocx(docxBuffer: Buffer): Promise<QuestionnaireQuestion[]> {
  // Convert docx to HTML using Mammoth
  const result = await mammoth.convertToHtml({ buffer: docxBuffer });
  const html = result.value;
  
  const $ = cheerio.load(html);
  const elements = $('body').children().toArray();
  
  const questions: QuestionnaireQuestion[] = [];
  const recentParas: string[] = [];
  
  let i = 0;
  while (i < elements.length) {
    const el = elements[i];
    const tagName = el.tagName.toLowerCase();
    
    if (tagName === 'p' || /^h[1-6]$/.test(tagName)) {
      const text = $(el).text().trim();
      if (!text) {
        i++;
        continue;
      }
      
      const mSection = text.match(SECTION_RE);
      const m = text.match(Q_PARA_RE);
      
      if (mSection) {
        questions.push({
          id: '',
          text: '',
          heading: text,
          coding: '',
          filter: '',
          options: [],
          source: 'paragraph',
          isSection: true
        });
      } else if (m) {
        const qId = m[1].toUpperCase();
        let qTextFull = m[2];
        
        // Accumulate multiline question text if paragraphs continue
        let tempI = i + 1;
        while (tempI < elements.length) {
          const nextEl = elements[tempI];
          const nextTag = nextEl.tagName.toLowerCase();
          if (nextTag === 'p' || /^h[1-6]$/.test(nextTag)) {
            const nextTxt = $(nextEl).text().trim();
            if (nextTxt === '') {
              tempI++;
              continue;
            }
            // Stop if we hit a new question, a table, or instruction block
            if (Q_PARA_RE.test(nextTxt) || CODING_RE.test(nextTxt) || FILTER_RE.test(nextTxt)) {
              break;
            }
            qTextFull += ' ' + nextTxt;
            tempI++;
          } else {
            break;
          }
        }
        
        // Extract coding & filters
        let codingType = 'SINGLE CODING';
        let filterBase = 'Ask All';
        
        // Check recent paragraphs queue for instructions
        for (const pTxt of recentParas) {
          const codingM = pTxt.match(CODING_RE);
          if (codingM) codingType = codingM[1].toUpperCase();
          
          const filterM = pTxt.match(FILTER_RE);
          if (filterM) filterBase = filterM[1];
        }
        
        // Check current text for instructions
        const codingM = qTextFull.match(CODING_RE);
        if (codingM) codingType = codingM[1].toUpperCase();
        const filterM = qTextFull.match(FILTER_RE);
        if (filterM) filterBase = filterM[1];
        
        // Find preceding uppercase heading
        let heading = '';
        for (let idx = recentParas.length - 1; idx >= 0; idx--) {
          const pTxt = recentParas[idx];
          if (pTxt === pTxt.toUpperCase() && pTxt.split(/\s+/).length <= 4 && !/ASK|CODING|SHOW/.test(pTxt)) {
            heading = pTxt;
            break;
          }
        }
        
        // Clean question text instructions
        qTextFull = qTextFull.replace(CODING_RE, '').replace(FILTER_RE, '').trim();
        
        // Scan ahead for options table
        let optionsTableIdx = -1;
        let j = tempI;
        while (j < elements.length) {
          const nextEl = elements[j];
          const nextTag = nextEl.tagName.toLowerCase();
          if (nextTag === 'table') {
            optionsTableIdx = j;
            break;
          } else if (nextTag === 'p' || /^h[1-6]$/.test(nextTag)) {
            const nextTxt = $(nextEl).text().trim();
            if (nextTxt && Q_PARA_RE.test(nextTxt)) {
              // We hit another question paragraph before a table
              break;
            }
          }
          j++;
        }
        
        const options: QuestionnaireOption[] = [];
        if (optionsTableIdx !== -1) {
          const table = elements[optionsTableIdx];
          const rows = $(table).find('tr').toArray();
          
          for (const row of rows) {
            const cells = $(row).find('td').toArray().map(cell => $(cell).text().trim().replace(/\s+/g, ' '));
            
            // Deduplicate merged cells text
            const uniqueCells: string[] = [];
            for (const cellText of cells) {
              if (uniqueCells.length === 0 || cellText !== uniqueCells[uniqueCells.length - 1]) {
                uniqueCells.push(cellText);
              }
            }
            
            if (uniqueCells.length === 0 || uniqueCells.every(c => c === '')) {
              continue;
            }
            
            // Skip header rows
            const firstCellLower = uniqueCells[0].toLowerCase();
            if (['code', 'instruction', 'route', 'terminate', 'remarks'].some(h => firstCellLower.includes(h))) {
              if (uniqueCells.length > 1 && ['code', 'route', 'instruction'].some(h => uniqueCells[1].toLowerCase().includes(h))) {
                continue;
              }
            }
            
            // Extract options based on column count
            if (uniqueCells.length >= 4) {
              options.push({
                text: uniqueCells[1],
                code: uniqueCells[2],
                route: uniqueCells[3] || undefined
              });
            } else if (uniqueCells.length === 3) {
              const startsWithId = /^[r]\d+/i.test(uniqueCells[0]) || uniqueCells[0] === '';
              if (startsWithId) {
                options.push({
                  text: uniqueCells[1],
                  code: uniqueCells[2]
                });
              } else {
                options.push({
                  text: uniqueCells[0],
                  code: uniqueCells[1],
                  route: uniqueCells[2] || undefined
                });
              }
            } else if (uniqueCells.length === 2) {
              options.push({
                text: uniqueCells[0],
                code: uniqueCells[1]
              });
            } else if (uniqueCells.length === 1) {
              options.push({
                text: uniqueCells[0],
                code: ''
              });
            }
          }
          
          // Advance index past table
          i = optionsTableIdx;
        } else {
          i = tempI - 1;
        }
        
        questions.push({
          id: qId,
          text: qTextFull,
          heading: heading,
          coding: codingType,
          filter: filterBase,
          options: options,
          source: 'paragraph'
        });
      } else {
        recentParas.push(text);
        if (recentParas.length > 5) recentParas.shift();
      }
      i++;
    } else if (tagName === 'table') {
      const rows = $(el).find('tr').toArray();
      if (rows.length > 0) {
        const firstRowCells = $(rows[0]).find('td').toArray().map(c => $(c).text().trim());
        const firstCell = firstRowCells[0];
        
        const m = firstCell.match(Q_CELL_RE);
        if (m) {
          const qId = m[1].toUpperCase();
          let qTextFull = firstRowCells[1] || '';
          
          let codingType = 'SINGLE CODING';
          let filterBase = 'Ask All';
          
          const codingM = qTextFull.match(CODING_RE);
          if (codingM) codingType = codingM[1].toUpperCase();
          const filterM = qTextFull.match(FILTER_RE);
          if (filterM) filterBase = filterM[1];
          
          // Find preceding uppercase heading
          let heading = '';
          for (let idx = recentParas.length - 1; idx >= 0; idx--) {
            const pTxt = recentParas[idx];
            if (pTxt === pTxt.toUpperCase() && pTxt.split(/\s+/).length <= 4 && !/ASK|CODING|SHOW/.test(pTxt)) {
              heading = pTxt;
              break;
            }
          }
          
          qTextFull = qTextFull.replace(CODING_RE, '').replace(FILTER_RE, '').trim();
          
          const options: QuestionnaireOption[] = [];
          for (let rIdx = 1; rIdx < rows.length; rIdx++) {
            const cells = $(rows[rIdx]).find('td').toArray().map(cell => $(cell).text().trim().replace(/\s+/g, ' '));
            const uniqueCells: string[] = [];
            for (const cellText of cells) {
              if (uniqueCells.length === 0 || cellText !== uniqueCells[uniqueCells.length - 1]) {
                uniqueCells.push(cellText);
              }
            }
            if (uniqueCells.length === 0 || uniqueCells.every(c => c === '')) {
              continue;
            }
            
            // Extract options based on column count
            if (uniqueCells.length >= 4) {
              options.push({
                text: uniqueCells[1],
                code: uniqueCells[2],
                route: uniqueCells[3] || undefined
              });
            } else if (uniqueCells.length === 3) {
              const startsWithId = /^[r]\d+/i.test(uniqueCells[0]) || uniqueCells[0] === '';
              if (startsWithId) {
                options.push({
                  text: uniqueCells[1],
                  code: uniqueCells[2]
                });
              } else {
                options.push({
                  text: uniqueCells[0],
                  code: uniqueCells[1],
                  route: uniqueCells[2] || undefined
                });
              }
            } else if (uniqueCells.length === 2) {
              options.push({
                text: uniqueCells[0],
                code: uniqueCells[1]
              });
            } else if (uniqueCells.length === 1) {
              options.push({
                text: uniqueCells[0],
                code: ''
              });
            }
          }
          
          questions.push({
            id: qId,
            text: qTextFull,
            heading: heading,
            coding: codingType,
            filter: filterBase,
            options: options,
            source: 'table'
          });
        }
      }
      
      recentParas.length = 0; // Clear paragraphs queue since we hit a table
      i++;
    } else {
      i++;
    }
  }
  
  return questions;
}
