// In-page micro-benchmark of the leaked-observer callback cost per billing-like mutation (2 textContent writes),
// with and without a URL change, at N observers. 3P blocked, vendor not loaded.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const DIR = '/tmp/claude-1000/-home-thingsboard095-tb-thingsboard-io/3973666f-bba9-429b-a45b-e0ddba54c47a/scratchpad/inp/verify-C3';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class CDP { constructor(u){this.ws=new WebSocket(u);this.id=0;this.p=new Map();this.h=new Map();} open(){return new Promise((res,rej)=>{this.ws.onopen=res;this.ws.onerror=rej;this.ws.onmessage=(m)=>{const d=JSON.parse(m.data);if(d.id&&this.p.has(d.id)){const{res,rej}=this.p.get(d.id);this.p.delete(d.id);d.error?rej(new Error(JSON.stringify(d.error))):res(d.result);}else if(d.method)(this.h.get(d.method)||[]).forEach(f=>f(d.params));};});} on(m,f){if(!this.h.has(m))this.h.set(m,[]);this.h.get(m).push(f);} send(method,params={}){const id=++this.id;this.ws.send(JSON.stringify({id,method,params}));return new Promise((res,rej)=>this.p.set(id,{res,rej}));} }
const port = 9960 + Math.floor(Math.random() * 30), ud = `${DIR}/prof-micro-${Date.now()}`;
const chrome = spawn('/usr/bin/google-chrome', ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${ud}`, '--no-first-run', '--disable-extensions', 'about:blank'], { stdio: 'ignore' });
let ver; for (let i = 0; i < 50 && !ver; i++) { try { ver = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); } catch { await sleep(200); } }
const pg = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === 'page');
const c = new CDP(pg.webSocketDebuggerUrl); await c.open();
process.on('exit', () => { try { chrome.kill('SIGKILL'); } catch {} try { fs.rmSync(ud, { recursive: true, force: true }); } catch {} });
const ev = async (e, a = true) => { const r = await c.send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: a }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 300)); return r.result.value; };
await c.send('Page.enable'); await c.send('Network.enable');
await c.send('Network.setBlockedURLs', { urls: ['*yourgpt*', '*googletagmanager*', '*google-analytics*', '*doubleclick*', '*youtube*', '*api.github.com*', '*cloudflareinsights*'] });
const loaded = new Promise((r) => c.on('Page.loadEventFired', r));
await c.send('Page.navigate', { url: 'https://thingsboard.io/pricing/' }); await loaded; await sleep(4000);
for (const cpu of [1, 4]) {
  await c.send('Emulation.setCPUThrottlingRate', { rate: cpu });
  const r = await ev(`(async () => {
    const obs = []; let uCalls = 0;
    const add = (n) => { for (let i = 0; i < n; i++) { let $ = ''; const S = new MutationObserver(function () { location.href !== $ && ($ = location.href, uCalls++); }); S.observe(document, { subtree: true, childList: true }); obs.push(S); } };
    const a = document.querySelector('[data-billing-subtitle]') || document.querySelector('h1'), b = document.querySelector('[data-billing-heading]') || document.querySelector('h2');
    const base = location.pathname + location.search;
    const out = {};
    const bench = async (changeUrl, reps = 40) => {
      const ts = [];
      for (let i = 0; i < reps; i++) {
        await new Promise((r) => setTimeout(r, 5));
        const t0 = performance.now();
        if (changeUrl) history.replaceState(null, '', base.split('?')[0] + '?product=thingsboard-pe&x=' + (i % 2));
        a.textContent = a.textContent; b.textContent = b.textContent;
        await Promise.resolve();
        ts.push(performance.now() - t0);
      }
      ts.sort((x, y) => x - y); return +ts[Math.floor(ts.length / 2)].toFixed(3);
    };
    for (const N of [0, 60, 300, 900, 1800]) { add(N - obs.length); await bench(false, 6); out[N] = { sameUrl: await bench(false), urlChanged: await bench(true) }; }
    history.replaceState(null, '', base); obs.forEach((o) => o.disconnect());
    return out;
  })()`);
  console.log('cpu', cpu, JSON.stringify(r));
}
process.exit(0);
