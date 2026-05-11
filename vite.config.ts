import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    exclude: ['lucide-react'],
  },
  build: {
    minify: 'esbuild',
    cssMinify: 'esbuild',
    chunkSizeWarningLimit: 1200,
    sourcemap: false,
    // NOT: manualChunks-i tətbiq etmirik — Vite-in default chunking-i daha
    // təhlükəsizdir. lazy-loaded admin page-ləri onsuz da öz chunk-larında
    // ayrılır. Aqressiv manual chunking circular dep / order problemləri
    // yaradırdı → boş səhifə.
  },
});
