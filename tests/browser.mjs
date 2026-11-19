import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import assert from 'node:assert/strict';
const root = process.cwd();
const output = path.join(root, '.qa');
await fs.mkdir(output, { recursive: true });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const allowed = new Set(['index.html','styles.css','light.css','chat.css','app.js','core.js','web-api.js','web-ui.js','web.css']);
const requests = [];
const server = http.createServer(async (req, res) => {
  requests.push(req.url);
  const pathname = new URL(req.url, 'http://localhost').pathname;
  const name = pathname.replace(/^\/chisheng-live-web\//, '') || 'index.html';
  if (!allowed.has(name)) { res.writeHead(404); res.end(); return; }
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
  res.writeHead(200, { 'Content-Type': types[path.extname(name)] });
  res.end(await fs.readFile(path.join(root, name)));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const website = process.argv[2] || `http://127.0.0.1:${server.address().port}/chisheng-live-web/`;
const temporary = net.createServer();
await new Promise(resolve => temporary.listen(0, '127.0.0.1', resolve));
const debugPort = temporary.address().port;
await new Promise(resolve => temporary.close(resolve));
const edge = spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', [
  '--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check',
  `--remote-debugging-port=${debugPort}`, `--user-data-dir=${path.join(output, 'edge-' + Date.now())}`, 'about:blank'
], { windowsHide: true, stdio: 'ignore' });
const sockets = [];
const network = [];
async function ready(url) {
  for (let i=0;i<100;i++) { try { const r=await fetch(url); if(r.ok) return r; } catch {} await pause(150); }
  throw new Error('Not ready: ' + url);
}
async function cdp(url) {
  const socket = new WebSocket(url); sockets.push(socket);
  await new Promise((resolve,reject) => { socket.onopen=resolve; socket.onerror=reject; });
  let seq=0; const pending=new Map();
  socket.onmessage=event=>{
    const m=JSON.parse(event.data);
    if(m.method==='Network.requestWillBeSent') network.push(m.params.request.url);
    if(m.id && pending.has(m.id)) { const p=pending.get(m.id); pending.delete(m.id); m.error?p.reject(new Error(m.error.message)):p.resolve(m.result); }
  };
  return (method,params={})=>new Promise((resolve,reject)=>{const id=++seq; pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));});
}
async function evaluate(send,expression){
  const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true,userGesture:true});
  if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);
  return r.result.value;
}
async function waitFor(send,expression){
  for(let i=0;i<80;i++){if(await evaluate(send,expression))return;await pause(150);}
  const info=await evaluate(send,"({title:document.title,pill:document.getElementById('serverPill')?.textContent,errors:document.getElementById('jsErrorLog')?.textContent,body:document.body.innerText.slice(0,250)})");
  throw new Error('Timed out: '+expression+' '+JSON.stringify(info));
}
try {
  const version=await (await ready(`http://127.0.0.1:${debugPort}/json/version`)).json();
  const browser=await cdp(version.webSocketDebuggerUrl);
  const {browserContextId}=await browser('Target.createBrowserContext');
  const {targetId}=await browser('Target.createTarget',{url:'about:blank',browserContextId});
  const targets=await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
  const page=await cdp(targets.find(t=>t.id===targetId).webSocketDebuggerUrl);
  await page('Network.enable');
  await page('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  await page('Page.navigate',{url:website});
  await waitFor(page,"document.getElementById('serverPill')?.textContent.includes('网页版已就绪')");
  assert.equal(await evaluate(page,"getComputedStyle(document.getElementById('exitBtn')).display"),'none');
  const text='M8 网页版保存测试。欢迎了解车型。配置以实车为准。';
  await evaluate(page,`document.getElementById('navScriptStudio').click();document.querySelector('#modelGroups [data-model="m8"]').click();document.getElementById('scriptInput').value=${JSON.stringify(text)};document.getElementById('scriptInput').dispatchEvent(new Event('input',{bubbles:true}));`);
  await pause(1300);
  const block={words:['测试禁词'],replacements:[{from:'绝对',to:'尽量'}],updatedAt:Date.now()};
  await evaluate(page,`ChishengWeb.fetch('/api/blocklist',{method:'POST',body:JSON.stringify(${JSON.stringify(block)})})`);
  await evaluate(page,"ChishengWeb.fetch('/api/music/upload?name=test.wav',{method:'POST',body:new Blob([new Uint8Array(44)],{type:'audio/wav'})}).then(r=>r.json())");
  await page('Page.reload');
  await waitFor(page,`document.getElementById('scriptInput')?.value===${JSON.stringify(text)}`);
  assert.equal(await evaluate(page,"JSON.parse(localStorage.getItem(ChishengWeb.blockKey)).words[0]"),'测试禁词');
  const music=await evaluate(page,"ChishengWeb.fetch('/api/music/list').then(r=>r.json()).then(d=>({count:d.tracks.length,url:d.tracks[0].url,name:d.tracks[0].name}))");
  assert.equal(music.count,1); assert.match(music.url,/^blob:/);
  await evaluate(page,"document.getElementById('navScript').click();document.getElementById('multiAllBtn').click();document.getElementById('buildPlaylistBtn').click();");
  const queue=await evaluate(page,"document.getElementById('queueCount').textContent");assert.match(queue,/[1-9]/);
  await evaluate(page,"window.__backup=null;HTMLAnchorElement.prototype.click=function(){fetch(this.href).then(r=>r.json()).then(d=>window.__backup=d)};document.getElementById('exportWebBackup').click()");
  await waitFor(page,"window.__backup?.format==='chisheng-web-backup'");
  assert.equal(await evaluate(page,"window.__backup.state.scripts.m8"),text);
  const restored='从备份恢复后的测试讲稿。';
  await evaluate(page,`window.confirm=()=>true;window.__backup.state.scripts.m8=${JSON.stringify(restored)};const dt=new DataTransfer();dt.items.add(new File([JSON.stringify(window.__backup)],'backup.json',{type:'application/json'}));const input=document.getElementById('webBackupFile');input.files=dt.files;input.dispatchEvent(new Event('change'));`);
  await waitFor(page,`document.getElementById('scriptInput')?.value===${JSON.stringify(restored)}`);
  await evaluate(page,"document.getElementById('navChat').click()");
  assert.match(await evaluate(page,"document.getElementById('chatView').textContent"),/直播互动需要完整版/);
  await evaluate(page,"document.getElementById('navScript').click();window.scrollTo(0,0)");
  await pause(250);
  assert.equal(await evaluate(page,"document.getElementById('jsErrorLog')?.textContent||''"),'');
  assert.equal(network.filter(url=>new URL(url).pathname.startsWith('/api/')).length,0);
  const shot=await page('Page.captureScreenshot',{format:'png'});
  await fs.writeFile(path.join(output,'web-preview.png'),Buffer.from(shot.data,'base64'));
  await page('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await pause(200);
  const mobile=await page('Page.captureScreenshot',{format:'png'});
  await fs.writeFile(path.join(output,'web-mobile.png'),Buffer.from(mobile.data,'base64'));
  console.log(JSON.stringify({website,scriptPersists:true,musicPersists:true,backupRoundTrip:true,queue,backendRequests:0,browserErrors:0}));
  await browser('Browser.close').catch(()=>{});
} finally {
  sockets.forEach(socket=>socket.close());edge.kill();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
}
