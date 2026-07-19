import * as ExcelJS from 'exceljs';

export interface TabSpecRow {
  no: number;
  id: string;
  tableTitle: string;
  baseTitle: string;
  baseFilter: string;
  headerTitle: string;
  comment: string;
  remark: string;
  isSection?: boolean;
}

export interface HeaderBanner {
  id: string; // e.g. RQ1
  tableTitle: string;
  options: {
    code: string;
    text: string;
  }[];
}

export async function generateExcel(
  tabSpecData: TabSpecRow[],
  banners: HeaderBanner[]
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'AP Analyzer API';
  workbook.created = new Date();

  const tabSpecSheet = workbook.addWorksheet('TabSpec', { views: [{ showGridLines: false }] });
  const headerSheet = workbook.addWorksheet('Header', { views: [{ showGridLines: false }] });

  // --- TabSpec sheet ---

  const headerRow = tabSpecSheet.getRow(1);
  headerRow.values = ['No.', 'Question No', 'Table Title', 'Base Title', 'Base Filter', 'Header Title', 'Comment', 'Remark'];
  headerRow.height = 25;
  headerRow.eachCell((cell) => {
    cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF002060' } }; // Deep blue header
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.border = {
      top: { style: 'thin', color: { argb: 'FFD3D3D3' } },
      bottom: { style: 'thin', color: { argb: 'FFD3D3D3' } },
      left: { style: 'thin', color: { argb: 'FFD3D3D3' } },
      right: { style: 'thin', color: { argb: 'FFD3D3D3' } },
    };
  });

  let currentExcelRow = 2;
  for (const item of tabSpecData) {
    const row = tabSpecSheet.getRow(currentExcelRow);
    row.height = 20;

    if (item.isSection) {
      // Borders must be applied before the merge below; exceljs crashes if the
      // merged range is styled afterwards.
      for (let col = 1; col <= 8; col++) {
        const cell = row.getCell(col);
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFD3D3D3' } },
          bottom: { style: 'thin', color: { argb: 'FFD3D3D3' } },
        };
      }

      const cell = row.getCell(1);
      cell.value = item.tableTitle;
      cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FF002060' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE6EEF8' } };
      cell.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };

      tabSpecSheet.mergeCells(currentExcelRow, 1, currentExcelRow, 8);
    } else {
      row.getCell(1).value = item.no;
      row.getCell(2).value = item.id;
      row.getCell(3).value = item.tableTitle;
      row.getCell(4).value = item.baseTitle;
      row.getCell(5).value = item.baseFilter || null;
      row.getCell(6).value = item.headerTitle;
      row.getCell(7).value = item.comment;
      row.getCell(8).value = item.remark || null;

      for (let col = 1; col <= 8; col++) {
        const cell = row.getCell(col);
        cell.font = { name: 'Calibri', size: 10 };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } };

        // Column 3 is the table title, the only free-text column.
        if (col === 3) {
          cell.alignment = { horizontal: 'left', vertical: 'middle' };
        } else {
          cell.alignment = { horizontal: 'center', vertical: 'middle' };
        }
        
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFE0E0E0' } },
          bottom: { style: 'thin', color: { argb: 'FFE0E0E0' } },
          left: { style: 'thin', color: { argb: 'FFE0E0E0' } },
          right: { style: 'thin', color: { argb: 'FFE0E0E0' } },
        };
      }
    }
    currentExcelRow++;
  }

  tabSpecSheet.columns = [
    { key: 'no', width: 8 },
    { key: 'qNo', width: 15 },
    { key: 'title', width: 45 },
    { key: 'baseTitle', width: 15 },
    { key: 'baseFilter', width: 35 },
    { key: 'headerTitle', width: 18 },
    { key: 'comment', width: 15 },
    { key: 'remark', width: 15 },
  ];


  // --- Header sheet ---
  //
  // Six fixed rows, one column per banner option:
  //   1 Column No.   (#1, #2, #3...)
  //   2 Header       (Total, Center, Zone...)
  //   3 Description  (All India, Mumbai...)
  //   4 Question No. (Total, RQ1...)
  //   5 Code         (Code 1, Code 2...)
  //   6 Sig letters  (a, b, c...)

  const row1 = headerSheet.getRow(1);
  const row2 = headerSheet.getRow(2);
  const row3 = headerSheet.getRow(3);
  const row4 = headerSheet.getRow(4);
  const row5 = headerSheet.getRow(5);
  const row6 = headerSheet.getRow(6);
  
  // Column A holds the row labels.
  row1.getCell(1).value = 'Column No.';
  row2.getCell(1).value = 'Header';
  row3.getCell(1).value = 'Description';
  row4.getCell(1).value = 'Question No. ';
  row5.getCell(1).value = 'Code';
  row6.getCell(1).value = 'Sig letters';

  // Column B is always the Total column; banner options start at column C.
  row1.getCell(2).value = '#1';
  row2.getCell(2).value = 'Total';
  row3.getCell(2).value = 'Total';
  row4.getCell(2).value = 'Total';
  row5.getCell(2).value = '';
  row6.getCell(2).value = '';

  let colIdx = 3;
  const sigAlphabet = 'abcdefghijklmnopqrstuvwxyz'.split('');
  let sigCharIdx = 0;

  for (const banner of banners) {
    const opts = banner.options;
    if (opts.length === 0) continue;

    const startCol = colIdx;
    const endCol = colIdx + opts.length - 1;

    for (let oIdx = 0; oIdx < opts.length; oIdx++) {
      const opt = opts[oIdx];
      const currentCol = colIdx + oIdx;

      row1.getCell(currentCol).value = `#${currentCol - 1}`;
      row2.getCell(currentCol).value = banner.tableTitle;
      row3.getCell(currentCol).value = opt.text;
      row4.getCell(currentCol).value = banner.id;
      row5.getCell(currentCol).value = `Code ${opt.code}`;

      // Sig letters run continuously across all banners, not per banner.
      const letter = sigAlphabet[sigCharIdx % sigAlphabet.length];
      row6.getCell(currentCol).value = letter.toUpperCase();
      sigCharIdx++;
    }

    // The title and question-no rows span the banner's whole option range.
    if (opts.length > 1) {
      headerSheet.mergeCells(2, startCol, 2, endCol);
      headerSheet.mergeCells(4, startCol, 4, endCol);
    }

    colIdx += opts.length;
  }

  const headerBorder = {
    top: { style: 'thin' as const, color: { argb: 'FFC0C0C0' } },
    bottom: { style: 'thin' as const, color: { argb: 'FFC0C0C0' } },
    left: { style: 'thin' as const, color: { argb: 'FFC0C0C0' } },
    right: { style: 'thin' as const, color: { argb: 'FFC0C0C0' } }
  };

  for (let r = 1; r <= 6; r++) {
    const row = headerSheet.getRow(r);
    row.height = 22;
    
    for (let c = 1; c < colIdx; c++) {
      const cell = row.getCell(c);

      // Labels, column numbers, titles and question numbers are bold.
      const bold = c === 1 || r === 1 || r === 2 || r === 4;
      cell.font = { name: 'Arial', size: 10, bold };

      cell.alignment = c === 1
        ? { horizontal: 'left', vertical: 'middle' }
        : { horizontal: 'center', vertical: 'middle', wrapText: true };

      let fillColor = 'FFFFFFFF';
      if (r === 6) fillColor = 'FFFFFFA0';       // sig letters row
      else if (c === 1) fillColor = 'FFF2F2F2';  // label column
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fillColor } };

      cell.border = headerBorder;
    }
  }

  headerSheet.getColumn(1).width = 15; // labels
  headerSheet.getColumn(2).width = 12; // Total
  for (let c = 3; c < colIdx; c++) {
    headerSheet.getColumn(c).width = 15;
  }

  return Buffer.from(await workbook.xlsx.writeBuffer() as ArrayBuffer);
}
