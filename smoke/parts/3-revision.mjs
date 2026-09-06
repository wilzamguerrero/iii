import { openPage, say, wait } from "../part.mjs";

const cdp = await openPage(["notion.js", "revision.js"], 2500);
await cdp.evaluate(`(async () => {
  const m = await import("/src/core/state/selection.ts");
  m.selectPage({ id: "page-1", name: "Indagar", parentId: "proj-1", projectName: "Mi proyecto" });
})()`);
await wait(900);

/* --- revisar sin credencial --------------------------------------------- */
await cdp.evaluate(`[...document.querySelectorAll(".wr__act")].find((b) => b.textContent === "Revisar").click()`);
await wait(200);
const bare = await cdp.evaluate(`(() => {
  const rev = document.querySelector(".rev");
  return {
    shown: !rev.hidden,
    lead: rev.querySelector(".rev__lead") ? rev.querySelector(".rev__lead").textContent : null,
    button: rev.querySelector(".btn") ? rev.querySelector(".btn").textContent : null,
    calls: window.__aiCalls.length,
  };
})()`);
say(bare.shown === true, "la columna de revision se abre");
say(bare.lead !== null && bare.lead.indexOf("Para revisar hace falta la credencial") === 0, "y dice que falta la credencial", bare.lead);
say(bare.calls === 0, "sin gastar una peticion", "llamadas=" + bare.calls);

await cdp.evaluate(`[...document.querySelectorAll(".rev .btn")].find((b) => b.textContent === "Configurar la IA").click()`);
await wait(250);
const toTray = await cdp.evaluate(`(() => {
  const pop = document.getElementById("tray-ai");
  return { open: pop ? !pop.hidden : false };
})()`);
say(toTray.open === true, "y lleva hasta los ajustes de la bandeja");
await cdp.evaluate(`document.querySelector("#tray-ai .tray-pop__x").click()`);
await wait(120);

/* --- se pone la credencial con la columna abierta ---------------------- */
await cdp.evaluate(`(async () => {
  const m = await import("/src/core/ai/config.ts");
  m.setKey(m.activeProvider(), "sk-de-prueba-para-el-humo");
})()`);
await wait(250);
const live = await cdp.evaluate(`(() => {
  const lead = document.querySelector(".rev .rev__lead");
  return { stillBare: lead ? lead.textContent.indexOf("falta la credencial") > 0 : false };
})()`);
say(live.stillBare === false, "poner la clave despierta la columna abierta",
  live.stillBare ? "sigue pidiendo la credencial" : "");

/* --- revisar de verdad -------------------------------------------------- */
await cdp.evaluate(`(() => {
  const b = [...document.querySelectorAll(".rev .btn")].find((x) => x.textContent.indexOf("Revisar") === 0);
  if (b) b.click();
})()`);
await wait(1200);
const done = await cdp.evaluate(`(() => {
  const rev = document.querySelector(".rev");
  const call = window.__aiCalls[window.__aiCalls.length - 1] || null;
  const asked = call ? call.messages[call.messages.length - 1].content : "";
  return {
    verdict: rev.querySelector(".rev__verdict") ? rev.querySelector(".rev__verdict").textContent : null,
    cards: rev.querySelectorAll(".rev__card").length,
    kinds: [...rev.querySelectorAll(".rev__kind")].map((k) => k.textContent),
    again: [...rev.querySelectorAll(".btn")].map((b) => b.textContent),
    sawStructure: asked.indexOf("Idea de trabajo de grado") > 0,
    sawPhase: asked.indexOf("Indagar") > 0,
    sawText: asked.indexOf("Aqui todavia no hay nada escrito") > 0,
    noReplace: asked.indexOf("Sin texto de reemplazo") > 0,
  };
})()`);
say(done.verdict !== null && done.verdict.indexOf("armazon") > 0, "el veredicto sale arriba", done.verdict);
say(done.cards === 3, "una tarjeta por observacion", "n=" + done.cards);
say(JSON.stringify(done.kinds) === JSON.stringify(["Falta", "Sin respaldo", "Flojo"]), "con su tipo en palabras", JSON.stringify(done.kinds));
say(done.again.includes("Revisar otra vez"), "y se puede volver a pedir", JSON.stringify(done.again));
say(done.sawStructure && done.sawPhase && done.sawText, "el modelo recibio fase, forma y documento",
  `estructura=${done.sawStructure} fase=${done.sawPhase} texto=${done.sawText}`);
say(done.noReplace === true, "y la prohibicion de reescribir");

const led = await cdp.evaluate(`(() => {
  const one = document.querySelector(".rev__card .rev__one");
  if (one) one.click();
  const area = document.querySelector(".wr__edit");
  return { picked: area.value.slice(area.selectionStart, area.selectionEnd) };
})()`);
say(led.picked === "Naturaleza de la situacion", "pulsar una observacion lleva hasta su sitio", JSON.stringify(led.picked));

await cdp.evaluate(`(() => {
  const links = [...document.querySelectorAll(".rev__card .lnkbtn")];
  if (links[1]) links[1].click();
})()`);
await wait(500);
const carried = await cdp.evaluate(`(() => {
  const turns = [...document.querySelectorAll(".ai-turn--mine")].map((t) => t.textContent);
  return { last: turns[turns.length - 1] || "" };
})()`);
say(carried.last.indexOf("Sobre la revisi") === 0 && carried.last.indexOf("sin respaldo") > 0,
  "una observacion se puede llevar al asistente", carried.last.slice(0, 62));

/* --- el orden de Escape ------------------------------------------------- */
const esc = () => cdp.evaluate(`(() => {
  document.querySelector(".wr").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  const wr = document.querySelector(".wr");
  return {
    tools: !document.querySelector(".wr__tools").hidden,
    pick: !document.querySelector(".pick").hidden,
    rev: !document.querySelector(".rev").hidden,
    wr: wr ? !wr.hidden : false,
  };
})()`);
await cdp.evaluate(`(() => {
  const area = document.querySelector(".wr__edit");
  area.focus();
  area.setSelectionRange(0, 40);
  area.dispatchEvent(new Event("select", { bubbles: true }));
  [...document.querySelectorAll(".wr__act")].find((b) => b.textContent === "Estructura").click();
})()`);
await wait(200);
const s1 = await esc();
say(s1.tools === false && s1.pick === true, "el primer Escape retira la barra de seleccion", JSON.stringify(s1));
const s2 = await esc();
say(s2.pick === false && s2.rev === true, "el segundo cierra las estructuras", JSON.stringify(s2));
const s3 = await esc();
say(s3.rev === false && s3.wr === true, "el tercero cierra la revision", JSON.stringify(s3));
const s4 = await esc();
say(s4.wr === false, "y el cuarto cierra el documento", JSON.stringify(s4));
const shut = await cdp.evaluate(`(async () => {
  const m = await import("/src/core/state/selection.ts");
  return { body: document.body.className, sel: m.selection.get() };
})()`);
say(shut.body.indexOf("is-writing") < 0 && shut.sel === null,
  "al cerrar se suelta la pagina y la pagina vuelve a respirar", JSON.stringify(shut));

/* --- el borrador que no llego ------------------------------------------- */
await cdp.evaluate(`(async () => {
  const d = await import("/src/core/persist/drafts.ts");
  await d.putDraft({
    pageId: "page-2", name: "Idear", at: Date.now() - 5 * 60 * 1000,
    content: "# Idear" + String.fromCharCode(10, 10) + "Esto se escribio y no llego a Notion nunca.",
  });
})()`);
await wait(300);
await cdp.evaluate(`(async () => {
  const m = await import("/src/core/state/selection.ts");
  m.selectPage({ id: "page-2", name: "Idear", parentId: "proj-1", projectName: "Mi proyecto" });
})()`);
await wait(1000);
const back = await cdp.evaluate(`(() => {
  const note = document.querySelector(".wr__note");
  return {
    said: note && !note.hidden ? note.textContent : null,
    value: document.querySelector(".wr__edit").value,
    state: document.querySelector(".wr__state").textContent,
    offer: [...document.querySelectorAll(".wr__note button")].map((b) => b.textContent),
  };
})()`);
say(back.said !== null && back.said.indexOf("Se recuper") === 0, "el borrador se avisa al abrir", back.said);
say(back.value.indexOf("no llego a Notion nunca") > 0, "y esta puesto en la hoja, no escondido");
say(back.offer.includes("Usar lo que hay en Notion"), "lo que se ofrece es lo contrario", JSON.stringify(back.offer));
await wait(2000);
const kept = await cdp.evaluate(`({
  saved: window.__saved.length,
  last: (window.__saved[window.__saved.length - 1] || "").slice(-30),
  state: document.querySelector(".wr__state").textContent,
})`);
say(kept.saved >= 1 && kept.last.indexOf("no llego a Notion nunca") >= 0,
  "y se manda solo sin preguntar", JSON.stringify(kept));

cdp.close();
