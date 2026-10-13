// Wave background parity: screenshot every .pricing-bg instance with everything else hidden,
// frozen at fixed animation times. Works on both the SMIL build and the CSS-animation build.
// Usage: node vis-waves.mjs <origin> <variant> <outdir>
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const [origin, variant, outDir] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const PAGES = ['/pricing/', '/', '/products/thingsboard-pe/', '/products/paas/'];
const VIEWS = [
	{ name: 'desktop', w: 1350, h: 940, dpr: 1, mobile: false },
	{ name: 'wide', w: 1920, h: 1080, dpr: 1, mobile: false },
	{ name: 'mobile', w: 412, h: 823, dpr: 1.75, mobile: true },
];
const THEMES = ['light', 'dark'];
const TIMES = [0, 7.3, 21.1];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const port = 9300 + Math.floor(Math.random() * 200);
const ud = `${outDir}/.prof-${variant}-${port}`;
const ch = spawn('/usr/bin/google-chrome', ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${ud}`, '--no-first-run', '--enable-gpu', '--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', 'about:blank'], { stdio: 'ignore' });
let list;
for (let i = 0; i < 60; i++) { try { list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); if (list.find((t) => t.type === 'page')) break; } catch {} await sleep(200); }
const ws = new WebSocket(list.find((t) => t.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0; const pend = new Map(); let loaded;
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } else if (d.method === 'Page.loadEventFired') loaded && loaded(); };
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, (d) => r(d.result || d)); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) console.error('ERR', JSON.stringify(r.exceptionDetails).slice(0, 300)); return r.result && r.result.value; };
await send('Page.enable');

const report = [];
for (const v of VIEWS) {
	await send('Emulation.setUserAgentOverride', v.mobile ? { userAgent: 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Mobile Safari/537.36', platform: 'Android' } : { userAgent: '' });
	await send('Emulation.setDeviceMetricsOverride', { width: v.w, height: v.h, deviceScaleFactor: v.dpr, mobile: v.mobile });
	for (const theme of THEMES) {
		// Starlight reads the stored theme before first paint.
		const sid = await send('Page.addScriptToEvaluateOnNewDocument', { source: `try{localStorage.setItem('starlight-theme','${theme}')}catch{}` });
		for (const page of PAGES) {
			const lp = new Promise((r) => (loaded = r));
			await send('Page.navigate', { url: origin + page });
			await lp;
			await sleep(2500);
			const n = await ev(`(() => {
				const s = document.createElement('style');
				s.textContent = 'body * { visibility: hidden !important; } .pricing-bg, .pricing-bg * { visibility: visible !important; }';
				document.head.appendChild(s);
				return document.querySelectorAll('.pricing-bg').length;
			})()`);
			const info = { page, view: v.name, theme, instances: n, theme_attr: await ev(`document.documentElement.dataset.theme`), anims: await ev(`document.getAnimations().filter(a => String(a.animationName||'').startsWith('pricing-bg-wave')).length`) };
			report.push(info);
			for (let i = 0; i < n; i++) {
				for (const t of TIMES) {
					// Freeze at t: SMIL via the SVG timeline, CSS via the Animation objects.
					await ev(`(() => {
						document.querySelectorAll('.pricing-bg svg').forEach((svg) => { if (!svg.ownerSVGElement && svg.pauseAnimations) { svg.pauseAnimations(); svg.setCurrentTime(${t}); } });
						document.getAnimations().forEach((a) => { if (String(a.animationName||'').startsWith('pricing-bg-wave')) { a.pause(); a.currentTime = ${t * 1000}; } });
					})()`);
					const rect = await ev(`(() => {
						const el = document.querySelectorAll('.pricing-bg')[${i}];
						if (getComputedStyle(el).position === 'fixed') { scrollTo(0, 0); return { x: 0, y: 0, width: innerWidth, height: innerHeight }; }
						el.scrollIntoView({ block: 'start' });
						const r = el.getBoundingClientRect();
						return { x: r.left + scrollX, y: r.top + scrollY, width: r.width, height: Math.min(r.height, 1600) };
					})()`);
					await ev(`new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 250))))`);
					const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { ...rect, scale: 1 } });
					const name = `${page.replace(/\//g, '_') || '_'}-${v.name}-${theme}-i${i}-t${t}.png`;
					fs.writeFileSync(`${outDir}/${name}`, Buffer.from(shot.data, 'base64'));
				}
			}
		}
		await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: sid.identifier });
	}
}
fs.writeFileSync(`${outDir}/report.json`, JSON.stringify(report, null, 1));
console.log(JSON.stringify(report));
ws.close(); ch.kill('SIGKILL'); await sleep(800); try { fs.rmSync(ud, { recursive: true, force: true }); } catch {}
process.exit(0);
