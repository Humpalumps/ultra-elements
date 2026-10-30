// Headless Chrome over CDP for deterministic checks. The page goes back to about:blank after every
// command, so a finished check leaves nothing rendering on the GPU.
//   node dev/look.mjs shot <out.png> <url>     load a ?shot=… url, wait for it to pause, capture
//   node dev/look.mjs eval <url> <js>          load the url, wait for start-up, evaluate, print JSON
//   node dev/look.mjs stop
// Console errors and warnings seen while loading are printed once each.
// Every shot/eval holds a machine-wide GPU lock (one check at a time).
// Env: LOOK_PORT (default 9441; one per parallel user), LOOK_PHONE=1 (Nord 4 viewport with touch),
// LOOK_PRELOAD=<file> (script to run before the page's own), CHROME (path to the browser).
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const PORT = Number(process.env.LOOK_PORT ?? 9441);
const CHROME = process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PHONE = !!process.env.LOOK_PHONE;
const [cmd, a1, a2] = process.argv.slice(2);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const targets = async () => (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
const up = () => targets().then(() => true, () => false);

async function start() {
  if (await up()) return;
  spawn(CHROME, [
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${path.join(os.tmpdir(), `look-${PORT}`)}`,
    '--headless=new', '--window-size=1920,1080', '--no-first-run', '--no-default-browser-check',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
    '--enable-gpu', '--use-angle=d3d11', '--ignore-gpu-blocklist', 'about:blank',
  ], { detached: true, stdio: 'ignore' }).unref();
  for (let i = 0; i < 50 && !(await up()); i++) await wait(200);
}

async function session() {
  const page = (await targets()).find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0;
  const pending = new Map(), logs = new Set();
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); }
    if (d.method === 'Runtime.consoleAPICalled' && (d.params.type === 'error' || d.params.type === 'warning')) logs.add(d.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 400));
    if (d.method === 'Runtime.exceptionThrown') logs.add(`EXCEPTION ${(d.params.exceptionDetails.exception?.description ?? d.params.exceptionDetails.text).slice(0, 400)}`);
  };
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  return { send, logs, close: () => ws.close() };
}
async function evaluate(s, expr) {
  const r = await s.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout: 3600000 });
  return r.result?.exceptionDetails ? { error: r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text } : r.result?.result?.value;
}
async function load(s, url) {
  await s.send('Runtime.enable');
  await s.send('Emulation.setDeviceMetricsOverride', PHONE
    ? { width: 354, height: 652, deviceScaleFactor: 3, mobile: true }
    : { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
  await s.send('Emulation.setTouchEmulationEnabled', { enabled: PHONE });
  if (process.env.LOOK_PRELOAD) { await s.send('Page.enable'); await s.send('Page.addScriptToEvaluateOnNewDocument', { source: fs.readFileSync(process.env.LOOK_PRELOAD, 'utf8') }); }
  await s.send('Page.navigate', { url });
  await wait(1000);
}
// One GPU check at a time across every look.mjs process (parallel agents queue here), so a
// benchmark never shares the GPU with someone else's shot. A lock left by a dead process is taken over.
const LOCK = path.join(os.tmpdir(), 'ultra-elements-gpu.lock');
async function lock() {
  for (;;) {
    try { fs.mkdirSync(LOCK); fs.writeFileSync(path.join(LOCK, 'pid'), String(process.pid)); return; } catch (e) { if (e.code !== 'EEXIST') throw e; }
    let pid = 0, age = 0;
    try { pid = Number(fs.readFileSync(path.join(LOCK, 'pid'), 'utf8')); } catch { try { age = Date.now() - fs.statSync(LOCK).mtimeMs; } catch {} }
    let dead = !pid && age > 10000;
    if (pid) try { process.kill(pid, 0); } catch { dead = true; }
    if (dead) fs.rmSync(LOCK, { recursive: true, force: true }); else await wait(500);
  }
}
const unlock = () => { try { if (Number(fs.readFileSync(path.join(LOCK, 'pid'), 'utf8')) === process.pid) fs.rmSync(LOCK, { recursive: true, force: true }); } catch {} };
process.on('exit', unlock);
process.on('SIGINT', () => process.exit(130));
process.on('SIGTERM', () => process.exit(143));

async function until(s, expr, tries = 480) {
  for (let i = 0; i < tries; i++) { if (await evaluate(s, expr) === true) return true; await wait(250); }
  return false;
}

if (cmd !== 'stop') await lock();
await start();
const s = await session();
if (cmd === 'stop') { await s.send('Browser.close'); console.log('closed'); }
else {
  if (cmd === 'eval') {
    await load(s, a1);
    if (!(await until(s, `!!window.app && document.getElementById('loading').textContent === ''`))) console.log('timeout waiting for start-up');
    console.log(JSON.stringify(await evaluate(s, a2), null, 1));
  } else if (cmd === 'shot') {
    await load(s, a2);
    const done = await until(s, 'window.app?.ui?.paused === true');
    await wait(300);
    const r = await s.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(a1, Buffer.from(r.result.data, 'base64'));
    console.log(done ? 'ok' : 'timeout', a1);
  } else console.log('usage: look.mjs shot <out.png> <url> | eval <url> <js> | stop');
  await wait(100);
  for (const l of s.logs) console.log('console:', l);
  await s.send('Page.navigate', { url: 'about:blank' });
}
s.close();
process.exit(0);
