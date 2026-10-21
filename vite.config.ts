/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Relative base so the build works under any GitHub Pages path (/<repo>/)
export default defineConfig({
  base: "./",
  plugins: [react()],
  // Listen on all interfaces so a Windows browser can reach the dev server running inside WSL2
  server: { host: true },
  // Tests always run on the bundled sample, even when .env.local points at Supabase
  test: { env: { VITE_SUPABASE_URL: "", VITE_SUPABASE_ANON_KEY: "" } },
});
