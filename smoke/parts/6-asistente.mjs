import { openPage, say, wait } from "../part.mjs";

const cdp = await openPage(["notion.js", "asistente.js"]);

/* --- el papel y su ventana ---------------------------------------------- */
const handle = await cdp.evaluate(`(() => {
  const node = document.querySelector(".ai-handle");
  const box = node.getBoundingClientRect();
  return {
    shown: !node.hidden,
    expanded: node.getAttribute("aria-expanded"),
    ori: !!node.querySelector("svg"),
    right: Math.round(window.innerWidth - box.right),
    bottom: Math.round(window.innerHeight - box.bottom),
  };
})()`);
say(handle.shown === true, "el papel del asistente esta a la vista");
say(handle.ori === true, "y es el mismo avion de la entrada");
say(handle.right < 40 && handle.bottom < 120, "abajo a la derecha", `derecha=${handle.right} abajo=${handle.bottom}`);

await cdp.evaluate(`document.querySelector(".ai-handle").click()`);
await wait(400);
const open = await cdp.evaluate(`(() => {
  const pop = document.querySelector(".ai-pop");
  return {
    open: !pop.hidden,
    seeds: [...pop.querySelectorAll(".ai-seed")].map((b) => b.textContent),
    ctx: pop.querySelector(".ai-pop__ctx").textContent,
    foot: pop.querySelector(".ai-pop__foot").textContent,
    footHidden: pop.querySelector(".ai-pop__foot").hidden,
    acts: [...pop.querySelectorAll(".ai-pop__act")].map((b) => b.textContent),
  };
})()`);
say(open.open === true, "pulsarlo abre la ventana");
say(open.seeds.length === 3, "con tres preguntas del metodo para arrancar", "n=" + open.seeds.length);
say(open.ctx.indexOf("Todavia no ve nada") === 0 || open.ctx.indexOf("Todavía no ve nada") === 0,
  "que dice lo que ve, y todavia no ve nada", open.ctx);
say(open.footHidden === true && open.foot === "",
  "el pie no repite el modelo: ya se ve en los ajustes", JSON.stringify({ foot: open.foot, footHidden: open.footHidden }));
say(JSON.stringify(open.acts) === JSON.stringify(["Nueva", "×"]), "sin el boton de ajustes que sobraba", JSON.stringify(open.acts));

/* --- ve la intencion y el documento que hay delante --------------------- */
await cdp.evaluate(`(async () => {
  const i = await import("/src/core/state/intent.ts");
  i.rememberIntent("Mejorar la senaletica del hospital de Pasto.", new Date().toISOString());
  const s = await import("/src/core/state/selection.ts");
  s.selectPage({ id: "page-1", name: "Indagar", parentId: "proj-1", projectName: "Mi proyecto" });
})()`);
await wait(1000);
const sees = await cdp.evaluate(`document.querySelector(".ai-pop__ctx").textContent`);
say(sees.indexOf("intenci") > 0 && sees.indexOf("Indagar") > 0, "al abrir un documento dice que lo ve", sees);

/* --- lo que ve es lo escrito, no lo guardado --------------------------- */
await cdp.evaluate(`(() => {
  const area = document.querySelector(".wr__edit");
  area.focus();
  area.value = area.value + String.fromCharCode(10, 10) + "Esto acabo de escribirlo y no esta en Notion.";
  area.dispatchEvent(new Event("input", { bubbles: true }));
})()`);
await wait(200);
await cdp.evaluate(`(() => {
  window.__reads.length = 0;
  const field = document.querySelector(".ai-pop__field");
  field.value = "Que le falta a esto?";
  document.querySelector(".ai-pop__ask").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
})()`);
await wait(900);
const asked = await cdp.evaluate(`(() => {
  const call = window.__aiCalls[window.__aiCalls.length - 1] || null;
  const msgs = call ? call.messages : [];
  const ctx = msgs.find((m) => m.role === "system" && m.content.indexOf("Contexto de trabajo") === 0);
  const seen = ctx ? ctx.content : "";
  const last = msgs.length ? msgs[msgs.length - 1] : null;
  const turns = [...document.querySelectorAll(".ai-turn")].map((t) => t.className + " | " + t.textContent);
  return {
    calls: window.__aiCalls.length,
    roles: msgs.map((m) => m.role).join(","),
    asked: last ? last.role + ": " + last.content : "",
    method: msgs.length > 0 && msgs[0].content.indexOf("metodolog") > 0,
    sawFresh: seen.indexOf("Esto acabo de escribirlo") > 0,
    sawIntent: seen.indexOf("Mejorar la senaletica") > 0,
    sawName: seen.indexOf("Documento abierto: \\u00abIndagar\\u00bb") > 0,
    notionReads: window.__reads.length,
    turns,
  };
})()`);
say(asked.calls === 1, "preguntar manda una peticion", "llamadas=" + asked.calls);
say(asked.roles === "system,system,user", "con el metodo, lo que ve, y la pregunta", asked.roles);
say(asked.method === true, "el sistema es el del metodo 3i");
say(asked.asked === "user: Que le falta a esto?", "la pregunta viaja tal cual", asked.asked);
say(asked.sawFresh === true, "y el asistente ve lo que se acaba de escribir, no lo guardado");
say(asked.notionReads === 0, "sin volver a pedirselo a Notion", "lecturas=" + asked.notionReads);
say(asked.sawIntent && asked.sawName, "con la intencion y el documento que hay delante",
  `intencion=${asked.sawIntent} documento=${asked.sawName}`);
say(asked.turns.length === 2 && asked.turns[1].indexOf("ai-turn ai-turn--answer") === 0,
  "la respuesta se lee en la ventana", JSON.stringify(asked.turns[1] || "").slice(0, 70));

/* --- la respuesta trae acciones, como en un IDE ------------------------- */
const acts = await cdp.evaluate(`(() => {
  const one = document.querySelector(".ai-turn--answer");
  return {
    acts: one ? [...one.querySelectorAll(".ai-turn__acts .lnkbtn")].map((b) => b.textContent) : [],
    composed: one ? !!one.querySelector(".ai-md") : false,
  };
})()`);
say(acts.composed === true, "la respuesta llega compuesta, no como texto plano");
say(JSON.stringify(acts.acts) === JSON.stringify(["Copiar", "Añadir al documento"]),
  "con copiar y anadir al documento", JSON.stringify(acts.acts));

/* anadir la respuesta al documento la pega donde este el cursor */
const added = await cdp.evaluate(`(() => {
  const btn = document.querySelector(".ai-turn--answer .ai-turn__acts .lnkbtn:last-child");
  const area = document.querySelector(".wr__edit");
  const before = area.value.length;
  area.focus();
  area.setSelectionRange(area.value.length, area.value.length);
  btn.click();
  return { before, after: area.value.length, tail: area.value.slice(-120) };
})()`);
say(added.after > added.before, "anadir entra en el documento abierto", `${added.before} -> ${added.after}`);
say(added.tail.indexOf("Que decide una persona al salir del ascensor") >= 0, "con la respuesta dentro", added.tail.slice(0, 40));

/* --- se mueve y se queda donde se deja --------------------------------- */
const moved = await cdp.evaluate(`(() => {
  const grip = document.querySelector(".ai-pop__grip");
  const before = document.querySelector(".ai-pop").getBoundingClientRect().left;
  grip.focus();
  for (let i = 0; i < 4; i += 1) {
    grip.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
  }
  return {
    before: Math.round(before),
    after: Math.round(document.querySelector(".ai-pop").getBoundingClientRect().left),
    saved: localStorage.getItem("3i.pos.assistant.panel"),
  };
})()`);
say(moved.after < moved.before, "la ventana se mueve con las flechas", `${moved.before} -> ${moved.after}`);
say(moved.saved !== null, "y se recuerda donde se dejo", moved.saved);

/* --- cerrar deja el papel ---------------------------------------------- */
await cdp.evaluate(`document.querySelector(".ai-pop__x").click()`);
await wait(250);
const shut = await cdp.evaluate(`({
  pop: document.querySelector(".ai-pop").hidden,
  handle: document.querySelector(".ai-handle").hidden,
  expanded: document.querySelector(".ai-handle").getAttribute("aria-expanded"),
})`);
say(shut.pop === true && shut.handle === false, "cerrar la ventana deja el papel donde estaba");
say(shut.expanded === "false", "y lo dice quien lo abre");

/* --- el pliego: el papel se despliega y no retrasa el estado ------------ */

/* Lo que se mira aquí es que el adorno sea adorno. Los tiempos son cortos a
   propósito: a 40 ms el pliego está a menos de un doceavo y la ventana ya tiene
   que estar montada, medida y anunciada. Si algún día el estado se pusiera
   detrás de la animación, esto es lo que se pone rojo. */

await cdp.evaluate(`document.querySelector(".ai-handle").click()`);
await wait(40);
const folding = await cdp.evaluate(`(() => {
  const pop = document.querySelector(".ai-pop");
  const shell = document.querySelector(".ai-fold");
  const box = pop.getBoundingClientRect();
  const last = shell ? shell.getBoundingClientRect() : null;
  return {
    hidden: pop.hidden,
    expanded: document.querySelector(".ai-handle").getAttribute("aria-expanded"),
    folding: pop.classList.contains("is-folding"),
    shell: !!shell,
    faces: shell ? shell.querySelectorAll(".fold__face").length : 0,
    flaps: shell ? shell.querySelectorAll(".fold__flap").length : 0,
    veils: shell ? shell.querySelectorAll(".fold__shade").length : 0,
    filters: shell
      ? [...shell.querySelectorAll("*")].filter((n) => getComputedStyle(n).filter !== "none").length
      : -1,
    fits: last ? Math.abs(last.width - box.width) < 1 && Math.abs(last.height - box.height) < 1 : false,
    over: shell ? Number(getComputedStyle(shell).zIndex) < Number(getComputedStyle(pop).zIndex) : false,
    grabs: shell ? getComputedStyle(shell).pointerEvents : "",
  };
})()`);
say(folding.hidden === false && folding.expanded === "true",
  "la ventana esta montada y anunciada en el primer fotograma, no al final del pliegue",
  `hidden=${folding.hidden} expanded=${folding.expanded}`);
say(folding.shell === true && folding.folding === true, "y mientras se despliega el papel la tapa");
say(folding.faces === 8, "el pliego son ocho hojas: tres pliegues, un cuarto de pliego", "hojas=" + folding.faces);
say(folding.flaps === 7 && folding.veils === 7,
  "siete faldones con su velo, uno por cada pliegue que tienen encima",
  `faldones=${folding.flaps} velos=${folding.veils}`);
say(folding.filters === 0, "ni un filtro dentro: aplanaria el 3D y no habria pliegue", "con filtro=" + folding.filters);
say(folding.fits === true, "el pliego mide lo que la ventana, para que el relevo no se note");
say(folding.over === true, "y va por debajo de ella, sin trucos de orden en el DOM");
say(folding.grabs === "none", "el papel no se puede pulsar", folding.grabs);

await wait(900);
const done = await cdp.evaluate(`(() => {
  const pop = document.querySelector(".ai-pop");
  return {
    shell: !!document.querySelector(".ai-fold"),
    folding: pop.classList.contains("is-folding"),
    opacity: getComputedStyle(pop).opacity,
    ink: [...pop.children].map((n) => getComputedStyle(n).opacity).filter((o) => o !== "1").length,
  };
})()`);
say(done.shell === false, "al acabar no queda papel montado");
say(done.folding === false && done.opacity === "1", "y la ventana se ve entera", `opacidad=${done.opacity}`);
say(done.ink === 0, "la tinta acaba de entrar y no se queda a medias", "a medias=" + done.ink);

/* --- recoger: el papel vuelve al asa ----------------------------------- */
await cdp.evaluate(`document.querySelector(".ai-pop__x").click()`);
await wait(40);
const gone = await cdp.evaluate(`({
  hidden: document.querySelector(".ai-pop").hidden,
  expanded: document.querySelector(".ai-handle").getAttribute("aria-expanded"),
  shell: !!document.querySelector(".ai-fold"),
})`);
say(gone.hidden === true && gone.expanded === "false",
  "cerrar esconde la ventana en el primer fotograma; el pliegue no la retiene",
  `hidden=${gone.hidden} expanded=${gone.expanded}`);
say(gone.shell === true, "y el papel se queda recogiendose encima");
await wait(500);
say(await cdp.evaluate(`!document.querySelector(".ai-fold")`), "hasta que no queda nada");

/* --- pulsar dos veces seguidas no deja nada a medias -------------------- */
await cdp.evaluate(`document.querySelector(".ai-handle").click()`);
await wait(150);
await cdp.evaluate(`document.querySelector(".ai-handle").click()`);
await wait(900);
const rush = await cdp.evaluate(`({
  hidden: document.querySelector(".ai-pop").hidden,
  shell: !!document.querySelector(".ai-fold"),
  folding: document.querySelector(".ai-pop").classList.contains("is-folding"),
})`);
say(rush.hidden === true && rush.shell === false && rush.folding === false,
  "abrir y cerrar a media animacion no deja la ventana a medias",
  JSON.stringify(rush));

/* --- con movimiento reducido no se construye pliego -------------------- */
await cdp.send("Emulation.setEmulatedMedia", {
  features: [{ name: "prefers-reduced-motion", value: "reduce" }],
});
await cdp.evaluate(`document.querySelector(".ai-handle").click()`);
await wait(60);
const calm = await cdp.evaluate(`(() => {
  const pop = document.querySelector(".ai-pop");
  return {
    hidden: pop.hidden,
    shell: !!document.querySelector(".ai-fold"),
    opacity: getComputedStyle(pop).opacity,
  };
})()`);
say(calm.hidden === false && calm.shell === false && calm.opacity === "1",
  "con movimiento reducido abre sin pliego y se ve desde el principio",
  JSON.stringify(calm));
await cdp.send("Emulation.setEmulatedMedia", { features: [] });

cdp.close();
