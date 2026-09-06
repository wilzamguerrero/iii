import { openPage, say, wait } from "../part.mjs";

const cdp = await openPage(["notion.js"], 2500);
await cdp.evaluate(`(async () => {
  const m = await import("/src/core/state/selection.ts");
  m.selectPage({ id: "page-1", name: "Indagar", parentId: "proj-1", projectName: "Mi proyecto" });
})()`);
await wait(900);

/* --- leer ---------------------------------------------------------------- */
await cdp.evaluate(`document.querySelector(".wr__act--mode").click()`);
await wait(200);
const read = await cdp.evaluate(`(() => {
  const doc = document.querySelector(".doc");
  return {
    docShown: !doc.hidden,
    editHidden: document.querySelector(".wr__edit").hidden,
    label: document.querySelector(".wr__act--mode").textContent,
    pressed: document.querySelector(".wr__act--mode").getAttribute("aria-pressed"),
    tags: [...doc.children].map((n) => n.tagName.toLowerCase() + "." + n.className),
    lines: [...doc.querySelectorAll("[data-line]")].map((n) => n.dataset.line).slice(0, 6),
    quote: !!doc.querySelector("blockquote.doc__quote"),
    list: doc.querySelectorAll("ul.doc__list li.doc__item").length,
  };
})()`);
say(read.docShown && read.editHidden, "leer cambia de hoja");
say(read.label === "Escribir" && read.pressed === "true", "y el boton dice como volver", read.label);
say(read.quote === true, "la linea de la estructura se lee como cita");
say(read.list === 2, "la lista sale compuesta", "items=" + read.list);
say(read.lines.length === 6 && read.lines.every((l) => /^\d+$/.test(l)), "cada bloque sabe su linea", read.lines.join(","));

/* --- ir a un apartado desde la izquierda -------------------------------- */
const jump = await cdp.evaluate(`(() => {
  const heads = [...document.querySelectorAll(".out__h")];
  const target = heads.find((b) => b.textContent.indexOf("Un tercer nivel") === 0);
  target.click();
  const found = document.querySelector(".doc .is-found");
  return { clicked: !!target, found: found ? found.textContent : null, current: target.getAttribute("aria-current") };
})()`);
say(jump.found && jump.found.indexOf("Un tercer nivel") === 0, "pulsar un apartado lleva hasta el", jump.found);

/* --- estructuras -------------------------------------------------------- */
await cdp.evaluate(`[...document.querySelectorAll(".wr__act")].find((b) => b.textContent === "Estructura").click()`);
await wait(150);
const pick = await cdp.evaluate(`(() => {
  const pick = document.querySelector(".pick");
  const rows = [...pick.querySelectorAll(".pick__one")];
  return {
    shown: !pick.hidden,
    rows: rows.length,
    names: rows.map((r) => r.querySelector(".pick__name").textContent),
    mine: rows.filter((r) => r.classList.contains("is-in")).map((r) => r.querySelector(".pick__name").textContent),
    disabled: rows.filter((r) => r.querySelector("button").disabled).length,
  };
})()`);
say(pick.shown === true, "la ventanita de estructuras se abre");
say(pick.rows === 3, "con las tres formas del reglamento", JSON.stringify(pick.names));
say(pick.mine.length === 1 && pick.mine[0] === "Idea de trabajo de grado", "sabe cual sigue ya el documento", JSON.stringify(pick.mine));
say(pick.disabled === 1, "y no deja insertarla dos veces");

const before = await cdp.evaluate(`document.querySelector(".wr__edit").value.length`);
await cdp.evaluate(`(() => {
  const rows = [...document.querySelectorAll(".pick__one")];
  const row = rows.find((r) => r.querySelector(".pick__name").textContent === "Anteproyecto");
  row.querySelector("button").click();
})()`);
await wait(250);
const inserted = await cdp.evaluate(`(() => {
  const area = document.querySelector(".wr__edit");
  return {
    pickHidden: document.querySelector(".pick").hidden,
    grew: area.value.length,
    caret: area.selectionStart,
    mode: document.querySelector(".wr__act--mode").textContent,
    heads: document.querySelectorAll(".out__h").length,
    state: document.querySelector(".wr__state").textContent,
    hasTitle: area.value.indexOf("# Anteproyecto") >= 0 || area.value.indexOf("Estructura: Anteproyecto") >= 0,
  };
})()`);
say(inserted.pickHidden === true, "insertar cierra la ventanita");
say(inserted.grew > before + 200, "los apartados entran en el texto", inserted.grew + " > " + before);
say(inserted.caret === before + 2, "el cursor queda donde empieza lo insertado", "caret=" + inserted.caret);
say(inserted.mode === "Leer", "y se vuelve a escribir para poder escribirlos");
say(inserted.hasTitle === true, "con su linea de estructura");
say(inserted.heads > 10, "los apartados nuevos estan a la izquierda", "n=" + inserted.heads);

/* --- las tres acciones sobre lo marcado -------------------------------- */
const tools = await cdp.evaluate(`(() => {
  const area = document.querySelector(".wr__edit");
  const at = area.value.indexOf("El programa de Diseno");
  area.focus();
  area.setSelectionRange(at, at + 60);
  area.dispatchEvent(new Event("select", { bubbles: true }));
  const bar = document.querySelector(".wr__tools");
  return { shown: !bar.hidden, labels: [...bar.querySelectorAll(".wr__tool")].map((b) => b.textContent) };
})()`);
say(tools.shown === true, "marcar texto ofrece las tres acciones", JSON.stringify(tools.labels));

await cdp.evaluate(`[...document.querySelectorAll(".wr__tool")].find((b) => b.textContent === "Cuestionar").click()`);
await wait(500);
const asked = await cdp.evaluate(`(() => {
  const pop = document.querySelector(".ai-pop");
  const turns = [...document.querySelectorAll(".ai-turn")].map((t) => t.textContent);
  return {
    open: pop ? !pop.hidden : false,
    mine: turns.find((t) => t.indexOf("Cuestiona este fragmento") === 0) || null,
    toolsHidden: document.querySelector(".wr__tools").hidden,
  };
})()`);
say(asked.open === true, "la pregunta va a la ventana del asistente");
say(asked.mine !== null && asked.mine.indexOf("El programa de Diseno") > 0, "con el fragmento dentro", asked.mine ? asked.mine.slice(0, 60) : "nada");
say(asked.toolsHidden === true, "y la barra de seleccion se retira");

cdp.close();
