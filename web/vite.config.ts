import { defineConfig } from "vite-plus";

export default defineConfig({
  // GitHub Pages serves project sites under /<repo>/; CI passes the fork's repo name.
  base: process.env.BASE_PATH ?? "/",
  lint: { options: { typeAware: true, typeCheck: true } },
  test: { include: ["src/**/*.test.ts"] },
});
