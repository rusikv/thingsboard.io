// Analyse a saved trace: thread inventory, per-thread busy time, and the frame
// pipeline around the first N pointerdown dispatches.
import fs from 'node:fs';
const file = process.argv[2];
const N = Number(process.argv[3] || 3);
const tev = JSON.parse(fs.readFileSync(file, 'utf8'));
console.log('events', tev.length);
const tname = new Map();
const pname = new Map();
for (const e of tev) {
	if (e.ph === 'M' && e.name === 'thread_name') tname.set(e.pid + ':' + e.tid, e.args.name);
	if (e.ph === 'M' && e.name === 'process_name') pname.set(e.pid, e.args.name);
}
const thr = (e) => (pname.get(e.pid) || e.pid) + '/' + (tname.get(e.pid + ':' + e.tid) || e.tid);
// busy time per thread for selected names
const X = tev.filter((e) => e.ph === 'X' && e.dur != null);
const t0 = Math.min(...X.slice(0, 5000).map((e) => e.ts));
const t1 = X.reduce((m, e) => Math.max(m, e.ts + e.dur), 0);
const spanS = (t1 - t0) / 1e6;
console.log('trace span s', spanS.toFixed(1));
const names = {};
for (const e of X) {
	const k = thr(e) + ' :: ' + e.name;
	names[k] = names[k] || { n: 0, ms: 0 };
	names[k].n++;
	names[k].ms += e.dur / 1000;
}
const top = Object.entries(names)
	.filter(([k]) => /RasterTask|Raster|Paint|UpdateLayoutTree|Layout|PrePaint|Commit|DrawFrame|Display::Draw|SkiaOutputSurface|Swap|BeginMainThreadFrame|ProxyMain::BeginMainFrame|ActivateLayerTree|SMIL|SVG|Animation|RunTask|ThreadControllerImpl/.test(k))
	.sort((a, b) => b[1].ms - a[1].ms)
	.slice(0, 40);
for (const [k, v] of top) console.log(`${(v.ms / spanS).toFixed(1).padStart(7)} ms/s  ${String(v.n).padStart(7)}  ${k}`);

// pipeline around pointerdowns
const main = [...tname.entries()].filter(([, n]) => n === 'CrRendererMain').map(([k]) => k);
const pds = X.filter((e) => e.name === 'EventDispatch' && e.args && e.args.data && e.args.data.type === 'pointerdown').sort((a, b) => a.ts - b.ts);
console.log('pointerdowns', pds.length);
for (const pd of pds.slice(0, N)) {
	console.log(`\n=== pointerdown @${((pd.ts - t0) / 1000).toFixed(1)}ms (${thr(pd)})`);
	const win = X.filter((e) => e.ts >= pd.ts - 5000 && e.ts <= pd.ts + 70000 && e.dur >= 300 && !/^(ThreadControllerImpl::RunTask|RunTask|ThreadPool_RunTask)$/.test(e.name))
		.sort((a, b) => a.ts - b.ts);
	for (const e of win.slice(0, 90)) console.log(`  +${((e.ts - pd.ts) / 1000).toFixed(1).padStart(6)}  ${(e.dur / 1000).toFixed(1).padStart(6)}ms  ${thr(e).slice(0, 45).padEnd(45)} ${e.name}${e.args && e.args.data && e.args.data.type ? ' ' + e.args.data.type : ''}`);
}
