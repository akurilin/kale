//
// This Vite config defines how the renderer bundle is built/served for the
// Electron Forge Vite plugin, even while using mostly default behavior.
//
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// https://vitejs.dev/config
export default defineConfig({
  plugins: [react()],
});
