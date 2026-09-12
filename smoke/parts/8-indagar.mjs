/**
 * La ruta de Indagar: dentro del documento, al lado y en el mapa.
 *
 * Es la parte que faltaba. Las otras siete prueban el editor, la revisión, la
 * franja, el asistente y el dictado con un documento cualquiera —uno que no
 * lleva la ruta escrita dentro—, así que los tres módulos de la fase Indagar
 * no tenían ninguna comprobación en el navegador. Aquí sí: el doble `route.js`
 * sirve un documento que es el que fabrica `indagar.ts`, con las preguntas de
 * los tres primeros pasos respondidas, y eso pone la plataforma en el punto
 * exacto donde la ruta se bifurca.
 *
 * Lo que se comprueba, en orden:
 *
 * 1. La columna se abre sola y dice en qué paso va.
 * 2. Las preguntas tienen mandos pegados dentro del documento; saltar hasta una
 *    abre el hueco de responderla y responder abre el de la siguiente.
 * 3. El mapa dibuja el abanico de las siete naturalezas.
 * 4. Mirar una naturaleza no toca el documento; tomarla sí, y lo escrito se
 *    queda.
 * 5. Escribir con el mapa abierto mueve el avance que el mapa dibuja.
 * 6. Cambiar de ruta no borra el trabajo de la anterior.
 * 7. Escape cierra lo de encima, no el documento.
 */

import { openPage, say, wait } from "../part.mjs";

const cdp = await openPage(["notion.js", "route.js"], 3200);

/* --- el documento de la ruta -------------------------------------------- */

await cdp.evaluate(`(async () => {
  const m = await import("/src/core/state/selection.ts");
  m.selectPage({ id: "page-1", name: "Indagar", parentId: "proj-1", projectName: "Mi proyecto" });
})()`);
await wait(1400);

const doc = await cdp.evaluate(`(() => {
  const vis = document.querySelector(".vis");
  return {
    error: window.__routeError || null,
    made: window.__routeMade || 0,
    steps: document.querySelectorAll(".vis [data-step]").length,
    asks: document.querySelectorAll(".vis blockquote[data-ask]").length,
    done: document.querySelectorAll('.vis blockquote[data-ask="done"]').length,
  };
})()`);
say(doc.error === null, "la ruta se arma desde el metodo, sin fallar", doc.error || "");
say(doc.made > 25, "el doble sirve la ruta entera, no el documento de siempre", "bloques=" + doc.made);
say(doc.steps === 4, "los cuatro pasos comunes llevan su mando", "pasos=" + doc.steps);
say(doc.asks === 11, "y las once preguntas comunes el suyo", "preguntas=" + doc.asks);
say(doc.done === 8, "las de los tres primeros pasos van respondidas, que es lo que se sembro",
  "respondidas=" + doc.done);

/* --- la columna se abre sola -------------------------------------------- */

const guide = await cdp.evaluate(`(() => {
  const guia = document.querySelector(".guia");
  const stage = guia.querySelector(".guia__now__stage");
  const bar = guia.querySelector(".guia__bar");
  return {
    open: !guia.hidden,
    stage: stage ? stage.textContent : null,
    now: guia.querySelector(".guia__now__head") ? guia.querySelector(".guia__now__head").textContent : null,
    done: bar ? Number(bar.getAttribute("aria-valuenow")) : -1,
    total: bar ? Number(bar.getAttribute("aria-valuemax")) : -1,
    nat: guia.querySelector(".guia__nat__name") ? guia.querySelector(".guia__nat__name").textContent : null,
    mapBtn: guia.querySelector(".guia__nat--due") !== null,
    openAsks: guia.querySelectorAll(".guia__q").length,
    rules: guia.querySelectorAll(".guia__rules__list li").length,
    steps: guia.querySelectorAll(".guia__s").length,
    soft: guia.querySelector(".guia__steps__soft") ? guia.querySelector(".guia__steps__soft").textContent : null,
  };
})()`);
say(guide.open === true, "el documento de Indagar abre la columna solo");
say(guide.stage === "Toca diagnosticar la naturaleza", "y dice donde esta la ruta", guide.stage);
say(guide.now === "4. Diagnosticar la naturaleza de la situación", "con el paso que toca", guide.now);
say(guide.done === 3 && guide.total === 11, "el avance son 3 de 11 pasos", `${guide.done} de ${guide.total}`);
say(guide.nat === "Sin naturaleza diagnosticada" && guide.mapBtn === true,
  "y la bifurcacion se ofrece donde se decide");
say(guide.openAsks === 3, "la columna lista las tres preguntas que quedan sin responder",
  "mostradas=" + guide.openAsks);
say(guide.steps === 6, "la ruta escrita son seis apartados: cuatro comunes y la salida",
  "pasos=" + guide.steps);
say((guide.soft || "").indexOf("al tomar una ruta") > 0,
  "y los cinco que faltan se anuncian sin fingir que ya estan", guide.soft || "");
say(guide.rules === 6, "las seis reglas operativas estan plegadas", "reglas=" + guide.rules);

/* --- el mando lleva hasta la pregunta ----------------------------------- */

const jumped = await cdp.evaluate(`(() => {
  const q = [...document.querySelectorAll(".guia__q")].find((b) => b.textContent.indexOf("¿Qué está pasando realmente?") >= 0);
  if (!q) return { found: false };
  q.click();
  const lit = document.querySelector(".vis .is-found");
  const next = lit ? lit.nextElementSibling : null;
  const sel = window.getSelection();
  return {
    found: true,
    lit: lit ? lit.textContent.slice(0, 24) : null,
    widget: lit ? lit.querySelector(".ask") !== null : false,
    hole: next ? next.tagName : null,
    empty: next ? next.textContent === "" : false,
    caret: next && sel && sel.anchorNode ? next.contains(sel.anchorNode) : false,
  };
})()`);
say(jumped.found === true, "la columna lista las preguntas que faltan");
say(jumped.lit != null && jumped.lit.indexOf("¿Qué está pasando") === 0,
  "y su mando lleva hasta la pregunta en el documento", jumped.lit || "");
say(jumped.widget === true, "que es una pregunta con sus mandos pegados");
say(jumped.hole === "P" && jumped.empty === true,
  "saltar hasta ella abre el hueco de responder, no solo mueve la vista", jumped.hole || "");
say(jumped.caret === true, "con el cursor dentro: se llega escribiendo, no buscando donde");

/* --- los mandos de una pregunta ----------------------------------------- */

const commands = await cdp.evaluate(`(() => {
  const bq = [...document.querySelectorAll('.vis blockquote[data-ask="open"]')]
    .find((b) => b.textContent.indexOf("¿Qué está pasando realmente?") === 0);
  const bs = [...bq.querySelectorAll(".ask__b")];
  return {
    n: bs.length,
    titles: bs.map((b) => b.title),
    glyphs: bs.map((b) => b.querySelector(".ico") ? 1 : 0),
    editable: bq.getAttribute("contenteditable"),
    widget: bq.querySelector(".ask").getAttribute("contenteditable"),
  };
})()`);
say(commands.n === 2, "una pregunta lleva responder y la IA", "n=" + commands.n);
say(commands.titles[0].indexOf("Responder aquí") === 0, "el primero escribe debajo", commands.titles[0]);
say(commands.titles[1].indexOf("borrador") > 0, "el segundo pide un borrador", commands.titles[1]);
say(commands.glyphs.every((g) => g === 1), "los dos con su icono");
say(commands.widget === "false", "y los mandos no son texto del documento: no viajan a Notion",
  "contenteditable=" + commands.widget);

/* --- responder abre el hueco -------------------------------------------- */

/* Otra pregunta, no la de arriba: a esa el salto ya le abrió el hueco. Ésta
   está intacta, así que lo que se mide aquí es el mando de responder. */
const answered = await cdp.evaluate(`(() => {
  const bq = [...document.querySelectorAll('.vis blockquote[data-ask="open"]')]
    .find((b) => b.textContent.indexOf("¿Qué se necesita para avanzar?") === 0);
  const before = document.querySelectorAll(".vis > p").length;
  bq.querySelector(".ask__b").click();
  const after = document.querySelectorAll(".vis > p").length;
  const live = [...document.querySelectorAll(".vis blockquote")]
    .find((b) => b.textContent.indexOf("¿Qué se necesita para avanzar?") === 0);
  const next = live ? live.nextElementSibling : null;
  const sel = window.getSelection();
  return {
    grew: after - before,
    p: next ? next.tagName : null,
    still: live ? live.getAttribute("data-ask") : null,
    inside: next && sel && sel.anchorNode ? next.contains(sel.anchorNode) : false,
  };
})()`);
say(answered.grew === 1, "responder abre un parrafo debajo de la pregunta", "nuevos=" + answered.grew);
say(answered.p === "P", "y el hueco es un parrafo, no un formulario", answered.p);
say(answered.inside === true, "con el cursor dentro, listo para escribir");
say(answered.still === "open", "un hueco vacio no cuenta como respuesta: responder es escribir",
  "estado=" + answered.still);

/* --- el mando del paso del diagnostico ---------------------------------- */

const step = await cdp.evaluate(`(() => {
  const h = [...document.querySelectorAll(".vis [data-step]")]
    .find((b) => b.textContent.indexOf("Diagnosticar la naturaleza") > 0);
  const bs = [...h.querySelectorAll(".ask__b")];
  return { n: bs.length, due: h.querySelector(".ask__b--map") !== null, titles: bs.map((b) => b.title) };
})()`);
say(step.n === 2 && step.due === true, "el paso que decide trae el mapa", "n=" + step.n);
say(step.titles.some((t) => t.indexOf("Abrir el mapa") === 0), "y dice que ahi se bifurca la ruta");

/* --- el mapa ------------------------------------------------------------ */

await cdp.evaluate(`[...document.querySelectorAll(".wr__act")].find((b) => b.textContent === "Mapa").click()`);
await wait(500);

const map = await cdp.evaluate(`(() => {
  const root = document.getElementById("wr-map");
  const btn = [...document.querySelectorAll(".wr__act")].find((b) => b.textContent === "Mapa");
  const nodes = [...root.querySelectorAll(".map__n")];
  return {
    open: !root.hidden,
    expanded: btn.getAttribute("aria-expanded"),
    title: root.querySelector(".map__title").textContent,
    rule: root.querySelector(".map__rule").textContent.slice(0, 24),
    nodes: nodes.length,
    commons: nodes.filter((n) => n.className.indexOf("map__n--paso") >= 0 && n.querySelector(".map__n__head").textContent.indexOf(". ") > 0).length,
    natures: nodes.filter((n) => n.className.indexOf("map__n--naturaleza") >= 0).length,
    outs: nodes.filter((n) => n.className.indexOf("map__n--salida") >= 0).length,
    wires: root.querySelectorAll(".map__wire").length,
    dashed: [...root.querySelectorAll(".map__wire")].filter((w) => w.getAttribute("class").indexOf("is-on") < 0).length,
    where: root.querySelector(".map__where__say").textContent,
    steps: root.querySelector(".map__where__n").textContent,
    notes: root.querySelectorAll(".map__notes__list li").length,
    foot: root.querySelector(".map__foot__say").textContent.slice(0, 30),
  };
})()`);
say(map.open === true && map.expanded === "true", "el mapa se abre desde la barra");
say(map.title === "La ruta de Indagar", "y se titula como la lamina", map.title);
say(map.nodes === 14, "dibuja los once pasos y las tres piezas del abanico",
  "nodos=" + map.nodes);
say(map.commons === 4, "los cuatro pasos comunes", "comunes=" + map.commons);
say(map.natures === 7, "las siete naturalezas en el abanico", "naturalezas=" + map.natures);
say(map.outs === 2, "y las dos piezas de la salida comun", "salidas=" + map.outs);
say(map.wires === 12, "las conexiones dicen como se llega de una a otra", "aristas=" + map.wires);
say(map.dashed === 8, "y van de puntos mientras no se elija: las siete del abanico y la rama en blanco",
  "discontinuas=" + map.dashed);
say(map.where.indexOf("toca diagnosticar") > 0, "y el lado dice donde se esta", map.where);
say(map.steps === "3 de 11 pasos", "con el avance del documento", map.steps);
say(map.notes === 4, "el mapa se explica: tres notas y el aviso de tipo de proyecto", "notas=" + map.notes);
say(map.foot.indexOf("Pulsa una naturaleza") === 0, "y todavia no ha tomado nada", map.foot);

/* --- mirar una naturaleza no toca el documento -------------------------- */

const before = await cdp.evaluate(`document.querySelector(".vis").textContent.length`);

const preview = await cdp.evaluate(`(() => {
  const root = document.getElementById("wr-map");
  const nodo = [...root.querySelectorAll(".map__n--naturaleza")]
    .find((n) => n.querySelector(".map__n__head").textContent === "Problema");
  nodo.click();
  // El mapa se repinta al mirar una naturaleza, así que el nodo de arriba ya no
  // es el que está en la pantalla: hay que volver a buscarlo.
  const after = document.getElementById("wr-map");
  const live = [...after.querySelectorAll(".map__n--naturaleza")]
    .find((n) => n.querySelector(".map__n__head").textContent === "Problema");
  const branch = [...after.querySelectorAll(".map__n")].filter((n) => n.className.indexOf("is-ghost") >= 0);
  return {
    pick: live ? live.className.indexOf("is-pick") >= 0 : false,
    card: after.querySelector(".map__card__kind").textContent,
    name: after.querySelector(".map__card__head").textContent,
    ask: after.querySelector(".map__card__ask").textContent.slice(0, 20),
    tools: after.querySelector(".map__card__tools").textContent.indexOf("5 porqués") >= 0,
    branch: branch.length,
    wires: [...after.querySelectorAll(".map__wire")].filter((w) => w.getAttribute("class").indexOf("is-on") >= 0).length,
    foot: after.querySelector(".map__foot__say").textContent.slice(0, 22),
  };
})()`);
const after = await cdp.evaluate(`document.querySelector(".vis").textContent.length`);

say(preview.pick === true, "pulsar una naturaleza la deja senalada");
say(preview.card === "Estás mirando" && preview.name === "Problema", "y el lado la lee", preview.name);
say(preview.ask.length > 0 && preview.tools === true, "con su pregunta y sus herramientas", preview.ask);
say(preview.branch === 5, "la vista previa dibuja sus cinco pasos", "pasos=" + preview.branch);
say(preview.wires >= 7, "y enciende el camino entero hasta la salida", "aristas=" + preview.wires);
say(preview.foot.indexOf("Tomar la ruta") === 0, "ofreciendo tomarla, no tomandola", preview.foot);
say(after === before, "mirar no escribe una sola letra en el documento",
  `${before} -> ${after}`);

/* --- tomarla escribe la rama -------------------------------------------- */

await cdp.evaluate(`(() => {
  const root = document.getElementById("wr-map");
  [...root.querySelectorAll(".map__foot__acts .btn")]
    .find((b) => b.textContent.indexOf("Tomar la ruta") === 0).click();
})()`);
await wait(300);

const taken = await cdp.evaluate(`(() => {
  const root = document.getElementById("wr-map");
  const vis = document.querySelector(".vis");
  const nat = [...vis.querySelectorAll("blockquote")].find((b) => b.textContent.indexOf("Naturaleza:") === 0);
  const heads = [...vis.querySelectorAll("h2, h3")].map((h) => h.textContent);
  const nodes = [...root.querySelectorAll(".map__n--naturaleza")];
  return {
    declared: nat ? nat.textContent : null,
    quote: nat ? nat.tagName : null,
    branchHeads: heads.filter((h) => h.indexOf("Problema · ") === 0).length,
    whole: heads.length,
    tools: vis.textContent.indexOf("Herramientas sugeridas") > 0,
    ends: vis.textContent.indexOf("Esta ruta termina en") > 0,
    synthesis: heads.indexOf("Síntesis de situación 3i") >= 0,
    situated: heads.indexOf("Intención situada") >= 0,
    taken: nodes.filter((n) => n.className.indexOf("is-taken") >= 0).length,
    cardKind: root.querySelector(".map__card__kind").textContent,
    foot: root.querySelector(".map__foot__say").textContent.slice(0, 26),
    where: root.querySelector(".map__where__say").textContent,
    steps: root.querySelector(".map__where__n").textContent,
  };
})()`);
say(taken.declared !== null && taken.declared.indexOf("Naturaleza: Problema") === 0 && taken.quote === "BLOCKQUOTE",
  "tomar la ruta la declara dentro del documento, en una cita como la estructura",
  (taken.declared || "").slice(0, 40));
say(taken.branchHeads === 5, "y escribe los cinco pasos de esa naturaleza", "pasos=" + taken.branchHeads);
say(taken.tools === true && taken.ends === true, "con sus herramientas sugeridas y donde termina");
say(taken.synthesis === true && taken.situated === true,
  "y la salida comun queda puesta, que es a donde lleva la ruta");
say(taken.taken === 1 && taken.cardKind === "Ruta tomada", "el mapa la marca como la tomada");
say(taken.where.indexOf("Recorriendo la rama") === 0, "y sabe que ahora se recorre la rama", taken.where);
say(taken.steps === "3 de 11 pasos",
  "sin regalar avance: los cinco pasos nuevos estan puestos, no escritos", taken.steps);

/* --- lo escrito se queda al cambiar de ruta ----------------------------- */

/* Se escribe dentro del primer paso de «Problema» antes de cambiarse a otra
   naturaleza. Esto es lo que hace que la comprobación signifique algo: cambiar
   de ruta promete no borrar trabajo, y sin trabajo escrito no hay nada que no
   borrar. Los otros cuatro apartados de «Problema» se quedan vacíos a
   propósito, porque desaparecer es lo que tienen que hacer: un apartado con su
   pregunta y nada más no es trabajo de nadie. */
const WROTE = "Lo que falla es que nadie sabe en que paso va, y eso se nota al entregar.";
await cdp.evaluate(`(() => {
  const vis = document.querySelector(".vis");
  const head = [...vis.querySelectorAll("h2, h3")]
    .find((h) => h.textContent.indexOf("Problema · 1.") === 0);
  const para = document.createElement("p");
  para.textContent = ${JSON.stringify(WROTE)};
  head.parentNode.insertBefore(para, head.nextElementSibling.nextElementSibling);
  vis.dispatchEvent(new Event("input", { bubbles: true }));
})()`);
await wait(250);

const wrote = await cdp.evaluate(`(() => {
  const root = document.getElementById("wr-map");
  return {
    steps: root.querySelector(".map__where__n").textContent,
    text: document.querySelector(".vis").textContent.indexOf(${JSON.stringify(WROTE)}) > 0,
  };
})()`);
say(wrote.text === true && wrote.steps === "4 de 11 pasos",
  "escribir dentro de un paso de la rama lo da por hecho", wrote.steps);

await cdp.evaluate(`(() => {
  const root = document.getElementById("wr-map");
  const nodo = [...root.querySelectorAll(".map__n--naturaleza")]
    .find((n) => n.querySelector(".map__n__head").textContent === "Tensión");
  nodo.click();
})()`);
await wait(120);
const switching = await cdp.evaluate(`(() => {
  const root = document.getElementById("wr-map");
  return {
    card: root.querySelector(".map__card__kind").textContent,
    foot: root.querySelector(".map__foot__say").textContent,
    btn: [...root.querySelectorAll(".map__foot__acts .btn")][0].textContent,
  };
})()`);
say(switching.card === "Estás mirando" && switching.btn === "Cambiar a Tensión",
  "cambiar de ruta se ofrece como cambio, no como toma", switching.btn);
say(switching.foot.indexOf("no se borra nada") > 0, "y promete lo que cumple: no borrar", switching.foot.slice(0, 60));

await cdp.evaluate(`[...document.querySelectorAll("#wr-map .map__foot__acts .btn")]
  .find((b) => b.textContent === "Cambiar a Tensión").click()`);
await wait(300);

const changed = await cdp.evaluate(`(() => {
  const vis = document.querySelector(".vis");
  const text = vis.textContent;
  const heads = [...vis.querySelectorAll("h2, h3")].map((h) => h.textContent);
  const nats = [...vis.querySelectorAll("blockquote")].filter((b) => b.textContent.indexOf("Naturaleza:") === 0);
  return {
    declarations: nats.length,
    now: nats.length > 0 ? nats[0].textContent : null,
    old: heads.filter((h) => h.indexOf("Problema · ") === 0),
    wrote: text.indexOf(${JSON.stringify(WROTE)}) > 0,
    kept: text.indexOf("El programa de Diseño Gráfico no tiene un sitio") >= 0,
    answered: vis.querySelectorAll('blockquote[data-ask="done"]').length,
    branch: heads.filter((h) => h.indexOf("Tensión · ") === 0).length,
  };
})()`);
say(changed.declarations === 1, "solo queda una naturaleza declarada, no dos verdades",
  "declaraciones=" + changed.declarations);
say((changed.now || "").indexOf("Naturaleza: Tensión") === 0, "y es la nueva", (changed.now || "").slice(0, 34));
say(changed.branch === 5, "la rama nueva entra entera", "pasos=" + changed.branch);
say(changed.wrote === true, "y lo que se habia escrito en la anterior sigue ahi, palabra por palabra");
say(changed.old.length === 1 && (changed.old[0] || "").indexOf("Problema · 1.") === 0,
  "en su apartado, que es el unico de la anterior que se queda: los vacios sobran",
  "quedan=" + changed.old.join(" / "));
say(changed.kept === true, "lo escrito al principio sigue escrito");
say(changed.answered === 8, "y las preguntas respondidas siguen respondidas", "n=" + changed.answered);

/* --- escape cierra lo de encima ----------------------------------------- */

const closing = await cdp.evaluate(`(() => {
  const wr = document.querySelector(".wr");
  document.querySelector("#wr-map .map__stage").dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  const first = { map: !document.getElementById("wr-map").hidden, doc: !wr.hidden };
  wr.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  const second = { map: !document.getElementById("wr-map").hidden, guia: !document.querySelector(".guia").hidden, doc: !wr.hidden };
  return { first, second };
})()`);
say(closing.first.map === false && closing.first.doc === true,
  "escape cierra el mapa y deja el documento abierto");
say(closing.second.guia === false && closing.second.doc === true,
  "y el segundo escape cierra la columna, no el documento");

/* --- la barra sigue mandando -------------------------------------------- */

const bar = await cdp.evaluate(`(() => {
  const indagar = [...document.querySelectorAll(".wr__act")].find((b) => b.textContent === "Indagar");
  indagar.click();
  const opened = !document.querySelector(".guia").hidden;
  return { found: indagar !== undefined, expanded: indagar.getAttribute("aria-expanded"), opened };
})()`);
say(bar.found === true && bar.expanded === "true" && bar.opened === true,
  "el boton de la barra vuelve a abrir la columna");

console.log("ruta de Indagar: " + JSON.stringify({ bloques: doc.made, nodos: map.nodes }));

cdp.close();
