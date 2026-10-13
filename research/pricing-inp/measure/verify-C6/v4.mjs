// C6 verification: per-frame style cost of the :root:has(#cc-main ...) launcher rule and of promo-collapse.
// Usage: node v.mjs <mobile|desktop> <cpu>
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const DIR = '/home/ruru/projects/thingsboard.io-research/research/pricing-inp/measure/verify-C6';
const [kind = 'mobile', cpuS = '4'] = process.argv.slice(2);
const mobile = kind === 'mobile';
const cpu = Number(cpuS);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const port = 9300 + Math.floor(Math.random() * 90);
const ud = `${DIR}/profile-${Date.now()}`;
const ch = spawn('/usr/bin/google-chrome', ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${ud}`, '--no-first-run', '--enable-gpu', '--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', 'about:blank'], { stdio: 'ignore' });
let list;
for (let i = 0; i < 50; i++) { try { list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); if (list.length) break; } catch {} await sleep(200); }
const ws = new WebSocket(list.find((t) => t.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0; const pend = new Map(); let evs = []; let done; let loaded;
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } else if (d.method === 'Tracing.dataCollected') evs.push(...d.params.value); else if (d.method === 'Tracing.tracingComplete') done(); else if (d.method === 'Page.loadEventFired') loaded && loaded(); };
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, (d) => r(d.result || d)); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result?.value;
await send('Page.enable');
if (mobile) {
	await send('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Mobile Safari/537.36', platform: 'Android' });
	await send('Emulation.setDeviceMetricsOverride', { width: 412, height: 823, deviceScaleFactor: 1.75, mobile: true });
	await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
} else {
	await send('Emulation.setDeviceMetricsOverride', { width: 1350, height: 940, deviceScaleFactor: 1, mobile: false });
}
await send('Emulation.setCPUThrottlingRate', { rate: cpu });
await send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__et=[];new PerformanceObserver(l=>l.getEntries().forEach(e=>{ if(e.interactionId) window.__et.push({n:e.name,d:e.duration,del:e.processingStart-e.startTime,proc:e.processingEnd-e.processingStart,id:e.interactionId}); })).observe({type:'event',durationThreshold:16,buffered:true});` });
const lp = new Promise((r) => (loaded = r));
await send('Page.navigate', { url: (process.env.TB_ORIGIN || 'https://thingsboard.io') + '/pricing/' });
await lp;
await sleep(8000);

const cats = ['devtools.timeline', 'blink', 'toplevel', 'disabled-by-default-devtools.timeline'];
async function trace(label, ms = 3000, during) {
	evs = [];
	await send('Tracing.start', { transferMode: 'ReportEvents', traceConfig: { includedCategories: cats } });
	await sleep(300);
	if (during) await during(); else await sleep(ms);
	const dp = new Promise((r) => (done = r));
	await send('Tracing.end');
	await dp;
	const tn = new Map(); for (const e of evs) if (e.ph === 'M' && e.name === 'thread_name') tn.set(e.pid + ':' + e.tid, e.args.name);
	const mains = [...tn.entries()].filter(([, n]) => n === 'CrRendererMain').map(([k]) => k);
	let best = null, bn = 0; for (const k of mains) { const n = evs.filter((e) => e.pid + ':' + e.tid === k).length; if (n > bn) { bn = n; best = k; } }
	const M = evs.filter((e) => e.pid + ':' + e.tid === best && e.ph === 'X');
	const t0 = Math.min(...M.map((e) => e.ts)), t1 = Math.max(...M.map((e) => e.ts + e.dur));
	const span = (t1 - t0) / 1e6;
	const ult = M.filter((e) => e.name === 'UpdateLayoutTree');
	const run = M.filter((e) => e.name === 'RunTask');
	const sum = (a) => a.reduce((s, e) => s + e.dur / 1000, 0);
	const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };
	const counts = {}; for (const e of ult) { const c = e.args?.elementCount ?? '?'; counts[c] = (counts[c] || 0) + 1; }
	const r = { label, span: +span.toFixed(2), recalcPerS: +(ult.length / span).toFixed(1), recalcMsPerS: +(sum(ult) / span).toFixed(1), recalcMedianMs: +med(ult.map((e) => e.dur / 1000)).toFixed(2), recalcMaxMs: +Math.max(0, ...ult.map((e) => e.dur / 1000)).toFixed(2), runTaskMsPerS: +(sum(run) / span).toFixed(1), elementCounts: counts };
	console.log(JSON.stringify(r));
	return r;
}

const info = await ev(`(() => {
  const l = document.getElementById('chat-launcher'); const cs = l && getComputedStyle(l);
  const all = [...document.querySelectorAll('*')];
  const cc = document.getElementById('cc-main');
  const rules = [];
  const walk = (list, media) => { for (const r of list) { try { if (r.cssRules && !r.selectorText) walk(r.cssRules, (media||'') + (r.conditionText ? ' @' + r.conditionText : '')); if (r.selectorText && r.selectorText.includes(':has(#cc-main')) rules.push({ sel: r.selectorText, media, text: r.cssText.slice(0, 300) }); if (r.selectorText && r.cssRules && r.cssRules.length) walk(r.cssRules, media); } catch {} } };
  for (const s of document.styleSheets) { try { walk(s.cssRules, ''); } catch {} }
  return { ua: navigator.userAgent, w: innerWidth, dom: all.length, ccIndex: all.indexOf(cc), launcherIndex: all.indexOf(l),
    launcher: cs && { visibility: cs.visibility, anim: cs.animationName, play: cs.animationPlayState, dur: cs.animationDuration },
    root: { anim: getComputedStyle(document.documentElement).animationName, promoH: getComputedStyle(document.documentElement).getPropertyValue('--promo-h'), promoCur: getComputedStyle(document.documentElement).getPropertyValue('--promo-cur') },
    banner: (() => { const b = document.querySelector('#cc-main .cm'); return b && { hidden: b.hidden }; })(),
    smil: [...document.querySelectorAll('animate,animateTransform,animateMotion,set')].length,
    anims: document.getAnimations().map((a) => ({ name: a.animationName || a.constructor.name, target: a.effect?.target?.id || a.effect?.target?.tagName, state: a.playState, tl: a.timeline?.constructor?.name })),
    rules };
})()`);
console.log('INFO', JSON.stringify(info, null, 1));
const out = { kind, cpu, info, phases: [] };
const P = async (l, ms, d) => out.phases.push(await trace(l, ms, d));


const pt = await ev(`(() => { for (const fx of [0.03,0.05,0.95]) for (const fy of [0.35,0.4,0.3,0.45]) { const x = innerWidth*fx, y = innerHeight*fy; const h = document.elementFromPoint(x,y); if (h && !h.closest('a,button,input,label,select,summary,[role=button],[tabindex],header,#cc-main,#chat-launcher,[onclick]')) return {x,y,el:h.tagName+'.'+h.className}; } return null; })()`);
console.log('tap point', JSON.stringify(pt));
async function taps(label, n = 14) {
	await ev(`window.__et = []`);
	for (let k = 0; k < n; k++) {
		await sleep(350 + Math.random() * 450);
		await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: pt.x, y: pt.y }] });
		await sleep(60);
		await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
	}
	await sleep(1200);
	const et = await ev(`window.__et`);
	const by = {}; for (const e of et) { (by[e.id] = by[e.id] || []).push(e); }
	const inter = Object.values(by).map((a) => ({ d: Math.max(...a.map((e) => e.d)), del: Math.max(...a.map((e) => e.del)) }));
	const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };
	const r = { label, n: inter.length, durMed: med(inter.map((i) => i.d)), durMax: Math.max(...inter.map((i) => i.d)), delayMed: +(med(inter.map((i) => i.del)) || 0).toFixed(1), delayMax: +Math.max(...inter.map((i) => i.del)).toFixed(1), durs: inter.map((i) => i.d).join(',') };
	console.log(JSON.stringify(r));
}
const st = () => ev(`(() => { const cs = getComputedStyle(document.getElementById('chat-launcher')); return JSON.stringify({ banner: !document.querySelector('#cc-main .cm').hidden, vis: cs.visibility, play: cs.animationPlayState }); })()`);
for (const rep of [1, 2]) {
	console.log('state', await st());
	await taps('T' + rep + 'a rule present (prod)');
	await ev(`(() => { const s = document.createElement('style'); s.id='pp'; s.textContent='#chat-launcher{animation-play-state:paused!important}'; document.head.appendChild(s); })()`);
	await sleep(400);
	await taps('T' + rep + 'b launcher paused (= proposed fix while banner up)');
	await ev(`document.getElementById('pp').remove()`);
	await ev(`(() => { const s = document.createElement('style'); s.id='pp2'; s.textContent='#chat-launcher{animation-play-state:paused!important}'; document.head.appendChild(s); document.querySelectorAll('svg').forEach(s=>{ if (s.pauseAnimations && !s.ownerSVGElement) s.pauseAnimations(); }); })()`);
	await sleep(400);
	await taps('T' + rep + 'c launcher + SMIL paused (no continuous frames)');
	await ev(`(() => { document.getElementById('pp2').remove(); document.querySelectorAll('svg').forEach(s=>{ if (s.unpauseAnimations && !s.ownerSVGElement) s.unpauseAnimations(); }); })()`);
	await sleep(400);
}
ws.close(); ch.kill('SIGKILL'); await sleep(800); try { fs.rmSync(ud, { recursive: true, force: true }); } catch {}
process.exit(0);
