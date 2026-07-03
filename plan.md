# Plan: Questionnaire to Excel AP Converter (Node/TypeScript/React Monorepo)

This plan details the implementation of a web application structured as a monorepo that runs on a single port.

---

## Technical Stack & Architecture

- **Monorepo Structure**:
  - `server/`: Express backend written in TypeScript, using `mammoth` for DOCX parsing, `cheerio` for HTML DOM parsing, and `exceljs` for writing styled Excel files.
  - `client/`: React application built with TypeScript and Vite.
- **Single Port Deployment**:
  - During development, the client runs on port `5173` (Vite) and proxies API calls to the Express server running on port `3000`.
  - For production/deployment, the client is compiled to static assets (`client/dist`). The Express server serves these assets using `express.static()` and listens on a single port (e.g. `3000`).

---

## 1. DOCX Parsing Mechanics

Rather than parsing raw XML, we use **Mammoth.js** to convert the Word document to clean HTML, and **Cheerio** to parse the elements in order. This ensures robust sequencing:

```typescript
import mammoth from 'mammoth';
import cheerio from 'cheerio';

// Convert docx to HTML
const { value: html } = await mammoth.convertToHtml({ buffer: docxBuffer });

// Parse sequential DOM
const $ = cheerio.load(html);
const bodyElements = $('body').children();
```

We iterate through `bodyElements`:
- If the tag is `p`, `h1`–`h6`, we extract text and match question regexes.
- If the tag is `table`, we parse table rows (`tr`) and cells (`td`) to get choices or grid questions.

---

## 2. Pattern Matching via Regex

We will detect question segments and metadata using these JS/TS regex patterns:

- **Question Identification in Paragraphs**:
  ```typescript
  // Matches "RQ7.", "C1.", "BB12.", etc. at the start of a paragraph
  const qParaRegex = /^\s*([A-Z]+\d+[a-z]*)\.?\s+(.*)/i;
  ```
- **Question Identification in Table Cell (0, 0)**:
  ```typescript
  // Matches tables where the first cell is exactly a Question ID
  const qCellRegex = /^\s*([A-Z]+\d+[a-z]*)\s*$/i;
  ```
- **Coding Instruction Extraction**:
  ```typescript
  // Extracts SINGLE CODING, MULTIPLE CODING, RECORD VERBATIM, RANKING, GRID
  const codingRegex = /(SINGLE\s+CODING|MULTIPLE\s+CODING|RECORD\s+VERBATIM|RANKING|GRID|SINGLE\s+MULTIPLE\s+CODING)/i;
  ```
- **Filter Instruction Extraction**:
  ```typescript
  // Matches filter conditions like "ASK ALL" or "ASK THOSE CODED..."
  const filterRegex = /(ASK\s+ALL|ASK\s+THOSE\s+[^.]*|ASK\s+IF\s+[^.]*|FILTER\s*:?\s*[^.]*)/i;
  ```

---

## 3. Heuristic Table Title Engine

To guess the "Table Title" column for the `TabSpec` sheet:
1. **Preceding Headers**: We look backwards at the nearest short uppercase paragraph (e.g. `CITY`, `CWE EDUCATION`) within the last 3-4 elements. If found, we use it (converted to Sentence Case).
2. **Text Cleaning Heuristic**: If no header is found, we strip common question prefixes from the text:
   - `Which of the following best describes your `
   - `Please select your `
   - `What is your `
   - `Which of the `
   - `On which of the `
   - `Why did you `
   - `From where did you `
3. **Truncation**: We take the cleaned text, capitalize the first letter, remove punctuation, and truncate it to the first 4-5 words (max 40 characters).
   - *Example*: `Which of the following best describes your current occupation??` -> `Current occupation`
   - *Example*: `Please select your Gender. SINGLE CODING` -> `Gender`

---

## 4. Excel Generation & Styling (ExcelJS)

To guarantee that all styles, borders, sheet views, and default worksheets are preserved:
1. The server loads the target template (e.g. `AP FOR GOLDLINE CONSUMER.xlsx`) from the workspace.
2. It keeps helper sheets (`Version Management`, `Deliverables`, `Table Standards`, `Weighting`, `MVA`) unmodified.
3. It completely overwrites `TabSpec`:
   - Writes section dividers as merged cells (A to H) in bold deep blue fill.
   - Writes columns `No.`, `Question No`, `Table Title`, `Base Title`, `Base Filter`, `Header Title`, `Comment`, `Remark` with exact typography (Calibri 10pt, alignments).
4. It overwrites `Header`:
   - Unfolds selected demographic questions (marked as banners) into columns.
   - Merges cells in row 11 (`Header`) and row 13 (`Question No.`) for each category.
   - Auto-generates Sig Letters (`a`, `b`, `c`...) and Sig Groups (`A/B/C/D`...) for significance testing.
5. Saves the workbook and sends it back to the client.

---

## 5. Directory Layout & Proposed Workspace Structure

```
d:\Manya\
  package.json              <- Monorepo root configuration
  plan.md                   <- Local plan file
  server/
    package.json            <- Express server configuration
    tsconfig.json           <- TS compiler configs
    src/
      server.ts             <- Express app & single-port routing
      parser.ts             <- Mammoth + Cheerio parsing engine
      excelGen.ts           <- ExcelJS template builder
  client/
    package.json            <- React config
    tsconfig.json           <- TS config
    vite.config.ts          <- Vite proxy config (port 5173 -> 3000)
    src/
      main.tsx              <- Frontend mounting
      App.tsx               <- Converter Layout
      components/
        QuestionTable.tsx   <- Grid editor for parsed fields
        RegexSandbox.tsx    <- Interactive regex testing panel
```
