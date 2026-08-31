import { build as buildVite } from "vite";
import { build as buildEsbuild } from "esbuild";

await buildVite();

await buildEsbuild({
  entryPoints: {
    background: "src/background/service-worker.ts",
    content: "src/content/content.ts",
  },
  outdir: "dist",
  bundle: true,
  format: "esm",
  target: "chrome120",
  minify: true,
  sourcemap: false,
  logLevel: "info",
});
