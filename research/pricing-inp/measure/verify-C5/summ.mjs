import fs from 'node:fs';
const DIR = '/home/ruru/projects/thingsboard.io-research/research/pricing-inp/measure/verify-C5';
const files = fs.readdirSync(DIR).filter((f) => /^out-.*\.json$/.test(f));
const latest = {};
for (const f of files) {
	const m = f.match(/^out-(.*)-(gtm|nogtm)-(\d+)\.json$/);
	if (!m) continue;
	const k = m[1] + '|' + m[2];
	if (!latest[k] || latest[k].t < +m[3]) latest[k] = { t: +m[3], f };
}
const med = (a) => { const s = a.filter((x) => x != null).sort((x, y) => x - y); if (!s.length) return null; const n = s.length; return n % 2 ? s[(n - 1) / 2] : +((s[n / 2 - 1] + s[n / 2]) / 2).toFixed(1); };
for (const prof of ['desktop-1x', 'desktop-4x', 'mobile-4x']) {
	const A = latest[prof + '|nogtm'], B = latest[prof + '|gtm'];
	if (!A || !B) { console.log(prof, 'missing', !!A, !!B); continue; }
	const a = JSON.parse(fs.readFileSync(`${DIR}/${A.f}`)), b = JSON.parse(fs.readFileSync(`${DIR}/${B.f}`));
	console.log(`\n=== ${prof}  (GTM boot: ${JSON.stringify(b.gtmBoot && b.gtmBoot.trace && { longest: b.gtmBoot.trace.longestTasks.slice(0, 4), eval: b.gtmBoot.trace.evalScripts.filter((e) => e.n === 'EvaluateScript').map((e) => e.ms) })}; net blocked ${b.netCheck.blockedCount}, 3p responses ${b.netCheck.responses3p.length})`);
	console.log('label'.padEnd(30), 'INP-dur A→B (med)', '  clickSync A→B', '  procAll A→B', '  dlPush(B)', '  pushes(B sample)');
	const labels = [...new Set(a.interactions.map((r) => r.label))].filter((l) => !l.startsWith('(setup)'));
	for (const l of labels) {
		const ra = a.interactions.filter((r) => r.label === l && !r.err), rb = b.interactions.filter((r) => r.label === l && !r.err);
		const f = (rs, fn) => med(rs.map(fn));
		const durA = f(ra, (r) => r.duration), durB = f(rb, (r) => r.duration);
		const csA = f(ra, (r) => r.clickSyncMs.reduce((x, y) => x + y, 0)), csB = f(rb, (r) => r.clickSyncMs.reduce((x, y) => x + y, 0));
		const pA = f(ra, (r) => r.best ? r.best.procAllEvents : 0), pB = f(rb, (r) => r.best ? r.best.procAllEvents : 0);
		const dl = f(rb, (r) => r.dlPushMs);
		console.log(l.padEnd(30), `${durA} → ${durB}  [${ra.map((r) => r.duration).join(',')} | ${rb.map((r) => r.duration).join(',')}]`.padEnd(40), `${csA} → ${csB}`.padEnd(16), `${pA} → ${pB}`.padEnd(16), String(dl).padEnd(8), (rb[0] ? rb[0].dlPushes.join(' ') : '').slice(0, 90));
	}
}
