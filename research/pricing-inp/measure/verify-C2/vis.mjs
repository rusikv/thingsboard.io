// Visual parity: SMIL original vs WAAPI-layer prototype, both frozen at the same animation times.
// Usage: node vis.mjs <desktop|mobile>
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const OUT = '/tmp/claude-1000/-home-thingsboard095-tb-thingsboard-io/3973666f-bba9-429b-a45b-e0ddba54c47a/scratchpad/inp/verify-C2';
const kind = process.argv[2];
const mobile = kind === 'mobile';
const P = mobile ? { w: 412, h: 823, dpr: 1.75 } : { w: 1350, h: 940, dpr: 1 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const port = 9100 + Math.floor(Math.random() * 150);
const ud = `${OUT}/prof3-${Date.now()}`;
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
if (mobile) await send('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Mobile Safari/537.36', platform: 'Android' });
await send('Emulation.setDeviceMetricsOverride', { width: P.w, height: P.h, deviceScaleFactor: P.dpr, mobile });
const lp = new Promise((r) => (loaded = r));
await send('Page.navigate', { url: 'https://thingsboard.io/pricing/' });
await lp;
await sleep(4000);
// hide everything except the background so the diff only sees the waves
await ev(`(() => { const s = document.createElement('style'); s.textContent = 'body * { visibility: hidden !important; } .pricing-bg, .pricing-bg * { visibility: visible !important; } #chat-launcher{animation:none!important}'; document.head.appendChild(s); scrollTo(0, 0); })()`);
await ev(`(() => {
	const svg = document.querySelector('.pricing-bg .pricing-bg-svg');
	const cs = getComputedStyle(svg);
	const wrap = document.createElement('div');
	for (const p of ['position', 'right', 'top', 'width', 'height', 'transform', 'transform-origin', 'mask-image', '-webkit-mask-image']) wrap.style.setProperty(p, cs.getPropertyValue(p));
	wrap.style.overflow = 'visible';
	const w = parseFloat(cs.width), h = parseFloat(cs.height);
	const s = Math.max(w / 900, h / 900);
	const mk = () => { const n = svg.cloneNode(false); n.removeAttribute('class'); n.setAttribute('style', 'position:absolute;left:0;top:0;width:100%;height:100%;overflow:visible;will-change:transform'); return n; };
	const base = mk(); base.style.willChange = 'auto';
	const dc = svg.querySelector('defs').cloneNode(true); dc.querySelectorAll('[id]').forEach((g) => (g.id = g.id + 'x')); base.appendChild(dc);
	svg.querySelectorAll(':scope > rect').forEach((r) => { const c = r.cloneNode(true); c.setAttribute('fill', c.getAttribute('fill').replace(')', 'x)')); base.appendChild(c); });
	wrap.appendChild(base);
	window.__anims = [];
	svg.querySelectorAll(':scope > g').forEach((g) => {
		const at = g.querySelector('animateTransform');
		const from = Number(at.getAttribute('from').split(' ')[1]), to = Number(at.getAttribute('to').split(' ')[1]);
		const n = mk(); n.appendChild(g.querySelector('path').cloneNode(true)); wrap.appendChild(n);
		const a = n.animate([{ transform: 'translateY(' + from * s + 'px)' }, { transform: 'translateY(' + to * s + 'px)' }], { duration: parseFloat(at.getAttribute('dur')) * 1000, iterations: Infinity, easing: 'linear' });
		a.pause(); __anims.push(a);
	});
	svg.after(wrap); wrap.style.display = 'none';
	window.__svg = svg; window.__wrap = wrap;
	window.__show = (which, t) => {
		svg.pauseAnimations(); svg.setCurrentTime(t);
		__anims.forEach((a) => (a.currentTime = t * 1000));
		svg.style.display = which === 'smil' ? '' : 'none';
		wrap.style.display = which === 'fix' ? '' : 'none';
		return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 300))));
	};
	return { w, h, s };
})()`);
for (const t of [0, 7.3, 21.1]) for (const which of ['smil', 'fix']) {
	await ev(`__show(${JSON.stringify(which)}, ${t})`);
	await sleep(400);
	const r = await send('Page.captureScreenshot', { format: 'png' });
	fs.writeFileSync(`${OUT}/vis-${kind}-${which}-t${t}.png`, Buffer.from(r.data, 'base64'));
}
ws.close(); ch.kill('SIGKILL'); await sleep(800); try { fs.rmSync(ud, { recursive: true, force: true }); } catch {}
console.log('ok');
process.exit(0);
