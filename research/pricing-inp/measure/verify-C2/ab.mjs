// A/B: isolate SMIL wave background vs chat-hue CSS animation vs a compositor-only prototype.
// Usage: node ab.mjs <desktop|mobile> <condition> [reps]
// conditions: all | smilonly | chatonly | none | fix (fix = SMIL replaced by WAAPI transform anims; chat anim off)
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const OUT = '/home/ruru/projects/thingsboard.io-research/research/pricing-inp/measure/verify-C2';
const [kind, cond, repsS] = process.argv.slice(2);
const REPS = Number(repsS || 20);
const mobile = kind === 'mobile';
const P = mobile ? { w: 412, h: 823, dpr: 1.75, cpu: 4 } : { w: 1350, h: 940, dpr: 1, cpu: 1 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const port = 9500 + Math.floor(Math.random() * 150);
const ud = `${OUT}/profile-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
const ch = spawn('/usr/bin/google-chrome', ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${ud}`, '--no-first-run', '--enable-gpu', '--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', 'about:blank'], { stdio: 'ignore' });
let list;
for (let i = 0; i < 60; i++) { try { list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); if (list.find((t) => t.type === 'page')) break; } catch {} await sleep(200); }
const ws = new WebSocket(list.find((t) => t.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0; const pend = new Map(); let evs = []; let tdone; let loaded;
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } else if (d.method === 'Tracing.dataCollected') evs.push(...d.params.value); else if (d.method === 'Tracing.tracingComplete') tdone && tdone(); else if (d.method === 'Page.loadEventFired') loaded && loaded(); };
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, (d) => r(d.result || d)); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr, awaitP = false) => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: awaitP }); return r.result && r.result.value; };

await send('Page.enable');
if (mobile) {
	await send('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Mobile Safari/537.36', platform: 'Android' });
	await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
}
await send('Emulation.setDeviceMetricsOverride', { width: P.w, height: P.h, deviceScaleFactor: P.dpr, mobile });
await send('Emulation.setCPUThrottlingRate', { rate: P.cpu });

const pre = `
window.__et = [];
new PerformanceObserver((l) => { for (const e of l.getEntries()) if (e.interactionId) __et.push({ id: e.interactionId, name: e.name, start: e.startTime, dur: e.duration, ps: e.processingStart, pe: e.processingEnd }); }).observe({ type: 'event', durationThreshold: 16, buffered: true });
addEventListener('DOMContentLoaded', () => {
	const cond = ${JSON.stringify(cond)};
	if (cond === 'smilonly' || cond === 'none' || cond === 'fix') { const s = document.createElement('style'); s.textContent = '#chat-launcher{animation:none!important}'; document.head.appendChild(s); }
	if (cond === 'chatonly' || cond === 'none') document.querySelectorAll('svg.pricing-bg-svg').forEach((s) => s.pauseAnimations());
});
`;
await send('Page.addScriptToEvaluateOnNewDocument', { source: pre });
const lp = new Promise((r) => (loaded = r));
await send('Page.navigate', { url: (process.env.TB_ORIGIN || 'https://thingsboard.io') + '/pricing/' });
await lp;
await sleep(mobile ? 7000 : 5000);

let fixInfo = null;
if (cond === 'fix') {
	fixInfo = await ev(`(() => {
		const svg = document.querySelector('.pricing-bg .pricing-bg-svg');
		const cs = getComputedStyle(svg);
		const wrap = document.createElement('div');
		for (const p of ['position', 'right', 'top', 'width', 'height', 'transform', 'transform-origin', 'mask-image', '-webkit-mask-image']) wrap.style.setProperty(p, cs.getPropertyValue(p));
		wrap.style.overflow = 'visible';
		const w = parseFloat(cs.width), h = parseFloat(cs.height);
		const s = Math.max(w / 900, h / 900);
		const mk = () => { const n = svg.cloneNode(false); n.removeAttribute('class'); n.setAttribute('style', 'position:absolute;left:0;top:0;width:100%;height:100%;overflow:visible;will-change:transform'); return n; };
		const base = mk(); base.style.willChange = 'auto';
		base.appendChild(svg.querySelector('defs').cloneNode(true));
		svg.querySelectorAll(':scope > rect').forEach((r) => base.appendChild(r.cloneNode(true)));
		wrap.appendChild(base);
		const anims = [];
		svg.querySelectorAll(':scope > g').forEach((g) => {
			const at = g.querySelector('animateTransform');
			const from = Number(at.getAttribute('from').split(' ')[1]), to = Number(at.getAttribute('to').split(' ')[1]);
			const dur = parseFloat(at.getAttribute('dur')) * 1000;
			const n = mk(); n.appendChild(g.querySelector('path').cloneNode(true)); wrap.appendChild(n);
			n.animate([{ transform: 'translateY(' + from * s + 'px)' }, { transform: 'translateY(' + to * s + 'px)' }], { duration: dur, iterations: Infinity, easing: 'linear' });
			anims.push([from, to, dur]);
		});
		svg.replaceWith(wrap);
		return { w, h, s, anims };
	})()`);
	await sleep(2000);
}

// idle trace 4s
const cats = ['toplevel', 'devtools.timeline', 'disabled-by-default-devtools.timeline', 'viz', 'gpu'];
evs = [];
await send('Tracing.start', { transferMode: 'ReportEvents', traceConfig: { includedCategories: cats } });
await sleep(4000);
let tp = new Promise((r) => (tdone = r));
await send('Tracing.end');
await tp;
const tn = new Map(), pn = new Map();
for (const e of evs) { if (e.ph === 'M' && e.name === 'thread_name') tn.set(e.pid + ':' + e.tid, e.args.name); if (e.ph === 'M' && e.name === 'process_name') pn.set(e.pid, e.args.name); }
const xs = evs.filter((e) => e.ph === 'X' && e.dur != null);
const t0 = Math.min(...xs.map((e) => e.ts)), t1 = Math.max(...xs.map((e) => e.ts + e.dur));
const secs = (t1 - t0) / 1e6;
const busy = {}; const cnt = {};
for (const e of xs) {
	const k = (pn.get(e.pid) || e.pid) + '/' + (tn.get(e.pid + ':' + e.tid) || e.tid).replace(/\d+$/, '');
	if (e.name === 'ThreadControllerImpl::RunTask' || e.name === 'ThreadPool_RunTask') busy[k] = (busy[k] || 0) + e.dur / 1000;
	if (['ProxyMain::BeginMainFrame', 'Paint', 'RasterTask', 'DrawFrame', 'Graphics.Pipeline', 'Display::DrawAndSwap', 'SkiaOutputSurfaceImplOnGpu::SwapBuffers', 'UpdateLayoutTree', 'Layout'].includes(e.name)) cnt[e.name] = (cnt[e.name] || 0) + 1;
}
const busyPS = Object.fromEntries(Object.entries(busy).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => [k, +(v / secs).toFixed(0)]));
const cntPS = Object.fromEntries(Object.entries(cnt).map(([k, v]) => [k, +(v / secs).toFixed(1)]));

// background point
const pt = await ev(`(() => { scrollTo(0, 0); for (const fx of [0.015, 0.03, 0.97, 0.985]) for (const fy of [0.5, 0.45, 0.55, 0.4, 0.6]) { const x = innerWidth * fx, y = innerHeight * fy; const h = document.elementFromPoint(x, y); if (h && !h.closest('a,button,input,label,select,textarea,summary,[role=button],[tabindex],header,#cc-main,#chat-launcher,iframe,[onclick]')) return { x, y, hit: h.tagName + '.' + (h.className && h.className.baseVal === undefined ? h.className : '') }; } return null; })()`);
await sleep(800);
async function tap(x, y) {
	if (mobile) {
		await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, radiusX: 4, radiusY: 4, force: 1 }] });
		await sleep(70);
		await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
	} else {
		await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
		await sleep(60);
		await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
		await sleep(70);
		await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
	}
}
await ev('__et.length = 0');
const bgIds0 = [];
for (let i = 0; i < REPS; i++) { await tap(pt.x, pt.y); await sleep(550 + Math.random() * 200); }
await sleep(800);
const bg = await ev('JSON.stringify(__et)');
// FAQ category tabs, alternate 2nd/1st
const faqPts = await ev(`(() => { const b = [...document.querySelectorAll('.pricing-faq-block')].find((x) => x.checkVisibility()); if (!b) return null; const t = b.querySelectorAll('.faq-cat-tab'); if (t.length < 2) return null; t[0].scrollIntoView({ block: 'center', behavior: 'instant' }); return true; })()`);
await sleep(1200);
const faqXY = await ev(`(() => { const b = [...document.querySelectorAll('.pricing-faq-block')].find((x) => x.checkVisibility()); const t = b.querySelectorAll('.faq-cat-tab'); return [0, 1].map((i) => { const r = t[i].getBoundingClientRect(); const x = r.left + r.width / 2, y = r.top + r.height / 2; const h = document.elementFromPoint(x, y); return { x, y, ok: !!h && t[i].contains(h) && !h.closest('a[href]') }; }); })()`);
await ev('__et.length = 0');
let faqN = 0;
if (faqXY && faqXY[0].ok && faqXY[1].ok) for (let i = 0; i < Math.min(REPS, 12); i++) { const p = faqXY[(i + 1) % 2]; await tap(p.x, p.y); faqN++; await sleep(650 + Math.random() * 200); }
await sleep(800);
const faq = await ev('JSON.stringify(__et)');

function summarize(json, n) {
	const a = JSON.parse(json || '[]');
	const by = new Map();
	for (const e of a) { const c = by.get(e.id); if (!c || e.dur > c.dur) by.set(e.id, e); }
	const rows = [...by.values()].map((e) => ({ dur: e.dur, delay: +(e.ps - e.start).toFixed(1), proc: +(e.pe - e.ps).toFixed(1), pres: +(e.start + e.dur - e.pe).toFixed(1) }));
	const durs = rows.map((r) => r.dur);
	while (durs.length < n) durs.push(0); // <16ms not reported
	durs.sort((x, y) => x - y);
	const q = (p) => durs[Math.min(durs.length - 1, Math.floor((durs.length - 1) * p + 0.5))];
	const med = (k) => { const v = rows.map((r) => r[k]).sort((x, y) => x - y); return v.length ? v[Math.floor(v.length / 2)] : null; };
	return { n, reported: rows.length, under16: n - rows.length, median: q(0.5), p75: q(0.75), max: durs[durs.length - 1], medDelay: med('delay'), medPres: med('pres'), durs: durs.join(',') };
}
const res = { kind, cond, fixInfo, pt, idle: { secs: +secs.toFixed(2), busyMsPerSec: busyPS, countsPerSec: cntPS }, bg: summarize(bg, REPS), faq: summarize(faq, faqN) };
console.log(JSON.stringify(res));
fs.appendFileSync(`${OUT}/ab-results.jsonl`, JSON.stringify({ t: Date.now(), ...res }) + '\n');
ws.close(); ch.kill('SIGKILL'); await sleep(800); try { fs.rmSync(ud, { recursive: true, force: true }); } catch {}
process.exit(0);
