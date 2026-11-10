import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * index.html-dəki Content-Security-Policy-yə API serverinin ünvanını yazır.
 * Server ünvanı .env-dəki VITE_API_URL-dən (və ya köhnə VITE_SUPABASE_URL-dən)
 * götürülür; brauzer yalnız CSP-də adı çəkilən serverlərə qoşula bilir —
 * bu olmasa öz backend-imizə sorğular bloklanar. Realtime üçün wss/ws
 * variantı da əlavə olunur.
 */
function cspApiOrigin(apiUrl: string | undefined): Plugin {
  let origins = '';
  if (apiUrl) {
    try {
      const u = new URL(apiUrl);
      const ws = u.protocol === 'https:' ? 'wss:' : 'ws:';
      origins = `${u.origin} ${ws}//${u.host}`;
    } catch {
      throw new Error(`VITE_API_URL düzgün URL deyil: ${apiUrl}`);
    }
  }
  return {
    name: 'ellit-csp-api-origin',
    transformIndexHtml: (html) => html.split('%API_ORIGINS%').join(origins),
  };
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  return {
    plugins: [react(), cspApiOrigin(env.VITE_API_URL || env.VITE_SUPABASE_URL)],
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
  };
});
