import * as ExcelJS from 'exceljs';
import * as path from 'path';
import * as fs from 'fs';

async function test() {
  const templateDir = path.resolve(__dirname, '../..');
  const templatePath = path.join(templateDir, 'AP FOR GOLDLINE CONSUMER.xlsx');
  
  if (!fs.existsSync(templatePath)) {
    console.log("Template not found:", templatePath);
    return;
  }
  
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(templatePath);
  
  const tabSpecSheet = workbook.getWorksheet('TabSpec');
  if (tabSpecSheet) {
    console.log("=== Before Unmerge ===");
    console.log("model.merges:", (tabSpecSheet as any).model?.merges);
    console.log("_merges keys:", Object.keys((tabSpecSheet as any)._merges || {}));

    const merges = (tabSpecSheet as any).model?.merges;
    if (Array.isArray(merges)) {
      console.log(`\nUnmerging using actual range strings...`);
      merges.forEach(rangeStr => {
        try {
          tabSpecSheet.unMergeCells(rangeStr);
          console.log(`Called unMergeCells('${rangeStr}')`);
        } catch (e: any) {
          console.log(`Failed to unmerge ${rangeStr}:`, e.message);
        }
      });
    }

    console.log("\n=== After Unmerge ===");
    console.log("model.merges:", (tabSpecSheet as any).model?.merges);
    console.log("_merges keys:", Object.keys((tabSpecSheet as any)._merges || {}));
  }
}

test();
