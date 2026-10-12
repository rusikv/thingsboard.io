import { spawn } from 'node:child_process';
import fs from 'node:fs';
const DIR = '/tmp/claude-1000/-home-thingsboard095-tb-thingsboard-io/3973666f-bba9-429b-a45b-e0ddba54c47a/scratchpad/inp';
const extra = process.argv.slice(2);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const port = 9800 + Math.floor(Math.random() * 100);
const ud = `${DIR}/profile-gpu-${Date.now()}`;
const ch = spawn('/usr/bin/google-chrome', ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${ud}`, '--no-first-run', ...extra, 'about:blank'], { stdio: 'ignore' });
let ver;
for (let i = 0; i < 50; i++) { try { ver = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); break; } catch {} await sleep(200); }
await sleep(1500);
const ws = new WebSocket(ver.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
const res = await new Promise((r) => { ws.onmessage = (m) => r(JSON.parse(m.data)); ws.send(JSON.stringify({ id: 1, method: 'SystemInfo.getInfo' })); });
const g = res.result.gpu;
console.log('flags:', extra.join(' ') || '(none)');
console.log('devices:', JSON.stringify(g.devices.map((d) => [d.vendorString || d.vendorId, d.deviceString || d.deviceId, d.driverVendor, d.driverVersion])));
console.log('featureStatus:', JSON.stringify(g.featureStatus));
console.log('auxAttributes gl_renderer:', g.auxAttributes && (g.auxAttributes.glRenderer || g.auxAttributes.gl_renderer), 'angle:', g.auxAttributes && g.auxAttributes.displayType);
ws.close(); ch.kill('SIGKILL'); await sleep(1000);
try { fs.rmSync(ud, { recursive: true, force: true }); } catch {}
process.exit(0);
