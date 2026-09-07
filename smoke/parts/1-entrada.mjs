import { openPage, say, wait } from "../part.mjs";

const cdp = await openPage(["notion.js"], 2500);

const boot = await cdp.evaluate("({ title: document.title, wr: !!document.querySelector(\".wr\"), hidden: document.querySelector(\".wr\") ? document.querySelector(\".wr\").hidden : null })");
say(boot.wr === true, "el documento se monta al arrancar", JSON.stringify(boot));
say(boot.hidden === true, "y empieza cerrado");

/* Abrir una pagina como lo hace la franja. */
await cdp.evaluate(`(async () => {
  const m = await import("/src/core/state/selection.ts");
  m.selectPage({ id: "page-1", name: "Indagar", parentId: "proj-1", projectName: "Mi proyecto" });
})()`);
await wait(900);

const open = await cdp.evaluate(`(() => {
  const wr = document.querySelector(".wr");
  const vis = document.querySelector(".vis");
  return {
    hidden: wr.hidden,
    crumb: document.querySelector(".wr__crumb").textContent,
    state: document.querySelector(".wr__state").textContent,
    count: document.querySelector(".wr__count").textContent,
    blocks: vis ? vis.children.length : 0,
    heads: [...vis.querySelectorAll("h2, h3, h4")].map((h) => h.textContent),
    note: document.querySelector(".wr__note").hidden,
    body: document.body.className,
  };
})()`);
say(open.hidden === false, "se abre al elegir una pagina");
say(open.crumb.includes("Mi proyecto") && open.crumb.includes("Indagar"), "la barra dice proyecto y pagina", open.crumb);
say(open.blocks >= 6, "trae los bloques de Notion compuestos", "n=" + open.blocks);
say(open.heads.length === 4, "los titulos salen como titulos de verdad", JSON.stringify(open.heads));
say(open.state === "Guardado en Notion", "dice que esta guardado", open.state);
say(/\d+ palabras/.test(open.count), "cuenta las palabras", open.count);
say(open.note === true, "sin avisos que no hacen falta");
say(open.body.includes("is-writing"), "la pagina de detras no se desplaza");

/* Escribir: cuenta, apartados y guardado. */
await cdp.evaluate(`(() => {
  const vis = document.querySelector(".vis");
  vis.focus();
  const para = document.createElement("p");
  para.textContent = "Un parrafo escrito a mano para ver si el guardado se entera.";
  vis.appendChild(para);
  vis.dispatchEvent(new Event("input", { bubbles: true }));
})()`);
await wait(150);
const typed = await cdp.evaluate(`(() => ({
  state: document.querySelector(".wr__state").textContent,
  heads: document.querySelectorAll(".out__h").length,
  para: !!document.querySelector(".vis > p:last-child"),
}))()`);
say(typed.state === "Sin guardar", "escribir lo marca sin guardar", typed.state);
say(typed.para === true, "lo escrito queda en la hoja");
say(typed.heads === 4, "y los apartados siguen a la izquierda", "n=" + typed.heads);

await wait(2300);
const saved = await cdp.evaluate(`({
  state: document.querySelector(".wr__state").textContent,
  saves: window.__saves,
  last: (window.__saved[window.__saved.length - 1] || "").slice(-40),
})`);
say(saved.saves >= 1 && saved.saves <= 2, "se guarda solo, en una salva", "lotes=" + saved.saves);
say(saved.state === "Guardado en Notion", "y lo dice", saved.state);
say(saved.last.includes("guardado se entera."), "con lo escrito dentro", saved.last);

cdp.close();
