// node strip.mjs <out.jpg> "<id:form|id:form>" "<camera>" "<t,t,t...>" [query] [W] : one row per spell, one column per time
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
const [out, list, cam, times, query = '', W = '480'] = process.argv.slice(2);
const page = `(async () => {
  const a = app, res = [], cv = document.createElement('canvas'), g = cv.getContext('2d');
  const rc = a.renderer.domElement, W = ${W}, H = Math.round(W * rc.height / rc.width); cv.width = W; cv.height = H;
  const snap = () => { g.drawImage(rc, 0, 0, W, H); return cv.toDataURL('image/jpeg', 0.85).split(',')[1]; };
  const reset = () => { a.casts.clear(); a.fx.ground.clear(); a.fx.impacts.clear(); for (const d of a.fx.dummies) for (const k in d.status) d.status[k] = 0; for (let i = 0; i < 150; i++) a.stepFixed(); };
  const ts = ${JSON.stringify(times.split(',').map(Number))};
  a.ui.paused = false;
  for (const spec of ${JSON.stringify(list.split('|'))}) {
    const [id, form] = spec.split(':');
    const e = a.ENTRIES.find((x) => x.spell.id === id && (!form || x.form === form));
    if (!e) { res.push({ spec, missing: true, shots: [] }); continue; }
    a.selectEntry(e.key); await a.warmSpell(e.spell); a.fx.particles.reseed(7); reset();
    a.setView(${JSON.stringify(cam)});
    const pt = a.fx.ARENA.dummies[0].clone().setY(1.1);
    a.casts.cast(e.spell, pt, { form: e.form || e.spell.forms?.[0], target: 0, seed: 7 });
    const shots = []; let f = 0;
    for (const t of ts) { while (f / 60 < t) { a.stepFixed(); f++; } shots.push(snap()); }
    res.push({ spec, shots });
  }
  a.casts.clear();
  return { W, H, res };
})()`;
const r = spawnSync('node', ['dev/look.mjs', 'eval', `http://localhost:${process.env.UE_PORT ?? 5230}/?noattract${query}`, page], { encoding: 'utf8', maxBuffer: 1 << 30, env: process.env });
const text = r.stdout, end = text.lastIndexOf('\n}');
fs.writeFileSync(out + '.json', text.slice(text.indexOf('{'), end + 2));
console.log(text.slice(end + 2).split('\n').filter((l) => /Shader Error|EXCEPTION|Error/.test(l)).join('\n').slice(0, 800));
spawnSync('python', ['-c', `
import json,base64,io,sys
from PIL import Image,ImageDraw
d=json.load(open(sys.argv[1]+'.json'))
W,H=d['W'],d['H'];rows=d['res'];n=max(len(r['shots']) for r in rows)
s=Image.new('RGB',(W*n,H*len(rows)),(12,12,12));dr=ImageDraw.Draw(s)
for y,r in enumerate(rows):
  for x,b in enumerate(r['shots']): s.paste(Image.open(io.BytesIO(base64.b64decode(b))),(x*W,y*H))
  dr.text((6,y*H+4),r['spec'],fill=(255,255,0))
s.save(sys.argv[1],quality=86)
`, out], { stdio: 'inherit' });
fs.unlinkSync(out + '.json');
