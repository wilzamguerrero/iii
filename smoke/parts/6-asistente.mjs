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
say(asked.turns.length === 2 && asked.turns[1].indexOf("ai-turn |") === 0,
  "la respuesta se lee en la ventana", JSON.stringify(asked.turns[1] || "").slice(0, 70));

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

cdp.close();
