/** RFC 4180 quoted cells, including embedded newlines and escaped quotes. */
export function csvRows(text:string):string[][] {
  const rows:string[][]=[];let row:string[]=[],value='',quoted=false;
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(c==='"'){if(quoted&&text[i+1]==='"'){value+='"';i++;}else quoted=!quoted;}
    else if(c===','&&!quoted){row.push(value);value='';}
    else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&text[i+1]==='\n')i++;row.push(value);rows.push(row);row=[];value='';}
    else value+=c;
  }
  if(value || row.length){row.push(value);rows.push(row);}
  return rows;
}
export function validFilePreview(data:any) {
  if(!data || typeof data.id!=='string' || !/^[a-zA-Z0-9_-]{1,160}$/.test(data.id) || typeof data.name!=='string' || data.name.length>512)return false;
  if(data.extension==='pdf')return data.blob instanceof Blob && data.blob.type==='application/pdf' && data.blob.size<=128*1024*1024;
  if(['txt','md','csv','json'].includes(data.extension))return typeof data.text==='string' && data.text.length<=2*1024*1024;
  if(data.extension==='pptx')return data.blob instanceof Blob && data.blob.type==='application/vnd.openxmlformats-officedocument.presentationml.presentation' && data.blob.size<=128*1024*1024;
  if(data.extension==='xlsx')return data.blob instanceof Blob && data.blob.type==='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' && data.blob.size<=128*1024*1024;
  if(data.extension==='docx')return Array.isArray(data.segments) && data.segments.length<=20000 && data.segments.every((s:any)=>typeof s.text==='string' && typeof s.label==='string') && data.segments.reduce((n:number,s:any)=>n+s.text.length+s.label.length,0)<=8_100_000;
  return false;
}
