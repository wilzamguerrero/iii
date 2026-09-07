import { openPage, say, wait } from "../part.mjs";

const cdp = await openPage(["notion.js", "dictado.js"]);

/* --- el mismo boton en los tres sitios donde se escribe ------------------ */
const where = await cdp.evaluate(`(() => {
  const field = document.querySelector("#intent-form .field");
  const kids = field ? [...field.children].map((n) => n.id || n.className) : [];
  return {
    entry: !!field && !!field.querySelector(".mic"),
    order: kids.join(" "),
    pop: !!document.querySelector(".ai-pop__mic"),
  };
})()`);
say(where.entry === true, "la intencion se puede dictar");
say(where.order.indexOf("mic") < where.order.indexOf("send"), "y el boton va antes del avion", where.order);
say(where.pop === true, "el asistente tambien");

/* --- encender y apagar -------------------------------------------------- */
await cdp.evaluate(`document.querySelector(".ai-handle").click()`);
await wait(350);
const idle = await cdp.evaluate(`window.__micState(".ai-pop__mic")`);
const on = await cdp.evaluate(`(() => {
  document.querySelector(".ai-pop__mic").click();
  const one = window.__mic();
  return Object.assign(window.__micState(".ai-pop__mic"), {
    lang: one.lang, continuous: one.continuous, interim: one.interimResults,
    focused: document.activeElement.className,
  });
})()`);
say(idle.on === "false" && on.on === "true", "pulsar el microfono lo enciende", `${idle.on} -> ${on.on}`);
say(on.title.indexOf("Escuchando") === 0, "y lo dice", on.title);
say(on.glyph !== idle.glyph, "el icono pasa a ser el de parar");
say(on.continuous === true && on.interim === false, "escucha seguido y solo entrega frases terminadas",
  `continuous=${on.continuous} interim=${on.interim}`);
say(/^es/i.test(on.lang), "en espanol", on.lang);
say(on.focused.indexOf("ai-pop__field") >= 0, "y el cursor queda donde va a caer lo dicho", on.focused);

/* --- lo provisional no se escribe -------------------------------------- */
const interim = await cdp.evaluate(`(() => {
  window.__say("esto todavia no", false);
  return document.querySelector(".ai-pop__field").value;
})()`);
say(interim === "", "lo que aun se esta diciendo no se escribe", JSON.stringify(interim));

/* --- una frase terminada cae en el campo -------------------------------- */
const said = await cdp.evaluate(`(() => {
  window.__say("Quiero indagar la senaletica");
  const field = document.querySelector(".ai-pop__field");
  return { value: field.value, caret: field.selectionStart };
})()`);
say(said.value === "Quiero indagar la senaletica ", "una frase terminada se escribe", JSON.stringify(said.value));
say(said.caret === said.value.length, "con el cursor detras", "caret=" + said.caret);

/* --- se dicta en medio, no solo al final -------------------------------- */
const middle = await cdp.evaluate(`(() => {
  const field = document.querySelector(".ai-pop__field");
  field.value = "uno dos";
  field.setSelectionRange(3, 3);
  window.__say("tres");
  return { value: field.value, caret: field.selectionStart };
})()`);
say(middle.value === "uno tres dos", "lo dictado entra donde esta el cursor", JSON.stringify(middle.value));
say(middle.caret === 8, "y el cursor queda detras de lo dictado", "caret=" + middle.caret);

const glued = await cdp.evaluate(`(() => {
  const field = document.querySelector(".ai-pop__field");
  field.value = "uno tres dos";
  field.setSelectionRange(12, 12);
  window.__say(",");
  return field.value;
})()`);
say(glued === "uno tres dos, ", "una coma no lleva espacio delante", JSON.stringify(glued));

/* --- la pausa no lo apaga; el bucle si tiene tope ----------------------- */
const again = await cdp.evaluate(`(() => {
  window.__end();
  return window.__micState(".ai-pop__mic");
})()`);
say(again.on === "true" && again.starts === 2, "una pausa larga no apaga el dictado",
  `encendidos=${again.starts} boton=${again.on}`);

const burst = await cdp.evaluate(`(() => {
  for (let i = 0; i < 7; i += 1) window.__end();
  return window.__micState(".ai-pop__mic");
})()`);
say(burst.on === "false", "pero reencenderse sin parar no: se apaga solo", `boton=${burst.on} encendidos=${burst.starts}`);

/* --- sin permiso lo dice ----------------------------------------------- */
const denied = await cdp.evaluate(`(() => {
  document.querySelector(".ai-pop__mic").click();
  window.__fail("not-allowed");
  const one = window.__mic();
  return Object.assign(window.__micState(".ai-pop__mic"), { aborts: one.aborts });
})()`);
say(denied.on === "false", "sin permiso el microfono se apaga");
say(denied.title.indexOf("no dio permiso") > 0, "y cuenta por que", denied.title);
say(denied.aborts === 1, "cerrando la sesion que no se pudo abrir", "aborts=" + denied.aborts);

// El navegador avisa del cierre después de abortar, y ese aviso no debe borrar
// el motivo: quedarse con «Dictar» seria apagarse sin decir por que.
await wait(120);
const still = await cdp.evaluate(`window.__micState(".ai-pop__mic")`);
say(still.title.indexOf("no dio permiso") > 0, "y el motivo no se borra al cerrarse la sesion", still.title);

/* --- cerrar la ventana deja de escuchar --------------------------------- */
const shut = await cdp.evaluate(`(() => {
  document.querySelector(".ai-pop__mic").click();
  const before = window.__micState(".ai-pop__mic").on;
  document.querySelector(".ai-pop__x").click();
  const one = window.__mic();
  return { before, after: window.__micState(".ai-pop__mic").on, state: one.state };
})()`);
say(shut.before === "true" && shut.after === "false", "cerrar el asistente deja de escuchar",
  `${shut.before} -> ${shut.after}`);
say(shut.state === "off", "y suelta el microfono", shut.state);

/* --- dictar en el documento -------------------------------------------- */
await cdp.evaluate(`(async () => {
  const s = await import("/src/core/state/selection.ts");
  s.selectPage({ id: "page-1", name: "Indagar", parentId: "proj-1", projectName: "Mi proyecto" });
})()`);
await wait(1200);
const doc = await cdp.evaluate(`(() => {
  const vis = document.querySelector(".vis");
  vis.focus();
  const sel = window.getSelection();
  sel.removeAllRanges();
  const range = document.createRange();
  range.selectNodeContents(vis);
  range.collapse(false);
  sel.addRange(range);
  document.querySelector(".wr__mic").click();
  window.__say("Se pierde quien llega por urgencias");
  return {
    there: !!document.querySelector(".wr__mic"),
    tail: vis.textContent.slice(-40),
    state: document.querySelector(".wr__state").textContent,
  };
})()`);
say(doc.there === true, "el documento tambien se puede dictar");
say(doc.tail.indexOf("Se pierde quien llega por urgencias") >= 0, "lo dicho se escribe en la hoja", doc.tail);

await wait(2200);
const kept = await cdp.evaluate(`({
  saved: window.__saved.length,
  last: (window.__saved[window.__saved.length - 1] || "").slice(-40),
  state: document.querySelector(".wr__state").textContent,
})`);
say(kept.saved >= 1 && kept.last.indexOf("urgencias") > 0, "y llega a Notion como si se hubiera teclado",
  JSON.stringify(kept.last));
say(kept.state === "Guardado en Notion", "que lo diga", kept.state);

/* --- el tope del campo de la intencion se respeta ----------------------- */
const capped = await cdp.evaluate(`(() => {
  const field = document.querySelector("#intent-input");
  const mic = document.querySelector("#intent-form .field .mic");
  field.value = "x".repeat(175);
  field.setSelectionRange(175, 175);
  mic.click();
  window.__say("una intencion larguisima que no cabe de ninguna manera");
  const value = field.value;
  mic.click();
  return { max: field.maxLength, length: value.length };
})()`);
say(capped.length <= capped.max, "dictar no salta el tope del campo de la intencion",
  `${capped.length}/${capped.max}`);

cdp.close();
