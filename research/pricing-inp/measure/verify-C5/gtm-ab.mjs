// A/B: per-interaction cost on prod /pricing/ with GTM (consented, in-memory only) vs without.
// Every request off thingsboard.io is failed at the network layer except the two GTM/gtag
// script downloads, so no analytics hit can leave the browser.
// Usage: node gtm-ab.mjs <profile> <nogtm|gtm> [reps]
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const DIR = '/home/ruru/projects/thingsboard.io-research/research/pricing-inp/measure/verify-C5';
const TARGET = (process.env.TB_ORIGIN || 'https://thingsboard.io') + '/pricing/';
const PROFILES = {
	'mobile-4x': { w: 412, h: 823, dpr: 1.75, mobile: true, cpu: 4 },
	'desktop-1x': { w: 1350, h: 940, dpr: 1, mobile: false, cpu: 1 },
	'desktop-4x': { w: 1350, h: 940, dpr: 1, mobile: false, cpu: 4 },
};
const [profName, mode, repsArg] = process.argv.slice(2);
const P = PROFILES[profName];
if (!P || !['gtm', 'nogtm'].includes(mode)) throw new Error('usage');
const REPS = Number(repsArg || 3);
const TAG = `${profName}-${mode}-${Date.now()}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(`[${profName}/${mode}]`, ...a);

class CDP {
	constructor(url) { this.ws = new WebSocket(url); this.id = 0; this.pending = new Map(); this.handlers = new Map(); }
	open() {
		return new Promise((res, rej) => {
			this.ws.onopen = res; this.ws.onerror = rej;
			this.ws.onmessage = (m) => {
				const d = JSON.parse(m.data);
				if (d.id && this.pending.has(d.id)) {
					const { res, rej, method } = this.pending.get(d.id); this.pending.delete(d.id);
					if (d.error) rej(new Error(method + ': ' + JSON.stringify(d.error))); else res(d.result);
				} else if (d.method) (this.handlers.get(d.method) || []).forEach((h) => h(d.params));
			};
		});
	}
	on(m, h) { if (!this.handlers.has(m)) this.handlers.set(m, []); this.handlers.get(m).push(h); }
	send(method, params = {}) { const id = ++this.id; this.ws.send(JSON.stringify({ id, method, params })); return new Promise((res, rej) => this.pending.set(id, { res, rej, method })); }
	close() { try { this.ws.close(); } catch {} }
}

const OBSERVERS = `(() => {
  const S = window.__inp = { events: [], loafs: [], errs: [] };
  const desc = (n) => { if (!n || !n.tagName) return n ? String(n.nodeName) : null; let s = n.tagName.toLowerCase(); if (n.id) s += '#' + n.id; if (n.classList && n.classList.length) s += '.' + Array.from(n.classList).slice(0, 2).join('.'); return s; };
  S.desc = desc;
  try { new PerformanceObserver((l) => l.getEntries().forEach((e) => S.events.push({ name: e.name, startTime: e.startTime, duration: e.duration, processingStart: e.processingStart, processingEnd: e.processingEnd, interactionId: e.interactionId || 0, target: desc(e.target) }))).observe({ type: 'event', durationThreshold: 16, buffered: true }); } catch (e) { S.errs.push('event:' + e); }
  try { new PerformanceObserver((l) => l.getEntries().forEach((e) => S.loafs.push({ startTime: e.startTime, duration: e.duration, renderStart: e.renderStart, styleAndLayoutStart: e.styleAndLayoutStart, blockingDuration: e.blockingDuration,
      scripts: (e.scripts || []).map((s) => ({ sourceURL: s.sourceURL, fn: s.sourceFunctionName, invoker: s.invoker, type: s.invokerType, startTime: s.startTime, duration: s.duration, forced: s.forcedStyleAndLayoutDuration })) }))).observe({ type: 'long-animation-frame', buffered: true }); } catch (e) { S.errs.push('loaf:' + e); }
  // Sync wall time of every click dispatch: first window-capture listener -> last window-bubble listener.
  S.clicks = [];
  let t0 = 0;
  addEventListener('click', () => { t0 = performance.now(); }, true);
  addEventListener('click', (e) => { S.clicks.push({ ms: performance.now() - t0, target: desc(e.target), stopped: false }); }, false);
  // pointerup->click is where GTM's capture listener runs; also record pointerdown/up handler time.
})();`;

const HELPERS = `(() => {
  const visible = (el) => { if (!el || !el.isConnected) return false; if (el.checkVisibility && !el.checkVisibility({ checkOpacity: false, checkVisibilityCSS: true })) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  window.__vis = visible;
  window.__q = (sel, n = 0) => Array.from(document.querySelectorAll(sel)).filter(visible)[n] || null;
})();`;

// Wrap dataLayer.push to time each synchronous push (GTM's own gtm.click push goes through it too).
const WRAP_DL = `(() => {
  const dl = window.dataLayer; window.__dlt = [];
  const orig = dl.push;
  dl.push = function () { const t = performance.now(); const r = orig.apply(this, arguments); const a = arguments[0];
    let ev = a && a.event; if (!ev && a && typeof a.length === 'number') ev = 'args:' + a[0] + ':' + a[1];
    window.__dlt.push({ ev: String(ev), ms: performance.now() - t, at: t }); return r; };
  return { wrapped: true, gtmPresent: !!(window.google_tag_manager && window.google_tag_manager['GTM-TGBNQXN']) };
})()`;

function allowed(url) {
	if (url.startsWith('data:') || url.startsWith('blob:')) return true;
	let u;
	try { u = new URL(url); } catch { return false; }
	if (u.hostname === 'thingsboard.io') return true;
	if (u.hostname === 'www.googletagmanager.com' && (u.pathname === '/gtm.js' || u.pathname === '/gtag/js')) return true;
	return false;
}

async function main() {
	const port = 9800 + Math.floor(Math.random() * 150);
	const userDir = `${DIR}/profile-${TAG}`;
	const chrome = spawn('/usr/bin/google-chrome', ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${userDir}`, '--no-first-run', '--no-default-browser-check', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--disable-extensions', `--window-size=${P.w},${P.h}`, '--enable-gpu', '--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', 'about:blank'], { stdio: 'ignore' });
	let ver;
	for (let i = 0; i < 50 && !ver; i++) { try { ver = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); } catch { await sleep(200); } }
	const page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === 'page');
	const c = new CDP(page.webSocketDebuggerUrl);
	await c.open();
	const cleanup = () => { c.close(); try { chrome.kill('SIGKILL'); } catch {} try { fs.rmSync(userDir, { recursive: true, force: true }); } catch {} };
	process.on('exit', cleanup);
	const out = { profile: profName, mode, reps: REPS, chrome: ver.Browser, startedAt: new Date().toISOString(), blocked: [], allowed3p: [], responses3p: [] };

	await c.send('Page.enable');
	await c.send('Runtime.enable');
	await c.send('Network.enable');
	await c.send('Performance.enable', { timeDomain: 'timeTicks' });
	// Belt: renderer-side block list for every analytics/ads collector (covers sendBeacon/keepalive).
	const pats = ['*google-analytics.com*', '*analytics.google.com*', '*doubleclick.net*', '*googleadservices.com*', '*google.com/*', '*googlesyndication*', '*googletagmanager.com/td*', '*googletagmanager.com/a?*', '*facebook*', '*linkedin*', '*licdn*', '*yourgpt*', '*mailerlite*', '*hotjar*', '*clarity.ms*'];
	try { await c.send('Network.setBlockedURLs', { urlPatterns: pats.map((p) => ({ urlPattern: p, block: true })) }); } catch { await c.send('Network.setBlockedURLs', { urls: pats }); }
	// Braces: allowlist at the network layer.
	await c.send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] });
	c.on('Fetch.requestPaused', async (p) => {
		const url = p.request.url;
		if (allowed(url)) {
			if (!url.includes('://thingsboard.io/')) out.allowed3p.push(url.slice(0, 120));
			try { await c.send('Fetch.continueRequest', { requestId: p.requestId }); } catch {}
		} else {
			out.blocked.push(url.slice(0, 160));
			try { await c.send('Fetch.failRequest', { requestId: p.requestId, errorReason: 'BlockedByClient' }); } catch {}
		}
	});
	c.on('Network.responseReceived', (p) => { const u = p.response.url; if (!allowed(u)) out.responses3p.push(u.slice(0, 160) + ' ' + p.response.status); });
	const reqs = [];
	c.on('Network.requestWillBeSent', (p) => reqs.push(p.request.url));

	const chromeMajor = (ver.Browser.match(/\/(\d+)/) || [])[1];
	const ua = P.mobile ? `Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeMajor}.0.0.0 Mobile Safari/537.36` : ver['User-Agent'].replace('HeadlessChrome', 'Chrome');
	await c.send('Emulation.setUserAgentOverride', { userAgent: ua, platform: P.mobile ? 'Android' : 'Linux' });
	await c.send('Emulation.setDeviceMetricsOverride', { width: P.w, height: P.h, deviceScaleFactor: P.dpr, mobile: P.mobile });
	if (P.mobile) await c.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
	await c.send('Emulation.setCPUThrottlingRate', { rate: P.cpu });
	await c.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
	await c.send('Page.addScriptToEvaluateOnNewDocument', { source: OBSERVERS });

	const ev = async (expression, awaitPromise = false) => {
		const r = await c.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise });
		if (r.exceptionDetails) throw new Error('eval: ' + JSON.stringify(r.exceptionDetails).slice(0, 400));
		return r.result.value;
	};
	const metrics = async () => { const r = await c.send('Performance.getMetrics'); const m = {}; r.metrics.forEach((x) => (m[x.name] = x.value)); return m; };
	let traceEvents = [], traceDone = null;
	c.on('Tracing.dataCollected', (p) => { for (const e of p.value) traceEvents.push(e); });
	c.on('Tracing.tracingComplete', () => traceDone && traceDone());

	const loaded = new Promise((r) => c.on('Page.loadEventFired', r));
	await c.send('Page.navigate', { url: TARGET });
	await loaded;
	await sleep(5000);
	for (let i = 0; i < 10; i++) { const n = reqs.length; await sleep(1000); if (reqs.length === n) break; }
	await ev(HELPERS);

	if (mode === 'gtm') {
		// GTM boot under trace, to size the tasks that would land as input delay (May 13 - Oct 7 loader).
		traceEvents = [];
		await c.send('Tracing.start', { transferMode: 'ReportEvents', traceConfig: { includedCategories: ['devtools.timeline', 'toplevel', 'v8.execute', 'disabled-by-default-devtools.timeline'], recordMode: 'recordAsMuchAsPossible' } });
		const m0 = await metrics();
		const nl = await ev('__inp.loafs.length');
		out.gtmBoot = await ev(`(() => { window.tbConsent = { v: 1, analytics: true, marketing: true, necessary: true };
      gtag('consent', 'update', { analytics_storage: 'granted', ad_storage: 'granted', ad_user_data: 'granted' });
      const t = performance.now(); window.tbLoadGtm(); return { calledAt: t, scriptTag: !!document.querySelector('script[src*="gtm.js?id=GTM-TGBNQXN"]') }; })()`);
		for (let i = 0; i < 40; i++) { await sleep(250); if (await ev(`!!(window.google_tag_manager && google_tag_manager['GTM-TGBNQXN'] && google_tag_manager['G-PMZCBFYH5Y'])`)) break; }
		await sleep(6000);
		const m1 = await metrics();
		const p = new Promise((r) => (traceDone = r));
		await c.send('Tracing.end');
		await p;
		out.gtmBoot.ready = await ev(`({ gtm: !!(window.google_tag_manager && google_tag_manager['GTM-TGBNQXN']), ga4: !!(window.google_tag_manager && google_tag_manager['G-PMZCBFYH5Y']), keys: Object.keys(window.google_tag_manager || {}).filter(k => /^(GTM|G|AW)-/.test(k)), dlLen: dataLayer.length })`);
		out.gtmBoot.metrics = { scriptMs: +((m1.ScriptDuration - m0.ScriptDuration) * 1000).toFixed(1), taskMs: +((m1.TaskDuration - m0.TaskDuration) * 1000).toFixed(1) };
		const mainTid = (() => { const tn = traceEvents.find((e) => e.name === 'thread_name' && e.args && e.args.name === 'CrRendererMain'); return tn ? { pid: tn.pid, tid: tn.tid } : null; })();
		const onMain = (e) => !mainTid || (e.pid === mainTid.pid && e.tid === mainTid.tid);
		const tasks = traceEvents.filter((e) => e.name === 'RunTask' && e.ph === 'X' && onMain(e)).map((e) => e.dur / 1000).sort((a, b) => b - a);
		const evalS = traceEvents.filter((e) => e.ph === 'X' && onMain(e) && (e.name === 'EvaluateScript' || e.name === 'v8.compile' || e.name === 'v8.evaluateModule') && JSON.stringify(e.args || {}).includes('googletagmanager')).map((e) => ({ n: e.name, ms: +(e.dur / 1000).toFixed(1), url: ((e.args.data && e.args.data.url) || '').slice(0, 80) }));
		out.gtmBoot.trace = { longestTasks: tasks.slice(0, 8).map((x) => +x.toFixed(1)), tasksOver50: tasks.filter((x) => x > 50).length, evalScripts: evalS };
		out.gtmBoot.loafs = (await ev(`__inp.loafs.slice(${nl})`)).map((l) => ({ dur: +l.duration.toFixed(1), blocking: +l.blockingDuration.toFixed(1), scripts: l.scripts.filter((s) => s.duration > 3).map((s) => `${(s.sourceURL || '').replace(/^https:\/\/www\.googletagmanager\.com/, 'GTM').slice(0, 60)} ${s.type} ${s.duration.toFixed(0)}ms f${(s.forced || 0).toFixed(0)}`) }));
		log('GTM boot', JSON.stringify(out.gtmBoot.ready), JSON.stringify(out.gtmBoot.metrics), JSON.stringify(out.gtmBoot.trace));
	}
	out.wrap = await ev(WRAP_DL);
	log('wrap', JSON.stringify(out.wrap));

	const results = [];
	out.interactions = results;
	const settle = P.cpu > 1 ? 1500 : 900;
	async function locate(expr) {
		const ok = await ev(`(() => { const el = ${expr}; if (!el) return false; el.scrollIntoView({ block: 'center', behavior: 'instant' }); return true; })()`);
		if (!ok) return { err: 'not found' };
		await sleep(300);
		await ev('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))', true);
		const r = await ev(`(() => { const el = ${expr}; const b = el.getBoundingClientRect(); const x = b.left + b.width * 0.5, y = b.top + b.height * 0.5; const hit = document.elementFromPoint(x, y);
      return { x, y, hit: __inp.desc(hit), ok: !!hit && (el === hit || el.contains(hit) || hit.contains(el)), link: !!(hit && hit.closest('a[href]')), blocked: !!(hit && hit.closest('#chat-launcher, iframe, #cc-main')) }; })()`);
		if (!r.ok) return { err: 'obscured by ' + r.hit };
		if (r.link || r.blocked) return { err: 'refused ' + r.hit };
		return r;
	}
	async function tap(x, y) {
		if (P.mobile) {
			const o = await ev('[visualViewport.offsetLeft, visualViewport.offsetTop, visualViewport.scale]');
			x = (x - o[0]) * o[2]; y = (y - o[1]) * o[2];
			await c.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, radiusX: 4, radiusY: 4, force: 1 }] });
			await sleep(70);
			await c.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
		} else {
			await c.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
			await sleep(120);
			await c.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
			await sleep(70);
			await c.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
		}
	}
	async function measure(label, expr) {
		const mark = await ev(`({ ne: __inp.events.length, nl: __inp.loafs.length, nc: __inp.clicks.length, nd: __dlt.length, t0: performance.now() })`);
		const m0 = await metrics();
		let info;
		if (expr === 'BG') {
			info = await ev(`(() => { const W = innerWidth, H = innerHeight; for (const fx of [0.01, 0.02, 0.98]) for (const fy of [0.5, 0.45, 0.55, 0.6, 0.4]) { const x = W * fx, y = H * fy; const h = document.elementFromPoint(x, y); if (!h || h.closest('a,button,input,label,select,summary,[role=button],[onclick],[tabindex],.sub-tab,.faq-item,.plan-card,.topup-item,#chat-launcher,#cc-main,header,.calc-modal-overlay')) continue; return { x, y, hit: __inp.desc(h) }; } return { err: 'no bg' }; })()`);
		} else info = await locate(expr);
		if (info.err) { results.push({ label, err: info.err }); log('SKIP', label, info.err); return; }
		await tap(info.x, info.y);
		await sleep(settle);
		await ev('new Promise(r => requestAnimationFrame(() => setTimeout(r, 50)))', true);
		const m1 = await metrics();
		const d = await ev(`({ events: __inp.events.slice(${mark.ne}), loafs: __inp.loafs.slice(${mark.nl}), clicks: __inp.clicks.slice(${mark.nc}), dl: __dlt.slice(${mark.nd}) })`);
		const byId = new Map();
		for (const e of d.events) { if (!e.interactionId) continue; if (!byId.has(e.interactionId)) byId.set(e.interactionId, []); byId.get(e.interactionId).push(e); }
		let best = null;
		for (const [, es] of byId) {
			const w = es.reduce((a, b) => (b.duration > a.duration ? b : a));
			const procAll = es.reduce((a, e) => a + (e.processingEnd - e.processingStart), 0);
			const cand = { duration: w.duration, inputDelay: +(w.processingStart - w.startTime).toFixed(1), processing: +(w.processingEnd - w.processingStart).toFixed(1), procAllEvents: +procAll.toFixed(1), presentation: +(w.startTime + w.duration - w.processingEnd).toFixed(1), events: es.map((e) => `${e.name}:${Math.round(e.duration)}p${Math.round(e.processingEnd - e.processingStart)}`).join(' ') };
			if (!best || cand.duration > best.duration) best = cand;
		}
		const gtmScripts = [];
		for (const l of d.loafs) for (const s of l.scripts) if (/googletagmanager/.test(s.sourceURL || '')) gtmScripts.push({ ms: +s.duration.toFixed(1), forced: +(s.forced || 0).toFixed(1), type: s.type, inv: (s.invoker || '').slice(0, 40) });
		const rec = {
			label,
			hit: info.hit,
			duration: best ? best.duration : 0,
			under16: !best,
			best,
			clickSyncMs: d.clicks.map((x) => +x.ms.toFixed(2)),
			dlPushes: d.dl.map((x) => `${x.ev}:${x.ms.toFixed(2)}`),
			dlPushMs: +d.dl.reduce((a, x) => a + x.ms, 0).toFixed(2),
			loafs: d.loafs.map((l) => +l.duration.toFixed(0)),
			gtmLoafScripts: gtmScripts,
			delta: { styleN: m1.RecalcStyleCount - m0.RecalcStyleCount, styleMs: +((m1.RecalcStyleDuration - m0.RecalcStyleDuration) * 1000).toFixed(1), layoutN: m1.LayoutCount - m0.LayoutCount, layoutMs: +((m1.LayoutDuration - m0.LayoutDuration) * 1000).toFixed(1), scriptMs: +((m1.ScriptDuration - m0.ScriptDuration) * 1000).toFixed(1), taskMs: +((m1.TaskDuration - m0.TaskDuration) * 1000).toFixed(1) },
		};
		results.push(rec);
		log(label.padEnd(36), best ? `${best.duration}ms d${best.inputDelay} p${best.processing} (all ${best.procAllEvents}) pres${best.presentation}` : '<16', `clickSync ${rec.clickSyncMs.join(',')}`, `dl ${rec.dlPushes.join(' ')}`, `L${rec.delta.layoutN}/${rec.delta.layoutMs} S${rec.delta.styleN}/${rec.delta.styleMs} js${rec.delta.scriptMs}`, gtmScripts.length ? 'gtmLoAF ' + JSON.stringify(gtmScripts) : '');
		if (!P.mobile) { await c.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: P.h - 5 }); }
		await sleep(400);
	}
	const Q = (sel, n = 0) => `__q(${JSON.stringify(sel)}, ${n})`;
	const ensureTab = async (id) => { if ((await ev(`document.querySelector('.sub-tab.active')?.dataset.subtab`)) !== id) await measure('(setup) tab ' + id, Q(`.sub-tab[data-subtab="${id}"]`)); };

	for (let i = 0; i < REPS; i++) {
		await measure('background click', 'BG');
		await ensureTab('thingsboard-cloud');
		await measure('sub-tab -> Private Cloud', Q('.sub-tab[data-subtab="thingsboard-private-cloud"]'));
		await measure('PC billing -> Annual', Q('.billing-toggle[data-toggle-id="tb-pc-billing"] .billing-toggle-label[data-value="annual"]'));
		await measure('PC billing -> Monthly', Q('.billing-toggle[data-toggle-id="tb-pc-billing"] .billing-toggle-label[data-value="monthly"]'));
		await measure('sub-tab -> On-premises', Q('.sub-tab[data-subtab="thingsboard-pe"]'));
		await measure('sub-tab -> Cloud', Q('.sub-tab[data-subtab="thingsboard-cloud"]'));
		const eu = await ev(`document.getElementById('region-select')?.checked`);
		await measure('region label toggle', Q(`.region-toggle-label[data-region="${eu ? 'na' : 'eu'}"]`));
		await measure('top-up accordion', Q('.pricing-section[data-section="thingsboard-cloud"] .topup-header'));
		await measure('FAQ item toggle', Q('.pricing-faq-block[style*="block"] .faq-category-content.active .faq-question-toggle', 0));
	}
	out.netCheck = { blockedCount: out.blocked.length, blockedHosts: [...new Set(out.blocked.map((u) => { try { return new URL(u).hostname + new URL(u).pathname.slice(0, 20); } catch { return u.slice(0, 40); } }))].slice(0, 40), allowed3p: [...new Set(out.allowed3p)], responses3p: out.responses3p };
	log('net', JSON.stringify(out.netCheck));
	fs.writeFileSync(`${DIR}/out-${profName}-${mode}-${Date.now()}.json`, JSON.stringify(out, null, 1));
	cleanup();
	process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
