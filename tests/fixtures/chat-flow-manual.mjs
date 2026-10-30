// Deterministic protocol fixture for computer-use regression of the shipped chat.
// Run after npm run build:chat. All interactions happen in the rendered UI.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
const scene = 'flow-regression';
const history = [];
let sequence = 0, streamNumber = 0, active, pendingHistory = [], failStop = false;
const row = (role, content, extra = {}) => ({seq:++sequence,role,content,scene_id:scene,at:new Date().toISOString(),...extra});
const event = (type, data = {}) => {
  if (!active || active.finished) return;
  const dataWithScene = {scene_id:scene,...data};
  active.events.push({seq:active.events.length+1,event:type,data:dataWithScene});
  active.response?.write(`event: ${type}\ndata: ${JSON.stringify(dataWithScene)}\n\n`);
};
function persist(from = 'final') {
  if (!active?.text) return;
  const entry = row('assistant', active.text, {from});
  pendingHistory.push(entry);
  event('meta',{persisted:{from,kind:'self',seq:entry.seq,stream_id:active.stream_id}});
  active.text = '';
}
const document = `<!doctype html><meta charset="utf-8"><title>对话流回归测试</title>
<style>body{margin:0;font:14px system-ui;background:#eee}header{padding:8px;display:flex;flex-wrap:wrap;gap:8px}button{padding:6px 10px}iframe{display:block;border:0;width:100%;height:calc(100vh - 130px);margin:auto;background:white}output{display:block;padding:6px 12px;white-space:pre-wrap;font:12px monospace}</style>
<header>
<button data-action="character">追加单字</button><button data-action="short">追加短文本</button><button data-action="long">追加长文本</button>
<button data-action="tool">工具阶段</button><button data-action="finish">结束回复</button>
<button data-action="history">同步历史</button><button data-action="fail-stop">下次停止失败</button>
<button id="task">后台任务</button><button id="narrow">窄屏切换</button>
<button id="reset">重置测量</button><button id="reload">刷新对话</button>
</header><output id="metrics">等待加载</output>
<iframe id="chat" src="/loom.html?scene_id=${scene}&scene_strict=1&scene_label=回归测试&revision=fixture&history_scope=fixture&theme=light"></iframe>
<script>
const frame=document.querySelector('iframe');
const post=data=>frame.contentWindow.postMessage({revision:'fixture',...data},location.origin);
document.querySelectorAll('[data-action]').forEach(button=>button.onclick=async()=>{
 await fetch('/control/'+button.dataset.action,{method:'POST'});
 if(button.dataset.action==='history')post({type:'beings:chat-refresh',id:'refresh-'+Date.now()});
});
document.querySelector('#task').onclick=()=>post({type:'beings:scene-tasks',endpoint:'fixture',subagentReady:true,tasks:[{id:'background',sceneId:'${scene}',createdAt:Date.now(),status:'running'}]});
document.querySelector('#narrow').onclick=()=>frame.style.width=frame.style.width==='435px'?'100%':'435px';
document.querySelector('#reload').onclick=()=>frame.contentWindow.location.reload();
let maxDots=0, reorders=0, overlaps=0, previous=[], errors=[], baseline=null, drift=0, waiting=null, firstTokenShift=null;
document.querySelector('#reset').onclick=()=>{maxDots=0;reorders=0;overlaps=0;previous=[];drift=0;waiting=null;firstTokenShift=null;const d=frame.contentDocument;const box=d.querySelector('#messages');const node=[...d.querySelectorAll('.message')].find(n=>n.getBoundingClientRect().bottom>box.getBoundingClientRect().top+1);baseline=node?{node,top:node.getBoundingClientRect().top}:null;};
frame.onload=()=>{frame.contentWindow.addEventListener('error',e=>errors.push(e.message));};
function sample(){
 const d=frame.contentDocument,box=d?.querySelector('#messages');
 if(box){
  const dots=d.querySelectorAll('.thinking-dots').length;maxDots=Math.max(maxDots,dots);
  const pending=d.querySelector('.thinking-bubble'),user=[...d.querySelectorAll('.message.user')].at(-1);
  if(pending&&user)waiting={user,userTop:user.getBoundingClientRect().top,rect:pending.getBoundingClientRect()};
  else if(waiting){
   const reply=[...d.querySelectorAll('.message.being .content')].at(-1);
   if(reply&&user===waiting.user){const r=reply.getBoundingClientRect();firstTokenShift={userTop:user.getBoundingClientRect().top-waiting.userTop,bubbleTop:r.top-waiting.rect.top,height:r.height-waiting.rect.height,width:r.width-waiting.rect.width};}
   waiting=null;
  }
  const nodes=[...box.children].filter(n=>n.matches('.message,.breath-marker'));
  const common=previous.filter(n=>nodes.includes(n));
  if(common.some((n,i)=>i>0&&nodes.indexOf(common[i-1])>nodes.indexOf(n)))reorders++;
  previous=nodes;
  for(let i=1;i<nodes.length;i++)if(nodes[i].getBoundingClientRect().top<nodes[i-1].getBoundingClientRect().bottom-1)overlaps++;
  if(baseline?.node.isConnected)drift=Math.max(drift,Math.abs(baseline.node.getBoundingClientRect().top-baseline.top));
  document.querySelector('#metrics').textContent=JSON.stringify({dots,maxDots,reorders,overlaps,firstTokenShift,readingDrift:Math.round(drift*10)/10,messages:d.querySelectorAll('.message').length,markers:d.querySelectorAll('.breath-marker').length,bottomGap:Math.round(box.scrollHeight-box.scrollTop-box.clientHeight),errors});
 }
 requestAnimationFrame(sample);
}sample();
</script>`;
const server = createServer(async (req,res) => {
  const url = new URL(req.url,'http://localhost');
  const json = data => {res.setHeader('Content-Type','application/json');res.end(JSON.stringify(data));};
  if (url.pathname === '/') {res.setHeader('Content-Type','text/html; charset=utf-8');return res.end(document);}
  if (url.pathname === '/api/status') return json({being_name:'Flow fixture'});
  if (url.pathname === '/api/llm/config') return json({sbs_enabled:false});
  if (url.pathname === '/health') return res.end('OK fixture');
  if (url.pathname === '/api/history') return json({messages:history.filter(r=>r.seq>Number(url.searchParams.get('after')||0))});
  if (url.pathname === '/api/stream/active') {
    if (!active) {res.writeHead(204);return res.end();}
    return json({stream_id:active.stream_id,scene_id:scene,finished:active.finished,next_seq:active.events.length+1,events:active.events.filter(e=>e.seq>Number(url.searchParams.get('after')||0))});
  }
  if (url.pathname === '/api/chat/stream') {
    let body='';for await(const chunk of req)body+=chunk;
    const message=JSON.parse(body).message;
    if (active&&!active.finished) {
      persist('partial');
      pendingHistory.push(row('system','[breath yielded]',{from:'system',type:'marker'}),row('user',message));
      res.writeHead(202);res.end(JSON.stringify({queued:true}));
      setTimeout(()=>{event('message_stop');event('meta',{continuation:true});event('thinking',{text:'切换到新问题'});},100);
      return;
    }
    history.push(...pendingHistory.splice(0),row('user',message));
    active={stream_id:'fixture-'+ ++streamNumber,events:[],text:'',finished:false,response:res};
    res.writeHead(200,{'Content-Type':'text/event-stream'});
    event('meta',{stream_id:active.stream_id});event('thinking',{text:'等待测试输入'});return;
  }
  if (url.pathname === '/api/stop') {
    for await(const chunk of req){}
    if(failStop){failStop=false;res.writeHead(503);return res.end('fixture failure');}
    if(active&&!active.finished){persist('partial');event('message_stop');active.finished=true;active.response?.end();history.push(...pendingHistory.splice(0));}
    return json({ok:true,stream_id:active?.stream_id});
  }
  if(url.pathname.startsWith('/control/')){
    const action=url.pathname.split('/').at(-1);
    if(action==='history')history.push(...pendingHistory.splice(0));
    if(action==='fail-stop')failStop=true;
    if(action==='tool'){event('tool_use',{call_id:'tool',name:'fixture_read',input:{}});event('tool_result',{call_id:'tool',name:'fixture_read',content:'完成'});}
    if(action==='character'||action==='short'||action==='long'){
      const text=action==='character'?'好':action==='short'?'这是一段流式回复。':Array.from({length:30},(_,i)=>'\n\n'+(i+1)+'. 长回复段落，用于验证打断、滚动锚点和历史同步后的稳定性。').join('');
      if(active&&!active.finished){active.text+=text;event('content_block_delta',{delta:{text}});}
    }
    if(action==='finish'&&active&&!active.finished){persist();event('message_stop');active.finished=true;active.response?.end();history.push(...pendingHistory.splice(0));}
    return json({ok:true});
  }
  if(['/loom.html','/chat.js','/chat.css','/highlight.css'].includes(url.pathname)){
    res.setHeader('Content-Type',url.pathname.endsWith('.js')?'text/javascript':url.pathname.endsWith('.css')?'text/css':'text/html; charset=utf-8');
    return res.end(await readFile('desktop/generated'+url.pathname));
  }
  return json({});
});
server.listen(0,'127.0.0.1',()=>console.log('Computer-use fixture: http://127.0.0.1:'+server.address().port));
