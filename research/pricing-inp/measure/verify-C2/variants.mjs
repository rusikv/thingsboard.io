// In-session interleaved A/B (one Chrome, conditions toggled live) to cancel drift from other load on the box.
// Usage: node ab2.mjs <desktop|mobile> [rounds]
// conds: all (prod now) | smilonly (chat-hue off ~ field period) | chatonly (SMIL paused) | none | fix (SMIL -> WAAPI transform layers, chat off)
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const OUT = '/home/ruru/projects/thingsboard.io-research/research/pricing-inp/measure/verify-C2';
const [kind, roundsS] = process.argv.slice(2);
const ROUNDS = Number(roundsS || 5);
const mobile = kind === 'mobile';
const P = mobile ? { w: 412, h: 823, dpr: 1.75, cpu: 4 } : { w: 1350, h: 940, dpr: 1, cpu: 1 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const port = 9300 + Math.floor(Math.random() * 150);
const ud = `${OUT}/prof2-${Date.now()}`;
const ch = spawn('/usr/bin/google-chrome', ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${ud}`, '--no-first-run', '--enable-gpu', '--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', 'about:blank'], { stdio: 'ignore' });
let list;
for (let i = 0; i < 60; i++) { try { list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); if (list.find((t) => t.type === 'page')) break; } catch {} await sleep(200); }
const ws = new WebSocket(list.find((t) => t.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0; const pend = new Map(); let evs = []; let tdone; let loaded;
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } else if (d.method === 'Tracing.dataCollected') evs.push(...d.params.value); else if (d.method === 'Tracing.tracingComplete') tdone && tdone(); else if (d.method === 'Page.loadEventFired') loaded && loaded(); };
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, (d) => r(d.result || d)); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr, awaitP = false) => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: awaitP }); if (r.exceptionDetails) console.error('EVAL ERR', JSON.stringify(r.exceptionDetails).slice(0, 400)); return r.result && r.result.value; };

await send('Page.enable');
if (mobile) {
	await send('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Mobile Safari/537.36', platform: 'Android' });
	await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
}
await send('Emulation.setDeviceMetricsOverride', { width: P.w, height: P.h, deviceScaleFactor: P.dpr, mobile });
await send('Emulation.setCPUThrottlingRate', { rate: P.cpu });
await send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__et = []; new PerformanceObserver((l) => { for (const e of l.getEntries()) if (e.interactionId) __et.push({ id: e.interactionId, name: e.name, start: e.startTime, dur: e.duration, ps: e.processingStart, pe: e.processingEnd }); }).observe({ type: 'event', durationThreshold: 16, buffered: true });` });
const lp = new Promise((r) => (loaded = r));
await send('Page.navigate', { url: (process.env.TB_ORIGIN || 'https://thingsboard.io') + '/pricing/' });
await lp;
await sleep(mobile ? 7000 : 5000);


await ev(`(() => { const s = document.createElement('style'); s.textContent = '#chat-launcher{animation:none!important}'; document.head.appendChild(s);
	const svg = document.querySelector('.pricing-bg .pricing-bg-svg');
	window.__v = (c) => {
		svg.style.maskImage = c.includes('nomask') ? 'none' : ''; svg.style.webkitMaskImage = c.includes('nomask') ? 'none' : '';
		svg.style.transform = c.includes('no3d') ? 'rotate(-28deg)' : '';
		if (c === 'paused') svg.pauseAnimations(); else svg.unpauseAnimations();
		return c; };
})()`);
async function idle() {
	evs = [];
	await send('Tracing.start', { transferMode: 'ReportEvents', traceConfig: { includedCategories: ['toplevel', 'devtools.timeline'] } });
	await sleep(2500);
	const tp = new Promise((r) => (tdone = r));
	await send('Tracing.end');
	await tp;
	const tn = new Map(), pn = new Map();
	for (const e of evs) { if (e.ph === 'M' && e.name === 'thread_name') tn.set(e.pid + ':' + e.tid, e.args.name); if (e.ph === 'M' && e.name === 'process_name') pn.set(e.pid, e.args.name); }
	const xs = evs.filter((e) => e.ph === 'X' && e.dur != null);
	const secs = (Math.max(...xs.map((e) => e.ts + e.dur)) - Math.min(...xs.map((e) => e.ts))) / 1e6;
	const busy = {};
	for (const e of xs) { const k = (pn.get(e.pid) || e.pid) + '/' + (tn.get(e.pid + ':' + e.tid) || e.tid).replace(/\d+$/, ''); if (e.name === 'ThreadControllerImpl::RunTask') busy[k] = (busy[k] || 0) + e.dur / 1000; }
	return [Math.round((busy['Renderer/CrRendererMain'] || 0) / secs), Math.round((busy['GPU Process/CrGpuMain'] || 0) / secs)];
}
const res = {};
for (let r = 0; r < 3; r++) for (const c of ['smil', 'smil-nomask', 'smil-no3d', 'smil-nomask-no3d', 'paused']) { await ev(`__v(${JSON.stringify(c)})`); await sleep(800); (res[c] = res[c] || []).push(await idle()); }
for (const [c, v] of Object.entries(res)) console.log(kind, c.padEnd(18), 'R/G ms/s', JSON.stringify(v));
ws.close(); ch.kill('SIGKILL'); await sleep(800); try { fs.rmSync(ud, { recursive: true, force: true }); } catch {}
process.exit(0);
