// node sheet.mjs <outdir> <queryExtra> [filter ids,comma]   one page load, every entry, 5 frames each -> JPEGs
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
const [out, query = '', filter = ''] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const ids = filter ? filter.split(',') : null;
const page = `(async () => {
  const a = app, res = [], cv = document.createElement('canvas'), g = cv.getContext('2d');
  const W = a.Q.mobile ? 212 : 640, H = a.Q.mobile ? 391 : 360; cv.width = W; cv.height = H;
  const snap = () => { g.drawImage(a.renderer.domElement, 0, 0, W, H); return cv.toDataURL('image/jpeg', 0.82).split(',')[1]; };
  const reset = () => { a.casts.clear(); a.fx.ground.clear(); a.fx.impacts.clear(); for (const d of a.fx.dummies) for (const k in d.status) d.status[k] = 0; for (let i = 0; i < 150; i++) a.stepFixed(); };
  const want = ${JSON.stringify(ids)};
  a.ui.paused = false;
  for (const e of a.ENTRIES) {
    if (want && !want.includes(e.spell.id)) continue;
    a.selectEntry(e.key);
    await a.warmSpell(e.spell);
    a.fx.particles.reseed(7);
    reset();
    const pt = a.fx.ARENA.dummies[0].clone().setY(1.1);
    a.casts.cast(e.spell, pt, { form: e.form || e.spell.forms?.[0], target: 0, seed: 7 });
    const c = a.casts.active();
    const frames = {}, shots = [];
    let f = 0, tImpact = -1, tEnd = -1;
    const cam = (n) => { a.setView(n); };
    cam('Target close-up');
    const charge = c.durations?.charge ?? 0.5;
    const shot = (name, v) => { if (v) { cam(v); a.stepFixed(); f++; } shots.push([name, snap()]); if (v) cam('Target close-up'); };
    let antic = false, rel = false, imp1 = false, imp2 = false, aft = false, linger = c.durations?.linger ?? 2, impactDur = c.durations?.impact ?? 0.2;
    while (a.casts.count() > 0 && f < 900) {
      a.stepFixed(); f++;
      const t = f / 60, ph = c.phase;
      if (!antic && t > charge * 0.75) { antic = true; shot('1-antic'); }
      if (!rel && t > charge + 0.2) { rel = true; shot('2-release'); }
      if (tImpact < 0 && (ph === 'impact' || ph === 'linger')) tImpact = t;
      if (tImpact >= 0 && !imp1 && t > tImpact + 0.18) { imp1 = true; shot('3-impact'); }
      if (tImpact >= 0 && !imp2 && t > tImpact + 0.5) { imp2 = true; shot('4-overview', 'Overview'); }
      if (tImpact >= 0 && !aft && t > tImpact + Math.max(1.2, linger * 0.6)) { aft = true; shot('5-after'); }
    }
    res.push({ key: e.key, name: e.name, frames: f, shots });
  }
  return res;
})()`;
const look = path.join('dev', 'look.mjs');
const r = spawnSync('node', [look, 'eval', `http://localhost:${process.env.UE_PORT ?? 5230}/?noattract${query}`, page], { encoding: 'utf8', maxBuffer: 1 << 30, env: process.env });
const text = r.stdout, end = text.lastIndexOf('\n]');
const json = JSON.parse(text.slice(text.indexOf('['), end + 2));
for (const e of json) for (const [n, b] of e.shots) fs.writeFileSync(path.join(out, `${e.key.replace(/[: ]/g, '_')}__${n}.jpg`), Buffer.from(b, 'base64'));
console.log(json.map((e) => `${e.name}: ${e.frames}f ${e.shots.length} shots`).join('\n'));
console.log(text.slice(end + 2).split('\n').filter((l) => /Shader Error|EXCEPTION|Error/.test(l)).join('\n').slice(0, 1500));
