import {describe,it,expect} from 'vitest';
import {unzipSync,zipSync,strFromU8,strToU8} from 'fflate';
import ExcelJS from 'exceljs';
import {readWorkbook} from '../desktop/renderer/app/lib/xlsx-data';
describe('spreadsheet original-file preview',()=>{
  it('keeps sheets, positions, zero, false, formulas and rich text',async()=>{
    const book=new ExcelJS.Workbook(),first=book.addWorksheet('First');
    first.getCell('A1').value=0;first.getCell('B1').value=false;
    first.getCell('C1').value={formula:'40+2',result:42};first.getCell('E2').value={richText:[{text:'多模态'},{text:'验收'}]};
    book.addWorksheet('Second').getCell('A1').value='不要取消';
    const buffer=await book.xlsx.writeBuffer();const result=await readWorkbook(buffer as unknown as ArrayBuffer);
    expect(result.map(s=>s.name)).toEqual(['First','Second']);
    expect(result[0].rows[0].map(c=>c.text)).toEqual(['0','FALSE','42','','']);
    expect(result[0].rows[0][2].formula).toBe('40+2');
    expect(result[0].rows[1][4].text).toBe('多模态验收');
    expect(result[1].rows[0][0].text).toBe('不要取消');
  });
  it('accepts valid prefixed SpreadsheetML produced by other writers',async()=>{
    const book=new ExcelJS.Workbook();book.addWorksheet('First').getCell('A1').value=0;
    const entries=unzipSync(new Uint8Array(await book.xlsx.writeBuffer() as unknown as ArrayBuffer));
    const name='xl/worksheets/sheet1.xml';
    entries[name]=strToU8(strFromU8(entries[name]).replace(/<(\/?)([A-Za-z][\w]*)/g,'<$1ns0:$2').replace('xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"','xmlns:ns0="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'));
    const bytes=zipSync(entries);const result=await readWorkbook(bytes.buffer as ArrayBuffer);
    expect(result[0].rows[0][0].text).toBe('0');
  });
  it('reports bounded previews rather than silently dropping later rows',async()=>{
    const book=new ExcelJS.Workbook();book.addWorksheet('Large').getCell('A501').value='last';
    const result=await readWorkbook(await book.xlsx.writeBuffer() as unknown as ArrayBuffer);
    expect(result[0].rows).toHaveLength(500);expect(result[0].truncated).toBe(true);
  });
});
