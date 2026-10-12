// INP lab harness: drives headless Chrome over raw CDP against prod /pricing/.
// Usage: node run.mjs <profile> [--block3p] [--noanim] [--trace] [--tag=x]
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const DIR = '/tmp/claude-1000/-home-thingsboard095-tb-thingsboard-io/3973666f-bba9-429b-a45b-e0ddba54c47a/scratchpad/inp';
const TARGET = 'https://thingsboard.io/pricing/';
const PROFILES = {
	'mobile-4x': { w: 412, h: 823, dpr: 1.75, mobile: true, cpu: 4 },
	'mobile-1x': { w: 412, h: 823, dpr: 1.75, mobile: true, cpu: 1 },
	'desktop-1x': { w: 1350, h: 940, dpr: 1, mobile: false, cpu: 1 },
	'desktop-4x': { w: 1350, h: 940, dpr: 1, mobile: false, cpu: 4 },
	'desktop-6x': { w: 1350, h: 940, dpr: 1, mobile: false, cpu: 6 },
};
const args = process.argv.slice(2);
const profName = args[0];
const P = PROFILES[profName];
if (!P) throw new Error('unknown profile ' + profName);
const BLOCK3P = args.includes('--block3p');
const NOANIM = args.includes('--noanim');
const TRACE = args.includes('--trace');
const GPU = args.includes('--gpu');
const CALIB = args.includes('--calib');
const QUICK = args.includes('--quick');
const NOSMIL = args.includes('--nosmil');
const REDUCED = args.includes('--reducedmotion');
const DROPRULE = args.includes('--dropscriptrule');
const dropArg = args.find((a) => a.startsWith('--droprule='));
const DROPRE = dropArg ? dropArg.slice(11) : (DROPRULE ? 'script:last-child' : null);
const dprArg = args.find((a) => a.startsWith('--dpr='));
if (dprArg) P.dpr = Number(dprArg.slice(6));
const tagArg = args.find((a) => a.startsWith('--tag='));
const TAG = profName + (BLOCK3P ? '-3pblocked' : '') + (NOANIM ? '-noanim' : '') + (TRACE ? '-trace' : '') + (QUICK ? '-quick' : '') + (NOSMIL ? '-nosmil' : '') + (REDUCED ? '-reducedmotion' : '') + (DROPRULE ? '-dropscriptrule' : '') + (dropArg ? '-drop_' + dropArg.slice(11).replace(/[^a-z0-9]/gi, '') : '') + (dprArg ? '-dpr' + P.dpr : '') + (GPU ? '-gpu' : '-swgl') + (tagArg ? '-' + tagArg.slice(6) : '');
const REPS = args.includes('--quick') ? 1 : 3;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(`[${TAG}]`, ...a);

// ─── minimal CDP client ───
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
				} else if (d.method) {
					(this.handlers.get(d.method) || []).forEach((h) => h(d.params));
					(this.handlers.get('*') || []).forEach((h) => h(d));
				}
			};
		});
	}
	on(method, h) {
		if (!this.handlers.has(method)) this.handlers.set(method, []);
		this.handlers.get(method).push(h);
	}
	send(method, params = {}) {
		const id = ++this.id;
		this.ws.send(JSON.stringify({ id, method, params }));
		return new Promise((res, rej) => this.pending.set(id, { res, rej, method }));
	}
	close() {
		try {
			this.ws.close();
		} catch {}
	}
}

// ─── page-side instrumentation (injected before any page script) ───
const OBSERVERS = `(() => {
  const S = window.__inp = { events: [], loafs: [], fi: [], errs: [] };
  const desc = (n) => {
    if (!n || !n.tagName) return n ? String(n.nodeName) : null;
    let s = n.tagName.toLowerCase();
    if (n.id) s += '#' + n.id;
    if (n.classList && n.classList.length) s += '.' + Array.from(n.classList).slice(0, 2).join('.');
    return s;
  };
  S.desc = desc;
  const ev = (e) => ({ name: e.name, startTime: e.startTime, duration: e.duration, processingStart: e.processingStart,
    processingEnd: e.processingEnd, interactionId: e.interactionId || 0, target: desc(e.target) });
  try { new PerformanceObserver((l) => l.getEntries().forEach((e) => S.events.push(ev(e))))
    .observe({ type: 'event', durationThreshold: 16, buffered: true }); } catch (e) { S.errs.push('event:' + e); }
  try { new PerformanceObserver((l) => l.getEntries().forEach((e) => S.fi.push(ev(e))))
    .observe({ type: 'first-input', buffered: true }); } catch (e) { S.errs.push('fi:' + e); }
  try { new PerformanceObserver((l) => l.getEntries().forEach((e) => S.loafs.push({
      startTime: e.startTime, duration: e.duration, renderStart: e.renderStart, styleAndLayoutStart: e.styleAndLayoutStart,
      blockingDuration: e.blockingDuration, firstUIEventTimestamp: e.firstUIEventTimestamp,
      scripts: (e.scripts || []).map((s) => ({ sourceURL: s.sourceURL, sourceFunctionName: s.sourceFunctionName,
        invoker: s.invoker, invokerType: s.invokerType, startTime: s.startTime, duration: s.duration,
        executionStart: s.executionStart, forcedStyleAndLayoutDuration: s.forcedStyleAndLayoutDuration,
        pauseDuration: s.pauseDuration, sourceCharPosition: s.sourceCharPosition })) })))
    .observe({ type: 'long-animation-frame', buffered: true }); } catch (e) { S.errs.push('loaf:' + e); }
})();`;

const NOSMIL_JS = `(() => {
  const pause = () => document.querySelectorAll('svg').forEach((s) => { try { if (s.pauseAnimations && !s.ownerSVGElement) s.pauseAnimations(); } catch {} });
  document.addEventListener('DOMContentLoaded', pause);
  addEventListener('load', pause);
})();`;
const NOANIM_CSS = `(() => {
  const css = 'html, :root, #chat-launcher, #chat-launcher * { animation: none !important; }';
  const add = () => { const s = document.createElement('style'); s.id = '__noanim'; s.textContent = css; (document.head || document.documentElement).appendChild(s); };
  if (document.head) add(); else { const mo = new MutationObserver(() => { if (document.head) { mo.disconnect(); add(); } }); mo.observe(document, { childList: true, subtree: true }); }
})();`;

// Helpers defined in the page after load.
const HELPERS = `(() => {
  const visible = (el) => { if (!el || !el.isConnected) return false; if (el.checkVisibility && !el.checkVisibility({ checkOpacity: false, checkVisibilityCSS: true })) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  window.__vis = visible;
  window.__q = (sel, n = 0) => Array.from(document.querySelectorAll(sel)).filter(visible)[n] || null;
  window.__qAll = (sel) => Array.from(document.querySelectorAll(sel)).filter(visible);
})();`;

async function main() {
	const port = 9400 + Math.floor(Math.random() * 400);
	const userDir = `${DIR}/profile-${TAG}-${Date.now()}`;
	const chrome = spawn(
		'/usr/bin/google-chrome',
		[
			'--headless=new',
			`--remote-debugging-port=${port}`,
			`--user-data-dir=${userDir}`,
			'--no-first-run',
			'--no-default-browser-check',
			'--disable-background-timer-throttling',
			'--disable-renderer-backgrounding',
			'--disable-backgrounding-occluded-windows',
			'--disable-extensions',
			`--window-size=${P.w},${P.h}`,
			...(GPU ? ['--enable-gpu', '--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl'] : []),
			'about:blank',
		],
		{ stdio: ['ignore', 'ignore', 'ignore'], detached: false }
	);
	let ver;
	for (let i = 0; i < 50; i++) {
		try {
			ver = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
			break;
		} catch {
			await sleep(200);
		}
	}
	if (!ver) throw new Error('chrome did not start');
	const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
	const page = list.find((t) => t.type === 'page');
	const c = new CDP(page.webSocketDebuggerUrl);
	await c.open();
	const out = { tag: TAG, profile: profName, chrome: ver.Browser, block3p: BLOCK3P, noanim: NOANIM, trace: TRACE, gpu: GPU, nosmil: NOSMIL, reducedMotion: REDUCED, dpr: P.dpr, cpu: P.cpu, startedAt: new Date().toISOString() };

	const cleanup = () => {
		c.close();
		try {
			chrome.kill('SIGKILL');
		} catch {}
		try {
			fs.rmSync(userDir, { recursive: true, force: true });
		} catch {}
	};
	process.on('exit', cleanup);

	try {
		await c.send('Page.enable');
		await c.send('Runtime.enable');
		await c.send('Network.enable');
		await c.send('Performance.enable', { timeDomain: 'timeTicks' });
		// Network log for 3P inventory
		const reqs = [];
		c.on('Network.requestWillBeSent', (p) => reqs.push({ url: p.request.url, type: p.type, t: p.timestamp }));
		const failed = [];
		c.on('Network.loadingFailed', (p) => failed.push({ id: p.requestId, err: p.errorText, blocked: p.blockedReason }));

		const uaDefault = ver['User-Agent'].replace('HeadlessChrome', 'Chrome');
		const chromeMajor = (ver.Browser.match(/\/(\d+)/) || [])[1] || '155';
		const ua = P.mobile
			? `Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeMajor}.0.0.0 Mobile Safari/537.36`
			: uaDefault;
		await c.send('Emulation.setUserAgentOverride', { userAgent: ua, platform: P.mobile ? 'Android' : 'Linux' });
		await c.send('Emulation.setDeviceMetricsOverride', {
			width: P.w,
			height: P.h,
			deviceScaleFactor: P.dpr,
			mobile: P.mobile,
		});
		if (P.mobile) await c.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
		await c.send('Emulation.setCPUThrottlingRate', { rate: P.cpu });
		await c.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }, ...(REDUCED ? [{ name: 'prefers-reduced-motion', value: 'reduce' }] : [])] });

		if (BLOCK3P) {
			const pats = [
				'*googletagmanager.com*',
				'*google-analytics.com*',
				'*analytics.google.com*',
				'*doubleclick.net*',
				'*yourgpt*',
				'*mailerlite*',
				'*facebook.net*',
				'*linkedin.com*',
				'*licdn.com*',
				'*hotjar*',
				'*clarity.ms*',
				'*youtube.com*',
				'*ytimg.com*',
				'*api.github.com*',
				'*googleapis.com*',
				'*gstatic.com*',
				'*cloudflareinsights.com*',
			];
			try {
				await c.send('Network.setBlockedURLs', { urlPatterns: pats.map((p) => ({ urlPattern: p, block: true })) });
				out.blockMode = 'urlPatterns';
			} catch (e) {
				await c.send('Network.setBlockedURLs', { urls: pats });
				out.blockMode = 'urls';
			}
			out.blockPatterns = pats;
		}

		await c.send('Page.addScriptToEvaluateOnNewDocument', { source: OBSERVERS });
		if (NOANIM) await c.send('Page.addScriptToEvaluateOnNewDocument', { source: NOANIM_CSS });
		if (NOSMIL) await c.send('Page.addScriptToEvaluateOnNewDocument', { source: NOSMIL_JS });
		if (DROPRE) await c.send('Page.addScriptToEvaluateOnNewDocument', { source: `addEventListener('DOMContentLoaded', () => { const removed = []; const walk = (list, owner) => { for (let i = list.length - 1; i >= 0; i--) { const r = list[i]; if (r.cssRules && !r.selectorText) walk(r.cssRules, r); else if (r.selectorText && new RegExp(${JSON.stringify(DROPRE)}).test(r.selectorText) && r.selectorText.includes(':has(')) { removed.push(r.selectorText); owner.deleteRule(i); } } }; for (const sh of document.styleSheets) { try { walk(sh.cssRules, sh); } catch {} } window.__droppedRules = removed.length; });` });

		const ev = async (expression, awaitPromise = false) => {
			const r = await c.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise });
			if (r.exceptionDetails) throw new Error('eval: ' + JSON.stringify(r.exceptionDetails).slice(0, 500));
			return r.result.value;
		};
		const metrics = async () => {
			const r = await c.send('Performance.getMetrics');
			const m = {};
			r.metrics.forEach((x) => (m[x.name] = x.value));
			return m;
		};

		// ─── trace plumbing ───
		let traceEvents = [];
		let traceDone = null;
		c.on('Tracing.dataCollected', (p) => {
			for (const e of p.value) traceEvents.push(e);
		});
		c.on('Tracing.tracingComplete', () => traceDone && traceDone());
		const traceStart = async (cats) => {
			traceEvents = [];
			await c.send('Tracing.start', {
				transferMode: 'ReportEvents',
				traceConfig: { includedCategories: cats, recordMode: 'recordAsMuchAsPossible' },
			});
		};
		const traceStop = async () => {
			const p = new Promise((r) => (traceDone = r));
			await c.send('Tracing.end');
			await p;
			return traceEvents;
		};

		// ─── navigate ───
		const loaded = new Promise((r) => c.on('Page.loadEventFired', r));
		const tNav = Date.now();
		await c.send('Page.navigate', { url: TARGET });
		await loaded;
		out.loadMs = Date.now() - tNav;
		log('loaded in', out.loadMs, 'ms');
		await sleep(5000);
		// wait for network quiet (no new request in 2s), max 10s
		for (let i = 0; i < 10; i++) {
			const n = reqs.length;
			await sleep(1000);
			if (reqs.length === n) break;
		}
		await ev(HELPERS);
		out.consentBanner = await ev(`(() => { const cm = document.querySelector('#cc-main .cm'); return cm ? { present: true, hidden: cm.hidden, visible: window.__vis(cm), rect: (() => { const r = cm.getBoundingClientRect(); return [r.left, r.top, r.width, r.height].map(Math.round); })() } : { present: false }; })()`);
		out.state0 = await ev(`({ activeSubTab: document.querySelector('.sub-tab.active')?.dataset.subtab, regionEU: document.getElementById('region-select')?.checked, theme: document.documentElement.dataset.theme, url: location.href, promoBanner: !!document.querySelector('#promo-banner'), promoVisible: window.__vis(document.querySelector('#promo-banner')), rootAnim: getComputedStyle(document.documentElement).animationName, chatAnim: getComputedStyle(document.querySelector('#chat-launcher') || document.body).animationName, observerErrs: __inp.errs, droppedRules: window.__droppedRules, smilPaused: Array.from(document.querySelectorAll('svg')).filter(s => s.animationsPaused && s.animationsPaused()).length, smilElems: document.querySelectorAll('animate, animateTransform, animateMotion, set').length, bgSvgVisible: window.__vis(document.querySelector('.pricing-bg-svg')) })`);
		log('state0', JSON.stringify(out.state0), 'consent', JSON.stringify(out.consentBanner));

		// ─── DOM stats ───
		out.dom = await ev(`(() => {
      const all = document.querySelectorAll('*');
      const depth = new Map(); let maxDepth = 0;
      for (const el of all) { const d = (depth.get(el.parentElement) || 0) + 1; depth.set(el, d); if (d > maxDepth) maxDepth = d; }
      const body = document.body.querySelectorAll('*');
      let invisible = 0, invisibleNonMeta = 0;
      for (const el of body) { if (!el.checkVisibility()) { invisible++; if (!/^(SCRIPT|STYLE|TEMPLATE|NOSCRIPT|LINK|META)$/.test(el.tagName)) invisibleNonMeta++; } }
      const hiddenAttr = document.querySelectorAll('[hidden]'); let inHiddenAttr = 0; hiddenAttr.forEach(h => inHiddenAttr += h.querySelectorAll('*').length + 1);
      const inlineNone = document.querySelectorAll('[style*="display:none"], [style*="display: none"]'); let inInlineNone = 0; inlineNone.forEach(h => inInlineNone += h.querySelectorAll('*').length + 1);
      const per = {};
      for (const sel of ['.pricing-section','.pricing-faq-block','.calc-modal-overlay','[data-region-content]','[data-billing-content]','header.header','nav.head-menu','footer','#cc-main','#chat-launcher','.faq-section','svg']) {
        per[sel] = Array.from(document.querySelectorAll(sel)).map(e => ({ n: e.querySelectorAll('*').length + 1, visible: e.checkVisibility(), id: e.dataset.section || e.dataset.faqContext || e.id || e.dataset.regionContent || e.dataset.billingContent || '' }));
      }
      let rules = 0, hasRules = [], sheets = 0, xorigin = 0, customPropRoot = 0, animRules = 0;
      const walk = (list) => { for (const r of list) { rules++; if (r.selectorText && r.selectorText.includes(':has(')) hasRules.push(r.selectorText.slice(0, 140)); if (r.cssRules) walk(r.cssRules); } };
      for (const s of document.styleSheets) { sheets++; try { walk(s.cssRules); } catch { xorigin++; } }
      let animated = [];
      for (const el of all) { const cs = getComputedStyle(el); if (cs.animationName && cs.animationName !== 'none') animated.push(__inp.desc(el) + ' :: ' + cs.animationName + ' ' + cs.animationDuration + ' ' + cs.animationIterationCount + ' ' + cs.animationPlayState); }
      const svgEls = document.querySelectorAll('svg *').length;
      return { elements: all.length, bodyElements: body.length, maxDepth, invisibleInBody: invisible, invisibleNonMeta, hiddenAttrContainers: hiddenAttr.length, elementsInHiddenAttr: inHiddenAttr, inlineDisplayNoneContainers: inlineNone.length, elementsInInlineDisplayNone: inInlineNone, svgDescendants: svgEls, htmlBytes: document.documentElement.outerHTML.length, styleSheets: sheets, crossOriginSheets: xorigin, cssRules: rules, hasSelectorRules: hasRules.length, hasSelectorSamples: hasRules.slice(0, 40), animatedElements: animated, sections: per,
        docAnimations: document.getAnimations().map(a => ({ name: a.animationName || a.constructor.name, target: __inp.desc(a.effect && a.effect.target), playState: a.playState, timeline: a.timeline ? a.timeline.constructor.name : null })) };
    })()`);
		log('DOM', out.dom.elements, 'elements, depth', out.dom.maxDepth, 'invisible', out.dom.invisibleNonMeta, 'rules', out.dom.cssRules, ':has', out.dom.hasSelectorRules);

		// ─── idle activity: 5s ───
		const idle = async (label) => {
			const m0 = await metrics();
			const loafN = await ev('__inp.loafs.length');
			await traceStart(['devtools.timeline', 'disabled-by-default-devtools.timeline.frame', 'blink', 'cc', 'toplevel']);
			const t0 = await ev('performance.now()');
			await sleep(5000);
			const t1 = await ev('performance.now()');
			const tev = await traceStop();
			const m1 = await metrics();
			const loafs = await ev(`__inp.loafs.slice(${loafN})`);
			// main-thread analysis from trace
			const rendererMain = findRendererMain(tev);
			const sum = (name) => {
				let n = 0, d = 0;
				for (const e of tev) if (e.name === name && e.ph === 'X' && (!rendererMain || (e.pid === rendererMain.pid && e.tid === rendererMain.tid))) { n++; d += (e.dur || 0) / 1000; }
				return { n, ms: +d.toFixed(1) };
			};
			const topTasks = sum('RunTask');
			const frames = tev.filter((e) => e.name === 'DrawFrame' || e.name === 'Graphics.Pipeline' ).length;
			const beginMain = tev.filter((e) => e.name === 'BeginMainThreadFrame').length;
			const animFrames = tev.filter((e) => e.name === 'Animation' ).length;
			const dt = (t1 - t0) / 1000;
			const d = (k) => +((m1[k] - m0[k]) || 0).toFixed(4);
			const res = {
				label,
				seconds: +dt.toFixed(2),
				perSecond: {
					recalcStyleCount: +(d('RecalcStyleCount') / dt).toFixed(1),
					recalcStyleMs: +((d('RecalcStyleDuration') * 1000) / dt).toFixed(2),
					layoutCount: +(d('LayoutCount') / dt).toFixed(1),
					layoutMs: +((d('LayoutDuration') * 1000) / dt).toFixed(2),
					scriptMs: +((d('ScriptDuration') * 1000) / dt).toFixed(2),
					taskMs: +((d('TaskDuration') * 1000) / dt).toFixed(2),
				},
				trace: {
					runTask: topTasks,
					updateLayoutTree: sum('UpdateLayoutTree'),
					layout: sum('Layout'),
					paint: sum('Paint'),
					prePaint: sum('PrePaint'),
					commit: sum('Commit'),
					animate: sum('Animate'),
					beginMainThreadFrame: beginMain,
					drawFrames: frames,
					updateLayoutTreeElementCounts: tev.filter((e) => e.name === 'UpdateLayoutTree' && e.args && e.args.elementCount != null && (!rendererMain || e.pid === rendererMain.pid)).slice(0, 10).map((e) => e.args.elementCount),
				},
				loafs: loafs.length,
				loafMs: +loafs.reduce((a, l) => a + l.duration, 0).toFixed(1),
				threadBusyMsPerSec: threadBusy(tev, dt),
			};
			return res;
		};
		out.idle = await idle('idle-after-load');
		log('idle', JSON.stringify(out.idle.perSecond), JSON.stringify(out.idle.trace));

		// ─── interactions ───
		const results = [];
		out.interactions = results;
		let traceForInteractions = TRACE;
		if (traceForInteractions) await traceStart(['devtools.timeline', 'blink', 'toplevel', 'disabled-by-default-devtools.timeline', 'disabled-by-default-devtools.timeline.invalidationTracking', 'disabled-by-default-devtools.timeline.frame']);

		const settleMs = P.cpu > 1 ? 1500 : 900;

		// locate target, scroll it to center, return click point (or null)
		async function locate(expr, fx = 0.5, fy = 0.5, { allowLink = false, noScroll = false } = {}) {
			const ok = await ev(`(() => { const el = ${expr}; if (!el) return false; ${noScroll ? '' : "el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });"} return true; })()`);
			if (!ok) return { err: 'not found' };
			await sleep(300);
			await ev('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))', true);
			const r = await ev(`(() => { const el = ${expr}; const b = el.getBoundingClientRect(); const x = b.left + b.width * ${fx}, y = b.top + b.height * ${fy};
        const hit = document.elementFromPoint(x, y);
        const link = hit && hit.closest('a[href]');
        const chat = hit && hit.closest('#chat-launcher, [id*="yourgpt" i], iframe');
        const consent = hit && hit.closest('#cc-main');
        return { x, y, w: b.width, h: b.height, hit: __inp.desc(hit), hitOk: !!hit && (el === hit || el.contains(hit) || hit.contains(el)), link: link ? link.getAttribute('href') : null, chat: !!chat, consent: !!consent, el: __inp.desc(el) }; })()`);
			if (!r.hitOk) return { ...r, err: 'obscured by ' + r.hit };
			if (r.chat || r.consent) return { ...r, err: 'refused: chat/consent' };
			if (r.link && !allowLink) return { ...r, err: 'refused: link ' + r.link };
			return r;
		}

		async function dispatchClick(x, y) {
			if (P.mobile) {
				// Touch coordinates are visual-viewport relative; client rects are layout-viewport relative.
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
		async function dispatchKey(key) {
			const map = {
				ArrowRight: { code: 'ArrowRight', windowsVirtualKeyCode: 39 },
				ArrowLeft: { code: 'ArrowLeft', windowsVirtualKeyCode: 37 },
				Escape: { code: 'Escape', windowsVirtualKeyCode: 27 },
				Backspace: { code: 'Backspace', windowsVirtualKeyCode: 8 },
			};
			let k = map[key];
			let text;
			if (!k && /^[0-9]$/.test(key)) {
				k = { code: 'Digit' + key, windowsVirtualKeyCode: 48 + Number(key) };
				text = key;
			}
			await c.send('Input.dispatchKeyEvent', { type: text ? 'keyDown' : 'rawKeyDown', key, ...k, ...(text ? { text, unmodifiedText: text } : {}) });
			await sleep(60);
			await c.send('Input.dispatchKeyEvent', { type: 'keyUp', key, ...k });
		}
		async function dispatchHover(x, y) {
			// move in from slightly outside to fire enter events
			await c.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x - 30, y: y + 30 });
			await sleep(50);
			await c.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
		}

		async function measure(label, group, doIt) {
			const mark = await ev(`(() => { console.timeStamp('inp-start'); return { t0: performance.now(), ne: __inp.events.length, nl: __inp.loafs.length }; })()`);
			const m0 = await metrics();
			const info = await doIt();
			if (info && info.err) {
				results.push({ label, group, err: info.err, info });
				log('SKIP', label, info.err);
				return null;
			}
			await sleep(settleMs);
			await ev('new Promise(r => requestAnimationFrame(() => setTimeout(r, 50)))', true);
			const m1 = await metrics();
			const data = await ev(`(() => { console.timeStamp('inp-end'); return { events: __inp.events.slice(${mark.ne}), loafs: __inp.loafs.slice(${mark.nl}), t1: performance.now(), url: location.href, scrollY: scrollY }; })()`);
			const byId = new Map();
			for (const e of data.events) {
				if (!e.interactionId) continue;
				if (!byId.has(e.interactionId)) byId.set(e.interactionId, []);
				byId.get(e.interactionId).push(e);
			}
			const inter = [];
			for (const [id, es] of byId) {
				const worst = es.reduce((a, b) => (b.duration > a.duration ? b : a));
				const start = Math.min(...es.map((e) => e.startTime));
				const end = Math.max(...es.map((e) => e.startTime + e.duration));
				inter.push({
					interactionId: id,
					duration: worst.duration,
					worstEvent: worst.name,
					target: worst.target,
					inputDelay: +(worst.processingStart - worst.startTime).toFixed(1),
					processing: +(worst.processingEnd - worst.processingStart).toFixed(1),
					presentation: +(worst.startTime + worst.duration - worst.processingEnd).toFixed(1),
					events: es.map((e) => `${e.name}:${Math.round(e.duration)}(d${Math.round(e.processingStart - e.startTime)}/p${Math.round(e.processingEnd - e.processingStart)})`),
					window: [start, end],
				});
			}
			const nonInteraction = data.events.filter((e) => !e.interactionId).map((e) => `${e.name}:${Math.round(e.duration)}(p${Math.round(e.processingEnd - e.processingStart)})@${e.target}`);
			const best = inter.sort((a, b) => b.duration - a.duration)[0] || null;
			// LoAFs overlapping the worst interaction window (or the whole measure window if none)
			const w = best ? best.window : [mark.t0, data.t1];
			const loafs = data.loafs
				.filter((l) => l.startTime < w[1] && l.startTime + l.duration > w[0])
				.map((l) => {
					const end = l.startTime + l.duration;
					const scriptMs = l.scripts.reduce((a, s) => a + s.duration, 0);
					const forced = l.scripts.reduce((a, s) => a + (s.forcedStyleAndLayoutDuration || 0), 0);
					return {
						start: +l.startTime.toFixed(1),
						duration: +l.duration.toFixed(1),
						blocking: +l.blockingDuration.toFixed(1),
						scriptMs: +scriptMs.toFixed(1),
						forcedStyleLayoutMs: +forced.toFixed(1),
						preLayoutMs: l.renderStart ? +(l.styleAndLayoutStart - l.renderStart).toFixed(1) : 0,
						styleLayoutPaintMs: l.styleAndLayoutStart ? +(end - l.styleAndLayoutStart).toFixed(1) : 0,
						beforeRenderMs: +((l.renderStart || end) - l.startTime).toFixed(1),
						scripts: l.scripts
							.sort((a, b) => b.duration - a.duration)
							.slice(0, 6)
							.map((s) => ({
								src: (s.sourceURL || '').replace('https://thingsboard.io', '').slice(0, 110),
								fn: s.sourceFunctionName,
								invoker: (s.invoker || '').slice(0, 80),
								type: s.invokerType,
								ms: +s.duration.toFixed(1),
								forcedSL: +(s.forcedStyleAndLayoutDuration || 0).toFixed(1),
								char: s.sourceCharPosition,
							})),
					};
				});
			const d = (k) => +(((m1[k] - m0[k]) || 0) * 1000).toFixed(1);
			const rec = {
				label,
				group,
				duration: best ? best.duration : null,
				under16: !best,
				best,
				otherInteractions: inter.slice(1).map((i) => ({ d: i.duration, ev: i.worstEvent, t: i.target })),
				nonInteraction: nonInteraction.slice(0, 8),
				loafs,
				metricsDelta: {
					recalcStyleCount: (m1.RecalcStyleCount - m0.RecalcStyleCount) || 0,
					recalcStyleMs: d('RecalcStyleDuration'),
					layoutCount: (m1.LayoutCount - m0.LayoutCount) || 0,
					layoutMs: d('LayoutDuration'),
					scriptMs: d('ScriptDuration'),
					taskMs: d('TaskDuration'),
					windowMs: Math.round(data.t1 - mark.t0),
				},
				click: info ? { x: Math.round(info.x || 0), y: Math.round(info.y || 0), hit: info.hit } : null,
				urlAfter: data.url.replace('https://thingsboard.io', ''),
			};
			results.push(rec);
			log(
				label.padEnd(58),
				best ? `${best.duration}ms  delay ${best.inputDelay} proc ${best.processing} pres ${best.presentation} [${best.events.join(' ')}]` : '<16ms',
				loafs.length ? `LoAF ${loafs.map((l) => l.duration + '/' + l.scriptMs + 's/' + l.styleLayoutPaintMs + 'sl').join(',')}` : ''
			);
			return rec;
		}

		const clickSel = (label, group, expr, opts = {}) =>
			measure(label, group, async () => {
				const r = await locate(expr, opts.fx ?? 0.5, opts.fy ?? 0.5, opts);
				if (r.err) return r;
				await dispatchClick(r.x, r.y);
				return r;
			});
		const hoverSel = (label, group, expr) =>
			measure(label, group, async () => {
				const r = await locate(expr, 0.5, 0.5, { allowLink: true });
				if (r.err) return r;
				await dispatchHover(r.x, r.y);
				return r;
			});
		const keySel = (label, group, expr, key, focus = true) =>
			measure(label, group, async () => {
				if (focus) {
					const ok = await ev(`(() => { const el = ${expr}; if (!el) return false; el.scrollIntoView({ block: 'center', behavior: 'instant' }); el.focus({ preventScroll: true }); if (el.select && el.type !== 'range') { try { el.select(); } catch {} } return document.activeElement === el; })()`);
					if (!ok) return { err: 'focus failed' };
					await sleep(300);
				}
				await dispatchKey(key);
				return { x: 0, y: 0, hit: 'key:' + key };
			});
		const moveAway = async () => {
			if (!P.mobile) await c.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: P.h - 5 });
			await sleep(400);
		};
		const Q = (sel, n = 0) => `__q(${JSON.stringify(sel)}, ${n})`;
		const sec = (id) => `.pricing-section[data-section="${id}"]`;
		const ensureTab = async (id) => {
			const cur = await ev(`document.querySelector('.sub-tab.active')?.dataset.subtab`);
			if (cur !== id) await clickSel(`(setup) sub-tab -> ${id}`, 'setup', Q(`.sub-tab[data-subtab="${id}"]`));
		};
		const closeModalIfOpen = async () => {
			const open = await ev(`!!__q('.calc-modal-overlay .calc-modal-close')`);
			if (open) await clickSel('(setup) close calculator', 'setup', Q('.calc-modal-overlay .calc-modal-close'));
		};

		// 1. baseline: empty background
		for (let i = 0; i < REPS; i++) {
			await measure('baseline: click empty background', 'baseline', async () => {
				const pt = await ev(`(() => {
          const cands = [];
          const W = innerWidth, H = innerHeight;
          for (const fx of [0.01, 0.02, 0.98, 0.5]) for (const fy of [0.5, 0.45, 0.55, 0.6, 0.4]) cands.push([W * fx, H * fy]);
          for (const [x, y] of cands) { const h = document.elementFromPoint(x, y); if (!h) continue;
            if (h.closest('a,button,input,label,select,summary,[role=button],[onclick],[tabindex],.sub-tab,.faq-item,.plan-card,.topup-item,#chat-launcher,#cc-main,header,.calc-modal-overlay')) continue;
            return { x, y, hit: __inp.desc(h) }; }
          return null; })()`);
				if (!pt) return { err: 'no empty point' };
				await dispatchClick(pt.x, pt.y);
				return pt;
			});
			await moveAway();
		}

		// 2. sub-tab cycle
		await ensureTab('thingsboard-cloud');
		for (let i = 0; i < REPS; i++) {
			await clickSel('sub-tab: Cloud -> Private Cloud', 'sub-tab', Q('.sub-tab[data-subtab="thingsboard-private-cloud"]'));
			await clickSel('sub-tab: Private Cloud -> On-premises', 'sub-tab', Q('.sub-tab[data-subtab="thingsboard-pe"]'));
			await clickSel('sub-tab: On-premises -> Cloud', 'sub-tab', Q('.sub-tab[data-subtab="thingsboard-cloud"]'));
		}

		// 3. region toggle (Cloud tab)
		await ensureTab('thingsboard-cloud');
		for (let i = 0; i < REPS; i++) {
			const eu = await ev(`document.getElementById('region-select').checked`);
			await clickSel(`region: label -> ${eu ? 'North America' : 'Europe'}`, 'region', Q(`.region-toggle-label[data-region="${eu ? 'na' : 'eu'}"]`));
			await clickSel(`region: label -> ${eu ? 'Europe' : 'North America'}`, 'region', Q(`.region-toggle-label[data-region="${eu ? 'eu' : 'na'}"]`));
		}
		for (let i = 0; i < REPS; i++) await clickSel('region: switch (checkbox)', 'region', Q('.region-toggle-switch'));

		// 4. upsell "See Private Cloud Options" (tab switch via upsell)
		for (let i = 0; i < REPS; i++) {
			await ensureTab('thingsboard-cloud');
			await clickSel('upsell: See Private Cloud Options (switch tab)', 'sub-tab', Q(`${sec('thingsboard-cloud')} .upsell-card-btn[data-switch-to]`));
		}

		// 5. top-up accordion (Cloud tab)
		await ensureTab('thingsboard-cloud');
		for (let i = 0; i < REPS; i++) await clickSel('top-up accordion toggle', 'accordion', Q(`${sec('thingsboard-cloud')} .topup-header`));

		// 6. tooltips (hover) – plan features + add-ons (desktop meaningful; on mobile a hover = emulated tap-less move, skip)
		if (!P.mobile && !QUICK) {
			for (let i = 0; i < REPS; i++) {
				await hoverSel('hover: plan feature (i) tooltip', 'tooltip-hover', Q(`${sec('thingsboard-cloud')} .plan-card .plan-feature-info`, i));
				await moveAway();
			}
			for (let i = 0; i < REPS; i++) {
				await hoverSel('hover: add-on (i) tooltip', 'tooltip-hover', Q(`${sec('thingsboard-cloud')} .addon-tooltip-trigger`, i));
				await moveAway();
			}
		}

		// 7. Private Cloud: billing toggle, comparison tooltips, PC calculator
		await ensureTab('thingsboard-private-cloud');
		for (let i = 0; i < REPS; i++) {
			await clickSel('PC billing: -> Annual', 'billing', Q('.billing-toggle[data-toggle-id="tb-pc-billing"] .billing-toggle-label[data-value="annual"]'));
			await clickSel('PC billing: -> Monthly', 'billing', Q('.billing-toggle[data-toggle-id="tb-pc-billing"] .billing-toggle-label[data-value="monthly"]'));
		}
		if (!P.mobile && !QUICK) {
			for (let i = 0; i < REPS; i++) {
				await hoverSel('hover: comparison-table (i) tooltip', 'tooltip-hover', Q(`${sec('thingsboard-private-cloud')} .pc-comparison-tooltip-trigger`, i));
				await moveAway();
			}
		}
		for (let i = 0; i < REPS; i++) {
			await ensureTab('thingsboard-private-cloud');
			await clickSel(`PC calculator: open #${i + 1}${i === 0 ? ' (cold chunk)' : ''}`, 'calc-open', Q(`${sec('thingsboard-private-cloud')} .upsell-card-btn[onclick]`));
			await sleep(P.cpu > 1 ? 3000 : 1200);
			if (i === 0) {
				const pcSlider = `__q('#tb-pc-calc .calc-slider, .calc-modal-overlay .calc-slider')`;
				for (const fx of [0.35, 0.7, 0.15]) await clickSel(`PC calc: click slider track @${fx}`, 'calc-input', pcSlider, { fx });
				for (let k = 0; k < REPS; k++) await keySel('PC calc: slider ArrowRight', 'calc-input', pcSlider, 'ArrowRight', k === 0);
				const pcNum = `__q('.calc-modal-overlay .calc-number-input')`;
				let first = true;
				for (const dgt of ['2', '5', '0']) {
					await keySel(`PC calc: type digit into devices`, 'calc-input', pcNum, dgt, first);
					first = false;
				}
				// stepper + (first enabled increment button)
				for (let k = 0; k < REPS; k++) await clickSel('PC calc: stepper +', 'calc-input', `Array.from(document.querySelectorAll('.calc-modal-overlay .calc-stepper-btn[data-action="increment"]')).filter(b => __vis(b) && !b.disabled)[0] || null`);
				for (let k = 0; k < REPS; k++) await clickSel('PC calc: add-on switch', 'calc-input', `(__qAll('.calc-modal-overlay .calc-toggle')[0]) || null`);
			}
			await clickSel(`PC calculator: close #${i + 1}`, 'calc-close', Q('.calc-modal-overlay .calc-modal-close'));
			await closeModalIfOpen();
		}

		// 8. On-premises: billing toggle + PAYG calculator
		await ensureTab('thingsboard-pe');
		for (let i = 0; i < REPS; i++) {
			await clickSel('On-prem billing: -> Perpetual', 'billing', Q('.billing-toggle[data-toggle-id="tb-sm-billing"] .billing-toggle-label[data-value="perpetual"]', 0), { fx: 0.25 });
			await clickSel('On-prem billing: -> Subscription', 'billing', Q('.billing-toggle[data-toggle-id="tb-sm-billing"] .billing-toggle-label[data-value="payg"]', 0), { fx: 0.25 });
		}
		for (let i = 0; i < REPS; i++) {
			await ensureTab('thingsboard-pe');
			await clickSel(`PAYG calculator: open #${i + 1}${i === 0 ? ' (cold chunk)' : ''}`, 'calc-open', Q(`${sec('thingsboard-pe')} .upsell-card-btn[onclick]`));
			await sleep(P.cpu > 1 ? 3000 : 1200);
			if (i === 0) {
				for (const fx of [0.4, 0.75, 0.1]) await clickSel(`PAYG calc: click slider track @${fx}`, 'calc-input', `__q('#sm-slider')`, { fx });
				for (let k = 0; k < REPS; k++) await keySel('PAYG calc: slider ArrowRight', 'calc-input', `__q('#sm-slider')`, 'ArrowRight', k === 0);
				let first = true;
				for (const dgt of ['2', '5', '0']) {
					await keySel('PAYG calc: type digit into devices', 'calc-input', `__q('#sm-devices')`, dgt, first);
					first = false;
				}
				for (let k = 0; k < REPS; k++) await clickSel('PAYG calc: Edge add-on switch', 'calc-input', `(document.getElementById('sm-edge-toggle')?.closest('.calc-toggle')) || null`);
			}
			await clickSel(`PAYG calculator: close #${i + 1}`, 'calc-close', Q('.calc-modal-overlay .calc-modal-close'));
			await closeModalIfOpen();
		}

		// 9. FAQ (Cloud context)
		await ensureTab('thingsboard-cloud');
		const faqBlk = '.pricing-faq-block[style*="block"]';
		for (let i = 0; i < REPS; i++) {
			await clickSel('FAQ: category tab -> 2nd', 'faq', Q(`${faqBlk} .faq-cat-tab`, 1));
			await clickSel('FAQ: category tab -> 1st', 'faq', Q(`${faqBlk} .faq-cat-tab`, 0));
		}
		for (let i = 0; i < REPS; i++) await clickSel('FAQ: expand/collapse item', 'faq', Q(`${faqBlk} .faq-category-content.active .faq-question-toggle`, 0));
		for (let i = 0; i < REPS; i++) {
			await clickSel(`FAQ: category tab -> #${i + 1}`, 'faq', Q(`${faqBlk} .faq-cat-tab`, i));
			await clickSel('FAQ: Load more', 'faq', Q(`${faqBlk} .faq-category-content.active .faq-load-more:not(.faq-load-more--used)`));
		}

		// 10. (i) info click -> scroll-to-FAQ (also what a mobile tap on (i) does)
		for (let i = 0; i < REPS; i++) {
			await ensureTab('thingsboard-cloud');
			await clickSel('feature (i) click -> jump to FAQ', 'tooltip-click', Q(`${sec('thingsboard-cloud')} .plan-card .plan-feature-info`, i));
			await sleep(800);
			await moveAway();
		}

		// 11. header menu
		await ev(`window.scrollTo({ top: 0, behavior: 'instant' })`);
		await sleep(500);
		if (P.mobile) {
			for (let i = 0; i < REPS; i++) {
				await clickSel('header: burger open', 'header', Q('header .burger'), { noScroll: true });
				await sleep(300);
				await clickSel('header: expand "Products" in drawer', 'header', Q('nav.head-menu > ul > li span.main-menu-link'), { noScroll: false });
				await ev(`window.scrollTo({ top: 0, behavior: 'instant' })`);
				await clickSel('header: burger close', 'header', Q('header .burger'), { noScroll: true });
				await sleep(300);
			}
		} else {
			for (let i = 0; i < REPS; i++) {
				await hoverSel('header: hover "Products" (mega-menu open)', 'header', Q('nav.head-menu > ul > li[data-submenu-id]', i));
				await sleep(500);
				await moveAway();
			}
			for (let i = 0; i < REPS; i++) {
				await clickSel('header: click "Products" label (desktop no-op)', 'header', Q('nav.head-menu > ul > li[data-submenu-id] span.main-menu-link', 0), { noScroll: true });
				await moveAway();
			}
		}

		// 12. theme toggle
		for (let i = 0; i < REPS; i++) {
			if (P.mobile) {
				// theme toggle may live in the drawer
				const vis = await ev(`!!__q('.theme-toggle-btn')`);
				if (!vis) {
					await clickSel('(setup) burger open for theme', 'setup', Q('header .burger'), { noScroll: true });
					await sleep(400);
				}
			}
			await clickSel('theme toggle', 'theme', Q('.theme-toggle-btn'), { noScroll: false });
			if (P.mobile) {
				const open = await ev(`document.querySelector('header.header')?.classList.contains('opened-burger')`);
				if (open) await clickSel('(setup) burger close', 'setup', Q('header .burger'), { noScroll: true });
			}
			await moveAway();
		}

		// idle again after interactions (state changed)
		if (traceForInteractions) {
			const tev = await traceStop();
			out.interactionTrace = analyseInteractionTrace(tev);
			fs.writeFileSync(`${DIR}/trace-${TAG}.json`, JSON.stringify(tev));
		}
		out.idleAfter = await idle('idle-after-interactions');
		log('idleAfter', JSON.stringify(out.idleAfter.perSecond));

		out.consentBannerEnd = await ev(`(() => { const cm = document.querySelector('#cc-main .cm'); return cm ? { hidden: cm.hidden, visible: window.__vis(cm), cookie: /tb_consent=/.test(document.cookie) } : null; })()`);
		log('consent end', JSON.stringify(out.consentBannerEnd));
		// calibration: same browser config, trivial pages
		{
			const pages = {
				plain: '<!doctype html><meta name=viewport content="width=device-width"><body style="margin:0;height:3000px;background:#fff;font:16px sans-serif"><p style="padding:40px">calibration</p><button id=b style="margin:40px;padding:20px">button</button>',
				anim: '<!doctype html><meta name=viewport content="width=device-width"><style>@property --h{syntax:"<color>";inherits:true;initial-value:#3d50f5}@keyframes k{0%{--h:#3d50f5}50%{--h:#22c55e}100%{--h:#3d50f5}}#b{animation:k 15s linear infinite;background:var(--h);color:#fff}</style><body style="margin:0;height:3000px;background:#fff;font:16px sans-serif"><p style="padding:40px">calibration</p><button id=b style="margin:40px;padding:20px">button</button>',
			};
			out.calibration = {};
			for (const [name, html] of Object.entries(pages)) {
				const ld = new Promise((r) => c.on('Page.loadEventFired', r));
				await c.send('Page.navigate', { url: 'data:text/html,' + encodeURIComponent(html) });
				await ld;
				await sleep(1500);
				await ev(HELPERS);
				const before = results.length;
				for (let i = 0; i < 5; i++) await clickSel(`calibration(${name}): click button`, 'calibration', Q('#b'));
				out.calibration[name] = results.slice(before).map((r) => r.duration);
				results.splice(before);
			}
			log('calibration', JSON.stringify(out.calibration));
		}
		// 3P inventory
		const hosts = {};
		for (const r of reqs) {
			try {
				const h = new URL(r.url).host;
				hosts[h] = (hosts[h] || 0) + 1;
			} catch {}
		}
		out.requestHosts = hosts;
		out.failedRequests = failed.slice(0, 50);
		out.firstInput = await ev('__inp.fi');
		out.finalUrl = await ev('location.href');
		out.layoutViewport = await ev('({ innerWidth, innerHeight, docScrollWidth: document.documentElement.scrollWidth, vv: [visualViewport.width, visualViewport.height, visualViewport.scale] })');
	} finally {
		fs.writeFileSync(`${DIR}/out-${TAG}.json`, JSON.stringify(out, null, 1));
		log('wrote', `${DIR}/out-${TAG}.json`);
		cleanup();
	}
}

function threadBusy(tev, dt) {
	const tn = new Map(), pn = new Map();
	for (const e of tev) {
		if (e.ph === 'M' && e.name === 'thread_name') tn.set(e.pid + ':' + e.tid, e.args.name);
		if (e.ph === 'M' && e.name === 'process_name') pn.set(e.pid, e.args.name);
	}
	const acc = {};
	for (const e of tev) {
		if (e.ph !== 'X' || e.name !== 'ThreadControllerImpl::RunTask' && e.name !== 'ThreadPool_RunTask') continue;
		let t = tn.get(e.pid + ':' + e.tid) || String(e.tid);
		t = t.replace(/\d+$/, '');
		const k = (pn.get(e.pid) || e.pid) + '/' + t;
		acc[k] = (acc[k] || 0) + (e.dur || 0) / 1000;
	}
	const out = {};
	for (const [k, v] of Object.entries(acc).sort((a, b) => b[1] - a[1]).slice(0, 8)) out[k] = +(v / dt).toFixed(1);
	return out;
}
function onMainAll(tev, main) {
	return tev.filter((e) => main && e.pid === main.pid);
}
function topCounts(arr, n) {
	const m = new Map();
	for (const x of arr) m.set(x, (m.get(x) || 0) + 1);
	return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => v + 'x ' + k);
}
function findRendererMain(tev) {
	// thread named CrRendererMain whose process loaded thingsboard.io (pick the one with most events)
	const threads = tev.filter((e) => e.ph === 'M' && e.name === 'thread_name' && e.args && e.args.name === 'CrRendererMain');
	let best = null, bestN = -1;
	for (const t of threads) {
		const n = tev.reduce((a, e) => a + (e.pid === t.pid && e.tid === t.tid && e.name === 'RunTask' ? 1 : 0), 0);
		if (n > bestN) {
			bestN = n;
			best = t;
		}
	}
	return best ? { pid: best.pid, tid: best.tid } : null;
}

function analyseInteractionTrace(tev) {
	const main = findRendererMain(tev);
	const onMain = tev.filter((e) => main && e.pid === main.pid && e.tid === main.tid);
	const marks = onMain.filter((e) => e.name === 'TimeStamp' && e.args && e.args.data && /^inp-(start|end)$/.test(e.args.data.message));
	const windows = [];
	for (let i = 0; i < marks.length - 1; i++) {
		if (marks[i].args.data.message === 'inp-start' && marks[i + 1].args.data.message === 'inp-end') windows.push([marks[i].ts, marks[i + 1].ts]);
	}
	return windows.map(([a, b]) => {
		const inWin = onMain.filter((e) => e.ts >= a && e.ts <= b && e.ph === 'X');
		const agg = (name) => {
			const es = inWin.filter((e) => e.name === name);
			return { n: es.length, ms: +(es.reduce((s, e) => s + (e.dur || 0), 0) / 1000).toFixed(1), max: +(Math.max(0, ...es.map((e) => e.dur || 0)) / 1000).toFixed(1) };
		};
		const ult = inWin.filter((e) => e.name === 'UpdateLayoutTree');
		const lay = inWin.filter((e) => e.name === 'Layout');
		return {
			windowMs: Math.round((b - a) / 1000),
			updateLayoutTree: agg('UpdateLayoutTree'),
			ultElementCounts: ult.map((e) => (e.args && e.args.elementCount) || (e.args && e.args.beginData && e.args.beginData.elementCount)).filter((x) => x != null).slice(0, 12),
			layout: agg('Layout'),
			layoutObjects: lay.map((e) => e.args && e.args.beginData ? `${e.args.beginData.dirtyObjects}/${e.args.beginData.totalObjects}` : '').filter(Boolean).slice(0, 12),
			paint: agg('Paint'),
			prePaint: agg('PrePaint'),
			layerize: agg('Layerize'),
			commit: agg('Commit'),
			eventDispatch: agg('EventDispatch'),
			functionCall: agg('FunctionCall'),
			parseHTML: agg('ParseHTML'),
			hitTest: agg('HitTest'),
			scheduleStyleRecalc: inWin.filter((e) => e.name === 'ScheduleStyleRecalculation').length,
			invalidationTracking: inWin.filter((e) => e.name === 'StyleRecalcInvalidationTracking' || e.name === 'StyleInvalidatorInvalidationTracking').length,
			invReasons: topCounts(onMainAll(tev, main).filter((e) => e.ts >= a && e.ts <= b && /InvalidationTracking/.test(e.name)).map((e) => {
				const d = (e.args && e.args.data) || {};
				const sel = d.invalidationList ? d.invalidationList.map((l) => (l.classes || []).concat(l.ids || [], l.tagNames || [], l.attributes || [], l.pseudoClasses || []).join(',') + (l.subtree ? '[subtree]' : '') + (l.invalidateSelf ? '[self]' : '')).join('|') : '';
				return `${e.name.replace('InvalidationTracking', '')}:${d.reason || ''}:${d.changedPseudo || d.changedClass || d.changedAttribute || d.changedId || ''}:${(d.nodeName || '').slice(0, 50)}${sel ? ' {' + sel.slice(0, 120) + '}' : ''}`;
			}), 14),
			frames: inWin.filter((e) => e.name === 'BeginMainThreadFrame').length,
			rafs: agg('FireAnimationFrame'),
			mainThreadTasks: agg('RunTask'),
			threadControllerTasks: agg('ThreadControllerImpl::RunTask'),
		};
	});
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
