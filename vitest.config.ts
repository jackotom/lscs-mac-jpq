import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.{test,spec}.{ts,tsx,js,jsx,mts,cts,mjs,cjs}"],
    environment: "jsdom",
    environmentOptions: {
      jsdom: {
        url: "http://localhost/"
      }
    },
    globals: true,
    fileParallelism: false,
    maxWorkers: 1,
    setupFiles: ["tests/setup.ts"]
  }
});
