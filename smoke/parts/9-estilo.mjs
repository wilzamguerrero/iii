/**
 * Los dos ejes del aspecto: claro/oscuro por un lado, sobrio/vivo por el otro.
 *
 * Es la parte que faltaba desde que el aspecto dejó de ser una sola tabla. Las
 * otras ocho prueban lo que la plataforma hace; esta prueba cómo se ve, que
 * también se puede romper: un token que se queda sin declarar, una gama que no
 * llega, una mezcla que se resuelve donde no debe.
 *
 * Lo que se comprueba, en orden:
 *
 * 1. Sin haber elegido sale sobrio, y sobrio es el papel editorial de siempre:
 *    esquinas casi rectas, cursiva de verdad, ninguna gama y ninguna mancha.
 * 2. Elegir «vivo» se guarda, y cambia las tres cosas que se pidieron: las
 *    letras, las esquinas y el color.
 * 3. La fase la pone el documento que se abre, y cada una tiene su gama.
 *    Cerrarlo la quita.
 * 4. Los nodos del mapa reparten los cuatro tonos de la gama, así que dos
 *    vecinos nunca coinciden.
 * 5. El oscuro de vivo es el gris medio de los programas de Adobe y no el casi
 *    negro del oscuro sobrio.
 *
 * Los colores no se comparan como texto sino pintados: `paint()` mete el token
 * en una propiedad de verdad y lee lo que resolvió el navegador. Es la única
 * forma de mirar un `color-mix`, que como texto sigue siendo un `color-mix`.
 *
 * Y al final se deja en sobrio claro a propósito: la elección se guarda en el
 * navegador, y la parte 5 comprueba que un panel mide 3px. Si esta parte se
 * fuera dejando «vivo» puesto, rompería a la otra en la corrida siguiente.
 */

import { openPage, say, wait } from "../part.mjs";

const cdp = await openPage(["notion.js", "route.js"], 3200);

/* --- lo que hace falta para mirar --------------------------------------- */

async function setSkin(which) {
  await cdp.evaluate(`(async () => {
    const m = await import("/src/core/state/skin.ts");
    m.setSkin("${which}");
  })()`);
  await wait(500);
}

async function setTheme(which) {
  await cdp.evaluate(`(async () => {
    const m = await import("/src/core/state/theme.ts");
    m.setTheme("${which}");
  })()`);
  await wait(600);
}

/** Pinta un token en una propiedad de verdad y devuelve lo que resolvió. */
const PAINT = `const paint = (token) => {
  const d = document.createElement("div");
  d.style.color = "var(" + token + ")";
  document.documentElement.appendChild(d);
  const v = getComputedStyle(d).color;
  d.remove();
  return v;
};`;

const look = () => cdp.evaluate(`(() => {
  ${PAINT}
  const root = document.documentElement;
  const cs = getComputedStyle(root);
  const vis = document.querySelector(".vis");
  const head = document.querySelector(".vis > h2");
  const first = (node) => node
    ? getComputedStyle(node).fontFamily.split(",")[0].replace(/["']/g, "").trim()
    : null;
  return {
    skin: root.dataset.skin || null,
    theme: root.dataset.theme || null,
    phase: root.dataset.phase || null,
    stored: localStorage.getItem("3i.skin"),
    rPanel: cs.getPropertyValue("--r-panel").trim(),
    rSoft: cs.getPropertyValue("--r-soft").trim(),
    rNode: cs.getPropertyValue("--r-node").trim(),
    slant: cs.getPropertyValue("--slant").trim(),
    paper: paint("--paper"),
    ink: paint("--ink"),
    phA: paint("--ph-a"),
    blobA: paint("--blob-a"),
    lineA: paint("--line-a"),
    ring: paint("--ring"),
    ai: paint("--ai"),
    body: first(vis),
    head: first(head),
  };
})()`);

/** Los tres canales de un color resuelto, para poder hablar de claridad. */
const chan = (color) => (String(color).match(/[\d.]+/g) || []).slice(0, 3).map(Number);

/* --- 1. sin haber elegido ----------------------------------------------- */

const sobrio = await look();
say(sobrio.skin === "sobrio" && sobrio.stored === null,
  "sin haber elegido, la plataforma sale sobria",
  sobrio.skin + " (guardado: " + sobrio.stored + ")");
say(sobrio.rPanel === "3px", "con las esquinas casi rectas de siempre", sobrio.rPanel);
say(sobrio.slant === "italic",
  "y la cursiva de la serif, que es un dibujo y no una inclinacion", sobrio.slant);
say(sobrio.phA === sobrio.ink,
  "la gama de fase es la tinta: este papel no tiene colores de estado",
  sobrio.phA + " vs " + sobrio.ink);
say(chan(sobrio.blobA).length === 3 && String(sobrio.blobA).includes("0)"),
  "y las formas flotantes no estan, sin regla que las apague", sobrio.blobA);

/* --- 2. elegir vivo ----------------------------------------------------- */

await setSkin("vivo");
const vivo = await look();
say(vivo.skin === "vivo" && vivo.stored === "vivo",
  "elegir vivo se aplica y se queda guardado",
  vivo.skin + " (guardado: " + vivo.stored + ")");
say(vivo.rPanel === "14px", "un panel se redondea de verdad", vivo.rPanel);
say(vivo.rNode === "18px", "y un nodo mas que un panel: es una ficha, no una ventana",
  vivo.rNode);
say(vivo.rSoft === "7px",
  "lo pequeno se redondea menos, para que un code no se vuelva pildora", vivo.rSoft);
say(vivo.slant === "normal",
  "sin cursiva: la geometrica no tiene una y el navegador la falsificaria", vivo.slant);
say(vivo.body === "Plus Jakarta Sans",
  "el cuerpo de la hoja baja a la humanista, que es la de parrafo largo", vivo.body);
say(vivo.head === "Outfit",
  "y los titulos suben a la geometrica, que es de donde viene el aire de la lamina",
  vivo.head);
say(vivo.paper !== sobrio.paper,
  "el papel deja de ser blanco puro: sobre blanco puro un pastel se ve sucio",
  vivo.paper);
say(vivo.ai === sobrio.ai,
  "el azul de la IA no cambia con el estilo: es fidelidad del dato, no gusto",
  vivo.ai);
say(vivo.blobA !== sobrio.blobA && !String(vivo.blobA).endsWith(" 0)"),
  "y ahora si hay manchas de color al fondo", vivo.blobA);

/* --- 3. la fase la pone el documento ------------------------------------ */

say(vivo.phase === null, "sin documento abierto no hay fase", String(vivo.phase));
const sinFase = vivo.phA;

await cdp.evaluate(`(async () => {
  const m = await import("/src/core/state/selection.ts");
  m.selectPage({ id: "page-1", name: "Indagar", parentId: "proj-1", projectName: "Mi proyecto" });
})()`);
await wait(1500);

const indagar = await look();
say(indagar.phase === "indagar",
  "abrir el documento de una fase la escribe en el html", String(indagar.phase));
say(indagar.phA !== sinFase,
  "y mueve la gama entera sin que ningun componente sepa que fase es",
  indagar.phA + " vs " + sinFase);

/* Las otras dos gamas se miran poniendo el atributo a mano: lo que se comprueba
   aquí es la tabla de `tokens.css`, no que el documento la escriba —eso acaba de
   quedar dicho—. */
const gamas = await cdp.evaluate(`(() => {
  ${PAINT}
  const root = document.documentElement;
  const was = root.dataset.phase;
  const out = {};
  for (const phase of ["indagar", "idear", "implementar"]) {
    root.dataset.phase = phase;
    out[phase] = [paint("--ph-a"), paint("--ph-b"), paint("--ph-c"), paint("--ph-d")];
  }
  if (was) root.dataset.phase = was; else delete root.dataset.phase;
  return out;
})()`);
const cabezas = ["indagar", "idear", "implementar"].map((p) => gamas[p][0]);
say(new Set(cabezas).size === 3,
  "las tres fases tienen tres gamas distintas", cabezas.join(" · "));
say(["indagar", "idear", "implementar"].every((p) => new Set(gamas[p]).size === 4),
  "y cada una cuatro tonos, que es lo que pedia la lamina: variacion dentro de la etapa",
  gamas.idear.join(" · "));

/* --- 4. los nodos del mapa ---------------------------------------------- */

await cdp.evaluate(
  `[...document.querySelectorAll(".wr__act")].find((b) => b.textContent === "Mapa").click()`);
await wait(900);

const mapa = await cdp.evaluate(`(() => {
  const root = document.getElementById("wr-map");
  const all = [...root.querySelectorAll(".map__n")];
  const four = all.slice(0, 4).map((n) => {
    const cs = getComputedStyle(n);
    return {
      tone: cs.getPropertyValue("--tone").trim(),
      border: cs.borderTopColor,
      radius: cs.borderTopLeftRadius,
    };
  });
  const canvas = root.querySelector(".map__canvas");
  const stage = root.querySelector(".map__stage");
  return {
    count: all.length,
    tones: four.map((f) => f.tone),
    borders: four.map((f) => f.border),
    radius: four[0] ? four[0].radius : null,
    grid: canvas ? getComputedStyle(canvas).backgroundImage : "none",
    stagePos: stage ? getComputedStyle(stage).position : null,
    blobs: stage
      ? (getComputedStyle(stage, "::before").backgroundImage.match(/radial-gradient/g) || []).length
      : 0,
  };
})()`);

say(mapa.count > 12, "el mapa dibuja la ruta entera", "nodos=" + mapa.count);
say(new Set(mapa.tones).size === 4,
  "los cuatro primeros nodos llevan cuatro tonos: dos vecinos nunca coinciden",
  mapa.tones.join(" · "));
say(new Set(mapa.borders).size === 4,
  "y el reparto llega al borde pintado, no se queda en la propiedad",
  mapa.borders.join(" · "));
say(mapa.radius === "18px", "un nodo es una ficha redonda", String(mapa.radius));
say(mapa.grid.includes("radial-gradient"),
  "el lienzo lleva la trama de puntos, que se arrastra y se acerca con el plano");
say(mapa.stagePos === "relative" && mapa.blobs === 4,
  "y el escenario las cuatro manchas fijas, que se quedan quietas al arrastrar",
  "manchas=" + mapa.blobs);

/* --- 5. el gris de Adobe ------------------------------------------------ */

await setTheme("dark");
const vivoOscuro = await look();
const grey = chan(vivoOscuro.paper);
say(grey.every((c) => c >= 36 && c <= 72),
  "el oscuro de vivo es un gris medio, como los paneles de Adobe",
  vivoOscuro.paper);
say(vivoOscuro.phA !== indagar.phA,
  "y la gama sube de claridad: un azul de papel blanco, sobre gris medio, se hunde",
  vivoOscuro.phA + " vs " + indagar.phA);
say(vivoOscuro.ring !== sobrio.ring,
  "el anillo de dictar sigue al papel en vez de ser tinta oscura fija",
  vivoOscuro.ring);

await setSkin("sobrio");
const sobrioOscuro = await look();
const black = chan(sobrioOscuro.paper);
say(black.every((c) => c < 32),
  "el oscuro sobrio sigue siendo el casi negro de antes: son dos papeles, no uno",
  sobrioOscuro.paper);
say(sobrioOscuro.rPanel === "3px" && sobrioOscuro.slant === "italic",
  "y volver a sobrio devuelve las esquinas y la cursiva, en oscuro tambien");

/* --- cerrar el documento quita la fase ---------------------------------- */

await cdp.evaluate(`(() => {
  const x = document.querySelector(".wr__x");
  if (x) x.click();
})()`);
await wait(900);
const cerrado = await look();
say(cerrado.phase === null,
  "cerrar el documento quita la fase: la casa no se queda indagando",
  String(cerrado.phase));

/* --- se deja como se encontro ------------------------------------------- */

await setTheme("light");
/* Y se borra la elección, no sólo se devuelve: la primera comprobación de esta
   misma parte es que sin nada guardado sale sobrio, y eso sólo vuelve a ser
   verdad la próxima vez si aquí no queda nada escrito. Con `CDP_PORT` puesto a
   un Chrome que ya estaba abierto el perfil no es nuevo, y entonces esto es lo
   único que lo garantiza. */
await cdp.evaluate(`localStorage.removeItem("3i.skin")`);
const final = await look();
say(final.skin === "sobrio" && final.theme === "light" && final.rPanel === "3px",
  "la parte se va dejando sobrio claro, que es lo que la parte 5 espera encontrar",
  final.skin + " " + final.theme + " " + final.rPanel);
say(final.stored === null, "y sin la eleccion guardada, como la encontro",
  String(final.stored));

cdp.close();
