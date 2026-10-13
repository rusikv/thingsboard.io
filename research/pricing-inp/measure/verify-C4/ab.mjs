// A/B: prod /pricing/ as served vs. the same chunks patched in flight with C4's fixes.
// Usage: node ab.mjs <desktop-4x|mobile-4x> <base|fix> [--reps=N] [--keep3p]
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const DIR = '/home/ruru/projects/thingsboard.io-research/research/pricing-inp/measure/verify-C4';
const TARGET = (process.env.TB_ORIGIN || 'https://thingsboard.io') + '/pricing/';
const PROFILES = {
	'mobile-4x': { w: 412, h: 823, dpr: 1.75, mobile: true, cpu: 4 },
	'desktop-4x': { w: 1350, h: 940, dpr: 1, mobile: false, cpu: 4 },
	'desktop-1x': { w: 1350, h: 940, dpr: 1, mobile: false, cpu: 1 },
};
const [profName, variant] = process.argv.slice(2);
const P = PROFILES[profName];
const repsArg = process.argv.find((a) => a.startsWith('--reps='));
const REPS = repsArg ? Number(repsArg.slice(7)) : 4;
const KEEP3P = process.argv.includes('--keep3p');
const TAG = `${profName}-${variant}${KEEP3P ? '-3p' : ''}-${Date.now() % 100000}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(`[${TAG}]`, ...a);

// ─── patches (exact strings verified unique in the prod chunks) ───
const PATCHES = {
	'index.astro_astro_type_script_index_0_lang': [
		// (a) drop the forced reflow; double rAF keeps the fade
		['(n.offsetWidth,requestAnimationFrame(()=>n.classList.add(`visible`)))', 'requestAnimationFrame(()=>requestAnimationFrame(()=>n.classList.add(`visible`)))'],
	],
	'calc-tb-payg.': [
		// (b) drop scrollTop save/restore around results.innerHTML
		['let h=x.parentElement?.scrollTop||0;x.innerHTML=m,x.parentElement&&(x.parentElement.scrollTop=h);', 'x.innerHTML=m;'],
		['let t=x.parentElement?.scrollTop||0;x.innerHTML=e,x.parentElement&&(x.parentElement.scrollTop=t);', 'x.innerHTML=e;'],
		// (c) slider change: skip the sync calculate when the input's rAF calculate is already queued
		['_.value=String(k.devices),z(),G()}})', '_.value=String(k.devices),z(),q||G()}})'],
		// (d) devices blur + add-on toggles: coalesce through the rAF scheduler
		['v.value=String(R(e)),z(),G()});function Y(', 'v.value=String(R(e)),z(),J()});function Y('],
		['e===`edge`&&!D[e].checked&&(k.addons.edge.count=1),G())})})', 'e===`edge`&&!D[e].checked&&(k.addons.edge.count=1),J())})})'],
	],
	'calc-tb-pc.': [
		['let c=g.parentElement?.scrollTop||0;if(g.innerHTML=a,g.parentElement&&(g.parentElement.scrollTop=c),', 'if(g.innerHTML=a,'],
		['let r=g.parentElement?.scrollTop||0;g.innerHTML=n,g.parentElement&&(g.parentElement.scrollTop=r);', 'g.innerHTML=n;'],
	],
};

class CDP {
	constructor(url) {
		this.ws = new WebSocket(url);
		this.id = 0;
		this.pending = new Map();
		this.handlers = new Map();
	}
	open() {
		return new Promise((res, rej) => {
			this.ws.onopen = res;
			this.ws.onerror = rej;
			this.ws.onmessage = (m) => {
				const d = JSON.parse(m.data);
				if (d.id && this.pending.has(d.id)) {
					const { res, rej, method } = this.pending.get(d.id);
					this.pending.delete(d.id);
					if (d.error) rej(new Error(method + ': ' + JSON.stringify(d.error)));
					else res(d.result);
				} else if (d.method) (this.handlers.get(d.method) || []).forEach((h) => h(d.params));
			};
		});
	}
	on(m, h) {
		if (!this.handlers.has(m)) this.handlers.set(m, []);
		this.handlers.get(m).push(h);
	}
	send(method, params = {}) {
		const id = ++this.id;
		this.ws.send(JSON.stringify({ id, method, params }));
		return new Promise((res, rej) => this.pending.set(id, { res, rej, method }));
	}
}

const OBSERVERS = `(() => {
  const S = window.__inp = { events: [], loafs: [] };
  const desc = (n) => { if (!n || !n.tagName) return n ? String(n.nodeName) : null; let s = n.tagName.toLowerCase(); if (n.id) s += '#' + n.id; if (n.classList && n.classList.length) s += '.' + Array.from(n.classList).slice(0, 2).join('.'); return s; };
  S.desc = desc;
  new PerformanceObserver((l) => l.getEntries().forEach((e) => S.events.push({ name: e.name, startTime: e.startTime, duration: e.duration, processingStart: e.processingStart, processingEnd: e.processingEnd, interactionId: e.interactionId || 0, target: desc(e.target) }))).observe({ type: 'event', durationThreshold: 16, buffered: true });
  new PerformanceObserver((l) => l.getEntries().forEach((e) => S.loafs.push({ startTime: e.startTime, duration: e.duration, styleAndLayoutStart: e.styleAndLayoutStart,
    scripts: (e.scripts || []).map((s) => ({ invoker: s.invoker, duration: s.duration, forced: s.forcedStyleAndLayoutDuration })) }))).observe({ type: 'long-animation-frame', buffered: true });
})();`;
const HELPERS = `(() => {
  const visible = (el) => { if (!el || !el.isConnected) return false; if (el.checkVisibility && !el.checkVisibility({ checkOpacity: false, checkVisibilityCSS: true })) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  window.__vis = visible;
  window.__q = (sel, n = 0) => Array.from(document.querySelectorAll(sel)).filter(visible)[n] || null;
})();`;

async function main() {
	const port = 9800 + Math.floor(Math.random() * 150);
	const userDir = `${DIR}/profile-${TAG}`;
	const chrome = spawn('/usr/bin/google-chrome', ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${userDir}`, '--no-first-run', '--no-default-browser-check', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--disable-extensions', `--window-size=${P.w},${P.h}`, '--enable-gpu', '--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', 'about:blank'], { stdio: 'ignore' });
	let ver;
	for (let i = 0; i < 50 && !ver; i++) {
		try {
			ver = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
		} catch {
			await sleep(200);
		}
	}
	const page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === 'page');
	const c = new CDP(page.webSocketDebuggerUrl);
	await c.open();
	const cleanup = () => {
		try { c.ws.close(); } catch {}
		try { chrome.kill('SIGKILL'); } catch {}
		try { fs.rmSync(userDir, { recursive: true, force: true }); } catch {}
	};
	process.on('exit', cleanup);
	const out = { tag: TAG, variant, profile: profName, chrome: ver.Browser, keep3p: KEEP3P, patched: [], results: [] };
	try {
		await c.send('Page.enable');
		await c.send('Runtime.enable');
		await c.send('Network.enable');
		await c.send('Performance.enable', { timeDomain: 'timeTicks' });
		await c.send('Network.setCacheDisabled', { cacheDisabled: true });
		if (!KEEP3P) {
			const pats = ['*googletagmanager.com*', '*google-analytics.com*', '*analytics.google.com*', '*doubleclick.net*', '*yourgpt*', '*mailerlite*', '*facebook.net*', '*linkedin.com*', '*licdn.com*', '*hotjar*', '*clarity.ms*', '*youtube.com*', '*ytimg.com*', '*api.github.com*', '*cloudflareinsights.com*'];
			await c.send('Network.setBlockedURLs', { urls: pats });
		}
		// intercept our three chunks in both variants (same overhead), patch only in `fix`
		await c.send('Fetch.enable', { patterns: Object.keys(PATCHES).map((k) => ({ urlPattern: `*${k}*`, requestStage: 'Response' })) });
		c.on('Fetch.requestPaused', async (p) => {
			try {
				const key = Object.keys(PATCHES).find((k) => p.request.url.includes(k));
				const b = await c.send('Fetch.getResponseBody', { requestId: p.requestId });
				let body = b.base64Encoded ? Buffer.from(b.body, 'base64').toString('utf8') : b.body;
				if (variant === 'fix' && key) {
					for (const [from, to] of PATCHES[key]) {
						const n = body.split(from).length - 1;
						out.patched.push({ file: key, n, from: from.slice(0, 50) });
						if (n === 1) body = body.replace(from, () => to);
					}
				}
				await c.send('Fetch.fulfillRequest', { requestId: p.requestId, responseCode: p.responseStatusCode || 200, responseHeaders: (p.responseHeaders || []).filter((h) => !/^(content-length|content-encoding)$/i.test(h.name)), body: Buffer.from(body, 'utf8').toString('base64') });
			} catch (e) {
				out.fetchErr = String(e);
				try { await c.send('Fetch.continueRequest', { requestId: p.requestId }); } catch {}
			}
		});
		const chromeMajor = (ver.Browser.match(/\/(\d+)/) || [])[1];
		await c.send('Emulation.setUserAgentOverride', { userAgent: P.mobile ? `Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeMajor}.0.0.0 Mobile Safari/537.36` : ver['User-Agent'].replace('HeadlessChrome', 'Chrome'), platform: P.mobile ? 'Android' : 'Linux' });
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
		const metrics = async () => {
			const r = await c.send('Performance.getMetrics');
			const m = {};
			r.metrics.forEach((x) => (m[x.name] = x.value));
			return m;
		};
		const loaded = new Promise((r) => c.on('Page.loadEventFired', r));
		await c.send('Page.navigate', { url: TARGET });
		await loaded;
		await sleep(7000);
		await ev(HELPERS);
		out.state0 = await ev(`({ tab: document.querySelector('.sub-tab.active')?.dataset.subtab, consent: !!document.querySelector('#cc-main .cm:not([hidden])') })`);

		async function locate(expr, fx = 0.5, fy = 0.5) {
			const ok = await ev(`(() => { const el = ${expr}; if (!el) return false; el.scrollIntoView({ block: 'center', behavior: 'instant' }); return true; })()`);
			if (!ok) return { err: 'not found' };
			await sleep(300);
			await ev('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))', true);
			return ev(`(() => { const el = ${expr}; const b = el.getBoundingClientRect(); const x = b.left + b.width * ${fx}, y = b.top + b.height * ${fy};
        const hit = document.elementFromPoint(x, y);
        const ok = !!hit && (el === hit || el.contains(hit) || hit.contains(el));
        const bad = hit && (hit.closest('a[href]') || hit.closest('#chat-launcher, iframe, #cc-main'));
        return { x, y, hit: __inp.desc(hit), err: !ok ? 'obscured by ' + __inp.desc(hit) : bad ? 'refused: link/chat/consent' : null }; })()`);
		}
		async function tap(x, y) {
			if (P.mobile) {
				const o = await ev('[visualViewport.offsetLeft, visualViewport.offsetTop, visualViewport.scale]');
				x = (x - o[0]) * o[2];
				y = (y - o[1]) * o[2];
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
		async function key(k) {
			const map = { ArrowRight: { code: 'ArrowRight', windowsVirtualKeyCode: 39 } };
			let d = map[k], text;
			if (!d) { d = { code: 'Digit' + k, windowsVirtualKeyCode: 48 + Number(k) }; text = k; }
			await c.send('Input.dispatchKeyEvent', { type: text ? 'keyDown' : 'rawKeyDown', key: k, ...d, ...(text ? { text, unmodifiedText: text } : {}) });
			await sleep(60);
			await c.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, ...d });
		}
		async function measure(label, doIt, record = true) {
			const mark = await ev(`({ ne: __inp.events.length, nl: __inp.loafs.length, t0: performance.now() })`);
			const m0 = await metrics();
			const info = await doIt();
			if (info && info.err) { log('SKIP', label, info.err); out.results.push({ label, err: info.err }); return; }
			await sleep(P.cpu > 1 ? 1500 : 900);
			await ev('new Promise(r => requestAnimationFrame(() => setTimeout(r, 50)))', true);
			const m1 = await metrics();
			const data = await ev(`({ events: __inp.events.slice(${mark.ne}), loafs: __inp.loafs.slice(${mark.nl}) })`);
			const byId = new Map();
			for (const e of data.events) if (e.interactionId) (byId.get(e.interactionId) || byId.set(e.interactionId, []).get(e.interactionId)).push(e);
			let best = null;
			for (const es of byId.values()) {
				const w = es.reduce((a, b) => (b.duration > a.duration ? b : a));
				if (!best || w.duration > best.duration) best = { duration: w.duration, ev: w.name, delay: Math.round(w.processingStart - w.startTime), proc: Math.round(w.processingEnd - w.processingStart), pres: Math.round(w.startTime + w.duration - w.processingEnd), all: es.map((e) => `${e.name}:${Math.round(e.duration)}`).join(' ') };
			}
			const forced = data.loafs.reduce((a, l) => a + l.scripts.reduce((s, x) => s + (x.forced || 0), 0), 0);
			const script = data.loafs.reduce((a, l) => a + l.scripts.reduce((s, x) => s + x.duration, 0), 0);
			const d = (k) => +(((m1[k] - m0[k]) || 0) * 1000).toFixed(1);
			const rec = { label, dur: best ? best.duration : 0, delay: best?.delay, proc: best?.proc, pres: best?.pres, events: best?.all, styleMs: d('RecalcStyleDuration'), layoutMs: d('LayoutDuration'), styleN: m1.RecalcStyleCount - m0.RecalcStyleCount, layoutN: m1.LayoutCount - m0.LayoutCount, scriptMs: d('ScriptDuration'), loafForced: +forced.toFixed(1), loafScript: +script.toFixed(1) };
			if (record) out.results.push(rec);
			log(label.padEnd(40), `${rec.dur}ms d${rec.delay}/p${rec.proc}/r${rec.pres}`, `style ${rec.styleMs}ms x${rec.styleN} layout ${rec.layoutMs}ms x${rec.layoutN} forced ${rec.loafForced}`, rec.events || '');
		}
		const click = (label, expr, opts = {}, record = true) => measure(label, async () => { const r = await locate(expr, opts.fx, opts.fy); if (r.err) return r; await tap(r.x, r.y); return r; }, record);
		const Q = (sel, n = 0) => `__q(${JSON.stringify(sel)}, ${n})`;
		const sec = (id) => `.pricing-section[data-section="${id}"]`;
		const ensureTab = async (id) => { if ((await ev(`document.querySelector('.sub-tab.active')?.dataset.subtab`)) !== id) await click('(setup) tab ' + id, Q(`.sub-tab[data-subtab="${id}"]`), {}, false); };

		// A. sub-tab switches
		await ensureTab('thingsboard-cloud');
		for (let i = 0; i < REPS; i++) {
			await click('subtab Cloud->PC', Q('.sub-tab[data-subtab="thingsboard-private-cloud"]'));
			await click('subtab PC->Cloud', Q('.sub-tab[data-subtab="thingsboard-cloud"]'));
		}
		// B. PC calculator
		await ensureTab('thingsboard-private-cloud');
		await click('(setup) PC open cold', Q(`${sec('thingsboard-private-cloud')} .upsell-card-btn[onclick]`), {}, false);
		await sleep(3000);
		for (let i = 0; i < REPS; i++) await click('PC add-on switch', `(Array.from(document.querySelectorAll('.calc-modal-overlay .calc-toggle')).filter(__vis)[0]) || null`);
		for (let i = 0; i < Math.min(REPS, 3); i++) await click('PC stepper +', `Array.from(document.querySelectorAll('.calc-modal-overlay .calc-stepper-btn[data-action="increment"]')).filter(b => __vis(b) && !b.disabled)[0] || null`);
		await click('(setup) close', Q('.calc-modal-overlay .calc-modal-close'), {}, false);
		for (let i = 0; i < 2; i++) {
			await click('PC calc reopen', Q(`${sec('thingsboard-private-cloud')} .upsell-card-btn[onclick]`));
			await sleep(800);
			await click('(setup) close', Q('.calc-modal-overlay .calc-modal-close'), {}, false);
		}
		// C. PAYG calculator
		await ensureTab('thingsboard-pe');
		await click('(setup) PAYG open cold', Q(`${sec('thingsboard-pe')} .upsell-card-btn[onclick]`), {}, false);
		await sleep(3000);
		const edge = `(document.getElementById('sm-edge-toggle')?.closest('.calc-toggle')) || null`;
		for (let i = 0; i < REPS; i++) await click('PAYG Edge switch (no blur)', edge);
		const focusEl = async (expr) => ev(`(() => { const el = ${expr}; if (!el) return false; el.scrollIntoView({ block: 'center', behavior: 'instant' }); el.focus({ preventScroll: true }); if (el.select && el.type !== 'range') { try { el.select(); } catch {} } return document.activeElement === el; })()`);
		await focusEl(`document.getElementById('sm-slider')`);
		await sleep(300);
		for (let i = 0; i < REPS; i++) await measure('PAYG slider ArrowRight', async () => { await key('ArrowRight'); return {}; });
		out.sliderAfterArrows = await ev(`({ slider: document.getElementById('sm-slider').value, devices: document.getElementById('sm-devices').value })`);
		for (let i = 0; i < Math.min(REPS, 3); i++) {
			await focusEl(`document.getElementById('sm-devices')`);
			await sleep(300);
			for (const dg of ['2', '5', '0', '0']) { await key(dg); await sleep(250); }
			await sleep(800);
			await click('PAYG Edge switch after typing (blur)', edge);
		}
		await click('(setup) close', Q('.calc-modal-overlay .calc-modal-close'), {}, false);
		for (let i = 0; i < 2; i++) {
			await click('PAYG calc reopen', Q(`${sec('thingsboard-pe')} .upsell-card-btn[onclick]`));
			await sleep(800);
			await click('(setup) close', Q('.calc-modal-overlay .calc-modal-close'), {}, false);
		}
	} catch (e) {
		out.error = String(e && e.stack || e);
		log('ERROR', out.error);
	} finally {
		fs.writeFileSync(`${DIR}/ab-${TAG}.json`, JSON.stringify(out, null, 1));
		log('patched', JSON.stringify(out.patched), 'fetchErr', out.fetchErr || '-');
		cleanup();
		process.exit(0);
	}
}
main();
