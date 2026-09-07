import { openPage, say, wait } from "../part.mjs";

const INTENT = "Quiero mejorar la senaletica del hospital departamental de Pasto "
  + "porque la gente no encuentra los servicios y pregunta en la portería.";

const cdp = await openPage(["notion.js", "arranque.js"]);

/* --- la intención se manda como la manda main.js ------------------------ */
await cdp.evaluate(`document.dispatchEvent(new CustomEvent("intent:submit", {
  detail: { intent: ${JSON.stringify(INTENT)}, at: Date.now() },
}))`);
await wait(1100);
const opened = await cdp.evaluate(`(() => {
  const begin = document.querySelector(".begin");
  return {
    shown: begin ? !begin.hidden : false,
    head: document.querySelector(".begin__title") ? document.querySelector(".begin__title").textContent : null,
    quote: document.querySelector(".begin__quote") ? document.querySelector(".begin__quote").textContent : null,
    said: document.querySelector(".begin__ai .msg") ? document.querySelector(".begin__ai .msg").textContent : null,
  };
})()`);
say(opened.shown === true, "la hoja de empezar se abre al mandar la intencion");
say(opened.head === "Empezar el proyecto", "y sabe que hay donde crear", opened.head);
say(opened.quote !== null && opened.quote.indexOf("senaletica del hospital") > 0, "con la intencion citada", (opened.quote || "").slice(0, 46));

await wait(1200);
const proposed = await cdp.evaluate(`(() => {
  const call = window.__aiCalls[0] || null;
  const asked = call ? call.messages[call.messages.length - 1].content : "";
  return {
    calls: window.__aiCalls.length,
    sawIntent: asked.indexOf("senaletica del hospital") > 0,
    sawPhases: asked.indexOf("indagar") > 0 && asked.indexOf("idear") > 0 && asked.indexOf("implementar") > 0,
    askedAboutProject: asked.indexOf("sobre este proyecto") > 0 || asked.indexOf("s\u00f3lo sobre este proyecto") > 0 || asked.indexOf("nombran a sus actores") > 0,
    name: document.querySelector(".search__input").value,
    note: document.querySelector(".begin__note") ? document.querySelector(".begin__note").textContent : null,
    phases: [...document.querySelectorAll(".begin__phase__name")].map((h) => h.textContent),
    questions: [...document.querySelectorAll(".begin__q")].map((q) => q.textContent),
    canCreate: !document.querySelector(".begin .btn").disabled,
  };
})()`);
say(proposed.calls === 1, "se le pide el armazon una sola vez", "llamadas=" + proposed.calls);
say(proposed.sawIntent && proposed.sawPhases, "el modelo recibe la intencion y lo que decide cada fase",
  `intencion=${proposed.sawIntent} fases=${proposed.sawPhases}`);
say(proposed.askedAboutProject === true, "y el encargo exige preguntas ancladas a este proyecto");
say(proposed.name === "Senaletica del hospital de Pasto", "propone el nombre de la carpeta", proposed.name);
say(proposed.note !== null && proposed.note.indexOf("orientacion") > 0, "y dice que naturaleza le parece", proposed.note);
say(JSON.stringify(proposed.phases) === JSON.stringify(["Indagar", "Idear", "Implementar"]),
  "las preguntas vienen por fase y en el orden del metodo", JSON.stringify(proposed.phases));
say(proposed.questions.length === 5, "cinco preguntas, ninguna de plantilla", "n=" + proposed.questions.length);
say(proposed.questions.every((q) => q.indexOf("objetivo general") < 0), "y ninguna es la de siempre");
say(proposed.canCreate === true, "se puede crear");

/* --- crear: la carpeta y los tres documentos, paginas de verdad ---------- */
await cdp.evaluate(`[...document.querySelectorAll(".begin .btn")].find((b) => b.textContent === "Crear el proyecto").click()`);
await wait(4200);
const made = await cdp.evaluate(`(() => {
  return {
    pages: window.__pages.map((p) => p.title),
    ids: window.__pages.map((p) => p.id),
    parents: window.__pages.map((p) => p.parent),
    icons: window.__pages.map((p) => p.icon ? p.icon.emoji : null),
    blocks: window.__made.map((m) => m.block.type),
    head: document.querySelector(".begin__title").textContent,
    listed: [...document.querySelectorAll(".begin__made__one")].map((li) => li.textContent),
    open: [...document.querySelectorAll(".begin .btn")].map((b) => b.textContent),
  };
})()`);
say(JSON.stringify(made.pages) === JSON.stringify(["Senaletica del hospital de Pasto", "Indagar", "Idear", "Implementar"]),
  "el proyecto es una pagina y los tres documentos paginas hijas", JSON.stringify(made.pages));
say(made.parents[0] === "root-1" && made.parents.slice(1).every((p) => p === made.ids[0]),
  "los tres van dentro de la pagina del proyecto", JSON.stringify(made.parents));
say(made.icons[0] === "\u{1F4C1}", "y el proyecto lleva su icono de carpeta", JSON.stringify(made.icons));
say(made.blocks.includes("heading_2") && made.blocks.includes("quote") && made.blocks.includes("bulleted_list_item"),
  "los documentos nacen con bloques nativos, no en un bloque de codigo", JSON.stringify(made.blocks.slice(0, 5)));
say(made.head === "Proyecto creado", "la hoja lo cuenta", made.head);
say(made.listed.length === 3, "con los tres documentos a la vista", JSON.stringify(made.listed));
say(made.open.some((t) => t === "Abrir Indagar"), "y ofrece abrir el primero", JSON.stringify(made.open));

/* --- la pregunta de la IA viaja dentro del documento -------------------- */
const seeded = await cdp.evaluate(`(() => {
  const doc = window.__pages[1];
  const first = window.__made.filter((m) => m.page === doc.id).map((m) => m.block);
  const text = first.map((b) => {
    const part = b[b.type];
    return (part && part.rich_text ? part.rich_text : []).map((s) => (s.text && s.text.content) || s.plain_text || "").join("");
  }).join(" | ");
  return { text, types: first.map((b) => b.type) };
})()`);
say(seeded.text.indexOf("senaletica del hospital") >= 0, "cada documento cita la intencion", seeded.text.slice(0, 60));
say(seeded.text.indexOf("Quien se pierde hoy en el hospital") >= 0, "y trae sus preguntas dentro");

/* --- abrir Indagar: del proyecto recien hecho al editor ----------------- */
await cdp.evaluate(`[...document.querySelectorAll(".begin .btn")].find((b) => b.textContent === "Abrir Indagar").click()`);
await wait(2200);
const writing = await cdp.evaluate(`(() => {
  const wr = document.querySelector(".wr");
  const begin = document.querySelector(".begin");
  const vis = document.querySelector(".vis");
  return {
    begunClosed: begin ? begin.hidden : true,
    open: wr ? !wr.hidden : false,
    crumb: document.querySelector(".wr__crumb") ? document.querySelector(".wr__crumb").textContent : null,
    state: document.querySelector(".wr__state").textContent,
    value: vis ? vis.textContent : "",
    editable: vis ? vis.getAttribute("contenteditable") : null,
    heads: [...document.querySelectorAll(".out__h")].map((b) => b.textContent),
    dock: document.querySelector(".dock") ? !document.querySelector(".dock").classList.contains("is-shut") : null,
  };
})()`);
say(writing.begunClosed === true && writing.open === true, "abrir lleva del proyecto al documento");
say(writing.crumb !== null && writing.crumb.indexOf("Indagar") > 0, "el editor dice donde esta", writing.crumb);
say(writing.editable === "true", "y se puede escribir en el");
say(writing.value.indexOf("Quien se pierde hoy en el hospital") > 0, "el documento trae sus preguntas", writing.value.slice(0, 40));
say(writing.state === "Guardado en Notion", "y nace guardado", writing.state);
say(writing.heads.length >= 2, "sus apartados salen a la izquierda", JSON.stringify(writing.heads));

/* --- lo escrito encima llega a Notion como diff -------------------------- */
await cdp.evaluate(`(() => {
  const vis = document.querySelector(".vis");
  vis.focus();
  const para = document.createElement("p");
  para.textContent = "Se pierde quien llega por urgencias y busca consulta externa.";
  vis.appendChild(para);
  vis.dispatchEvent(new Event("input", { bubbles: true }));
})()`);
await wait(3200);
const saved = await cdp.evaluate(`(() => {
  const vis = document.querySelector(".vis");
  const doc = window.__pages[1];
  return {
    value: vis ? vis.textContent.slice(-60) : "",
    state: document.querySelector(".wr__state").textContent,
    born: window.__made.filter((m) => m.page === doc.id).length,
  };
})()`);
say(saved.value.indexOf("busca consulta externa") > 0, "escribir queda en el documento");
say(saved.state === "Guardado en Notion", "y lo dice", saved.state);

cdp.close();
