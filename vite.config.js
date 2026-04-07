import { defineConfig } from 'vite';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { copyFileSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'chrome110',
    minify: false,
    lib: {
      entry: resolve(__dirname, 'src/content.js'),
      formats: ['iife'],
      name: 'CustomCanvas',
      fileName: () => 'content.js',
    },
    rollupOptions: {
      output: {
        extend: true,
        inlineDynamicImports: true,
      },
    },
  },
  plugins: [
    {
      name: 'copy-static-assets',
      closeBundle() {
        copyFileSync(
          resolve(__dirname, 'manifest.json'),
          resolve(__dirname, 'dist/manifest.json')
        );
        copyFileSync(
          resolve(__dirname, 'src/content.css'),
          resolve(__dirname, 'dist/content.css')
        );
        copyFileSync(
          resolve(__dirname, 'src/background.js'),
          resolve(__dirname, 'dist/background.js')
        );
      },
    },
  ],
});
