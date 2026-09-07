import { openPage, say, wait } from "../part.mjs";

const cdp = await openPage(["notion.js"], 2500);
await cdp.evaluate(`(async () => {
  const m = await import("/src/core/state/selection.ts");
  m.selectPage({ id: "page-1", name: "Indagar", parentId: "proj-1", projectName: "Mi proyecto" });
})()`);
await wait(900);

/* --- un solo modo: escribir y leer a la vez ------------------------------ */
const mode = await cdp.evaluate(`(() => ({
  vis: !!document.querySelector(".vis"),
  edit: !!document.querySelector(".wr__edit"),
  readBtn: !!document.querySelector(".wr__act--mode"),
  serif: getComputedStyle(document.querySelector(".vis")).fontFamily,
}))()`);
say(mode.vis === true && mode.edit === false, "la hoja es el documento mismo, sin dos modos");
say(mode.readBtn === false, "el boton de leer/escribir desaparecio");
say(mode.serif.indexOf("serif") >= 0, "y se escribe en la letra de leer", mode.serif.slice(0, 30));

/* --- los apartados llevan hasta su sitio --------------------------------- */
const jump = await cdp.evaluate(`(() => {
  const heads = [...document.querySelectorAll(".out__h")];
  const target = heads.find((b) => b.textContent.indexOf("Un tercer nivel") === 0);
  target.click();
  const found = document.querySelector(".vis .is-found");
  return { found: found ? found.textContent : null, current: target.getAttribute("aria-current") };
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

const before = await cdp.evaluate(`document.querySelectorAll(".vis > *").length`);
await cdp.evaluate(`(() => {
  const rows = [...document.querySelectorAll(".pick__one")];
  const row = rows.find((r) => r.querySelector(".pick__name").textContent === "Anteproyecto");
  row.querySelector("button").click();
})()`);
await wait(300);
const inserted = await cdp.evaluate(`(() => ({
  pickHidden: document.querySelector(".pick").hidden,
  grew: document.querySelectorAll(".vis > *").length,
  heads: document.querySelectorAll(".out__h").length,
  state: document.querySelector(".wr__state").textContent,
  hasTitle: [...document.querySelectorAll(".vis > blockquote")].some((b) => b.textContent.indexOf("Estructura: Anteproyecto") === 0),
}))()`);
say(inserted.pickHidden === true, "insertar cierra la ventanita");
say(inserted.grew > before + 10, "los apartados entran en el documento", inserted.grew + " > " + before);
say(inserted.hasTitle === true, "con su linea de estructura");
say(inserted.heads > 10, "los apartados nuevos estan a la izquierda", "n=" + inserted.heads);

/* --- el menu «/»: la tecla de los bloques -------------------------------- */
const slash = await cdp.evaluate(`(() => {
  const vis = document.querySelector(".vis");
  vis.focus();
  const all = vis.querySelectorAll(":scope > *");
  const para = document.createElement("p");
  vis.appendChild(para);
  const range = document.createRange();
  range.selectNodeContents(para);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  para.dispatchEvent(new KeyboardEvent("keydown", { key: "/", bubbles: true, cancelable: true }));
  const menu = document.querySelector(".sl");
  return {
    there: !!menu,
    shown: menu ? !menu.hidden : false,
    items: menu ? [...menu.querySelectorAll(".sl__one")].map((b) => b.dataset.id) : [],
    label: menu ? menu.querySelector(".sl__one .sl__label").textContent : null,
  };
})()`);
say(slash.there === true && slash.shown === true, "la tecla / abre el menu de bloques");
say(slash.items.includes("h1") && slash.items.includes("bullet") && slash.items.includes("quote")
  && slash.items.includes("divider") && slash.items.includes("code") && slash.items.includes("image"),
  "con los bloques de un documento de verdad", JSON.stringify(slash.items));

/* elegir un bloque lo pone donde estaba el cursor */
const picked = await cdp.evaluate(`(() => {
  const menu = document.querySelector(".sl");
  const one = [...menu.querySelectorAll(".sl__one")].find((b) => b.dataset.id === "h2");
  one.click();
  const vis = document.querySelector(".vis");
  const last = vis.lastElementChild;
  return { tag: last ? last.tagName : null, focus: document.activeElement === vis };
})()`);
say(picked.tag === "H3", "elegir Apartado pone un titulo en la hoja", picked.tag);
say(picked.focus === true, "y el cursor queda dentro del documento");

/* escribir sobre el titulo recien puesto */
await cdp.evaluate(`(() => {
  const vis = document.querySelector(".vis");
  const last = vis.lastElementChild;
  last.textContent = "Un apartado nuevo con el menu";
  vis.dispatchEvent(new Event("input", { bubbles: true }));
})()`);
await wait(200);
const heading = await cdp.evaluate(`(() => ({
  heads: [...document.querySelectorAll(".out__h")].map((h) => h.textContent),
  state: document.querySelector(".wr__state").textContent,
}))()`);
say(heading.heads.includes("Un apartado nuevo con el menu"), "el titulo del menu sale en los apartados");
say(heading.state === "Sin guardar", "y queda como cambio sin guardar");

/* --- las tres acciones sobre lo marcado -------------------------------- */
const tools = await cdp.evaluate(`(() => {
  const vis = document.querySelector(".vis");
  const para = [...vis.querySelectorAll("p")].find((p) => p.textContent.indexOf("El programa de Diseno") === 0);
  const range = document.createRange();
  range.selectNodeContents(para);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  vis.dispatchEvent(new Event("select", { bubbles: true }));
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

/* --- el clic derecho abre el menu de la IA ------------------------------ */
await cdp.evaluate(`document.querySelector(".ai-pop__x").click()`);
await wait(250);
const menu = await cdp.evaluate(`(() => {
  const vis = document.querySelector(".vis");
  const para = [...vis.querySelectorAll("p")].find((p) => p.textContent.indexOf("El programa de Diseno") === 0);
  const range = document.createRange();
  range.selectNodeContents(para);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  const rect = para.getBoundingClientRect();
  const event = new MouseEvent("contextmenu", {
    bubbles: true, cancelable: true, clientX: rect.left + 40, clientY: rect.top + 10,
  });
  vis.dispatchEvent(event);
  const pop = document.querySelector(".menu-pop");
  return {
    opened: event.defaultPrevented,
    shown: pop ? pop.isConnected : false,
    items: pop ? [...pop.querySelectorAll(".menu-pop__item")].map((b) => b.textContent) : [],
  };
})()`);
say(menu.opened === true && menu.shown === true, "el clic derecho sobre lo marcado abre el menu de la IA");
say(menu.items.includes("Cuestionar") && menu.items.includes("Resumir")
  && menu.items.includes("Buscar respaldo") && menu.items.includes("Parafrasear"),
  "con las acciones del metodo y las de investigacion", JSON.stringify(menu.items));

await cdp.evaluate(`(() => {
  const item = [...document.querySelectorAll(".menu-pop__item")].find((b) => b.textContent === "Buscar respaldo");
  if (item) item.click();
})()`);
await wait(400);
const respaldo = await cdp.evaluate(`(() => {
  const turns = [...document.querySelectorAll(".ai-turn")].map((t) => t.textContent);
  return {
    asked: turns.find((t) => t.indexOf("necesita respaldo") > 0) || null,
    menuGone: !document.querySelector(".menu-pop"),
  };
})()`);
say(respaldo.asked !== null, "buscar respaldo pregunta por el fragmento en el asistente",
  respaldo.asked ? respaldo.asked.slice(0, 60) : "nada");
say(respaldo.menuGone === true, "y el menu se retira al usarlo");

/* --- una imagen en la hoja ------------------------------------------------ */
await cdp.evaluate(`(() => {
  const vis = document.querySelector(".vis");
  const last = vis.lastElementChild;
  const fig = document.createElement("figure");
  const img = document.createElement("img");
  img.src = "https://example.com/plano.png";
  img.alt = "Un plano";
  fig.appendChild(img);
  last.after(fig);
  vis.dispatchEvent(new Event("input", { bubbles: true }));
})()`);
await wait(200);
const fig = await cdp.evaluate(`(() => {
  const img = document.querySelector(".vis img");
  return {
    there: !!img,
    src: img ? img.getAttribute("src") : null,
    alt: img ? img.getAttribute("alt") : null,
  };
})()`);
say(fig.there === true && fig.src === "https://example.com/plano.png",
  "una imagen en la hoja se ve mientras se escribe", JSON.stringify(fig));
say(fig.alt === "Un plano", "con su texto alternativo", fig.alt);

cdp.close();
