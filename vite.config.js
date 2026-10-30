import { defineConfig } from 'vite';

// relative base so the build works as a GitHub Pages project site. One chunk on purpose: three.js is
// ~700 kB and every spell's GLSL is warmed at start-up, so splitting would not cut what a visit loads.
export default defineConfig({ base: './', build: { chunkSizeWarningLimit: 2000 } });
