//
// This Vite config exists so Electron Forge can build the Electron main
// process entry independently while still keeping config explicit in-repo.
//
import { defineConfig } from 'vite';

// https://vitejs.dev/config
export default defineConfig({
  // Native modules like node-pty must stay external so Electron loads their
  // compiled `.node` bindings from node_modules instead of bundling them.
  // The ws package is also kept external because Vite's bundler can interfere
  // with its Node.js-specific internals (Buffer handling, HTTP upgrade).
  build: {
    rollupOptions: {
      external: ['node-pty', 'ws'],
    },
  },
});
