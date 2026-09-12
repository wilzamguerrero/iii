/**
 * El humo: arranca lo que haga falta, corre las ocho partes en orden y dice
 * cuántas comprobaciones pasaron.
 *
 * No hay marco de pruebas y no se va a añadir uno: cada parte abre la
 * plataforma de verdad en un Chrome sin ventana, la maneja por el protocolo de
 * depuración y mira el resultado en la página. Lo único que se finge es lo que
 * está fuera —Notion, el modelo, el reconocedor de voz del navegador—, y esos
 * dobles viven en `doubles/`.
 *
 * Se reutiliza lo que ya esté puesto: si alguien tiene `npm run dev` a mano o un
 * Chrome escuchando en el puerto de depuración, esto se cuelga de ellos y no los
 * apaga al terminar. Lo que arranca, lo apaga.
 *
 * Sale con código 1 si una sola comprobación falla, para que sirva en un gancho
 * de git o en un servidor sin que nadie tenga que leer la salida.
 */

import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const HERE = fileURLToPath(new URL(".", import.meta.url));

const PORT = Number(process.env.PORT ?? 5199);
const CDP_PORT = Number(process.env.CDP_PORT ?? 9222);
const BASE = process.env.BASE ?? `http://localhost:${PORT}`;

/* En orden: la entrada, la hoja, la revisión, el arranque de un proyecto, la
   franja, el asistente, el dictado y la ruta de Indagar. Cada una deja la
   página como la encuentra —recarga al empezar—, así que el orden es para
   leerlo, no una dependencia. */
const PARTS = [
  "1-entrada.mjs",
  "2-lectura.mjs",
  "3-revision.mjs",
  "4-arranque.mjs",
  "5-franja.mjs",
  "6-asistente.mjs",
  "7-dictado.mjs",
  "8-indagar.mjs",
];

const CHROMES = [
  process.env.CHROME,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  join(process.env.LOCALAPPDATA ?? "", "Google/Chrome/Application/chrome.exe"),
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].filter(Boolean);

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** ¿Contesta algo ahí? Vale cualquier respuesta: se pregunta si está vivo. */
async function answers(url) {
  try {
    await fetch(url);
    return true;
  } catch {
    return false;
  }
}

/** Espera a que conteste, o se rinde diciendo qué no llegó. */
async function upOrDie(url, what, tries = 80) {
  for (let i = 0; i < tries; i += 1) {
    if (await answers(url)) return;
    await wait(250);
  }
  throw new Error(`${what} no contesta en ${url}`);
}

/**
 * Apagar de verdad en Windows: Chrome y Vite reparten el trabajo en procesos
 * hijos, y matar sólo al padre deja el puerto ocupado para la próxima corrida.
 */
function kill(child) {
  if (!child || child.exitCode !== null) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    return;
  }
  child.kill("SIGTERM");
}

const mine = { vite: null, chrome: null, profile: null };

async function cleanup() {
  kill(mine.vite);
  kill(mine.chrome);
  if (mine.profile) {
    // Chrome suelta el perfil un instante después de morir; si no se puede
    // borrar, es un directorio temporal y no vale detener nada por él.
    await wait(300);
    await rm(mine.profile, { recursive: true, force: true }).catch(() => {});
  }
}

/** El servidor de desarrollo, no `preview`: las partes importan `/src/…`. */
async function startVite() {
  if (await answers(BASE)) {
    console.log(`· usando el servidor que ya está en ${BASE}`);
    return;
  }
  const bin = join(ROOT, "node_modules", "vite", "bin", "vite.js");
  if (!existsSync(bin)) throw new Error("falta vite; corre npm install");
  console.log(`· arrancando vite en ${BASE}`);
  mine.vite = spawn(process.execPath, [bin, "--port", String(PORT), "--strictPort"], {
    cwd: ROOT,
    stdio: "ignore",
  });
  mine.vite.on("error", (e) => { throw e; });
  await upOrDie(BASE, "vite");
}

async function startChrome() {
  const debug = `http://127.0.0.1:${CDP_PORT}/json/version`;
  if (await answers(debug)) {
    console.log(`· usando el Chrome que ya escucha en ${CDP_PORT}`);
    return;
  }
  const bin = CHROMES.find((p) => existsSync(p));
  if (!bin) throw new Error("no encuentro Chrome; ponlo en la variable CHROME");
  mine.profile = await mkdtemp(join(tmpdir(), "3i-humo-"));
  console.log("· arrancando Chrome sin ventana");
  mine.chrome = spawn(bin, [
    "--headless=new",
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${mine.profile}`,
    /* Un perfil nuevo cada vez: así lo guardado en el navegador —el tema, la
       intención, dónde se dejó el asistente— no pasa de una corrida a otra y
       cada parte prueba lo que dice probar. Y ancho de sobra, que la franja y
       el documento conviven en la pantalla. */
    "--window-size=1400,900",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-gpu",
    "--disable-extensions",
    "--mute-audio",
    "about:blank",
  ], { stdio: "ignore" });
  mine.chrome.on("error", (e) => { throw e; });
  await upOrDie(debug, "Chrome");
}

/** Una parte: se corre aparte para que un cuelgue no se lleve a las demás. */
function runPart(name) {
  return new Promise((done) => {
    const child = spawn(process.execPath, [join(HERE, "parts", name)], {
      env: { ...process.env, BASE },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let text = "";
    child.stdout.on("data", (d) => { text += d; });
    child.stderr.on("data", (d) => { text += d; });
    child.on("close", (code) => done({ text, code }));
  });
}

let ok = 0;
let bad = 0;
const broken = [];

try {
  await startVite();
  await startChrome();

  for (const name of PARTS) {
    const { text, code } = await runPart(name);
    const lines = text.split(/\r?\n/);
    ok += lines.filter((l) => l.startsWith("ok  ")).length;
    const fails = lines.filter((l) => l.startsWith("FAIL"));
    bad += fails.length;
    console.log(`\n=== ${name}`);
    console.log(text.trimEnd());
    // Salir mal sin un solo FAIL es haberse roto antes de comprobar nada.
    if (code !== 0 && fails.length === 0) broken.push(name);
  }
} finally {
  await cleanup();
}

const total = ok + bad;
console.log(`\n=== ${total} comprobaciones · ${ok} bien · ${bad} mal`);
if (broken.length) console.log(`=== se rompieron sin terminar: ${broken.join(", ")}`);
process.exitCode = bad > 0 || broken.length > 0 ? 1 : 0;

