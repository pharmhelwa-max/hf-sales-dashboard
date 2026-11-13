// `npm run demo`: runs the app on the bundled sample data, ignoring .env.local (no Supabase, no login).
import { defineConfig } from 'vite';

export default defineConfig({
  envDir: './scripts/no-env', // folder without .env files, so VITE_SUPABASE_* stay unset
});
