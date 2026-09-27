import { copyFileSync, createReadStream, existsSync, mkdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const CJS_DEFAULT_MODULES = [
  "/clipper-lib/clipper.js",
  "/@techstark/opencv-js/dist/opencv.js",
];

const ORT_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "node_modules/onnxruntime-web/dist",
);

const ORT_FILES = [
  "ort-wasm-simd-threaded.wasm",
  "ort-wasm-simd-threaded.mjs",
  "ort-wasm-simd-threaded.jsep.wasm",
  "ort-wasm-simd-threaded.jsep.mjs",
];

function cjsDefaultExport(): Plugin {
  return {
    name: "cjs-default-export",
    enforce: "pre",
    transform(code, id) {
      const normalized = id.replace(/\\/g, "/").split("?")[0];
      if (!CJS_DEFAULT_MODULES.some((suffix) => normalized.endsWith(suffix))) {
        return;
      }
      return {
        code: `const module = { exports: {} };\nconst exports = module.exports;\n${code}\nexport default module.exports;\n`,
        map: null,
      };
    },
  };
}

function ortAssets(): Plugin {
  return {
    name: "ort-assets",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url?.split("?")[0] ?? "";
        if (!url.startsWith("/ort/")) {
          next();
          return;
        }
        const file = path.join(ORT_DIR, path.basename(url));
        if (!existsSync(file) || !statSync(file).isFile()) {
          next();
          return;
        }
        res.setHeader(
          "Content-Type",
          file.endsWith(".wasm") ? "application/wasm" : "text/javascript",
        );
        createReadStream(file).pipe(res);
      });
    },
    closeBundle() {
      const outDir = path.resolve("dist/ort");
      mkdirSync(outDir, { recursive: true });
      for (const name of ORT_FILES) {
        const source = path.join(ORT_DIR, name);
        if (existsSync(source)) {
          copyFileSync(source, path.join(outDir, name));
        }
      }
    },
  };
}

const pagesBase = process.env.VITE_BASE_PATH?.trim();
const base =
  pagesBase && pagesBase !== "/"
    ? pagesBase.endsWith("/")
      ? pagesBase
      : `${pagesBase}/`
    : "/";

export default defineConfig({
  base,
  plugins: [cjsDefaultExport(), ortAssets(), react()],
  optimizeDeps: {
    exclude: ["@paddleocr/paddleocr-js", "clipper-lib", "@techstark/opencv-js"],
  },
  worker: {
    format: "es",
  },
});
