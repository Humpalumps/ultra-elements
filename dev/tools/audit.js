(async () => {
  const t0 = performance.now();
  const per = [];
  for (const s of app.SPELLS) {
    const a = performance.now(), n0 = app.renderer.info.programs.length;
    await app.warmSpell(s);
    per.push([s.id, Math.round(performance.now() - a), app.renderer.info.programs.length - n0]);
  }
  const gl = app.renderer.getContext();
  const size = { [gl.FLOAT_MAT4]: 4, [gl.FLOAT_MAT3]: 3, [gl.FLOAT_MAT2]: 2 };
  const isSampler = (t) => [gl.SAMPLER_2D, gl.SAMPLER_3D, gl.SAMPLER_CUBE, gl.SAMPLER_2D_SHADOW, gl.SAMPLER_2D_ARRAY, gl.SAMPLER_2D_ARRAY_SHADOW, gl.SAMPLER_CUBE_SHADOW, gl.INT_SAMPLER_2D, gl.UNSIGNED_INT_SAMPLER_2D].includes(t);
  const progs = app.renderer.info.programs.map((p) => {
    let vec = 0, samplers = 0;
    const n = gl.getProgramParameter(p.program, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) {
      const u = gl.getActiveUniform(p.program, i);
      if (isSampler(u.type)) samplers += u.size; else vec += (size[u.type] ?? 1) * u.size;
    }
    const vs = gl.getShaderSource(p.vertexShader) ?? '';
    const varyings = (vs.match(/^\s*(flat\s+)?(centroid\s+)?(smooth\s+)?out\s+(highp |mediump |lowp )?(\w+)\s+\w+/gm) ?? [])
      .reduce((a, l) => a + (/mat4/.test(l) ? 4 : /mat3/.test(l) ? 3 : 1), 0);
    return { name: p.name, vec, samplers, varyings, link: gl.getProgramParameter(p.program, gl.LINK_STATUS) };
  });
  const top = (k, n = 6) => [...progs].sort((a, b) => b[k] - a[k]).slice(0, n).map((p) => `${p.name}:${p[k]}`);
  const lim = (e) => gl.getParameter(e);
  return {
    total: Math.round(performance.now() - t0), slowest: per.sort((a, b) => b[1] - a[1]).slice(0, 8),
    programs: progs.length, badLink: progs.filter((p) => !p.link).map((p) => p.name),
    vecTop: top('vec'), samplersTop: top('samplers'), varyingsTop: top('varyings'),
    limits: { frag: lim(gl.MAX_FRAGMENT_UNIFORM_VECTORS), vert: lim(gl.MAX_VERTEX_UNIFORM_VECTORS), vary: lim(gl.MAX_VARYING_VECTORS), tex: lim(gl.MAX_TEXTURE_IMAGE_UNITS), draw: lim(gl.MAX_DRAW_BUFFERS) },
    textures: app.renderer.info.memory.textures, geometries: app.renderer.info.memory.geometries, entries: app.ENTRIES.length,
    size: [app.renderer.domElement.width, app.renderer.domElement.height],
  };
})()
