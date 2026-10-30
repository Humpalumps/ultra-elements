// tally GL memory and per-frame passes
(() => {
  const orig = HTMLCanvasElement.prototype.getContext;
  const T = (window.__gl = { bytes: { tex: 0, rb: 0, buf: 0 }, big: [], passes: 0, draws: 0, _dirty: false, _fb: null });
  HTMLCanvasElement.prototype.getContext = function (type, opts) {
    const gl = orig.call(this, type, opts);
    if (type !== 'webgl2' || !gl || gl.__tap) return gl;
    gl.__tap = 1;
    const bpp = (f) => ({ [gl.RGBA32F]: 16, [gl.RGBA16F]: 8, [gl.RG16F]: 4, [gl.R16F]: 2, [gl.R32F]: 4, [gl.RG32F]: 8, [gl.RGBA8]: 4, [gl.SRGB8_ALPHA8]: 4, [gl.R8]: 1, [gl.RG8]: 2, [gl.DEPTH_COMPONENT32F]: 4, [gl.DEPTH_COMPONENT24]: 4, [gl.DEPTH24_STENCIL8]: 4, [gl.DEPTH_COMPONENT16]: 2, [gl.R11F_G11F_B10F]: 4, [gl.RGB10_A2]: 4 }[f] ?? 4);
    const note = (kind, b, w, h, d) => { T.bytes[kind] += b; if (b > 2e6) T.big.push(`${kind} ${w}x${h}${d ? 'x' + d : ''} ${(b / 1e6).toFixed(1)}MB`); };
    const ts2 = gl.texStorage2D.bind(gl); gl.texStorage2D = (t, l, f, w, h) => { let b = 0; for (let i = 0, a = w, c = h; i < l; i++, a = Math.max(1, a >> 1), c = Math.max(1, c >> 1)) b += a * c * bpp(f) * (t === gl.TEXTURE_CUBE_MAP ? 6 : 1); note('tex', b, w, h); return ts2(t, l, f, w, h); };
    const ts3 = gl.texStorage3D.bind(gl); gl.texStorage3D = (t, l, f, w, h, d) => { note('tex', w * h * d * bpp(f) * (l > 1 ? 1.33 : 1), w, h, d); return ts3(t, l, f, w, h, d); };
    const ti2 = gl.texImage2D.bind(gl); gl.texImage2D = (...a) => { if (a.length >= 8 && typeof a[3] === 'number') note('tex', a[3] * a[4] * bpp(a[2]), a[3], a[4]); return ti2(...a); };
    const ti3 = gl.texImage3D.bind(gl); gl.texImage3D = (...a) => { note('tex', a[3] * a[4] * a[5] * bpp(a[2]), a[3], a[4], a[5]); return ti3(...a); };
    const rb = gl.renderbufferStorageMultisample.bind(gl); gl.renderbufferStorageMultisample = (t, s, f, w, h) => { note('rb', w * h * bpp(f) * Math.max(1, s), w, h); return rb(t, s, f, w, h); };
    const rb1 = gl.renderbufferStorage.bind(gl); gl.renderbufferStorage = (t, f, w, h) => { note('rb', w * h * bpp(f), w, h); return rb1(t, f, w, h); };
    const bd = gl.bufferData.bind(gl); gl.bufferData = (t, x, u, ...r) => { const b = typeof x === 'number' ? x : x?.byteLength ?? 0; note('buf', b, b, 1); return bd(t, x, u, ...r); };
    const bf = gl.bindFramebuffer.bind(gl); gl.bindFramebuffer = (t, f) => { if (t !== gl.READ_FRAMEBUFFER && f !== T._fb) { T._fb = f; T._dirty = true; } return bf(t, f); };
    const blit = gl.blitFramebuffer.bind(gl); gl.blitFramebuffer = (...a) => { T.blits = (T.blits ?? 0) + 1; return blit(...a); };
    const d = (n) => { const o = gl[n].bind(gl); gl[n] = (...a) => { T.draws++; if (T._dirty) { T.passes++; T._dirty = false; } return o(...a); }; };
    ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced', 'drawBuffers'].slice(0, 4).forEach(d);
    return gl;
  };
})();
