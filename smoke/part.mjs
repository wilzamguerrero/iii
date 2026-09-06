/**
 * Lo que toda parte necesita: la plataforma abierta con sus dobles puestos, una
 * forma de anotar lo comprobado y el recuento al salir.
 *
 * El recuento va en `process.on("exit")` y no al final de cada guión: si algo se
 * rompe a mitad —una espera que no llega, un selector que ya no existe— lo que
 * ya se comprobó se dice igual en vez de perderse junto con el fallo. Y una
 * parte con un solo `FAIL` sale con código 1, que es lo que mira `run.mjs`.
 */

import { readFileSync } from "node:fs";
import { attach } from "./cdp.mjs";

/** Donde está el servidor de desarrollo. `run.mjs` lo pone; a mano se hereda. */
export const BASE = process.env.BASE || "http://localhost:5199";

export const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const out = [];
let ref = null;

/** Una comprobación: qué se esperaba y, cuando falla, con qué se encontró. */
export function say(ok, what, extra) {
  out.push(`${ok ? "ok  " : "FAIL"} ${what}${extra ? "  <- " + extra : ""}`);
}

process.on("exit", () => {
  console.log(out.join("\n"));
  console.log("--- consola ---");
  // Lo que Vite cuenta de sí mismo no dice nada de la plataforma y tapa lo que sí.
  const logs = (ref ? ref.logs : []).filter((line) => !line.startsWith("[debug]"));
  console.log(logs.length ? logs.join("\n") : "(nada)");
  if (out.some((line) => line.startsWith("FAIL"))) process.exitCode = 1;
});

/**
 * Abre la plataforma con los dobles puestos antes de que corra nada suyo, y
 * espera a que acabe de montarse.
 *
 * Los dobles se instalan con `addScriptToEvaluateOnNewDocument`, que corre antes
 * del primer módulo de la página: es la única forma de que un `fetch` falso ya
 * esté puesto cuando la plataforma haga el primero. Y se navega con `?intro=0`
 * para no tener que ver el origami entero antes de llegar.
 */
export async function openPage(doubles, settle = 2600) {
  const cdp = await attach(9222);
  ref = cdp;
  for (const name of doubles) {
    const source = readFileSync(new URL("./doubles/" + name, import.meta.url), "utf8");
    await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source });
  }
  await cdp.send("Page.navigate", { url: BASE + "/?intro=0" });
  await wait(settle);
  return cdp;
}
