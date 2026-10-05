import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const rootDir = dirname(fileURLToPath(import.meta.url));

const pages = [
  "index",
  "about",
  "features",
  "contact",
  "privacy",
  "terms",
  "refund",
  "payment",
  "bag-balance",
];

export default defineConfig({
  root: rootDir,
  publicDir: "public",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: Object.fromEntries(
        pages.map((name) => [
          name,
          resolve(rootDir, name === "index" ? "index.html" : `${name}.html`),
        ]),
      ),
    },
  },
});
