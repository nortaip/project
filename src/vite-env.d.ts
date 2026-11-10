/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  // ⚠ NEVER add OPENAI_API_KEY or any other server-side secret here.
  // VITE_-prefixed env vars are bundled into client JS and visible to anyone.
  // Use a Supabase Edge Function for any AI / server-side work.
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
