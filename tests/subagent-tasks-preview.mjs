// Computer-use fixture: production topbar, task subscription and scene filtering.
import { createServer } from 'node:http';
import { build } from '../scripts/renderer-build.mjs';
import { browserAssets } from './support/browser-assets.mjs';

const bundle = await build({ plugins: [browserAssets()], stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
import {createRoot} from 'react-dom/client';
import {useState} from 'react';
import {Topbar} from './desktop/renderer/app/components/topbar';
import {AppModel} from './desktop/renderer/app/models/app';
import './desktop/renderer/app/styles.scss';
const listeners = new Set();
let tasks = [
  {id:'python',sceneId:'a',status:'running',brief:'使用内置 Python 汇总 CSV 数据并写入本机 JSON 文件。',turns:2,createdAt:Date.now()-3000},
  {id:'node',sceneId:'a',status:'queued',brief:'使用内置 Node 读取 JSON，核对中文和统计结果。',createdAt:Date.now()-2000},
  {id:'failure',sceneId:'a',status:'failed',brief:'模型连接测试',turns:1,createdAt:Date.now()-60000},
  {id:'other',sceneId:'b',status:'done',brief:'其他场景的任务',turns:3,createdAt:Date.now()-1000},
];
const snapshot = () => ({endpoint:'fixture-a',tasks});
const app = new AppModel({platform:'darwin',sceneTasks:async()=>snapshot(),onSceneTasks:fn=>{listeners.add(fn);return()=>listeners.delete(fn)}});
app.startup='ready'; app.sbsKnown=true; app.sbsEnabled=false;
app.snapshot={settings:{hasToken:true,endpoint:'fixture-a',being:'Willow'},chatScene:{scene_id:'a'},portal:{phase:'running'},kits:[]};
const emit = () => listeners.forEach(fn=>fn(snapshot()));
function Preview(){const [width,setWidth]=useState(900);const [dark,setDark]=useState(false);return <>
  <nav style={{display:'flex',gap:8,flexWrap:'wrap',padding:16}} aria-label="测试控制">
    <button onClick={()=>{tasks=tasks.map(t=>t.sceneId==='a'?{...t,status:'done',turns:4}:t);emit()}}>全部完成</button>
    <button onClick={()=>{tasks=[];emit()}}>清空任务</button>
    <button onClick={()=>{tasks=Array.from({length:40},(_,i)=>({id:'many-'+i,sceneId:'a',status:i<2?'running':i===2?'timeout':'done',brief:'任务 '+i+'：验证长列表滚动和状态更新',turns:i%5,createdAt:Date.now()-i*1000}));emit()}}>多任务</button>
    <button onClick={()=>{app.snapshot.chatScene.scene_id=app.snapshot.chatScene.scene_id==='a'?'b':'a';app.changed()}}>切换场景</button>
    <button onClick={()=>{app.snapshot.settings.endpoint=app.snapshot.settings.endpoint==='fixture-a'?'fixture-b':'fixture-a';app.changed()}}>切换连接</button>
    <button onClick={()=>setWidth(300)}>300px</button><button onClick={()=>setWidth(480)}>480px</button><button onClick={()=>setWidth(900)}>900px</button>
    <button onClick={()=>{document.documentElement.dataset.theme=dark?'light':'dark';setDark(!dark)}}>切换主题</button>
  </nav>
  <p style={{margin:'0 16px 12px'}}>示例数据 · 测试右上角任务入口；点击消息区域关闭浮层。</p>
  <div className="workspace-stage" style={{width,maxWidth:'calc(100vw - 32px)',margin:16,height:650,flex:'none'}}><div className="workspace-content" style={{height:'100%'}}>
    <section id="chat-view"><Topbar model={app}/><iframe title="测试对话" style={{width:'100%',height:'100%',border:0,paddingTop:100}} srcDoc="<body style='font:15px system-ui;padding:24px'>对话消息区域</body>"/></section>
  </div></div>
</>}
createRoot(document.getElementById('root')).render(<Preview/>);
` }, bundle: true, write: false, outdir: '/fixture', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env.DEV': 'false' } });
const server = createServer((req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  const file = bundle.outputFiles.find(file => file.path.endsWith(pathname));
  res.setHeader('Content-Type', file ? pathname.endsWith('.css') ? 'text/css' : 'text/javascript' : 'text/html;charset=utf-8');
  res.end(file?.contents || '<!doctype html><title>subagent 任务入口验收</title><style>#root{display:block!important;overflow:auto!important}body{overflow:auto!important}</style><link rel="stylesheet" href="/stdin.css"><div id="root"></div><script src="/stdin.js"></script>');
});
server.listen(0, '127.0.0.1', () => console.log('http://127.0.0.1:' + server.address().port));
