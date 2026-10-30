// Record the promo's clips in headless Chrome, one fresh page load per clip (dev server on :5200):
//   node dev/promo/clips.mjs "http://localhost:5200/?clips=/dev/promo/shotplan.json" <outDir> <1-39|1-26,28> [width height]
// then cut them: python dev/promo/cut.py dev/promo/shotplan.json <outDir> video/ultra-elements-promo.mp4
// Holds the same machine-wide GPU lock as dev/look.mjs, saves MediaRecorder's download into outDir,
// and reports frame pacing (rAF intervals over 20 ms = a frame the recording held twice).
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const [url, outDir, which, W = 1920, H = 1080] = process.argv.slice(2);
const list = which.split(',').flatMap((p) => { const [a, b = a] = p.split('-').map(Number); return Array.from({ length: b - a + 1 }, (_, i) => a + i); });   // '1-26,29,31-39'
const PORT = 9495, CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const targets = async () => (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
const up = () => targets().then(() => true, () => false);

const LOCK = path.join(os.tmpdir(), 'ultra-elements-gpu.lock');
for (;;) {
  try { fs.mkdirSync(LOCK); fs.writeFileSync(path.join(LOCK, 'pid'), String(process.pid)); break; } catch (e) { if (e.code !== 'EEXIST') throw e; }
  let pid = 0; try { pid = Number(fs.readFileSync(path.join(LOCK, 'pid'), 'utf8')); } catch {}
  let dead = false; if (pid) try { process.kill(pid, 0); } catch { dead = true; }
  if (dead) fs.rmSync(LOCK, { recursive: true, force: true }); else await wait(500);
}
const unlock = () => { try { if (Number(fs.readFileSync(path.join(LOCK, 'pid'), 'utf8')) === process.pid) fs.rmSync(LOCK, { recursive: true, force: true }); } catch {} };
process.on('exit', unlock);

if (!(await up())) {
  spawn(CHROME, [`--remote-debugging-port=${PORT}`, `--user-data-dir=${path.join(os.tmpdir(), `look-${PORT}`)}`,
    '--headless=new', `--window-size=${+W + 16},${+H + 95}`, '--auto-accept-this-tab-capture', '--no-first-run', '--no-default-browser-check',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
    '--enable-gpu', '--use-angle=d3d11', '--ignore-gpu-blocklist', 'about:blank'], { detached: true, stdio: 'ignore' }).unref();
  for (let i = 0; i < 50 && !(await up()); i++) await wait(200);
}
const page = (await targets()).find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
let id = 0, done = null, logs = new Set(), saved = [];
const pending = new Map();
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); }
  if (d.method === 'Browser.downloadProgress' && d.params.state === 'completed') { saved.push(d.params.guid); done?.(d.params); }
  if (d.method === 'Runtime.exceptionThrown') logs.add(`EXCEPTION ${d.params.exceptionDetails.exception?.description ?? d.params.exceptionDetails.text}`.slice(0, 300));
  if (d.method === 'Runtime.consoleAPICalled' && (d.params.type === 'error' || d.params.type === 'warning')) logs.add(d.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 300));
};
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evaluate = async (e) => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })).result?.result?.value;

fs.mkdirSync(outDir, { recursive: true });
await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: path.resolve(outDir), eventsEnabled: true });
await send('Runtime.enable');
await send('Page.enable');
await send('Page.addScriptToEvaluateOnNewDocument', { source: `
  window.__pace = { n: 0, slow: 0, worst: 0, last: 0 };
  window.__caps = []; window.__t0 = 0;
  setInterval(() => { const c = document.getElementById('caption'); if (!c) return; const s = c.textContent; if (s !== window.__last) { window.__last = s; if (!window.__t0 && s) window.__t0 = performance.now(); window.__caps.push(((performance.now() - window.__t0) / 1000).toFixed(1) + ' ' + s); } }, 50);
  (function f(t) { const p = window.__pace; if (p.last && window.app) { const d = t - p.last; p.n++; if (d > 20) { p.slow++; if (window.__t0) (p.inTake ??= []).push(((t - window.__t0) / 1000).toFixed(1) + ':' + d.toFixed(0)); } p.worst = Math.max(p.worst, d); } p.last = t; requestAnimationFrame(f); })(0);` });
const t0 = Date.now(), failed = [];
for (const k of list) {
  const got = new Promise((r) => { done = r; });
  await send('Page.navigate', { url: `${url}&only=${k}` });
  const file = await Promise.race([got, wait(120000).then(() => null)]);
  const pace = JSON.parse(await evaluate('JSON.stringify(window.__pace)') ?? '{}');
  console.log(`clip ${k}: ${file ? 'saved' : 'TIMEOUT'} · slow frames ${pace.slow ?? '?'} ${(pace.inTake ?? []).join(' ')}`);
  if (!file) failed.push(k);
}
await send('Page.navigate', { url: 'about:blank' });
await wait(300);
await send('Browser.close');
console.log(`${saved.length} clips in ${outDir} after ${((Date.now() - t0) / 1000).toFixed(0)} s${failed.length ? ` · failed ${failed}` : ''}`);
for (const l of logs) if (!l.includes('X4000') && !l.includes('X3595') && !l.includes('X4008')) console.log('console:', l);
process.exit(0);
