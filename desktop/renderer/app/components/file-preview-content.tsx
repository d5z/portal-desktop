import { useEffect, useState } from 'react';
import { Markdown } from '../../shared/components/markdown';
import { csvRows } from '../lib/file-preview-data';

function JsonValue({value,label,depth=0}:{value:unknown;label?:string;depth?:number}) {
  if(depth>=12)return <pre>{label}: {JSON.stringify(value)}</pre>;
  if(value!==null && typeof value==='object')return <details open><summary>{label && `${label}: `}{Array.isArray(value)?`数组 (${value.length})`:`对象 (${Object.keys(value).length})`}</summary><div className="file-json-children">{Object.entries(value).slice(0,100).map(([key,v])=><JsonValue key={key} label={key} value={v} depth={depth+1}/>)}{Object.keys(value).length>100 && <p>仅显示前 100 项，请打开原件查看全部。</p>}</div></details>;
  return <div>{label && <strong>{label}: </strong>}<span>{JSON.stringify(value)}</span></div>;
}
export function TextFile({extension,text}:{extension:string;text:string}) {
  if(extension==='md' || extension==='markdown')return <Markdown content={text} intelligentUI={false}/>;
  if(extension==='json'){try{return <div className="file-json"><JsonValue value={JSON.parse(text)}/></div>;}catch{return <><p>JSON 格式不完整，以下显示原文。</p><pre>{text}</pre></>;}}
  if(extension==='csv'){const rows=csvRows(text);return <><table><tbody>{rows.slice(0,200).map((row,i)=><tr key={i}>{row.map((value,j)=>i===0?<th key={j}>{value}</th>:<td key={j}>{value}</td>)}</tr>)}</tbody></table>{rows.length>200 && <p>仅展示前 200 行，请打开原文件查看全部内容。</p>}</>;}
  return <pre>{text}</pre>;
}
export function FileImage({blob,name}:{blob:Blob;name:string}) {
  const [url,setURL]=useState('');
  useEffect(()=>{const next=URL.createObjectURL(blob);setURL(next);return()=>URL.revokeObjectURL(next);},[blob]);
  return <div className="client-file-body">{url && <img src={url} alt={name}/>}</div>;
}
