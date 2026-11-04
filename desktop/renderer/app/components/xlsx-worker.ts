import {readWorkbook} from '../lib/xlsx-data';
self.onmessage=async(event:MessageEvent<ArrayBuffer>)=>{
  try{self.postMessage({sheets:await readWorkbook(event.data)});}catch(error){self.postMessage({error:error instanceof Error&&error.message.startsWith('工作')?error.message:'工作簿无法读取，文件可能损坏或加密，请使用系统应用打开'});}
};
