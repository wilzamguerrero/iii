import { openPage, say, wait } from "../part.mjs";

const cdp = await openPage(["notion.js", "arbol.js"]);

/* --- lo blanco por defecto ---------------------------------------------- */
const look = await cdp.evaluate(`(() => {
  const css = getComputedStyle(document.documentElement);
  return {
    theme: document.documentElement.dataset.theme,
    stored: localStorage.getItem("3i.theme"),
    paper: css.getPropertyValue("--paper").trim(),
    radius: css.getPropertyValue("--r-panel").trim(),
  };
})()`);
say(look.theme === "light", "la plataforma arranca en claro", look.theme + " (guardado: " + look.stored + ")");
say(look.radius === "3px", "las esquinas de los paneles son casi rectas", look.radius);

/* --- la franja y el arbol ----------------------------------------------- */
// Puede haber quedado abierta de una corrida anterior: la franja recuerda cómo
// estaba, y el perfil de Chrome es el mismo.
await cdp.evaluate(`(() => {
  const node = document.querySelector(".dock");
  if (node.dataset.open !== "true") document.querySelector(".dock__toggle").click();
})()`);
await wait(900);
const dock = await cdp.evaluate(`(() => {
  const node = document.querySelector(".dock");
  return {
    open: node.dataset.open,
    body: document.body.dataset.dock,
    inert: document.querySelector(".dock__body").hasAttribute("inert"),
    tabs: [...document.querySelectorAll(".tab__name")].map((t) => t.textContent),
    tree: !!document.querySelector(".exp__tree .tree"),
    rows: [...document.querySelectorAll(".tree__name")].map((n) => n.textContent),
    tiles: [...document.querySelectorAll(".tile__name")].map((n) => n.textContent),
  };
})()`);
say(dock.open === "true" && dock.body === "open", "la franja se abre", JSON.stringify(dock.open));
say(dock.inert === false, "y su cuerpo entra en el tabulador");
say(dock.tree === true, "el arbol esta a la izquierda del explorador");
say(dock.rows[0] === "Raiz", "y empieza en la raiz", JSON.stringify(dock.rows.slice(0, 3)));
say(dock.tiles.includes("Senaletica del hospital") && dock.tiles.includes("Un proyecto vacio"),
  "los proyectos salen como baldosas", JSON.stringify(dock.tiles));
say(dock.tiles.length === 2, "y lo que no es proyecto ni pagina no se cuela", "n=" + dock.tiles.length);

/* --- iconos con unidad grafica ----------------------------------------- */
const icons = await cdp.evaluate(`(() => {
  const one = document.querySelector(".tile__ico .ico");
  const small = document.querySelector(".tree__row .ico--small");
  const box = one ? one.getAttribute("viewBox") : null;
  const size = one ? getComputedStyle(one).width : null;
  return { box, size, small: small ? getComputedStyle(small).width : null };
})()`);
say(icons.box === "0 0 24 24", "los iconos vienen de la misma rejilla de 24", icons.box);
say(parseFloat(icons.size) >= 20, "y se ven, no se adivinan", icons.size);

/* --- desde la raiz hasta un documento ---------------------------------- */
await cdp.evaluate(`(() => {
  const rows = [...document.querySelectorAll(".tree__row")];
  const row = rows.find((r) => r.textContent.indexOf("Senaletica del hospital") === 0);
  row.querySelector(".tree__twist").click();
})()`);
await wait(800);
const opened = await cdp.evaluate(`(() => {
  const rows = [...document.querySelectorAll(".tree__name")].map((n) => n.textContent);
  const item = [...document.querySelectorAll(".tree__item")]
    .find((li) => li.querySelector(".tree__name").textContent === "Senaletica del hospital");
  return { rows, expanded: item ? item.getAttribute("aria-expanded") : null };
})()`);
say(opened.expanded === "true", "el triangulo abre el proyecto en el arbol");
say(opened.rows.includes("Indagar") && opened.rows.includes("Implementar"),
  "y dentro estan sus tres documentos", JSON.stringify(opened.rows));

await cdp.evaluate(`(() => {
  const rows = [...document.querySelectorAll(".tree__row")];
  const row = rows.find((r) => r.textContent === "Idear");
  row.click();
})()`);
await wait(1100);
const writing = await cdp.evaluate(`(() => {
  const wr = document.querySelector(".wr");
  const vis = document.querySelector(".vis");
  return {
    open: wr ? !wr.hidden : false,
    crumb: document.querySelector(".wr__crumb") ? document.querySelector(".wr__crumb").textContent : null,
    value: vis ? vis.textContent : "",
    state: document.querySelector(".wr__state").textContent,
  };
})()`);
say(writing.open === true, "pulsar un documento del arbol lo abre");
say(writing.crumb === "Senaletica del hospital·Idear", "con su proyecto delante", writing.crumb);
say(writing.value.indexOf("Idear") >= 0,
  "y con su texto dentro", JSON.stringify(writing.value.slice(0, 24)));

/* --- botones cuadrados como los paneles -------------------------------- */
const corners = await cdp.evaluate(`(() => {
  const seen = {};
  const one = (sel) => {
    const node = document.querySelector(sel);
    if (node) seen[sel] = getComputedStyle(node).borderRadius;
  };
  one(".wr__act");
  one(".tile");
  one(".crumb__act");
  one(".dock");
  return seen;
})()`);
const round = Object.entries(corners).filter(([, value]) => parseFloat(value) > 6);
say(round.length === 0, "ningun boton se redondea mas que un panel", JSON.stringify(corners));

cdp.close();
