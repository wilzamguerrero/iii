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
        "Quien se pierde hoy en el hospital y en que punto exacto se pierde?",
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
  const born = {};
  let n = 0;

  /** Lo que Notion devolvería al leer un bloque que acabamos de crear. */
  const asRead = (child) => {
    const spans = (list) => (list || []).map((s) => ({ plain_text: (s.text && s.text.content) || "" }));
    const out = { object: "block", type: child.type, has_children: false };
    if (child.type === "code") {
      out.code = {
        caption: spans(child.code.caption),
        rich_text: spans(child.code.rich_text),
        language: child.code.language || "markdown",
      };
    } else if (child.type === "toggle") {
      out.toggle = { rich_text: spans(child.toggle.rich_text) };
    }
    return out;
  };

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
      if (method === "PATCH" && endpoint.indexOf("/children") > 0) {
        const body = JSON.parse(init && init.body ? init.body : "{}");
        const child = body.children[0];
        n += 1;
        const id = "born-" + n;
        const made = asRead(child);
        made.id = id;
        born[id] = made;
        window.__made.push({ parent: endpoint.slice(8).replace("/children", ""), child });
        return json({ results: [made] });
      }
      if (method === "GET" && endpoint.indexOf("/children") > 0) {
        return json({ results: [], has_more: false });
      }
      if (method === "GET" && endpoint.indexOf("/blocks/") === 0) {
        const id = endpoint.slice(8);
        if (born[id]) return json(born[id]);
      }
      if (method === "PATCH" && endpoint.indexOf("/blocks/") === 0) {
        const id = endpoint.slice(8);
        const kept = born[id];
        if (kept) {
          const body = JSON.parse(init && init.body ? init.body : "{}");
          kept.code.rich_text = ((body.code && body.code.rich_text) || [])
            .map((s) => ({ plain_text: (s.text && s.text.content) || "" }));
          window.__saved.push(kept.code.rich_text.map((s) => s.plain_text).join(""));
          return json({ id });
        }
      }
    }

    return before(input, init);
  };
})();
