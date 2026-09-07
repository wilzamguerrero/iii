(() => {
  const NL = String.fromCharCode(10);

  localStorage.setItem("3i.ai.config", JSON.stringify({
    provider: "openrouter",
    models: { openrouter: "un/modelo-de-prueba" },
    keys: { openrouter: "sk-de-prueba-para-el-humo" },
    custom: [],
  }));

  const proposal = {
    title: "Senaletica del hospital de Pasto",
    note: "Suena a situacion de orientacion en un edificio, pero no dice para quien ni donde falla.",
    seeds: [
      { phase: "indagar", questions: [
        "Quien se pierde hoy en el hospital de Pasto y en que punto exacto se pierde?",
        "La senaletica que existe, quien la puso y con que criterio?",
      ] },
      { phase: "idear", questions: [
        "Que decide una persona en cada cruce de pasillo?",
        "Con que se va a probar antes de imprimir nada?",
      ] },
      { phase: "implementar", questions: [
        "Quien mantiene la senaletica cuando cambien los servicios?",
      ] },
    ],
  };

  const review = {
    verdict: "Sin revisar en esta prueba.",
    observations: [{ kind: "falta", where: "", note: "Sin observaciones en esta prueba." }],
  };

  const sse = (text) => {
    const parts = [];
    for (let i = 0; i < text.length; i += 60) {
      parts.push("data: " + JSON.stringify({ choices: [{ delta: { content: text.slice(i, i + 60) } }] }) + NL + NL);
    }
    parts.push("data: [DONE]" + NL + NL);
    const encoder = new TextEncoder();
    let n = 0;
    const stream = new ReadableStream({
      pull(controller) {
        if (n >= parts.length) { controller.close(); return; }
        controller.enqueue(encoder.encode(parts[n]));
        n += 1;
      },
    });
    return new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } });
  };

  window.__aiCalls = [];
  window.__made = [];
  window.__pages = [];
  window.__saved = [];
  const blocks = {};   // pageId â†’ bloques
  let n = 0;

  const json = (value, status) => new Response(JSON.stringify(value), {
    status: status || 200, headers: { "Content-Type": "application/json" },
  });

  const before = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : String(input.url || input);

    if (url.indexOf("/api/ai-chat") === 0) {
      const body = JSON.parse(init && init.body ? init.body : "{}");
      window.__aiCalls.push(body);
      const asked = body.messages[body.messages.length - 1].content;
      if (asked.indexOf("Prepara el arranque") > 0) return sse(JSON.stringify(proposal));
      return sse(JSON.stringify(review));
    }

    if (url.indexOf("/api/notion") === 0) {
      const q = new URL(url, location.origin).searchParams;
      const endpoint = q.get("endpoint") || "";
      const method = q.get("method") || "GET";
      const path = endpoint.split("?")[0];

      // Crear pagina: el proyecto y sus tres documentos.
      if (method === "POST" && path === "/pages") {
        const body = JSON.parse(init && init.body ? init.body : "{}");
        n += 1;
        // Id hexadecimal, como los de Notion de verdad: los ids de bloque
        // derivan de el y la plataforma los reconoce con [a-f0-9-].
        const id = "0a0b0c0d0e0f001" + n.toString(16).padStart(2, "0");
        const title = (body.properties && body.properties.title
          && body.properties.title.title
          && body.properties.title.title.map((t) => (t.text && t.text.content) || "").join("")) || "";
        window.__pages.push({ id, parent: body.parent && body.parent.page_id, title, icon: body.icon || null });
        blocks[id] = [];
        return json({ object: "page", id, url: "https://notion.so/" + id });
      }

      // Anadir bloques a una pagina.
      if (method === "PATCH" && path.indexOf("/children") > 0) {
        const id = path.slice(8).replace("/children", "");
        const body = JSON.parse(init && init.body ? init.body : "{}");
        const made = (body.children || []).map((child, at) => {
          const type = Object.keys(child).find((k) => k !== "object" && child[k] && typeof child[k] === "object");
          // Se guarda como lo manda la plataforma y se devuelve como lo
          // devolveria Notion: con plain_text en cada fragmento y un id
          // hexadecimal, que es la forma de los ids de Notion reales.
          const part = JSON.parse(JSON.stringify(child[type]));
          if (part && part.rich_text) {
            part.rich_text = part.rich_text.map((s) => ({
              plain_text: (s.text && s.text.content) || s.plain_text || "",
            }));
          }
          const seed = ((blocks[id].length + 1) * 7 + at * 3 + 11).toString(16).padStart(4, "0");
          const out = {
            id: id.slice(0, 12) + seed + "0f0e0d",
            object: "block", type, has_children: false,
          };
          out[type] = part;
          return out;
        });
        blocks[id].push(...made);
        for (const one of made) window.__made.push({ page: id, block: one });
        return json({ results: made });
      }

      // Leer los bloques de una pagina.
      if (method === "GET" && path.indexOf("/children") > 0) {
        const id = path.slice(8).replace("/children", "");
        return json({ results: blocks[id] || [], next_cursor: null, has_more: false });
      }

      // Leer la pagina: el titulo.
      if (method === "GET" && /^\/pages\//.test(path)) {
        const id = path.slice(7);
        const made = window.__pages.find((p) => p.id === id);
        return json({
          object: "page", id,
          properties: { title: { type: "title", title: [{ plain_text: made ? made.title : "Sin titulo" }] } },
        });
      }

      // Editar / borrar bloque: para cuando el editor guardara.
      if (method === "PATCH" && /^\/blocks\//.test(path)) {
        const id = path.slice(8);
        for (const list of Object.values(blocks)) {
          const found = list.find((b) => b.id === id);
          if (found) {
            const body = JSON.parse(init && init.body ? init.body : "{}");
            const type = Object.keys(body)[0];
            if (type) { found.type = type; found[type] = body[type]; }
            return json({ id });
          }
        }
        return json({ id });
      }
      if (method === "DELETE" && /^\/blocks\//.test(path)) {
        const id = path.slice(8);
        for (const list of Object.values(blocks)) {
          const at = list.findIndex((b) => b.id === id);
          if (at >= 0) list.splice(at, 1);
        }
        return json({ id });
      }
    }

    return before(input, init);
  };
})();
