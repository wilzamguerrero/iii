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
say(proposed.name === "Senaletica del hospital de Pasto", "propone el nombre de la carpeta", proposed.name);
say(proposed.note !== null && proposed.note.indexOf("orientacion") > 0, "y dice que naturaleza le parece", proposed.note);
say(JSON.stringify(proposed.phases) === JSON.stringify(["Indagar", "Idear", "Implementar"]),
  "las preguntas vienen por fase y en el orden del metodo", JSON.stringify(proposed.phases));
say(proposed.questions.length === 5, "cinco preguntas, ninguna de plantilla", "n=" + proposed.questions.length);
say(proposed.questions.every((q) => q.indexOf("objetivo general") < 0), "y ninguna es la de siempre");
say(proposed.canCreate === true, "se puede crear");

/* --- crear: la carpeta y los tres documentos ---------------------------- */
await cdp.evaluate(`[...document.querySelectorAll(".begin .btn")].find((b) => b.textContent === "Crear el proyecto").click()`);
await wait(1600);
const made = await cdp.evaluate(`(() => {
  const kinds = window.__made.map((one) => one.child.type);
  const names = window.__made.map((one) => {
    const c = one.child;
    const spans = c.type === "toggle" ? c.toggle.rich_text : c.code.caption;
    return spans.map((s) => s.text.content).join("");
  });
  const bodies = window.__made.filter((one) => one.child.type === "code")
    .map((one) => one.child.code.rich_text.map((s) => s.text.content).join(""));
  return {
    kinds, names,
    parents: window.__made.map((one) => one.parent),
    head: document.querySelector(".begin__title").textContent,
    listed: [...document.querySelectorAll(".begin__made__one")].map((li) => li.textContent),
    open: [...document.querySelectorAll(".begin .btn")].map((b) => b.textContent),
    firstBody: bodies[0] || "",
    langs: window.__made.filter((one) => one.child.type === "code").map((one) => one.child.code.language),
  };
})()`);
say(JSON.stringify(made.kinds) === JSON.stringify(["toggle", "code", "code", "code"]),
  "la carpeta es un desplegable y los documentos paginas", JSON.stringify(made.kinds));
say(JSON.stringify(made.names) === JSON.stringify(["Senaletica del hospital de Pasto", "Indagar", "Idear", "Implementar"]),
  "con sus nombres", JSON.stringify(made.names));
say(made.parents[0] === "root-1" && made.parents.slice(1).every((p) => p === "born-1"),
  "los tres van dentro de la carpeta", JSON.stringify(made.parents));
say(made.langs.every((l) => l === "markdown"), "y se guardan como markdown", JSON.stringify(made.langs));
say(made.firstBody.indexOf("senaletica del hospital") > 0, "cada documento cita la intencion");
say(made.firstBody.indexOf("Quien se pierde hoy en el hospital") > 0, "y trae sus preguntas dentro");
say(made.head === "Proyecto creado", "la hoja lo cuenta", made.head);
say(made.listed.length === 3, "con los tres documentos a la vista", JSON.stringify(made.listed));
say(made.open.some((t) => t === "Abrir Indagar"), "y ofrece abrir el primero", JSON.stringify(made.open));

/* --- abrir Indagar: del proyecto recien hecho al editor ----------------- */
await cdp.evaluate(`[...document.querySelectorAll(".begin .btn")].find((b) => b.textContent === "Abrir Indagar").click()`);
await wait(1200);
const writing = await cdp.evaluate(`(() => {
  const wr = document.querySelector(".wr");
  const begin = document.querySelector(".begin");
  return {
    begunClosed: begin ? begin.hidden : true,
    open: wr ? !wr.hidden : false,
    crumb: document.querySelector(".wr__crumb") ? document.querySelector(".wr__crumb").textContent : null,
    state: document.querySelector(".wr__state").textContent,
    value: document.querySelector(".wr__edit").value,
    disabled: document.querySelector(".wr__edit").disabled,
    heads: [...document.querySelectorAll(".out__h")].map((b) => b.textContent),
    dock: document.querySelector(".dock") ? !document.querySelector(".dock").classList.contains("is-shut") : null,
  };
})()`);
say(writing.begunClosed === true && writing.open === true, "abrir lleva del proyecto al documento");
say(writing.crumb !== null && writing.crumb.indexOf("Indagar") > 0, "el editor dice donde esta", writing.crumb);
say(writing.disabled === false, "y se puede escribir en el");
say(writing.value.indexOf("Quien se pierde hoy en el hospital") > 0, "el documento trae sus preguntas", writing.value.slice(0, 40));
say(writing.state === "Guardado en Notion", "y nace guardado", writing.state);
say(writing.heads.length >= 2, "sus apartados salen a la izquierda", JSON.stringify(writing.heads));

/* --- lo escrito encima llega a Notion ---------------------------------- */
await cdp.evaluate(`(() => {
  const area = document.querySelector(".wr__edit");
  area.focus();
  area.value = area.value + String.fromCharCode(10, 10) + "Se pierde quien llega por urgencias y busca consulta externa.";
  area.dispatchEvent(new Event("input", { bubbles: true }));
})()`);
await wait(2200);
const saved = await cdp.evaluate(`({
  saved: window.__saved.length,
  last: (window.__saved[window.__saved.length - 1] || "").slice(-40),
  state: document.querySelector(".wr__state").textContent,
})`);
say(saved.saved === 1 && saved.last.indexOf("busca consulta externa") > 0,
  "escribir en el documento nuevo llega a Notion", JSON.stringify(saved));
say(saved.state === "Guardado en Notion", "y lo dice", saved.state);

cdp.close();
