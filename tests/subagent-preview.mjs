// Computer-use preview of production components and real native-test task records.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {build} from '../scripts/renderer-build.mjs';
import {browserAssets} from './support/browser-assets.mjs';
const bundle=await build({plugins:[browserAssets()],stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`
import {createRoot} from 'react-dom/client';
import {useEffect,useState} from 'react';
import {Store} from './desktop/renderer/shared/models/store';
import {SubagentModelSettings} from './desktop/renderer/app/components/subagent-model-settings';
import {SceneScheduling} from './desktop/renderer/chat/components/scheduling';
import './desktop/renderer/app/styles.scss';
import './desktop/renderer/chat/styles.scss';
const app=Object.assign(new Store(),{snapshot:{settings:{hasToken:true}},api:{beingModelConfig:async patch=>patch?{ok:true,config:{provider:'self-hosted',model:'fixture-model',thinking:patch.thinking||'medium'}}:{provider:'self-hosted',model:'fixture-model',thinking:'medium',presets:[]},beingModelCatalog:async({kind})=>({status:200,data:kind==='routes'?{routes:[{id:'self-hosted',name:'自部署模型',keyless_in_loom:true}]}:{models:[{id:'fixture-model',name:'fixture-model',tool_call:true}]}})},closeSubagentSettings(){}});
function Preview(){const [view,setView]=useState('tasks');const [report,setReport]=useState(null);useEffect(()=>{fetch('/results').then(r=>r.json()).then(setReport)},[]);return <main style={{maxWidth:1000,margin:'24px auto',padding:24}}><h1>subagent 验收</h1><p>真实 Portal / Pi 执行，本地模型响应夹具；自部署远端认证仍未通过。</p><nav><button onClick={()=>setView('tasks')}>执行任务</button><button onClick={()=>setView('model')}>模型设置</button></nav>{view==='model'?<SubagentModelSettings app={app} embedded/>:<><p role="status">{report?'执行测试：'+report.status:'加载测试记录…'}</p><details open><summary>执行过程与子任务</summary><SceneScheduling hint="" tasks={(report?.ledger||[]).map((t,i)=>({id:t.task_id,sceneId:t.scene_id,status:t.status,brief:t.brief_head,turns:t.turns,createdAt:Date.now()-100000+i}))}/></details><details><summary>验证场景明细</summary><pre>{JSON.stringify(report?.cases,null,2)}</pre></details></>}</main>}

const originalFetch = window.fetch.bind(window);
window.fetch = async (target, init = {}) => {
 const url = new URL(String(target), location.href);
 if (url.protocol !== 'beings:' || url.hostname !== 'chat') return originalFetch(target, init);
 const kind = url.pathname.split('/').pop();
 if (kind === 'config') {
   const data = await app.api.beingModelConfig(init.body ? JSON.parse(init.body) : undefined);
   return Response.json(data, {status:data.ok === false ? data.http_status || 400 : 200});
 }
 const input = kind === 'keys' ? JSON.parse(init.body) : {route:url.searchParams.get('route')};
 const result = app.api.beingModelCatalog ? await app.api.beingModelCatalog({...input, kind}) : {status:200,data:kind==='routes'?{routes:[]}:{models:[]}};
 return Response.json(result.data, {status:result.status});
};
createRoot(document.getElementById('root')).render(<Preview/>);
`},bundle:true,write:false,outdir:'/fixture',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"','import.meta.env.DEV':'false'}});
const server=createServer(async(req,res)=>{const url=new URL(req.url,'http://localhost');if(url.pathname==='/results'){res.setHeader('Content-Type','application/json');res.end(await readFile('test-results/subagent/native-results.json'));return;}const output=bundle.outputFiles.find(f=>f.path.endsWith(url.pathname));if(output){res.setHeader('Content-Type',url.pathname.endsWith('.css')?'text/css':'text/javascript');res.end(output.contents);return;}res.setHeader('Content-Type','text/html;charset=utf-8');res.end('<title>subagent 验收</title><link rel="stylesheet" href="/stdin.css"><div id="root"></div><script src="/stdin.js"></script>');});
server.listen(0,'127.0.0.1',()=>console.log(`http://127.0.0.1:${server.address().port}`));
