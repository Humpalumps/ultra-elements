(async () => {
  const T = window.__gl;
  const heap = () => performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1e6) : null;
  const a = app, out = { mem0: { tex: T.bytes.tex / 1e6 | 0, rb: T.bytes.rb / 1e6 | 0, buf: T.bytes.buf / 1e6 | 0 }, heap: heap(), big: T.big.slice(0, 40), size: [a.renderer.domElement.width, a.renderer.domElement.height], tier: a.Q.tier, spells: [] };
  const frame = () => new Promise((r) => requestAnimationFrame(r));
  const sample = async (n) => { let mp = 0, md = 0, sp = 0; for (let i = 0; i < n; i++) { const p0 = T.passes, d0 = T.draws; await frame(); await frame(); const dp = T.passes - p0, dd = T.draws - d0; mp = Math.max(mp, dp / 2 | 0); md = Math.max(md, dd / 2 | 0); sp += dp / 2; } return [mp, Math.round(sp / n), md]; };
  out.idle = await sample(30);
  for (const s of a.SPELLS) {
    a.selectEntry(a.ENTRIES.find((e) => e.spell === s).key);
    await a.warmSpell(s);
    a.castCurrent();
    const r = await sample(40);
    a.casts.clear();
    out.spells.push([s.id, ...r]);
  }
  out.spells.sort((x, y) => y[1] - x[1]);
  out.memEnd = { tex: T.bytes.tex / 1e6 | 0, rb: T.bytes.rb / 1e6 | 0, buf: T.bytes.buf / 1e6 | 0 };
  return out;
})()
