// Interleaved in-session A/B of the Starlight list rule on prod /pricing/ calculator + billing interactions.
// Variants are swapped through CSSOM between rounds, so page state, 3P scripts and caches are shared.
// Usage: node ab.mjs <desktop|mobile> <cpuRate> [rounds]
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const DIR = '/tmp/claude-1000/-home-thingsboard095-tb-thingsboard-io/3973666f-bba9-429b-a45b-e0ddba54c47a/scratchpad/inp/verify-C1';
const MODE = process.argv[2] || 'desktop';
const CPU = Number(process.argv[3] || 4);
const ROUNDS = Number(process.argv[4] || 4);
const MOBILE = MODE === 'mobile';
const W = MOBILE ? 412 : 1350, H = MOBILE ? 823 : 940, DPR = MOBILE ? 1.75 : 1;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const port = 9500 + Math.floor(Math.random() * 190);
const udd = fs.mkdtempSync(DIR + '/udd-');
const chrome = spawn('/usr/bin/google-chrome', ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${udd}`, '--no-first-run', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-extensions', `--window-size=${W},${H}`, '--enable-gpu', '--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', 'about:blank'], { stdio: 'ignore' });
let wsUrl, ver;
for (let i = 0; i < 60; i++) { try { ver = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); const j = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); const p = j.find((t) => t.type === 'page'); if (p) { wsUrl = p.webSocketDebuggerUrl; break; } } catch {} await sleep(200); }
const ws = new WebSocket(wsUrl); await new Promise((r) => (ws.onopen = r));
let id = 0; const pend = new Map();
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } };
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 400)); return r.result.result.value; };
const log = (...a) => console.log(`[${MODE}-${CPU}x]`, ...a);

await send('Page.enable'); await send('Runtime.enable');
const ua = MOBILE ? `Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Mobile Safari/537.36` : ver['User-Agent'].replace('HeadlessChrome', 'Chrome');
await send('Emulation.setUserAgentOverride', { userAgent: ua, platform: MOBILE ? 'Android' : 'Linux' });
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: DPR, mobile: MOBILE });
if (MOBILE) await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
await send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => { const S = window.__ev = []; new PerformanceObserver((l) => l.getEntries().forEach((e) => { if (e.interactionId) S.push({ n: e.name, id: e.interactionId, d: e.duration, s: e.startTime, ps: e.processingStart, pe: e.processingEnd }); })).observe({ type: 'event', durationThreshold: 16, buffered: true }); })();` });
await send('Page.navigate', { url: 'https://thingsboard.io/pricing/' });
await sleep(12000);
await send('Emulation.setCPUThrottlingRate', { rate: CPU });

const NOT = 'a, strong, em, del, span, input, code, br, script';
const VARIANTS = {
	orig: null,
	drop: '',
	v038: `.sl-markdown-content li > :is(:last-child:not(li, ul, ol, ${NOT}, :where(.not-content *)), :not(script):has(~ script:last-child):not(:has(~ :not(script)))) { margin-bottom: 1.25rem; }`,
};
log(await ev(`(() => {
  const find = (rules, parent) => { for (let i = 0; i < rules.length; i++) { const r = rules[i]; if (r.selectorText && r.selectorText.includes(':is(ol') && r.selectorText.includes('script:last-child')) return { parent, i, text: r.cssText }; if (r.cssRules) { const f = find(r.cssRules, r); if (f) return f; } } return null; };
  for (const s of document.styleSheets) { let f; try { f = find(s.cssRules, s); } catch { continue; } if (f) { window.__slot = f; return 'rule found'; } }
  return 'NOT FOUND';
})()`));
const setVariant = (txt) => ev(`(() => { const f = window.__slot; f.parent.deleteRule(f.i); f.parent.insertRule(${txt === null ? 'f.text' : JSON.stringify(txt || '.__never__{}')}, f.i); return 1; })()`);

// Safe element helpers: never click links, chat, or consent.
const center = async (expr) => {
	await ev(`(() => { const el = ${expr}; el.scrollIntoView({ block: 'center', behavior: 'instant' }); })()`);
	await sleep(250);
	return ev(`(() => { const el = ${expr}; const b = el.getBoundingClientRect(); const x = b.left + b.width / 2, y = b.top + b.height / 2; const h = document.elementFromPoint(x, y);
    const ok = !!h && (h === el || el.contains(h) || h.contains(el)) && !h.closest('a[href], #chat-launcher, #cc-main, iframe');
    return { x, y, ok, hit: h && (h.tagName + '.' + h.className).slice(0, 60) }; })()`);
};
const click = async (expr) => {
	const p = await center(expr);
	if (!p.ok) throw new Error('unsafe/obscured click ' + expr + ' hit ' + p.hit);
	if (MOBILE) {
		const o = await ev('[visualViewport.offsetLeft, visualViewport.offsetTop, visualViewport.scale]');
		const x = (p.x - o[0]) * o[2], y = (p.y - o[1]) * o[2];
		await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, radiusX: 4, radiusY: 4, force: 1 }] });
		await sleep(70);
		await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
	} else {
		await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y }); await sleep(100);
		await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', buttons: 1, clickCount: 1 }); await sleep(60);
		await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', buttons: 0, clickCount: 1 });
	}
};
const key = async (k, code) => {
	await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: k, code: k, windowsVirtualKeyCode: code }); await sleep(50);
	await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: k, windowsVirtualKeyCode: code });
};
const settle = async () => { await sleep(CPU > 1 ? 1100 : 600); await ev('new Promise(r => requestAnimationFrame(() => setTimeout(r, 50)))'); };
const measure = async (fn) => {
	const n0 = await ev('__ev.length');
	await fn();
	await settle();
	const es = await ev(`__ev.slice(${n0})`);
	const by = new Map();
	for (const e of es) { const cur = by.get(e.id); if (!cur || e.d > cur.d) by.set(e.id, e); }
	const worst = [...by.values()].sort((a, b) => b.d - a.d)[0];
	return worst ? { d: worst.d, proc: +(worst.pe - worst.ps).toFixed(1), pres: +(worst.s + worst.d - worst.pe).toFixed(1) } : { d: 0, proc: 0, pres: 0 };
};

const results = {};
const rec = (label, v, r) => { ((results[label] ??= {})[v] ??= []).push(r); };

async function suite(label, actions) {
	const order = Object.keys(VARIANTS);
	for (let round = 0; round < ROUNDS; round++) {
		const rot = order.slice(round % order.length).concat(order.slice(0, round % order.length));
		for (const v of rot) {
			await setVariant(VARIANTS[v]);
			await sleep(300);
			for (const [name, act] of actions) rec(`${label}: ${name}`, v, await measure(act));
		}
	}
	await setVariant(null);
}

// ── PAYG (On-premises) calculator ──
await ev(`document.querySelector('.sub-tab[data-subtab="thingsboard-pe"]').click()`); await sleep(800);
await ev(`document.querySelector('.pricing-section[data-section="thingsboard-pe"] .upsell-card-btn[onclick*="openTbPaygCalc"]').click()`); await sleep(4000);
log('payg open', await ev(`!!document.getElementById('sm-slider')?.checkVisibility()`), 'rendered elems', await ev(`Array.from(document.querySelectorAll('*')).filter(e => e.checkVisibility()).length`));
await ev(`document.getElementById('sm-slider').focus({ preventScroll: false })`);
await suite('PAYG', [
	['slider ArrowRight', async () => { await ev(`document.getElementById('sm-slider').focus({ preventScroll: true })`); await sleep(150); await key('ArrowRight', 39); }],
	['slider ArrowRight #2', async () => { await ev(`document.getElementById('sm-slider').focus({ preventScroll: true })`); await sleep(150); await key('ArrowRight', 39); }],
	['Edge add-on switch', () => click(`document.getElementById('sm-edge-toggle').closest('.calc-toggle')`)],
	['Edge add-on switch (back)', () => click(`document.getElementById('sm-edge-toggle').closest('.calc-toggle')`)],
]);
await ev(`Array.from(document.querySelectorAll('.calc-modal-close')).find(e => e.checkVisibility())?.click()`); await sleep(1500);
log('payg closed', await ev(`!document.getElementById('sm-slider')?.checkVisibility()`));

// ── On-prem billing toggle (heading/subtitle textContent swap) ──
await suite('On-prem billing', [
	['-> Perpetual', () => click(`document.querySelector('#Pricing_PE_SM_Perpetual')`)],
	['-> Subscription', () => click(`document.querySelector('#Pricing_PE_SM_PayAsYouGo')`)],
]);

// ── Private Cloud billing + calculator ──
await ev(`document.querySelector('.sub-tab[data-subtab="thingsboard-private-cloud"]').click()`); await sleep(800);
await suite('PC billing', [
	['-> Annual', () => click(`document.querySelector('#Pricing_PE_PrivateCloud_Annual')`)],
	['-> Monthly', () => click(`document.querySelector('#Pricing_PE_PrivateCloud_Monthly')`)],
]);
await ev(`document.querySelector('.pricing-section[data-section="thingsboard-private-cloud"] .upsell-card-btn[onclick*="openTbPcCalc"]').click()`); await sleep(4000);
log('pc open; rendered elems', await ev(`Array.from(document.querySelectorAll('*')).filter(e => e.checkVisibility()).length`));
await ev(`(() => { const s = Array.from(document.querySelectorAll('.calc-modal-overlay .calc-slider')).find(e => e.checkVisibility()); s.focus(); window.__pcs = s; })()`);
await suite('PC calc', [
	['slider ArrowRight', async () => { await ev(`window.__pcs.focus({ preventScroll: true })`); await sleep(150); await key('ArrowRight', 39); }],
	['slider ArrowLeft', async () => { await ev(`window.__pcs.focus({ preventScroll: true })`); await sleep(150); await key('ArrowLeft', 37); }],
	['add-on switch', () => click(`Array.from(document.querySelectorAll('.calc-modal-overlay .calc-toggle')).find(e => e.checkVisibility())`)],
	['add-on switch (back)', () => click(`Array.from(document.querySelectorAll('.calc-modal-overlay .calc-toggle')).find(e => e.checkVisibility())`)],
]);
await ev(`Array.from(document.querySelectorAll('.calc-modal-close')).find(e => e.checkVisibility())?.click()`); await sleep(1000);

// ── control: sub-tab switch (no child-list mutation expected to dominate) ──
await suite('sub-tab', [
	['-> Cloud', () => click(`document.querySelector('.sub-tab[data-subtab="thingsboard-cloud"]')`)],
	['-> Private Cloud', () => click(`document.querySelector('.sub-tab[data-subtab="thingsboard-private-cloud"]')`)],
]);

const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
log('chrome', ver.Browser, 'rounds', ROUNDS);
log('label'.padEnd(40), Object.keys(VARIANTS).map((v) => (v + ' med d (proc/pres)').padEnd(26)).join(''));
for (const [label, byV] of Object.entries(results)) {
	log(label.padEnd(40), Object.keys(VARIANTS).map((v) => { const a = byV[v] || []; return `${med(a.map((r) => r.d))} (${med(a.map((r) => r.proc))}/${med(a.map((r) => r.pres))}) [${a.map((r) => r.d).join(',')}]`.padEnd(26); }).join(''));
}
fs.writeFileSync(`${DIR}/ab-${MODE}-${CPU}x.json`, JSON.stringify({ chrome: ver.Browser, results }, null, 1));
ws.close(); chrome.kill(); try { fs.rmSync(udd, { recursive: true, force: true }); } catch {}
