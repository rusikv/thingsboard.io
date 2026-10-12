// Detailed idle trace of /pricing/ for one emulated profile: what runs in each frame.
// Usage: node idletrace.mjs <mobile|desktop> <cpu> [--noanim] [--nosmil] [--touchtap]
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const DIR = '/tmp/claude-1000/-home-thingsboard095-tb-thingsboard-io/3973666f-bba9-429b-a45b-e0ddba54c47a/scratchpad/inp';
const [kind, cpuS] = process.argv.slice(2);
const flags = process.argv.slice(4);
const mobile = kind === 'mobile';
const cpu = Number(cpuS || 4);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const port = 9700 + Math.floor(Math.random() * 90);
const ud = `${DIR}/profile-idle-${Date.now()}`;
const ch = spawn('/usr/bin/google-chrome', ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${ud}`, '--no-first-run', '--enable-gpu', '--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', 'about:blank'], { stdio: 'ignore' });
let list;
for (let i = 0; i < 50; i++) { try { list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); if (list.length) break; } catch {} await sleep(200); }
const ws = new WebSocket(list.find((t) => t.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0; const pend = new Map(); const evs = []; let done;
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } else if (d.method === 'Tracing.dataCollected') evs.push(...d.params.value); else if (d.method === 'Tracing.tracingComplete') done(); else if (d.method === 'Page.loadEventFired') loaded && loaded(); };
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, (d) => r(d.result || d)); ws.send(JSON.stringify({ id: i, method, params })); });
let loaded;
await send('Page.enable');
if (mobile) {
	await send('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Mobile Safari/537.36', platform: 'Android' });
	await send('Emulation.setDeviceMetricsOverride', { width: 412, height: 823, deviceScaleFactor: 1.75, mobile: true });
	await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
} else {
	await send('Emulation.setDeviceMetricsOverride', { width: 1350, height: 940, deviceScaleFactor: 1, mobile: false });
}
await send('Emulation.setCPUThrottlingRate', { rate: cpu });
if (flags.includes('--noanim')) await send('Page.addScriptToEvaluateOnNewDocument', { source: `addEventListener('DOMContentLoaded',()=>{const s=document.createElement('style');s.textContent='html,:root,#chat-launcher,#chat-launcher *{animation:none!important}';document.head.appendChild(s)})` });
if (flags.includes('--nosmil')) await send('Page.addScriptToEvaluateOnNewDocument', { source: `addEventListener('DOMContentLoaded',()=>document.querySelectorAll('svg').forEach(s=>s.pauseAnimations&&!s.ownerSVGElement&&s.pauseAnimations()))` });
const lp = new Promise((r) => (loaded = r));
await send('Page.navigate', { url: 'https://thingsboard.io/pricing/' });
await lp;
await sleep(8000);
const cats = ['devtools.timeline', 'blink', 'blink.debug', 'disabled-by-default-blink.debug', 'disabled-by-default-devtools.timeline', 'toplevel', 'cc', 'input', 'benchmark', 'disabled-by-default-devtools.timeline.invalidationTracking', 'scheduler', 'renderer.scheduler', 'disabled-by-default-renderer.scheduler'];
await send('Tracing.start', { transferMode: 'ReportEvents', traceConfig: { includedCategories: cats } });
await sleep(3000);
if (flags.includes('--touchtap')) {
	// tap empty background point twice for input pipeline view
	const pt = await send('Runtime.evaluate', { expression: `(() => { for (const fx of [0.01,0.02,0.98]) for (const fy of [0.5,0.45,0.55]) { const x = innerWidth*fx, y = innerHeight*fy; const h = document.elementFromPoint(x,y); if (h && !h.closest('a,button,input,label,header,#cc-main,#chat-launcher')) return {x,y}; } return null; })()`, returnByValue: true });
	const p = pt.result.value;
	for (let k = 0; k < 3; k++) {
		if (mobile) { await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: p.x, y: p.y }] }); await sleep(70); await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); }
		else { await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', clickCount: 1 }); await sleep(70); await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', clickCount: 1 }); }
		await sleep(800);
	}
}
const dp = new Promise((r) => (done = r));
await send('Tracing.end');
await dp;
const tag = `${kind}-${cpu}x${flags.join('')}`;
fs.writeFileSync(`${DIR}/idletrace-${tag}.json`, JSON.stringify(evs));
// aggregate: events nested inside UpdateLayoutTree on renderer main
const tn = new Map(); for (const e of evs) if (e.ph === 'M' && e.name === 'thread_name') tn.set(e.pid + ':' + e.tid, e.args.name);
const mains = [...tn.entries()].filter(([, n]) => n === 'CrRendererMain').map(([k]) => k);
let best = null, bn = 0; for (const k of mains) { const n = evs.filter((e) => e.pid + ':' + e.tid === k).length; if (n > bn) { bn = n; best = k; } }
const M = evs.filter((e) => e.pid + ':' + e.tid === best && e.ph === 'X').sort((a, b) => a.ts - b.ts);
const span = (Math.max(...M.map((e) => e.ts + e.dur)) - Math.min(...M.map((e) => e.ts))) / 1e6;
const agg = {};
for (const e of M) { agg[e.name] = agg[e.name] || { n: 0, ms: 0 }; agg[e.name].n++; agg[e.name].ms += e.dur / 1000; }
console.log(`== ${tag}: main-thread aggregates over ${span.toFixed(2)}s (ms/s, count/s)`);
for (const [k, v] of Object.entries(agg).sort((a, b) => b[1].ms - a[1].ms).slice(0, 45)) console.log(`  ${(v.ms / span).toFixed(1).padStart(7)} ms/s ${(v.n / span).toFixed(0).padStart(6)}/s  ${k}`);
const ult = M.filter((e) => e.name === 'UpdateLayoutTree');
console.log('UpdateLayoutTree elementCounts sample:', ult.slice(0, 12).map((e) => e.args && e.args.elementCount));
// first UpdateLayoutTree: list children
const u = ult.sort((a, b) => b.dur - a.dur)[0];
if (u) {
	console.log(`longest UpdateLayoutTree ${(u.dur / 1000).toFixed(2)}ms children:`);
	for (const e of M.filter((e) => e.ts >= u.ts && e.ts + e.dur <= u.ts + u.dur && e !== u && e.dur > 50)) console.log(`   +${((e.ts - u.ts) / 1000).toFixed(2)} ${(e.dur / 1000).toFixed(2)}ms ${e.name} ${e.args && e.args.data ? JSON.stringify(e.args.data).slice(0, 120) : ''}`);
}
const inv = evs.filter((e) => /InvalidationTracking/.test(e.name)).map((e) => { const d = (e.args && e.args.data) || {}; return `${e.name}:${d.reason || ''}:${d.changedPseudo || d.changedClass || d.changedAttribute || ''}:${(d.nodeName || '').slice(0, 60)}`; });
const ic = {}; for (const x of inv) ic[x] = (ic[x] || 0) + 1;
console.log('invalidation reasons:'); for (const [k, v] of Object.entries(ic).sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log(`   ${v}x ${k}`);
if (flags.includes('--touchtap')) {
	const ed = M.filter((e) => e.name === 'EventDispatch');
	console.log('EventDispatch:', ed.map((e) => `${e.args.data.type}@${((e.ts - M[0].ts) / 1000).toFixed(0)}`).join(' '));
	const inp = evs.filter((e) => /InputLatency|EventLatency|HandleInputEvent|WidgetBaseInputHandler::HandleInputEvent|InputHandlerProxy|MainThreadEventQueue/.test(e.name) && e.ph === 'X');
	const ia = {}; for (const e of inp) { ia[e.name] = ia[e.name] || []; ia[e.name].push((e.dur / 1000).toFixed(1)); }
	for (const [k, v] of Object.entries(ia)) console.log('  ', k, v.slice(0, 12).join(','));
}
ws.close(); ch.kill('SIGKILL'); await sleep(800); try { fs.rmSync(ud, { recursive: true, force: true }); } catch {}
process.exit(0);
