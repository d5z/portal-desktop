// Local-only visual fixture. No real connection, configuration writes or tool execution.
import { build } from 'esbuild';
import { createServer } from 'node:http';
const bundle = await build({ stdin: { resolveDir:process.cwd(), loader:'tsx', contents:`
import {createRoot} from 'react-dom/client';
import {useState} from 'react';
import {PermissionSettings,ToolApprovalDialog} from './desktop/renderer/app/components/permissions';
import {AppModel} from './desktop/renderer/app/models/app';
import {useModel} from './desktop/renderer/shared/hooks/use-model';
import './desktop/renderer/app/styles.css';
let listener; let answer='';
const api={platform:'win32',save:async settings=>({...app.snapshot,settings}),onToolApproval:fn=>{listener=fn;return()=>{}},toolApprovalPending:async()=>null,answerToolApproval:async(id,allow)=>{answer=allow?(app.snapshot.settings.permissionMode==='auto-review'?'已允许并记住':'已允许这一次'):'已拒绝';listener(null);document.getElementById('outcome').textContent=answer;}};
const app=new AppModel(api); app.snapshot={settings:{permissionMode:'auto-review',hasToken:true,being:'Willow',endpoint:'https://fixture.test'},portal:{phase:'stopped',logs:[]}};app.openPermissionSettings();
function Fixture(){useModel(app);const [dark,setDark]=useState(false);return <><main style={{padding:48}}><h1>工作权限</h1><p>本地界面预览 · 不执行真实操作</p><button onClick={()=>app.openPermissionSettings()}>快捷权限设置</button><button onClick={()=>listener({id:'fixture',title:'工具操作审批',message:app.snapshot.settings.permissionMode==='auto-review'?'允许 portal_exec 执行并记住此授权？':'允许 portal_exec 执行这一次操作？',rememberScope:app.snapshot.settings.permissionMode==='auto-review'?'同一 Being、同一工作区内，相同命令及执行参数的操作将不再询问；重启后仍有效。':undefined,detail:'Windows 沙箱 · 仅授权工作区 · 禁止网络\\n\\n'+JSON.stringify({tool:'portal_exec',arguments:{command:'npm test',workdir:'D:\\\\projects\\\\town'},scene:'代码审查 · 子代理'},null,2),expiresAt:Date.now()+120000})}>触发审批</button><button onClick={()=>{document.documentElement.dataset.theme=dark?'light':'dark';setDark(!dark)}}>切换主题</button><p id="outcome"/></main><PermissionSettings app={app}/><ToolApprovalDialog app={app}/></>};createRoot(document.getElementById('root')).render(<Fixture/>);
` }, bundle:true, write:false, outdir:'/fixture', jsx:'automatic', define:{'process.env.NODE_ENV':'"production"'} });
const server=createServer((req,res)=>{const js=req.url==='/app.js',css=req.url==='/app.css';res.setHeader('content-type',js?'text/javascript':css?'text/css':'text/html; charset=utf-8');res.end(js||css?bundle.outputFiles.find(f=>f.path.endsWith(js?'.js':'.css')).contents:'<!doctype html><html lang="zh-CN"><meta charset="utf-8"><link rel="stylesheet" href="/app.css"><div id="root"></div><script src="/app.js"></script></html>');});
server.listen(0,'127.0.0.1',()=>console.log(`Permissions preview: http://127.0.0.1:${server.address().port}`));
