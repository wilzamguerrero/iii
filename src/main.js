/**
 * Orquestación: monta la escena, encadena los actos y entrega el menú.
 *
 * La línea de tiempo está en TIME (choreography.js). Los dos últimos hitos no
 * van por reloj sino por suceso: el fundido salta cuando el avión entra de
 * verdad en el objetivo, así que nunca se descuadra en un equipo lento.
 */

import { createStage } from "./scene.js";
import { Choreography, TIME } from "./choreography.js";
import { Phrase } from "./phrase.js";
import { clamp } from "./utils.js";

/* ------------------------------------------------------------------ ajustes */

const CONFIG = {
  /** `{palabra}` sale en serif itálica. */
  lines: [
    { text: "Ningún proyecto nace de un problema." },
    { text: "Nace de una {intención}." },
  ],
  /** Un avión lejano sigue derivando detrás del menú. false lo deja en blanco puro. */
  ambientAfterIntro: true,
  /** Segundos que la frase se queda quieta, ya legible, antes del barrido. */
  holdAfterReveal: 4,
};

/* -------------------------------------------------------------------- setup */

const canvas = document.getElementById("gl");
const phraseEl = document.getElementById("phrase");
const menu = document.getElementById("menu");
const flashEl = document.getElementById("flash");
const skipBtn = document.getElementById("skip");
const form = document.getElementById("intent-form");
const input = document.getElementById("intent-input");
const sendBtn = document.getElementById("send");
const statusEl = document.getElementById("intent-status");
const field = form.querySelector(".field");

const params = new URLSearchParams(location.search);
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
const skipRequested = params.get("intro") === "0";

function hasWebGL() {
  try {
    const c = document.createElement("canvas");
    return !!(window.WebGLRenderingContext && (c.getContext("webgl2") || c.getContext("webgl")));
  } catch {
    return false;
  }
}

const phrase = new Phrase(phraseEl, CONFIG.lines);

let stage = null;
let choreo = null;
let phase = "intro";
let raf = 0;
let last = 0;
let t = 0;
let revealed = false;
let loosened = false;
let scattered = false;
let statusTimer = 0;

/* --------------------------------------------------------------------- menú */

function setStatus(text) {
  statusEl.textContent = text;
  statusEl.classList.toggle("is-on", Boolean(text));
  clearTimeout(statusTimer);
  if (text) {
    statusTimer = setTimeout(() => {
      statusEl.classList.remove("is-on");
    }, 3600);
  }
}

function showMenu() {
  if (phase === "menu") return;
  phase = "menu";
  phrase.hide();
  skipBtn.classList.add("is-off");
  skipBtn.disabled = true;
  menu.hidden = false;
  void menu.offsetHeight;
  menu.classList.add("is-in");

  // El fundido blanco se retira dejando el menú ya colocado detrás.
  requestAnimationFrame(() => {
    flashEl.style.transition = "opacity 900ms cubic-bezier(0.16, 1, 0.3, 1)";
    flashEl.style.opacity = "0";
  });

  if (matchMedia("(hover: hover) and (pointer: fine)").matches) {
    setTimeout(() => input.focus({ preventScroll: true }), 720);
  }
}

/** Fundido a blanco y entrega. */
function flashToMenu(duration = 240) {
  flashEl.style.transition = `opacity ${duration}ms cubic-bezier(0.5, 0, 0.9, 0.3)`;
  flashEl.style.opacity = "1";
  setTimeout(showMenu, duration + 20);
}

function skipIntro() {
  if (phase === "menu") return;
  if (choreo) choreo.finish();
  phrase.fadeOut();
  flashToMenu(200);
}

/* ------------------------------------------------------------------- intro 3D */

function tick(dt) {
  choreo.update(t, dt);

  if (!revealed && t >= TIME.reveal) {
    revealed = true;
    phrase.reveal();
  }
  // Desprender la maquetación antes del barrido: medir en caliente costaría un salto.
  if (revealed && !loosened && t >= TIME.attack - 0.6) {
    loosened = true;
    phrase.loosen();
  }

  phrase.update(dt, choreo.sweeping ? choreo.screen : null);

  if (!scattered && choreo.state === "dive") {
    scattered = true;
    phrase.scatterRest();
  }
}

function frame(now) {
  const dt = clamp((now - last) / 1000, 0, 0.05);
  last = now;
  t += dt;
  tick(dt);
  stage.render();
  raf = requestAnimationFrame(frame);
}

function startIntro3D() {
  stage = createStage(canvas);
  choreo = new Choreography(stage, {
    reduced,
    ambient: CONFIG.ambientAfterIntro,
    onFlash: () => flashToMenu(220),
  });

  // Con movimiento reducido no hay barrido ni picado: la frase se lee y se va.
  if (reduced) {
    const wait = (TIME.reveal + phrase.revealDuration + 3) * 1000;
    setTimeout(() => {
      phrase.fadeOut();
      setTimeout(() => flashToMenu(400), 520);
    }, wait);
  }

  // ?seek=8.4 adelanta la coreografía a pasos fijos antes de arrancar el rAF.
  // Sirve para revisar un instante concreto sin esperarlo en tiempo real.
  const seek = Number(params.get("seek"));
  if (Number.isFinite(seek) && seek > 0) {
    const step = 1 / 60;
    const n = Math.min(Math.round(seek / step), 3600);
    for (let i = 0; i < n; i++) {
      t += step;
      tick(step);
    }
  }

  last = performance.now();
  raf = requestAnimationFrame(frame);
}

/** Sin WebGL la página sigue funcionando: sólo tipografía. */
function startIntroFlat() {
  canvas.hidden = true;
  requestAnimationFrame(() => phrase.reveal());
  setTimeout(() => {
    phrase.fadeOut();
    setTimeout(() => flashToMenu(400), 520);
  }, (phrase.revealDuration + 3.2) * 1000);
}

/* ------------------------------------------------------------------- eventos */

addEventListener("resize", () => {
  if (stage) stage.resize();
  phrase.remeasure();
});

document.addEventListener("visibilitychange", () => {
  if (!stage) return;
  if (document.hidden) {
    cancelAnimationFrame(raf);
    raf = 0;
  } else if (!raf && phase !== "menu") {
    last = performance.now();
    raf = requestAnimationFrame(frame);
  }
});

canvas.addEventListener("webglcontextlost", (e) => {
  e.preventDefault();
  cancelAnimationFrame(raf);
  raf = 0;
  showMenu();
});

skipBtn.addEventListener("click", skipIntro);

addEventListener("keydown", (e) => {
  if (e.key === "Escape" && phase !== "menu") skipIntro();
});

/* -------------------------------------------------------------------- envío */

form.addEventListener("submit", (e) => {
  e.preventDefault();
  const intent = input.value.trim();

  if (!intent) {
    field.classList.remove("is-nudge");
    void field.offsetWidth;
    field.classList.add("is-nudge");
    input.focus();
    return;
  }

  sendBtn.classList.remove("is-folding");
  sendBtn.classList.add("is-flying");
  input.value = "";
  setStatus("Intención anotada.");

  // Punto de enganche: aquí se conecta el destino real (API, almacenamiento,
  // siguiente pantalla). De momento sólo se anuncia.
  document.dispatchEvent(
    new CustomEvent("intent:submit", {
      detail: { intent, at: new Date().toISOString() },
    })
  );

  // El papel se va volando y vuelve a plegarse solo.
  setTimeout(() => {
    sendBtn.classList.remove("is-flying");
    sendBtn.classList.add("is-folding");
  }, 780);
  setTimeout(() => sendBtn.classList.remove("is-folding"), 1700);
});

field.addEventListener("animationend", () => field.classList.remove("is-nudge"));

/* --------------------------------------------------------------------- boot */

function boot() {
  // El barrido llega cuando la frase ya se ha podido leer, no en un segundo fijo.
  TIME.attack = TIME.reveal + phrase.revealDuration + CONFIG.holdAfterReveal;

  if (skipRequested) {
    showMenu();
    return;
  }

  setTimeout(() => skipBtn.classList.add("is-on"), 1400);

  if (hasWebGL()) startIntro3D();
  else startIntroFlat();
}

boot();
