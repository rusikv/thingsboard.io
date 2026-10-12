// Independent check of C1: forced-style cost + restyled element count per mutation type,
// per CSS variant of Starlight's list-spacing rule, on prod /pricing/. No clicks at all.
// Usage: node micro.mjs <cpuRate>
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const DIR = '/tmp/claude-1000/-home-thingsboard095-tb-thingsboard-io/3973666f-bba9-429b-a45b-e0ddba54c47a/scratchpad/inp/verify-C1';
const CPU = Number(process.argv[2] || 1);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const port = 9700 + Math.floor(Math.random() * 200);
const udd = fs.mkdtempSync(DIR + '/udd-');
const chrome = spawn('/usr/bin/google-chrome', ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${udd}`, '--no-first-run', '--window-size=1350,940', 'about:blank'], { stdio: 'ignore' });
let wsUrl;
for (let i = 0; i < 60; i++) { try { const j = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); const p = j.find((t) => t.type === 'page'); if (p) { wsUrl = p.webSocketDebuggerUrl; break; } } catch {} await sleep(200); }
const ws = new WebSocket(wsUrl); await new Promise((r) => (ws.onopen = r));
let id = 0; const pend = new Map(); const handlers = {};
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } else if (d.method && handlers[d.method]) handlers[d.method](d.params); };
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 400)); return r.result.result.value; };
let tevs = []; let tdone;
handlers['Tracing.dataCollected'] = (p) => tevs.push(...p.value);
handlers['Tracing.tracingComplete'] = () => tdone && tdone();
const traceStart = (cats) => { tevs = []; return send('Tracing.start', { transferMode: 'ReportEvents', traceConfig: { includedCategories: cats } }); };
const traceStop = async () => { const p = new Promise((r) => (tdone = r)); await send('Tracing.end'); await p; return tevs; };

await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1350, height: 940, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: 'https://thingsboard.io/pricing/' });
await sleep(10000);
await send('Emulation.setCPUThrottlingRate', { rate: CPU });

const NOT = 'a, strong, em, del, span, input, code, br, script';
const V038 = `.sl-markdown-content li > :is(:last-child:not(li, ul, ol, ${NOT}, :where(.not-content *)), :not(script):has(~ script:last-child):not(:has(~ :not(script)))) { margin-bottom: 1.25rem; }`;
const variants = {
	orig: null,
	drop: '',
	v038: V038,
	// 0.39 rule with the :has() argument narrowed to element types Markdown actually emits as block children
	listHasP: `.sl-markdown-content :is(ol, ul):has(> li > p) > li > :last-child:not(${NOT}) { margin-bottom: 1.25rem; }`,
	// same :has() but as the subject (no descendant/child after it)
	subjOnly: `.sl-markdown-content :is(ol, ul):has(> li > :not(${NOT}, ol, ul)) { --x: 1; }`,
};

console.log('chrome', (await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()).Browser, 'cpu', CPU);
console.log('rule:', await ev(`(() => {
  const find = (rules, parent) => { for (let i = 0; i < rules.length; i++) { const r = rules[i]; if (r.selectorText && r.selectorText.includes(':is(ol') && r.selectorText.includes('script:last-child')) return { parent, i, text: r.cssText }; if (r.cssRules) { const f = find(r.cssRules, r); if (f) return f; } } return null; };
  let n = 0; for (const s of document.styleSheets) { let f; try { f = find(s.cssRules, s); } catch { continue; } if (f) { window.__slot = f; n++; } }
  return n + ' match(es); ' + window.__slot.text.slice(0, 160);
})()`));
console.log('page:', JSON.stringify(await ev(`({ all: document.querySelectorAll('*').length, slmc: document.querySelectorAll('.sl-markdown-content').length, lists: document.querySelectorAll('ul,ol').length, visibleLists: Array.from(document.querySelectorAll('ul,ol')).filter(e => e.checkVisibility()).length, rendered: Array.from(document.querySelectorAll('*')).filter(e => e.checkVisibility()).length, planCardInList: !!document.querySelector('.plan-card')?.closest('ul,ol') })`)));

const apply = (txt) => `(() => { const f = window.__slot; f.parent.deleteRule(f.i); f.parent.insertRule(${JSON.stringify(txt)} || '.__never__{}', f.i); return 'ok'; })()`;
const restore = `(() => { const f = window.__slot; f.parent.deleteRule(f.i); f.parent.insertRule(f.text, f.i); return 'ok'; })()`;

// Mutation kinds. Each returns a function body run once per iteration; forced style is read afterwards.
await ev(`(() => {
  const vis = (e) => e && e.checkVisibility();
  const card = Array.from(document.querySelectorAll('.plan-card')).find(vis);
  const head = Array.from(document.querySelectorAll('h2, h3, .plan-card-name, .plan-card-title')).find(e => vis(e) && e.childNodes.length === 1 && e.firstChild.nodeType === 3);
  const hidden = document.querySelector('.calc-modal-overlay') ; // display:none until opened
  const foot = document.querySelector('footer');
  const leaf = Array.from(document.querySelectorAll('.plan-card span, .plan-card p')).find(vis);
  window.__M = {
    appendDivPlanCard: () => { const d = document.createElement('div'); d.textContent = 'x'; card.appendChild(d); return () => d.remove(); },
    appendSpanPlanCard: () => { const d = document.createElement('span'); d.textContent = 'x'; card.appendChild(d); return () => d.remove(); },
    appendDivFooter: () => { const d = document.createElement('div'); d.textContent = 'x'; foot.appendChild(d); return () => d.remove(); },
    appendDivHidden: () => { const d = document.createElement('div'); d.textContent = 'x'; hidden.appendChild(d); return () => d.remove(); },
    textContentHeading: () => { const old = head.textContent; head.textContent = old + ' '; return () => { head.textContent = old; }; },
    textDataHeading: () => { const t = head.firstChild; const old = t.data; t.data = old + ' '; return () => { t.data = old; }; },
    classToggleLeaf: () => { leaf.classList.add('__probe'); return () => leaf.classList.remove('__probe'); },
  };
  window.__info = { card: !!card, head: head && head.tagName + '.' + head.className, hidden: !!hidden, foot: !!foot, leaf: !!leaf };
})()`);
console.log('targets', JSON.stringify(await ev('window.__info')));

const bench = (kind, n) => `(() => {
  const m = window.__M[${JSON.stringify(kind)}]; const t = [];
  for (let k = 0; k < ${n}; k++) {
    document.body.offsetWidth;
    const t0 = performance.now(); const undo = m(); getComputedStyle(document.body).color; const t1 = performance.now();
    undo(); document.body.offsetWidth; t.push(t1 - t0);
  }
  t.sort((a, b) => a - b); return +t[Math.floor(t.length / 2)].toFixed(2);
})()`;

const kinds = ['appendDivPlanCard', 'appendSpanPlanCard', 'appendDivFooter', 'appendDivHidden', 'textContentHeading', 'textDataHeading', 'classToggleLeaf'];
const res = {};
for (let round = 0; round < 2; round++) {
	for (const [vn, txt] of Object.entries(variants)) {
		if (txt !== null) await ev(apply(txt));
		for (const k of kinds) {
			const v = await ev(bench(k, 25));
			(res[vn] ??= {})[k] ??= []; res[vn][k].push(v);
		}
		// one traced iteration per kind: element count of the forced style pass
		await traceStart(['devtools.timeline', 'disabled-by-default-devtools.timeline']);
		for (const k of kinds) { await ev(`console.timeStamp('K:${k}')`); await ev(bench(k, 1)); }
		const t = await traceStop();
		const ts = t.filter((e) => e.name === 'TimeStamp').map((e) => ({ k: e.args?.data?.message, ts: e.ts })).sort((a, b) => a.ts - b.ts);
		const ult = t.filter((e) => e.name === 'UpdateLayoutTree');
		for (let i = 0; i < ts.length; i++) {
			const k = ts[i].k.slice(2); const end = ts[i + 1]?.ts ?? Infinity;
			const counts = ult.filter((e) => e.ts > ts[i].ts && e.ts < end).map((e) => e.args?.elementCount ?? e.args?.data?.elementCount ?? e.args?.endData?.elementCount).filter((x) => x != null);
			((res[vn].__counts ??= {})[k] ??= []).push(Math.max(0, ...counts));
		}
		if (txt !== null) await ev(restore);
	}
}
console.log('median forced-style ms per mutation (2 rounds x 25 iters) | max restyled elements in traced iteration');
console.log('variant'.padEnd(10), kinds.map((k) => k.padEnd(20)).join(''));
for (const [vn, r] of Object.entries(res)) {
	console.log(vn.padEnd(10), kinds.map((k) => `${r[k].join('/')} [${r.__counts?.[k]?.join('/')}]`.padEnd(20)).join(''));
}
fs.writeFileSync(`${DIR}/micro-cpu${CPU}.json`, JSON.stringify(res, null, 1));
ws.close(); chrome.kill(); try { fs.rmSync(udd, { recursive: true, force: true }); } catch {}
