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
  const area = document.querySelector(".wr__edit");
  return {
    hidden: wr.hidden,
    crumb: document.querySelector(".wr__crumb").textContent,
    state: document.querySelector(".wr__state").textContent,
    count: document.querySelector(".wr__count").textContent,
    chars: area.value.length,
    disabled: area.disabled,
    heads: [...document.querySelectorAll(".out__h")].map((b) => b.textContent),
    levels: [...document.querySelectorAll(".out__h")].map((b) => b.className),
    note: document.querySelector(".wr__note").hidden,
    body: document.body.className,
  };
})()`);
say(open.hidden === false, "se abre al elegir una pagina");
say(open.crumb.includes("Mi proyecto") && open.crumb.includes("Indagar"), "la barra dice proyecto y pagina", open.crumb);
say(open.chars > 200, "trae el texto de Notion", "chars=" + open.chars);
say(open.disabled === false, "el campo queda abierto");
say(open.state === "Guardado en Notion", "dice que esta guardado", open.state);
say(/\d+ palabras/.test(open.count), "cuenta las palabras", open.count);
say(open.heads.length === 4, "los apartados salen del texto", JSON.stringify(open.heads));
say(open.levels.some((c) => c.includes("out__h3")), "con su nivel", JSON.stringify(open.levels));
say(open.note === true, "sin avisos que no hacen falta");
say(open.body.includes("is-writing"), "la pagina de detras no se desplaza");

/* Escribir: cuenta, apartados y guardado. */
await cdp.evaluate(`(() => {
  const area = document.querySelector(".wr__edit");
  area.value = area.value + String.fromCharCode(10, 10) + "## Un apartado nuevo" + String.fromCharCode(10, 10) + "Con su parrafo escrito a mano para ver si el guardado se entera.";
  area.dispatchEvent(new Event("input", { bubbles: true }));
})()`);
await wait(120);
const typed = await cdp.evaluate("({ state: document.querySelector(\".wr__state\").textContent, heads: document.querySelectorAll(\".out__h\").length })");
say(typed.state === "Sin guardar", "escribir lo marca sin guardar", typed.state);
say(typed.heads === 5, "y el apartado nuevo aparece a la izquierda", "n=" + typed.heads);

await wait(2200);
const saved = await cdp.evaluate(`({ state: document.querySelector(".wr__state").textContent, saves: window.__saves, last: (window.__saved[window.__saved.length - 1] || "").slice(-40) })`);
// Con bloques, una salva son uno o dos lotes —según cuántas anclas nuevas
// haga el diff—, pero nunca una por tecla: eso es lo que se comprueba.
say(saved.saves >= 1 && saved.saves <= 2, "se guarda solo, en una salva", "lotes=" + saved.saves);
say(saved.state === "Guardado en Notion", "y lo dice", saved.state);
say(saved.last.includes("guardado se entera."), "con lo escrito dentro", saved.last);

cdp.close();
