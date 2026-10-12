// Simulates the YourGPT dep-less-useEffect MutationObserver leak (vendor code NOT loaded; yourgpt + all 3P blocked)
// on prod /pricing/, and times real pricing toggles at N leaked observers.
// Usage: node mo.mjs <cpuRate> <mobile:0|1> [N list comma]
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const DIR = '/tmp/claude-1000/-home-thingsboard095-tb-thingsboard-io/3973666f-bba9-429b-a45b-e0ddba54c47a/scratchpad/inp/verify-C3';
const CPU = Number(process.argv[2] || 1);
const MOBILE = process.argv[3] === '1';
const NS = (process.argv[4] || '0,60,300,900').split(',').map(Number);
const W = MOBILE ? 412 : 1350, H = MOBILE ? 823 : 940;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class CDP {
	constructor(url) { this.ws = new WebSocket(url); this.id = 0; this.p = new Map(); this.h = new Map(); }
	open() { return new Promise((res, rej) => { this.ws.onopen = res; this.ws.onerror = rej; this.ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && this.p.has(d.id)) { const { res, rej } = this.p.get(d.id); this.p.delete(d.id); d.error ? rej(new Error(JSON.stringify(d.error))) : res(d.result); } else if (d.method) (this.h.get(d.method) || []).forEach((f) => f(d.params)); }; }); }
	on(m, f) { if (!this.h.has(m)) this.h.set(m, []); this.h.get(m).push(f); }
	send(method, params = {}) { const id = ++this.id; this.ws.send(JSON.stringify({ id, method, params })); return new Promise((res, rej) => this.p.set(id, { res, rej })); }
}

const INSTR = `(() => {
  const S = window.__v = { ev: [], muts: 0, uCalls: 0, obs: [] };
  new PerformanceObserver((l) => l.getEntries().forEach((e) => { if (e.interactionId) S.ev.push({ n: e.name, d: e.duration, ps: e.processingStart, pe: e.processingEnd, st: e.startTime, id: e.interactionId }); })).observe({ type: 'event', durationThreshold: 16, buffered: true });
  // capture-first click timing: handler + microtasks, measured to a MessageChannel task
  const mc = new MessageChannel(); let pend = null;
  mc.port1.onmessage = () => { if (pend) { pend.tMsg = performance.now(); S.last = pend; pend = null; } };
  addEventListener('click', () => { pend = { t0: performance.now(), m0: S.muts, u0: S.uCalls }; requestAnimationFrame(() => { if (S.last) S.last.tRaf = performance.now(); else if (pend) pend.tRafEarly = performance.now(); }); mc.port2.postMessage(0); }, true);
  new MutationObserver((r) => { for (const x of r) if (x.type === 'childList') S.muts++; }).observe(document, { subtree: true, childList: true });
})();`;

async function main() {
	const port = 9800 + Math.floor(Math.random() * 150);
	const ud = `${DIR}/prof-${Date.now()}`;
	const chrome = spawn('/usr/bin/google-chrome', ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${ud}`, '--no-first-run', '--disable-extensions', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', `--window-size=${W},${H}`, 'about:blank'], { stdio: 'ignore' });
	let ver; for (let i = 0; i < 50 && !ver; i++) { try { ver = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); } catch { await sleep(200); } }
	const pg = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === 'page');
	const c = new CDP(pg.webSocketDebuggerUrl); await c.open();
	const done = () => { try { chrome.kill('SIGKILL'); } catch {} try { fs.rmSync(ud, { recursive: true, force: true }); } catch {} };
	process.on('exit', done);
	const ev = async (expression, awaitPromise = false) => { const r = await c.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 400)); return r.result.value; };
	await c.send('Page.enable'); await c.send('Network.enable');
	await c.send('Network.setBlockedURLs', { urls: ['*yourgpt*', '*googletagmanager*', '*google-analytics*', '*doubleclick*', '*mailerlite*', '*facebook*', '*linkedin*', '*licdn*', '*hotjar*', '*clarity.ms*', '*youtube*', '*ytimg*', '*api.github.com*', '*cloudflareinsights*', '*gstatic*', '*googleapis*'] });
	await c.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: MOBILE ? 1.75 : 1, mobile: MOBILE });
	await c.send('Page.addScriptToEvaluateOnNewDocument', { source: INSTR });
	const loaded = new Promise((r) => c.on('Page.loadEventFired', r));
	await c.send('Page.navigate', { url: 'https://thingsboard.io/pricing/' }); await loaded; await sleep(6000);
	await c.send('Emulation.setCPUThrottlingRate', { rate: CPU });
	const ver0 = await ev(`({ url: location.href, tabs: [...document.querySelectorAll('.sub-tab')].map(t => t.dataset.subtab), yg: !!document.getElementById('yourgpt_root'), elements: document.querySelectorAll('*').length })`);
	console.log('chrome', ver.Browser, 'cpu', CPU, 'mobile', MOBILE, JSON.stringify(ver0));

	const vis = `(el) => el && el.checkVisibility && el.checkVisibility() && el.getBoundingClientRect().width > 0`;
	async function click(expr, label) {
		const ok = await ev(`(() => { const v = ${vis}; const el = [...document.querySelectorAll(${JSON.stringify(expr)})].find(v); if (!el) return null; el.scrollIntoView({ block: 'center', behavior: 'instant' }); return true; })()`);
		if (!ok) return { label, err: 'not found' };
		await sleep(250); await ev('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))', true);
		const pt = await ev(`(() => { const v = ${vis}; const el = [...document.querySelectorAll(${JSON.stringify(expr)})].find(v); const b = el.getBoundingClientRect(); const x = b.left + b.width / 2, y = b.top + b.height / 2; const hit = document.elementFromPoint(x, y); return { x, y, ok: !!hit && (el.contains(hit) || hit === el), bad: !!(hit && hit.closest('a[href], #cc-main, #chat-launcher, iframe')) }; })()`);
		if (!pt.ok || pt.bad) return { label, err: 'obscured/unsafe' };
		const n0 = await ev('(__v.last = null, __v.ev.length)');
		const url0 = await ev('location.href');
		await c.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pt.x, y: pt.y }); await sleep(80);
		await c.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pt.x, y: pt.y, button: 'left', buttons: 1, clickCount: 1 }); await sleep(50);
		await c.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pt.x, y: pt.y, button: 'left', buttons: 0, clickCount: 1 });
		await sleep(CPU > 1 ? 1200 : 700);
		const r = await ev(`({ last: __v.last, ev: __v.ev.slice(${n0}), url: location.href, muts: __v.muts, u: __v.uCalls })`);
		const evs = r.ev.filter((e) => e.n === 'click' || e.n === 'pointerup' || e.n === 'mouseup');
		const worst = r.ev.reduce((a, b) => (!a || b.d > a.d ? b : a), null);
		const l = r.last || {};
		return { label, urlChanged: r.url !== url0, taskMs: l.tMsg != null ? +(l.tMsg - l.t0).toFixed(2) : null, rafMs: l.tRaf != null ? +(l.tRaf - l.t0).toFixed(2) : null, mutsInTask: null, inp: worst ? { d: worst.d, proc: +(worst.pe - worst.ps).toFixed(1), name: worst.n } : null };
	}

	// Leak simulation: vendor-identical observer body; u = cheap stand-in for a React useState setter.
	const addObservers = (n) => ev(`(() => { for (let i = 0; i < ${n}; i++) { let $ = ''; const S = new MutationObserver(function () { location.href !== $ && ($ = location.href, __v.uCalls++); }); S.observe(document, { subtree: true, childList: true }); __v.obs.push(S); } return __v.obs.length; })()`);
	const seq = [
		['.sub-tab[data-subtab="thingsboard-private-cloud"]', 'subtab→PrivateCloud'],
		['.sub-tab[data-subtab="thingsboard-pe"]', 'subtab→PE'],
		['.billing-toggle-label:not(.active)', 'billing toggle (PE)'],
		['.billing-toggle-label:not(.active)', 'billing toggle back'],
		['.sub-tab.active', 're-click active subtab (same URL)'],
		['.sub-tab[data-subtab="thingsboard-cloud"]', 'subtab→Cloud'],
		['.region-toggle-label:not(.active)', 'region toggle'],
		['.region-toggle-label:not(.active)', 'region toggle back'],
	];
	let have = 0;
	const all = {};
	for (const N of NS) {
		if (N > have) have = await addObservers(N - have);
		// warm a URL baseline so the first-callback-per-observer path is consumed
		await ev(`(document.body.appendChild(document.createElement('i')).remove(), 0)`);
		await sleep(300);
		const rows = [];
		for (const [sel, label] of seq) {
			const u0 = await ev('__v.uCalls');
			const m0 = await ev('__v.muts');
			const r = await click(sel, label);
			r.uCalls = (await ev('__v.uCalls')) - u0;
			r.childListRecs = (await ev('__v.muts')) - m0;
			rows.push(r);
		}
		all[N] = rows;
		console.log(`\n=== N=${have} leaked observers`);
		for (const r of rows) console.log(r.err ? `${r.label}: ${r.err}` : `${r.label.padEnd(34)} url${r.urlChanged ? 'Δ' : '='} task+micro=${r.taskMs}ms raf@${r.rafMs}ms childListRecs=${r.childListRecs} uCalls=${r.uCalls} INP-entry=${r.inp ? `${r.inp.d}ms(proc ${r.inp.proc})` : '<16ms'}`);
	}
	fs.writeFileSync(`${DIR}/mo-cpu${CPU}-${MOBILE ? 'm' : 'd'}.json`, JSON.stringify(all, null, 1));
	done(); process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
