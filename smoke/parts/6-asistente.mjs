import { openPage, say, wait } from "../part.mjs";

const cdp = await openPage(["notion.js", "asistente.js"]);

/** Espera a que el guardado se cierre, mirando lo que dice la pantalla. */
async function saved(cdp, limit = 8000) {
  const until = Date.now() + limit;
  let state = "";
  while (Date.now() < until) {
    state = await cdp.evaluate(`document.querySelector(".wr__state").textContent`);
    if (state === "Guardado en Notion") return state;
    await wait(120);
  }
  return state;
}

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
  const vis = document.querySelector(".vis");
  vis.focus();
  const para = document.createElement("p");
  para.textContent = "Esto acabo de escribirlo y no esta en Notion.";
  vis.appendChild(para);
  vis.dispatchEvent(new Event("input", { bubbles: true }));
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
  const vis = document.querySelector(".vis");
  const before = vis.textContent.length;
  vis.focus();
  const sel = window.getSelection();
  sel.removeAllRanges();
  const range = document.createRange();
  range.selectNodeContents(vis);
  range.collapse(false);
  sel.addRange(range);
  btn.click();
  return { before, after: vis.textContent.length, tail: vis.textContent.slice(-120) };
})()`);
say(added.after > added.before, "anadir entra en el documento abierto", `${added.before} -> ${added.after}`);
say(added.tail.indexOf("Que decide una persona al salir del ascensor") >= 0, "con la respuesta dentro", added.tail.slice(0, 40));

/* --- de quien es cada palabra ------------------------------------------- */

/* Se pidio que lo que redacta la IA se vea de otro color y que el color se
   retire de las palabras en cuanto la persona las toca. Lo que se comprueba
   aqui es la cadena entera: entra con color, se retira al escribir palabra a
   palabra, y el color llega a Notion como color de texto nativo. */

const painted = await cdp.evaluate(`(() => {
  const spans = [...document.querySelectorAll(".vis [data-ai]")];
  const one = spans[0];
  const line = one ? one.closest(".vis > *") : null;
  const note = one ? getComputedStyle(one) : null;
  const plain = line ? getComputedStyle(line) : null;
  return {
    n: spans.length,
    klass: one ? one.className : "",
    text: one ? one.textContent : "",
    was: one ? one.getAttribute("data-ai-was") : null,
    ink: note ? note.color : "",
    plainInk: plain ? plain.color : "",
    back: note ? note.backgroundColor : "",
    deco: note ? note.textDecorationLine : "",
    style: note ? note.fontStyle : "",
  };
})()`);
say(painted.n >= 1, "lo que escribe la IA entra marcado como suyo", "trozos=" + painted.n);
say(painted.klass === "vis__ai", "con la clase que le da color", painted.klass);
say(painted.text.indexOf("Falta decir quien se pierde") === 0,
  "y lo marcado es la respuesta del modelo, entera", painted.text.slice(0, 40));
say(painted.was === painted.text,
  "que recuerda lo que escribio, para saber luego que se le toco",
  JSON.stringify({ was: (painted.was || "").slice(0, 16), hoy: painted.text.slice(0, 16) }));
say(painted.ink !== painted.plainInk, "se ve de otro color que lo demas",
  `ia=${painted.ink} persona=${painted.plainInk}`);
say(painted.back === "rgba(0, 0, 0, 0)" && painted.deco === "none" && painted.style === "normal",
  "y solo de color: es texto del documento, no un aviso",
  JSON.stringify({ fondo: painted.back, raya: painted.deco, cursiva: painted.style }));

/* Tocar una letra de una palabra del modelo: la palabra entera pasa a ser de
   quien la toco, que media palabra de cada color seria un tachon. */
const touched = await cdp.evaluate(`(() => {
  const span = document.querySelector(".vis [data-ai]");
  const line = span.closest(".vis > *");
  const node = span.firstChild;
  node.textContent = "Faltax" + node.textContent.slice(5);
  const sel = window.getSelection();
  sel.removeAllRanges();
  const range = document.createRange();
  range.setStart(node, 6);
  range.collapse(true);
  sel.addRange(range);
  document.querySelector(".vis").dispatchEvent(new Event("input", { bubbles: true }));
  const mine = [...line.childNodes]
    .filter((n) => n.nodeType === 3 || !n.hasAttribute("data-ai"))
    .map((n) => n.textContent).join("");
  const still = [...line.querySelectorAll("[data-ai]")].map((n) => n.textContent).join("");
  const now = window.getSelection();
  return {
    mine,
    still,
    text: line.textContent,
    caret: now.anchorNode ? (now.anchorNode.textContent || "").slice(0, now.anchorOffset).slice(-6) : null,
  };
})()`);
say(touched.mine.indexOf("Faltax") >= 0,
  "tocar una letra saca del color la palabra entera", JSON.stringify(touched.mine.slice(0, 24)));
say(touched.still.indexOf("decir quien se pierde") >= 0,
  "y lo que no se toco sigue siendo del modelo", touched.still.slice(0, 30));
say(touched.text.indexOf("Faltax decir quien se pierde") >= 0,
  "sin mover ni perder una letra por el camino", touched.text.slice(0, 40));
say(touched.caret === "Faltax",
  "y el cursor se queda detras de lo que se acaba de escribir", JSON.stringify(touched.caret));

/* El color viaja a Notion como color de texto nativo, con el guardado de
   siempre: no hay un guardado aparte para esto. */
await saved(cdp);
const kept = await cdp.evaluate(`(() => {
  const out = [];
  for (const one of window.__blocks()) {
    const part = one[one.type];
    for (const bit of (part && part.rich_text) || []) {
      out.push({ text: bit.plain_text, color: bit.annotations ? bit.annotations.color : null });
    }
  }
  return { spans: out, state: document.querySelector(".wr__state").textContent };
})()`);
const suyo = kept.spans.find((one) => one.text.indexOf("decir quien se pierde") >= 0);
const mio = kept.spans.find((one) => one.text.indexOf("Faltax") >= 0);
say(kept.state === "Guardado en Notion", "el color llega con el guardado de siempre", kept.state);
say(suyo !== undefined && suyo.color === "blue",
  "lo del modelo va a Notion con su color", JSON.stringify(suyo && suyo.text.slice(0, 24)));
say(mio !== undefined && !mio.color,
  "y lo que toco la persona va sin color, como cualquier cosa suya",
  JSON.stringify(mio && { text: mio.text.slice(0, 12), color: mio.color }));

/* --- un cambio de color sin cambio de texto tambien se guarda ------------ */

/* Escribir una letra dentro de una palabra del modelo y borrarla deja el texto
   exactamente como estaba, pero la palabra ya no es suya. Si el guardado
   mirase solo el texto, esto no viajaria nunca y el color se quedaria puesto
   en Notion diciendo algo que ya no es verdad. */
const onlyColor = await cdp.evaluate(`(() => {
  const span = [...document.querySelectorAll(".vis [data-ai]")]
    .find((one) => (one.textContent || "").indexOf("ascensor") >= 0);
  const line = span.closest(".vis > *");
  const was = line.textContent;
  const node = span.lastChild;
  const cut = node.textContent.indexOf("ascensor") + "ascensor".length;
  node.textContent = node.textContent.slice(0, cut) + "z" + node.textContent.slice(cut);
  const sel = window.getSelection();
  const put = (where, offset) => {
    sel.removeAllRanges();
    const range = document.createRange();
    range.setStart(where, offset);
    range.collapse(true);
    sel.addRange(range);
  };
  put(node, cut + 1);
  document.querySelector(".vis").dispatchEvent(new Event("input", { bubbles: true }));

  const mid = line.textContent;
  const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
  let end = null;
  let step = walker.nextNode();
  while (step) {
    if ((step.textContent || "").indexOf("ascensorz") >= 0) { end = step; break; }
    step = walker.nextNode();
  }
  const loose = end !== null && end.parentElement !== null && !end.parentElement.closest("[data-ai]");
  if (end) {
    const gone = end.textContent.indexOf("ascensorz") + "ascensorz".length;
    end.textContent = end.textContent.slice(0, gone - 1) + end.textContent.slice(gone);
    put(end, gone - 1);
  }
  document.querySelector(".vis").dispatchEvent(new Event("input", { bubbles: true }));
  return {
    loose,
    grew: mid.indexOf("ascensorz") >= 0,
    same: line.textContent === was,
    state: document.querySelector(".wr__state").textContent,
    sent: window.__saved.length,
  };
})()`);
say(onlyColor.grew === true && onlyColor.loose === true,
  "escribir dentro de una palabra del modelo la suelta del color entera",
  JSON.stringify({ escrita: onlyColor.grew, suelta: onlyColor.loose }));
say(onlyColor.same === true, "y borrar la letra deja el texto como estaba", "igual=" + onlyColor.same);
say(onlyColor.state === "Sin guardar",
  "aun asi queda algo que guardar: cambio el color, no el texto", onlyColor.state);

await saved(cdp);
const settled = await cdp.evaluate(`(() => {
  const out = [];
  for (const one of window.__blocks()) {
    const part = one[one.type];
    for (const bit of (part && part.rich_text) || []) {
      if (bit.plain_text.indexOf("ascensor") >= 0) {
        out.push({ text: bit.plain_text, color: bit.annotations ? bit.annotations.color : null });
      }
    }
  }
  return { spans: out, state: document.querySelector(".wr__state").textContent, sent: window.__saved.length };
})()`);
say(settled.state === "Guardado en Notion", "el cambio de solo color llega a Notion", settled.state);
say(settled.sent > onlyColor.sent, "y viaja de verdad, no se queda en la pantalla",
  `${onlyColor.sent} -> ${settled.sent}`);
say(settled.spans.some((one) => one.text.indexOf("ascensor") >= 0 && !one.color),
  "la palabra que se toco queda sin color alli tambien",
  JSON.stringify(settled.spans.map((one) => [one.text.slice(-14), one.color])));


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

/* --- lo que se escribe se queda donde se escribio ----------------------- */

/* Tres bloques nuevos escritos seguidos en medio del documento. Notion no los
   pone donde uno cree: sin ancla van **al final de la pagina**, asi que el
   segundo y el tercero tienen que colgar del anterior. Cuando esto fallaba, el
   primero se quedaba en su sitio y los otros dos se iban al final —y con ellos
   el texto de la persona, a otro apartado—. */

await cdp.evaluate(`(() => {
  const vis = document.querySelector(".vis");
  const blocks = [...vis.children];
  // Un bloque de en medio, con otro detras: es el caso que se rompia.
  const at = blocks.find((n) => n.tagName === "P" && n.textContent.trim() && n.nextElementSibling);
  window.__anchorText = at.textContent.trim();
  window.__tailText = at.nextElementSibling.textContent.trim();
  for (const text of ["Parrafo nuevo uno", "Parrafo nuevo dos", "Parrafo nuevo tres"].reverse()) {
    const p = document.createElement("p");
    p.className = "vis__b vis__b--p";
    p.setAttribute("data-b", "");
    p.textContent = text;
    at.after(p);
  }
  vis.dispatchEvent(new InputEvent("input", { bubbles: true }));
})()`);

const landed = await saved(cdp);
say(landed === "Guardado en Notion", "los tres bloques nuevos llegan a Notion", landed);

const order = await cdp.evaluate(`(() => {
  const text = (b) => {
    const part = b[b.type];
    const rich = (part && part.rich_text) || [];
    return rich.map((s) => s.plain_text || "").join("");
  };
  const all = window.__blocks().map(text);
  const at = all.indexOf(window.__anchorText);
  return {
    trio: all.slice(at + 1, at + 4),
    tail: all[at + 4],
    want: window.__tailText,
    last: all[all.length - 1],
  };
})()`);

say(order.trio.join(" | ") === "Parrafo nuevo uno | Parrafo nuevo dos | Parrafo nuevo tres",
  "y quedan los tres seguidos, en su orden, detras del bloque donde se escribieron",
  order.trio.join(" | "));
say(order.tail === order.want,
  "sin empujar lo que venia detras", `${order.tail} != ${order.want}`);
say(order.last !== "Parrafo nuevo tres" && order.last !== "Parrafo nuevo dos",
  "y no se van al final de la pagina, que es lo que hace Notion sin ancla",
  order.last);

/* --- el bloque de codigo conserva su id -------------------------------- */

/* Sin marca de id, cada guardado lo borraba y lo recreaba: se llevaba por
   delante sus comentarios de Notion y su historial, y gastaba dos operaciones
   donde no tocaba ninguna. */

await cdp.evaluate(`(() => {
  const vis = document.querySelector(".vis");
  const pre = document.createElement("pre");
  pre.className = "vis__b vis__b--code";
  pre.setAttribute("data-b", "");
  pre.setAttribute("data-lang", "json");
  pre.textContent = '{"nodos":[]}';
  vis.append(pre);
  vis.dispatchEvent(new InputEvent("input", { bubbles: true }));
})()`);
await saved(cdp);

const born = await cdp.evaluate(`(() => {
  const one = window.__blocks().find((b) => b.type === "code");
  return one ? one.id : null;
})()`);
say(typeof born === "string" && born.length > 0, "el bloque de codigo existe en Notion", String(born));

/* Se toca otra cosa y se guarda otra vez: el codigo no se ha movido. */
await cdp.evaluate(`(() => {
  const vis = document.querySelector(".vis");
  const p = [...vis.children].find((n) => n.tagName === "P" && n.textContent.trim());
  p.textContent = p.textContent + " x";
  vis.dispatchEvent(new InputEvent("input", { bubbles: true }));
})()`);
await saved(cdp);

const stayed = await cdp.evaluate(`(() => {
  const all = window.__blocks().filter((b) => b.type === "code");
  return { id: all[0] ? all[0].id : null, many: all.length };
})()`);
say(stayed.id === born, "y sobrevive al guardado siguiente con el mismo id",
  `${born} -> ${stayed.id}`);
say(stayed.many === 1, "sin duplicarse", `n=${stayed.many}`);

cdp.close();
