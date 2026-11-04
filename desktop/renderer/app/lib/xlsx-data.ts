import ExcelJS from 'exceljs';
import {unzipSync,zipSync,strFromU8,strToU8} from 'fflate';
export type SheetPreview={name:string;rows:{text:string;formula?:string}[][];widths:number[];truncated:boolean};

function display(value:ExcelJS.CellValue):string {
  if(value===null||value===undefined)return '';
  if(typeof value==='boolean')return value?'TRUE':'FALSE';
  if(value instanceof Date)return value.toISOString().replace(/T00:00:00.000Z$/,'').replace('T',' ').replace('.000Z','');
  if(typeof value==='object'){
    if('result' in value)return display(value.result);
    if('richText' in value)return value.richText.map(run=>run.text).join('');
    if('text' in value)return value.text;
    if('error' in value)return value.error;
    return '';
  }
  return String(value);
}
export async function readWorkbook(data:ArrayBuffer):Promise<SheetPreview[]> {
  // Inspect the ZIP directory before ExcelJS inflates any entries.
  let total=0,count=0;
  unzipSync(new Uint8Array(data),{filter:file=>{total+=file.originalSize;if(total>64*1024*1024||++count>10000)throw new Error('工作簿过大，请使用系统应用打开');return false;}});
  // ExcelJS expects unprefixed SpreadsheetML tags. Some valid writers (including
  // ElementTree) emit a prefixed root; normalize those parts in memory only.
  const entries=unzipSync(new Uint8Array(data));let changed=false;
  for(const [name,bytes] of Object.entries(entries)){
    if(!name.startsWith('xl/')||!name.endsWith('.xml'))continue;
    let xml=strFromU8(bytes);
    const root=xml.match(/<(?![?!])([A-Za-z_][\w.-]*):[\w.-]+\b[^>]*>/)?.[0];
    const prefix=root?.match(/^<([A-Za-z_][\w.-]*):/)?.[1];
    if(!prefix||!root?.includes(`xmlns:${prefix}="http://schemas.openxmlformats.org/spreadsheetml/2006/main"`))continue;
    const escaped=prefix.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    xml=xml.replace(new RegExp(`(<\\/?)(?:${escaped}):`,'g'),'$1').replace(`xmlns:${prefix}=`, 'xmlns=');
    entries[name]=strToU8(xml);changed=true;
  }
  const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(changed?zipSync(entries,{level:0}).buffer as ArrayBuffer:data);
  let budget=200000;
  if(workbook.worksheets.length>100)throw new Error('工作表数量过多，请使用系统应用打开');
  return workbook.worksheets.filter(sheet=>sheet.state==='visible').map(sheet=>{
    const columns=Math.min(100,Math.max(1,sheet.columnCount));
    const rowCount=Math.min(500,Math.max(1,sheet.rowCount),Math.floor(budget/columns));budget-=rowCount*columns;
    const rows=Array.from({length:rowCount},(_,r)=>Array.from({length:columns},(_,c)=>{
      const cell=sheet.getCell(r+1,c+1),formula=cell.type===ExcelJS.ValueType.Formula?cell.formula:undefined;
      return {text:display(cell.value),formula};
    }));
    return {name:sheet.name,rows,widths:Array.from({length:columns},(_,c)=>Math.min(360,Math.max(80,(sheet.getColumn(c+1).width||16)*7))),truncated:rowCount<sheet.rowCount||columns<sheet.columnCount};
  });
}
