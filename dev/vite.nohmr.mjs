// Test server without hot reload, so a running check is never reloaded by someone else's edit.
//   npx vite --config dev/vite.nohmr.mjs --port <PORT> --strictPort
export default { base: './', server: { hmr: false } };
