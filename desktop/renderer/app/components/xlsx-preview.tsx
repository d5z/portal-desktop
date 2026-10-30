import {useEffect,useState,useId} from 'react';
import {navigateTabs} from '../../shared/components/tab-navigation';
import type {SheetPreview} from './xlsx-data';
// Keep the workbook parser in a worker; importing types must not load it in the shell.
function columnName(index:number){let name='';for(let n=index+1;n>0;n=Math.floor((n-1)/26))name=String.fromCharCode(65+(n-1)%26)+name;return name;}
export function XlsxPreview({blob}:{blob:Blob}) {
  const panelId = useId();
  const [sheets,setSheets]=useState<SheetPreview[]>([]),[active,setActive]=useState(0),[error,setError]=useState(''),[selected,setSelected]=useState<{row:number;column:number}|null>(null);
  useEffect(()=>{
    setSheets([]);setActive(0);setSelected(null);setError('');
    const worker=new Worker(new URL('./xlsx-worker.ts',import.meta.url),{type:'module'});let disposed=false;
    const fail=(message:string)=>{if(!disposed)setError(message);worker.terminate();};
    const timer=setTimeout(()=>fail('工作簿读取超时，请使用系统应用打开'),30000);
    worker.onmessage=e=>{if(disposed)return;clearTimeout(timer);if(e.data.error)fail(e.data.error);else{setSheets(e.data.sheets);if(!e.data.sheets.length)setError('没有可显示的工作表');worker.terminate();}};
    worker.onerror=()=>{clearTimeout(timer);fail('工作簿无法预览，请使用系统应用打开');};
    void blob.arrayBuffer().then(data=>{if(!disposed)worker.postMessage(data,[data]);}).catch(()=>fail('无法读取工作簿'));
    return()=>{disposed=true;clearTimeout(timer);worker.terminate();};
  },[blob]);
  const sheet=sheets[active],cell=selected&&sheet?.rows[selected.row]?.[selected.column];
  return <div className="xlsx-preview">{error?<p role="alert">{error}</p>:!sheet?<p role="status">正在读取工作簿…</p>:<>
    {selected&&cell&&<div className="xlsx-cell-value"><strong>{columnName(selected.column)}{selected.row+1}</strong><span>{cell.formula?`=${cell.formula} · `:''}{cell.text}</span></div>}
    <div className="xlsx-grid" key={active} role="tabpanel" id={`${panelId}-panel`} aria-labelledby={`${panelId}-tab-${active}`} tabIndex={0}><table aria-label={sheet.name}><colgroup><col style={{width:42}}/>{sheet.widths.map((width,i)=><col key={i} style={{width}}/>)}</colgroup><thead><tr><th aria-label="行号"/>{sheet.widths.map((_,i)=><th scope="col" key={i}>{columnName(i)}</th>)}</tr></thead><tbody>{sheet.rows.map((row,r)=><tr key={r}><th scope="row">{r+1}</th>{row.map((value,c)=><td key={c}><button title={value.text} aria-label={`${columnName(c)}${r+1}: ${value.text}`} onClick={()=>setSelected({row:r,column:c})}>{value.text}</button></td>)}</tr>)}</tbody></table></div>
    {sheet.truncated&&<p className="xlsx-limit">仅预览部分行列，完整内容请打开原文件。</p>}
    <nav className="xlsx-tabs" role="tablist" aria-label="工作表" onKeyDown={navigateTabs}>{sheets.map((s,i)=><button role="tab" id={`${panelId}-tab-${i}`} aria-controls={`${panelId}-panel`} tabIndex={i===active?0:-1} aria-selected={i===active} key={i} onClick={()=>{setActive(i);setSelected(null);}}>{s.name}</button>)}</nav>
  </>}</div>;
}
