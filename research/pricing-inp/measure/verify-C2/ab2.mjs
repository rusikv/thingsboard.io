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

// in-page condition switcher
const setup = await ev(`(() => {
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
	svg.querySelectorAll(':scope > g').forEach((g) => {
		const at = g.querySelector('animateTransform');
		const from = Number(at.getAttribute('from').split(' ')[1]), to = Number(at.getAttribute('to').split(' ')[1]);
		const n = mk(); n.appendChild(g.querySelector('path').cloneNode(true)); wrap.appendChild(n);
		n.animate([{ transform: 'translateY(' + from * s + 'px)' }, { transform: 'translateY(' + to * s + 'px)' }], { duration: parseFloat(at.getAttribute('dur')) * 1000, iterations: Infinity, easing: 'linear' });
	});
	const chatOff = document.createElement('style'); chatOff.textContent = '#chat-launcher{animation:none!important}';
	window.__cond = (c) => {
		const fix = c === 'fix';
		if (!wrap.isConnected) svg.after(wrap);
		wrap.style.display = fix ? '' : 'none';
		svg.style.visibility = fix ? 'hidden' : '';
		if (c === 'all' || c === 'chatonly') chatOff.remove(); else document.head.appendChild(chatOff);
		if (c === 'chatonly' || c === 'none' || fix) svg.pauseAnimations(); else svg.unpauseAnimations();
		return c;
	};
	return { w, h, s, launcher: !!document.querySelector('#chat-launcher'), launcherAnim: document.querySelector('#chat-launcher') && getComputedStyle(document.querySelector('#chat-launcher')).animationName };
})()`);
console.error('setup', JSON.stringify(setup));

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
// scroll so FAQ tabs are visible; background point next to them
await ev(`(() => { const b = [...document.querySelectorAll('.pricing-faq-block')].find((x) => x.checkVisibility()); const t0 = b.querySelector('.faq-cat-tab'); t0.scrollIntoView({ block: 'start', behavior: 'instant' }); scrollBy(0, -Math.round(innerHeight * 0.25)); })()`);
await sleep(1500);
const pts = await ev(`(() => {
	const b = [...document.querySelectorAll('.pricing-faq-block')].find((x) => x.checkVisibility());
	const t = [...b.querySelectorAll('.faq-cat-tab')].filter((x) => x.checkVisibility());
	const tabs = t.map((el) => { const r = el.getBoundingClientRect(); const x = r.left + r.width / 2, y = r.top + r.height / 2; const h = document.elementFromPoint(x, y); return { x, y, ok: !!h && el.contains(h) && !h.closest('a[href]'), hit: h && h.tagName + '.' + h.className }; });
	let bg = null;
	for (const fx of [0.015, 0.03, 0.97, 0.985]) for (const fy of [0.3, 0.25, 0.35, 0.2, 0.4]) { const x = innerWidth * fx, y = innerHeight * fy; const h = document.elementFromPoint(x, y); if (h && !h.closest('a,button,input,label,select,textarea,summary,[role=button],[tabindex],header,#cc-main,#chat-launcher,iframe,[onclick]')) { bg = { x, y, hit: h.tagName + '.' + (typeof h.className === 'string' ? h.className : '') }; break; } if (bg) break; }
	const okTabs = tabs.filter((x) => x.ok).slice(0, 2); return { tabs: okTabs.length === 2 ? okTabs : tabs.slice(0, 2), all: tabs.length, bg };
})()`);
console.error('pts', JSON.stringify(pts));
if (!pts.bg || !pts.tabs[0].ok || !pts.tabs[1].ok) { console.error('targets not ok'); }

async function idle(c) {
	evs = [];
	await send('Tracing.start', { transferMode: 'ReportEvents', traceConfig: { includedCategories: ['toplevel', 'devtools.timeline', 'viz', 'gpu'] } });
	await sleep(2500);
	const tp = new Promise((r) => (tdone = r));
	await send('Tracing.end');
	await tp;
	const tn = new Map(), pn = new Map();
	for (const e of evs) { if (e.ph === 'M' && e.name === 'thread_name') tn.set(e.pid + ':' + e.tid, e.args.name); if (e.ph === 'M' && e.name === 'process_name') pn.set(e.pid, e.args.name); }
	const xs = evs.filter((e) => e.ph === 'X' && e.dur != null);
	const secs = (Math.max(...xs.map((e) => e.ts + e.dur)) - Math.min(...xs.map((e) => e.ts))) / 1e6;
	const busy = {}, cnt = {};
	for (const e of xs) {
		const k = (pn.get(e.pid) || e.pid) + '/' + (tn.get(e.pid + ':' + e.tid) || e.tid).replace(/\d+$/, '');
		if (e.name === 'ThreadControllerImpl::RunTask') busy[k] = (busy[k] || 0) + e.dur / 1000;
		if (['Layout', 'RasterTask', 'Display::DrawAndSwap', 'UpdateLayoutTree'].includes(e.name)) cnt[e.name] = (cnt[e.name] || 0) + 1;
	}
	return { R: +((busy['Renderer/CrRendererMain'] || 0) / secs).toFixed(0), G: +((busy['GPU Process/CrGpuMain'] || 0) / secs).toFixed(0), C: +((busy['Renderer/Compositor'] || 0) / secs).toFixed(0), layoutPS: +((cnt.Layout || 0) / secs).toFixed(0), rasterPS: +((cnt.RasterTask || 0) / secs).toFixed(0), drawPS: +((cnt['Display::DrawAndSwap'] || 0) / secs).toFixed(0) };
}

const conds = ['all', 'smilonly', 'chatonly', 'none', 'fix'];
const res = Object.fromEntries(conds.map((c) => [c, { bg: [], faq: [], idle: [] }]));
let faqI = 1; const smilLog = [];
for (let r = 0; r < ROUNDS; r++) {
	const order = [...conds].sort(() => Math.random() - 0.5);
	for (const c of order) {
		await ev(`__cond(${JSON.stringify(c)})`);
		await sleep(1200);
		if (r < 2) res[c].idle.push(await idle(c));
		for (const [label, n] of [['bg', 3], ['faq', 3]]) {
			for (let i = 0; i < n; i++) {
				await ev('__et.length = 0');
				const p = label === 'bg' ? pts.bg : pts.tabs[faqI++ % 2];
				if (!p || (label === 'faq' && !p.ok)) continue;
				await tap(p.x, p.y);
				await sleep(mobile ? 750 : 550);
				const a = await ev('__et.slice()');
				const st = await ev(`(() => { const s = document.querySelector('.pricing-bg-svg'); const t1 = s.getCurrentTime(); return { paused: s.animationsPaused(), t: t1 }; })()`);
				smilLog.push([c, st.paused, st.t]);
				const by = new Map(); for (const e of a) { const k = by.get(e.id); if (!k || e.dur > k.dur) by.set(e.id, e); }
				const e = [...by.values()].sort((x, y) => y.dur - x.dur)[0];
				res[c][label].push(e ? { dur: e.dur, delay: +(e.ps - e.start).toFixed(1), proc: +(e.pe - e.ps).toFixed(1), pres: +(e.start + e.dur - e.pe).toFixed(1) } : { dur: 0 });
			}
		}
	}
}
const q = (v, p) => { v = [...v].sort((a, b) => a - b); return v[Math.min(v.length - 1, Math.floor((v.length - 1) * p + 0.5))]; };
const out = { kind, setup, pts, summary: {} };
for (const c of conds) {
	const s = {};
	for (const label of ['bg', 'faq']) {
		const v = res[c][label];
		const d = v.map((x) => x.dur);
		const dl = v.filter((x) => x.dur).map((x) => x.delay), pr = v.filter((x) => x.dur).map((x) => x.pres);
		s[label] = { n: d.length, med: q(d, 0.5), p75: q(d, 0.75), max: Math.max(...d), medDelay: dl.length ? q(dl, 0.5) : null, medPres: pr.length ? q(pr, 0.5) : null, durs: d.join(',') };
	}
	s.idle = res[c].idle;
	out.summary[c] = s;
	console.log(kind.padEnd(8), c.padEnd(9), 'bg', JSON.stringify(s.bg), '\n                  faq', JSON.stringify(s.faq), '\n                  idle', JSON.stringify(s.idle));
}
fs.writeFileSync(`${OUT}/ab2-${kind}-${Date.now()}.json`, JSON.stringify({ ...out, raw: res, smilLog }));
const adv = {}; for (let i = 1; i < smilLog.length; i++) if (smilLog[i][0] === smilLog[i-1][0]) { const k = smilLog[i][0]; adv[k] = adv[k] || []; adv[k].push(+(smilLog[i][2] - smilLog[i-1][2]).toFixed(2)); }
console.log('smil time advance per tap by cond', JSON.stringify(Object.fromEntries(Object.entries(adv).map(([k, v]) => [k, [Math.min(...v), Math.max(...v)]]))));
ws.close(); ch.kill('SIGKILL'); await sleep(800); try { fs.rmSync(ud, { recursive: true, force: true }); } catch {}
process.exit(0);
