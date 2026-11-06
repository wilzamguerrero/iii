/**
 * Capturas de los cuatro temas. Temporal: no se queda en el repositorio.
 *
 * Arranca su propio Chrome en un puerto aparte y con perfil nuevo, y le pone un
 * plazo a cada llamada. La corrida de humo usa el 9222; compartir el socket del
 * depurador con ella fue lo que colgó la sonda anterior.
 */

import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { attach } from "./smoke/cdp.mjs";

const PORT = 9333;
const BASE = "http://localhost:5199";
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const race = (p, ms, what) => Promise.race([
  p,
  new Promise((_, rej) => setTimeout(() => rej(new Error("PLAZO VENCIDO: " + what)), ms)),
]);

const profile = await mkdtemp(join(tmpdir(), "3i-fotos-"));
const chrome = spawn(CHROME, [
  "--headless=new",
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`,
  "--window-size=1400,900",
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-gpu",
  "--disable-extensions",
  "--mute-audio",
  "about:blank",
], { stdio: "ignore" });

async function bye() {
  spawnSync("taskkill", ["/PID", String(chrome.pid), "/T", "/F"], { stdio: "ignore" });
  await wait(300);
  await rm(profile, { recursive: true, force: true }).catch(() => {});
}

try {
  for (let i = 0; i < 60; i += 1) {
    try {
      await fetch(`http://127.0.0.1:${PORT}/json/version`);
      break;
    } catch { await wait(250); }
  }

  const cdp = await race(attach(PORT), 20000, "adjuntar");
  console.log("· adjuntado");

  await cdp.send("Page.navigate", { url: BASE + "/?intro=0" });
  await wait(3000);

  /* El documento de una fase: es lo que enciende la gama. Sin doble de Notion
     no hay página que abrir, así que se llama a `selectPage` a secas y lo que
     importa —el atributo y los tokens— se pone igual. */
  await race(cdp.evaluate(`(async () => {
    const m = await import("/src/core/state/selection.ts");
    m.selectPage({ id: "page-1", name: "Indagar", parentId: "proj-1", projectName: "Mi proyecto" });
  })()`), 15000, "abrir documento");
  await wait(2000);

  async function shot(name) {
    const png = await race(
      cdp.send("Page.captureScreenshot", { format: "png" }), 20000, "captura " + name);
    writeFileSync(`.foto-${name}.png`, Buffer.from(png.data, "base64"));
    console.log("  · " + name);
  }

  async function set(mod, fn, value) {
    await race(cdp.evaluate(`(async () => {
      const m = await import("/src/core/state/${mod}.ts");
      m.${fn}("${value}");
    })()`), 15000, fn + " " + value);
    await wait(700);
  }

  const read = () => race(cdp.evaluate(`(() => {
    const paint = (token) => {
      const d = document.createElement("div");
      d.style.color = "var(" + token + ")";
      document.documentElement.appendChild(d);
      const v = getComputedStyle(d).color;
      d.remove();
      return v;
    };
    const root = document.documentElement;
    const cs = getComputedStyle(root);
    const vis = document.querySelector(".vis");
    const h = document.querySelector(".vis > h2");
    const face = (n) => n
      ? getComputedStyle(n).fontFamily.split(",")[0].replace(/["']/g, "").trim() : null;
    return {
      skin: root.dataset.skin, theme: root.dataset.theme, phase: root.dataset.phase || null,
      rPanel: cs.getPropertyValue("--r-panel").trim(),
      rNode: cs.getPropertyValue("--r-node").trim(),
      slant: cs.getPropertyValue("--slant").trim(),
      paper: paint("--paper"), ink: paint("--ink"),
      phA: paint("--ph-a"), phB: paint("--ph-b"),
      phC: paint("--ph-c"), phD: paint("--ph-d"),
      blobA: paint("--blob-a"),
      body: face(vis), head: face(h),
      loaded: {
        outfit: document.fonts.check("700 24px Outfit"),
        jakarta: document.fonts.check("400 16px 'Plus Jakarta Sans'"),
        instrument: document.fonts.check("400 16px 'Instrument Serif'"),
      },
    };
  })()`), 15000, "leer");

  console.log("=== sobrio claro ===");
  console.log(JSON.stringify(await read()));
  await shot("1-sobrio-claro");

  await set("skin", "setSkin", "vivo");
  console.log("=== vivo claro ===");
  console.log(JSON.stringify(await read()));
  await shot("2-vivo-claro");

  await set("theme", "setTheme", "dark");
  console.log("=== vivo oscuro ===");
  console.log(JSON.stringify(await read()));
  await shot("3-vivo-oscuro");

  await set("skin", "setSkin", "sobrio");
  await shot("4-sobrio-oscuro");

  /* --- el mapa, que es donde están los nodos --- */
  await set("skin", "setSkin", "vivo");
  await set("theme", "setTheme", "light");
  await race(cdp.evaluate(
    `[...document.querySelectorAll(".wr__act")].find((b) => b.textContent === "Mapa").click()`),
    15000, "abrir mapa");
  await wait(1500);

  const nodes = await race(cdp.evaluate(`(() => {
    const root = document.getElementById("wr-map");
    if (!root) return { error: "no hay mapa" };
    const all = [...root.querySelectorAll(".map__n")];
    return {
      count: all.length,
      four: all.slice(0, 4).map((n) => {
        const cs = getComputedStyle(n);
        return { tone: cs.getPropertyValue("--tone").trim(), border: cs.borderTopColor,
                 bg: cs.backgroundColor, radius: cs.borderTopLeftRadius };
      }),
      grid: getComputedStyle(root.querySelector(".map__canvas")).backgroundImage.slice(0, 44),
      blobs: (getComputedStyle(root.querySelector(".map__stage"), "::before")
        .backgroundImage.match(/radial-gradient/g) || []).length,
    };
  })()`), 15000, "leer nodos");
  console.log("=== nodos, vivo claro ===");
  console.log(JSON.stringify(nodes));
  await shot("5-vivo-claro-mapa");

  await set("theme", "setTheme", "dark");
  await shot("6-vivo-oscuro-mapa");

  await set("skin", "setSkin", "sobrio");
  await set("theme", "setTheme", "light");
  await shot("7-sobrio-claro-mapa");

  /* --- la bandeja, donde se elige --- */
  await set("skin", "setSkin", "vivo");
  await race(cdp.evaluate(`(() => {
    const map = document.getElementById("wr-map");
    if (map && !map.hidden) {
      [...document.querySelectorAll(".wr__act")].find((b) => b.textContent === "Mapa").click();
    }
  })()`), 15000, "cerrar mapa");
  await wait(700);
  await race(cdp.evaluate(`(() => {
    const dock = document.querySelector(".dock");
    if (dock && dock.dataset.open !== "true") document.querySelector(".dock__toggle").click();
  })()`), 15000, "abrir franja");
  await wait(900);
  await race(cdp.evaluate(`(() => {
    const b = document.querySelector('.tray__btn[title="Ajustes del sistema"]');
    if (b) b.click();
    return !!b;
  })()`), 15000, "abrir bandeja");
  await wait(900);
  await shot("8-bandeja-vivo");

  console.log("· listo");
  cdp.close();
} catch (e) {
  console.log("FALLO: " + e.message);
} finally {
  await bye();
  process.exit(0);
}
