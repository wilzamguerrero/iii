import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

import { apiDev } from "./tools/vite-api-plugin.ts";

/**
 * Configuración de la Plataforma 3i.
 *
 * Tres decisiones que conviene no deshacer sin motivo:
 *
 * 1. `three` se resuelve al archivo vendorizado, no al paquete de npm. La intro
 *    de origami está calibrada contra ese build exacto; traerlo desde npm
 *    cambiaría la revisión y con ella el comportamiento de la coreografía. Este
 *    alias sustituye al `importmap` que tenía index.html: ahora el resolutor de
 *    Vite es la única vía, en desarrollo y en el bundle.
 * 2. `reference/` y `docs/` quedan fuera del watcher **y del rastreador de
 *    dependencias**. No se compilan —son material de consulta— y vigilarlos
 *    cuesta cientos de archivos por recarga. Lo segundo es menos evidente: sin
 *    `optimizeDeps.entries`, Vite busca entradas en todos los `*.html` del
 *    proyecto, encuentra los cinco que hay bajo `reference/` y sigue sus
 *    `import` hasta `solid-js` y `@opencode-ai/app`, que no están instalados ni
 *    lo estarán. De ahí salía el «Are they installed?» al arrancar.
 * 3. `envPrefix` se deja en el valor por omisión (`VITE_`). Es lo que impide que
 *    un secreto de `.env` acabe en el bundle del cliente.
 */
export default defineConfig({
  plugins: [apiDev()],

  resolve: {
    alias: {
      three: fileURLToPath(new URL("./vendor/three/three.module.min.js", import.meta.url)),
    },
  },

  // La única entrada de verdad es index.html; el rastreador no tiene por qué
  // buscar más (nota 2).
  optimizeDeps: {
    entries: ["index.html"],
  },

  server: {
    port: 5173,
    watch: {
      ignored: ["**/reference/**", "**/docs/**"],
    },
  },

  build: {
    target: "es2022",
    sourcemap: true,
    // El bundle son ~590 kB y casi todos son three.js. Se acepta a cambio de
    // que la intro no dependa de la red. Candidato a carga diferida más
    // adelante: con `?intro=0` hoy se descarga three sin usarlo.
    chunkSizeWarningLimit: 700,
  },
});
