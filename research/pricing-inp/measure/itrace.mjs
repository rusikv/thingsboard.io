// Trace one click on a selector (desktop emulation) and print the main-thread timeline around it.
// Usage: node itrace.mjs <cpu> <selector> [--pre=<selector to click first, untraced>] [--noanim]
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const DIR = '/tmp/claude-1000/-home-thingsboard095-tb-thingsboard-io/3973666f-bba9-429b-a45b-e0ddba54c47a/scratchpad/inp';
const [cpuS, sel] = process.argv.slice(2);
const pre = (process.argv.find((a) => a.startsWith('--pre=')) || '').slice(6);
const cpu = Number(cpuS);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const port = 9600 + Math.floor(Math.random() * 90);
const ud = `${DIR}/profile-itrace-${Date.now()}`;
const ch = spawn('/usr/bin/google-chrome', ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${ud}`, '--no-first-run', '--enable-gpu', '--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', 'about:blank'], { stdio: 'ignore' });
let list; for (let i = 0; i < 50; i++) { try { list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); if (list.length) break; } catch {} await sleep(200); }
const ws = new WebSocket(list.find((t) => t.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0; const pend = new Map(); const evs = []; let done, loaded;
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } else if (d.method === 'Tracing.dataCollected') evs.push(...d.params.value); else if (d.method === 'Tracing.tracingComplete') done(); else if (d.method === 'Page.loadEventFired') loaded && loaded(); };
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, (d) => r(d.result || d)); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (e) => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })).result?.value;
await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1350, height: 940, deviceScaleFactor: 1, mobile: false });
await send('Emulation.setCPUThrottlingRate', { rate: cpu });
if (process.argv.includes('--noanim')) {
	await send('Page.addScriptToEvaluateOnNewDocument', { source: `addEventListener('DOMContentLoaded',()=>{const s=document.createElement('style');s.textContent='html,:root,#chat-launcher,#chat-launcher *{animation:none!important}';document.head.appendChild(s);document.querySelectorAll('svg').forEach(s=>s.pauseAnimations&&!s.ownerSVGElement&&s.pauseAnimations())})` });
}
const hasPat = (process.argv.find((a) => a.startsWith('--haspat=')) || '').slice(9);
if (hasPat) {
	await send('Page.addScriptToEvaluateOnNewDocument', { source: `addEventListener('DOMContentLoaded', () => { const re = new RegExp(${JSON.stringify(hasPat)}); const removed = []; const walk = (list, owner) => { for (let i = list.length - 1; i >= 0; i--) { const r = list[i]; if (r.cssRules && !r.selectorText) walk(r.cssRules, r); else if (r.selectorText && r.selectorText.includes(':has(') && re.test(r.selectorText)) { removed.push(r.selectorText.slice(0, 100)); owner.deleteRule(i); } } }; for (const sh of document.styleSheets) { try { walk(sh.cssRules, sh); } catch (e) { removed.push('ERR ' + e); } } window.__removedHas = removed.length; window.__removedList = removed; });` });
}
if (process.argv.includes('--nohas')) {
	await send('Page.addScriptToEvaluateOnNewDocument', { source: `addEventListener('DOMContentLoaded', () => { let n = 0; const walk = (list) => { for (let i = list.length - 1; i >= 0; i--) { const r = list[i]; if (r.cssRules && !r.selectorText) walk(r.cssRules); else if (r.selectorText && /(^|[\\s,>])(html|body|:root|\\.page)[^\\s,]*:has\\(/.test(r.selectorText)) { list === r.parentStyleSheet?.cssRules ? r.parentStyleSheet.deleteRule(i) : r.parentRule.deleteRule(i); n++; } } }; for (const sh of document.styleSheets) { try { walk(sh.cssRules); } catch {} } window.__removedHas = n; });` });
}
const lp = new Promise((r) => (loaded = r));
await send('Page.navigate', { url: 'https://thingsboard.io/pricing/' });
await lp; await sleep(6000);
const clickSel = async (s) => {
	const p = await ev(`(() => { const el = Array.from(document.querySelectorAll(${JSON.stringify(s)})).find(e => e.checkVisibility()); if (!el) return null; el.scrollIntoView({ block: 'center', behavior: 'instant' }); const r = el.getBoundingClientRect(); const x = r.left + r.width / 2, y = r.top + r.height / 2; const h = document.elementFromPoint(x, y); if (!h || h.closest('a[href], #cc-main, #chat-launcher')) return null; return { x, y }; })()`);
	if (!p) { console.log('target not clickable', s); return false; } console.log('clicked', s);
	await sleep(400);
	await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y }); await sleep(120);
	await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', clickCount: 1 }); await sleep(70);
	await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', clickCount: 1 });
	return true;
};
console.log('removed :has rules', await ev('window.__removedHas'));
if (pre) { for (const p of pre.split("||")) { await clickSel(p); await sleep(3000); } }
// position first (untraced), then trace the click
await ev(`(() => { const el = Array.from(document.querySelectorAll(${JSON.stringify(sel)})).find(e => e.checkVisibility()); el && el.scrollIntoView({ block: 'center', behavior: 'instant' }); })()`);
await sleep(800);
await send('Tracing.start', { transferMode: 'ReportEvents', traceConfig: { includedCategories: ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'blink', 'toplevel', 'v8.execute', 'blink.user_timing', ...(process.argv.includes('--inv') ? ['disabled-by-default-devtools.timeline.invalidationTracking'] : [])] } });
await sleep(300);
await clickSel(sel);
await sleep(1500);
const dp = new Promise((r) => (done = r));
await send('Tracing.end'); await dp;
const tn = new Map(); for (const e of evs) if (e.ph === 'M' && e.name === 'thread_name') tn.set(e.pid + ':' + e.tid, e.args.name);
const mains = [...tn.entries()].filter(([, n]) => n === 'CrRendererMain').map(([k]) => k);
let best = null, bn = 0; for (const k of mains) { const n = evs.filter((e) => e.pid + ':' + e.tid === k).length; if (n > bn) { bn = n; best = k; } }
const M = evs.filter((e) => e.pid + ':' + e.tid === best && e.ph === 'X').sort((a, b) => a.ts - b.ts || b.dur - a.dur);
const ed = M.filter((e) => e.name === 'EventDispatch');
const pdn = ed.find((e) => e.args.data.type === 'mousedown');
if (!pdn) { console.log('no mousedown'); process.exit(0); }
const t0 = pdn.ts;
console.log(`== click ${sel} @cpu ${cpu}x: events from mousedown-5ms to +250ms (dur>=1ms, depth-limited)`);
const tops = M.filter((e) => e.ts >= t0 - 5000 && e.ts <= t0 + 250000 && e.dur >= 1000 && /^(ThreadControllerImpl::RunTask)$/.test(e.name));
for (const t of tops) {
	console.log(`TASK +${((t.ts - t0) / 1000).toFixed(1)} ${(t.dur / 1000).toFixed(1)}ms`);
	const kids = M.filter((e) => e.ts >= t.ts && e.ts + e.dur <= t.ts + t.dur && e !== t && e.dur >= 1000 && !/RunTask|ThreadControllerImpl|Blink\..*UpdateTime|LocalFrameView::(UpdateStyleAndLayout|RunStyleAndLayoutLifecyclePhases|updateStyleAndLayoutIfNeededRecursive)|Document::(updateStyle|UpdateStyleAndLayout)$/.test(e.name));
	for (const k of kids.slice(0, 25)) {
		const d = k.args && k.args.data ? k.args.data : {};
		const info = d.type || d.functionName || (d.url ? d.url.split('/').pop() + ':' + d.lineNumber : '') || (k.args && k.args.elementCount != null ? 'elems=' + k.args.elementCount : '') || (k.args && k.args.beginData ? `dirty ${k.args.beginData.dirtyObjects}/${k.args.beginData.totalObjects}` : '');
		console.log(`    +${((k.ts - t0) / 1000).toFixed(1).padStart(6)} ${(k.dur / 1000).toFixed(1).padStart(6)}ms ${k.name} ${info}`);
	}
}
if (process.argv.includes('--inv')) {
	const inv = evs.filter((e) => /InvalidationTracking/.test(e.name) && e.ts >= t0 && e.ts <= t0 + 250000).map((e) => { const d = (e.args && e.args.data) || {}; const sel = d.invalidationList ? ' {' + d.invalidationList.map((l) => JSON.stringify(l)).join('|').slice(0, 300) + '}' : ''; return `${e.name.replace('InvalidationTracking', '')}:${d.reason || ''}:${d.changedPseudo || d.changedClass || d.changedAttribute || d.changedId || d.extraData || ''}:${(d.nodeName || '').slice(0, 70)}${sel}`; });
	const ic = {}; for (const x of inv) ic[x] = (ic[x] || 0) + 1;
	console.log('invalidations in window:'); for (const [k, v] of Object.entries(ic).filter(([k]) => !k.startsWith('Layout:')).sort((a, b) => b[1] - a[1]).slice(0, 40)) console.log(`   ${v}x ${k.slice(0, 400)}`);
}
ws.close(); ch.kill('SIGKILL'); await sleep(800); try { fs.rmSync(ud, { recursive: true, force: true }); } catch {}
process.exit(0);
