// For every PricingBackground instance on a page: does Chrome composite its wave animations, and how much
// renderer-main work remains with the instance in view (waves running vs paused)?
// Usage: TB_ORIGIN=http://localhost:4321 node compcheck.mjs <desktop|mobile> <cpu> <path> [<path> ...]
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const [kind, cpuS, ...paths] = process.argv.slice(2);
const mobile = kind === 'mobile';
const cpu = Number(cpuS || 1);
const ORIGIN = process.env.TB_ORIGIN || 'http://localhost:4321';
const DIR = new URL('.', import.meta.url).pathname;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const port = 9600 + Math.floor(Math.random() * 90);
const ud = `${DIR}profile-${Date.now()}`;
const ch = spawn('/usr/bin/google-chrome', ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${ud}`, '--no-first-run', '--enable-gpu', '--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', 'about:blank'], { stdio: 'ignore' });
let list;
for (let i = 0; i < 60; i++) { try { list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); if (list.length) break; } catch {} await sleep(200); }
const ws = new WebSocket(list.find((t) => t.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0; const pend = new Map(); let evs = []; let done; let loaded;
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } else if (d.method === 'Tracing.dataCollected') evs.push(...d.params.value); else if (d.method === 'Tracing.tracingComplete') done(); else if (d.method === 'Page.loadEventFired') loaded && loaded(); };
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, (d) => r(d.result || d)); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expression) => (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result?.value;

await send('Page.enable');
if (mobile) {
	await send('Emulation.setDeviceMetricsOverride', { width: 412, height: 823, deviceScaleFactor: 1.75, mobile: true });
	await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
} else {
	await send('Emulation.setDeviceMetricsOverride', { width: 1350, height: 940, deviceScaleFactor: 1, mobile: false });
}
await send('Emulation.setCPUThrottlingRate', { rate: cpu });

const CATS = ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'blink.animations', 'cc', 'toplevel', 'blink'];
async function trace(ms) {
	evs = [];
	const dp = new Promise((r) => (done = r));
	await send('Tracing.start', { transferMode: 'ReportEvents', traceConfig: { includedCategories: CATS } });
	await sleep(ms);
	await send('Tracing.end');
	await dp;
	return evs;
}
function mainStats(events, ms) {
	const tn = new Map(); for (const e of events) if (e.ph === 'M' && e.name === 'thread_name') tn.set(e.pid + ':' + e.tid, e.args.name);
	const mains = [...tn.entries()].filter(([, n]) => n === 'CrRendererMain').map(([k]) => k);
	let best = null, bn = 0; for (const k of mains) { const n = events.filter((e) => e.pid + ':' + e.tid === k).length; if (n > bn) { bn = n; best = k; } }
	const M = events.filter((e) => e.pid + ':' + e.tid === best && e.ph === 'X');
	const s = ms / 1000;
	const sum = (name) => M.filter((e) => e.name === name).reduce((a, e) => a + (e.dur || 0), 0) / 1000 / s;
	const cnt = (name) => M.filter((e) => e.name === name).length / s;
	const top = M.filter((e) => e.name === 'RunTask').reduce((a, e) => a + (e.dur || 0), 0) / 1000 / s;
	return { taskMsPerS: +top.toFixed(1), recalcPerS: +cnt('UpdateLayoutTree').toFixed(0), recalcMsPerS: +sum('UpdateLayoutTree').toFixed(1), layoutPerS: +cnt('Layout').toFixed(0), paintPerS: +cnt('Paint').toFixed(0), framesPerS: +(events.filter((e) => e.name === 'AnimationFrame' && e.ph === 'b' && e.pid + ':' + e.tid === best).length / s).toFixed(0) };
}
function animVerdicts(events) {
	// Blink logs each animation as an async 'Animation' event (displayName = keyframes name) and adds a
	// 'compositeFailed' instant only when it cannot run that animation on the compositor.
	const out = new Map();
	for (const e of events) {
		if (e.name !== 'Animation') continue;
		const key = JSON.stringify(e.id2 || e.id);
		const d = e.args?.data || {};
		const cur = out.get(key) || {};
		if (d.displayName) cur.name = d.displayName;
		if (d.nodeName) cur.node = d.nodeName;
		if ('compositeFailed' in d) { cur.compositeFailed = d.compositeFailed; cur.unsupported = d.unsupportedProperties; }
		out.set(key, cur);
	}
	return [...out.values()].filter((a) => (a.name || '').startsWith('wave-bg-'));
}

const report = [];
for (const path of paths) {
	const lp = new Promise((r) => (loaded = r));
	await send('Page.navigate', { url: ORIGIN + path });
	await lp;
	await ev(`(() => { const s = document.createElement('style'); s.textContent = '#chat-launcher{animation:none!important}'; document.head.appendChild(s); })()`);
	await sleep(4000);
	const n = await ev(`document.querySelectorAll('.wave-bg').length`);
	for (let i = 0; i < n; i++) {
		await ev(`(() => { document.getElementById('bgcheck-pause')?.remove(); const bg = document.querySelectorAll('.wave-bg')[${i}]; (bg.parentElement).scrollIntoView({ block: 'center', behavior: 'instant' }); })()`);
		await sleep(1500);
		// Fresh animation events for this instance: restart its waves inside the trace window.
		const t1p = trace(3000);
		await sleep(150);
		await ev(`(() => { const bg = document.querySelectorAll('.wave-bg')[${i}]; bg.querySelectorAll('.wave-bg__wave').forEach((w) => { w.style.animation = 'none'; void w.offsetWidth; w.style.animation = ''; }); })()`);
		const run = await t1p;
		const verdicts = animVerdicts(run);
		const running = mainStats(run, 3000);
		await ev(`(() => { const s = document.createElement('style'); s.id = 'bgcheck-pause'; s.textContent = '.wave-bg__wave{animation-play-state:paused!important}'; document.head.appendChild(s); })()`);
		await sleep(800);
		const paused = mainStats(await trace(3000), 3000);
		const info = await ev(`(() => { const bg = document.querySelectorAll('.wave-bg')[${i}]; const r = bg.getBoundingClientRect(); return { host: [...bg.parentElement.classList].find((c) => !c.startsWith('astro-')) || bg.parentElement.tagName, contained: bg.classList.contains('wave-bg--contained'), inView: r.bottom > 0 && r.top < innerHeight }; })()`);
		report.push({ path, i, ...info, waveAnimsSeen: verdicts.length, composited: verdicts.filter((v) => !v.compositeFailed).length, failed: verdicts.filter((v) => v.compositeFailed).map((v) => `${v.name}:${v.compositeFailed}${v.unsupported ? ' ' + v.unsupported : ''}`), running, paused });
	}
}
ws.close(); ch.kill();
const tag = `${kind}-${cpu}x`;
fs.writeFileSync(`${DIR}compcheck-${tag}.json`, JSON.stringify(report, null, 1));
await sleep(1500);
try { fs.rmSync(ud, { recursive: true, force: true }); } catch {}
for (const r of report) {
	console.log(`${tag} ${r.path} #${r.i} ${r.host}${r.contained ? ' (contained)' : ''} inView=${r.inView} | wave anims seen ${r.waveAnimsSeen}, composited ${r.composited}${r.failed.length ? ', FAILED ' + r.failed.join(' ') : ''}`);
	console.log(`    running: ${JSON.stringify(r.running)}`);
	console.log(`    paused:  ${JSON.stringify(r.paused)}`);
}
