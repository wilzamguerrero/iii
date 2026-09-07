(() => {
  const NL = String.fromCharCode(10);
  const lines = [
    "# Indagar",
    "",
    "> Estructura: Idea de trabajo de grado · Reglamento de Trabajo de Grado, Art. 13",
    "",
    "## Antecedentes",
    "",
    "El programa de Diseno Grafico no tiene una plataforma que acompane el metodo 3i,",
    "y los estudiantes acaban repitiendo herramientas para lo mismo.",
    "",
    "## Naturaleza de la situacion",
    "",
    "Aqui todavia no hay nada escrito.",
    "",
    "### Un tercer nivel",
    "",
    "- Una lista",
    "- Con dos cosas",
  ];
  const doc = { text: lines.join(NL) };
  window.__doc = doc;
  window.__saved = [];
  /** Cuántas veces se mandó un lote de guardado, como lo contaría Notion. */
  window.__saves = 0;
  /** Cuántas lecturas de bloques: para no pisar el __reads (array) del doble
      del asistente, que apunta las mismas peticiones con otro propósito. */
  window.__blockReads = 0;
  window.__reads = 0;

  localStorage.setItem("3i.notion.session", JSON.stringify({
    token: "fake-token-for-the-smoke-test",
    botId: "bot", workspaceName: "Prueba", workspaceIcon: null,
    rootPageId: "root-1", rootPageTitle: "Raiz", connectedAt: new Date().toISOString(),
  }));

  /* El modelo nuevo: una pagina con bloques nativos. El guardado llega como
     diff —updates, creates con after, deletes— y el doble lo aplica en orden,
     como lo haria Notion. Los bloques nuevos reciben ids estables. */
  const blocks = [
    mkBlock("b1", "heading_2", "Indagar", 2),
    mkBlock("b2", "quote", "Estructura: Idea de trabajo de grado \u00b7 Reglamento de Trabajo de Grado, Art. 13"),
    mkBlock("b3", "heading_2", "Antecedentes"),
    mkBlock("b4", "paragraph", "El programa de Diseno Grafico no tiene una plataforma que acompane el metodo 3i, y los estudiantes acaban repitiendo herramientas para lo mismo."),
    mkBlock("b5", "heading_2", "Naturaleza de la situacion"),
    mkBlock("b6", "paragraph", "Aqui todavia no hay nada escrito."),
    mkBlock("b7", "heading_3", "Un tercer nivel"),
    mkBlock("b8", "bulleted_list_item", "Una lista"),
    mkBlock("b9", "bulleted_list_item", "Con dos cosas"),
  ];

  function mkBlock(id, type, text, level) {
    const out = { id, object: "block", type, has_children: false };
    out[type] = { rich_text: [{ plain_text: text }] };
    return out;
  }

  const json = (value, status) => new Response(JSON.stringify(value), {
    status: status || 200, headers: { "Content-Type": "application/json" },
  });

  const real = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : String(input.url || input);
    if (url.indexOf("/api/health") === 0) {
      return json({ ok: true, config: { ai: {}, aiCustom: "off" } });
    }
    if (url.indexOf("/api/notion") === 0) {
      const q = new URL(url, location.origin).searchParams;
      const endpoint = q.get("endpoint") || "";
      const method = q.get("method") || "GET";
      const path = endpoint.split("?")[0];

      // La pagina misma: titulo y padre.
      if (method === "GET" && /^\/pages\//.test(path)) {
        return json({
          object: "page", id: path.slice(7),
          properties: { title: { type: "title", title: [{ plain_text: "Indagar" }] } },
        });
      }

      // Los bloques de la pagina, paginados como Notion.
      if (method === "GET" && path.indexOf("/children") > 0) {
        const id = path.slice(8).replace("/children", "");
        let all = blocks;
        if (id !== "page-1") all = [];
        window.__blockReads += 1;
        return json({ results: all.slice(0, 100), next_cursor: null, has_more: false });
      }

      // Crear bloques: el diff manda los creates en lotes con su after.
      if (method === "PATCH" && path.indexOf("/children") > 0) {
        const body = JSON.parse(init && init.body ? init.body : "{}");
        window.__saves += 1;
        const made = (body.children || []).map((child, at) => {
          const type = Object.keys(child).find((k) => k !== "object" && typeof child[k] === "object");
          // Se guarda como lo manda la plataforma y se devuelve como lo
          // devolveria Notion: plain_text en cada fragmento.
          const part = JSON.parse(JSON.stringify(child[type]));
          if (part && part.rich_text) {
            part.rich_text = part.rich_text.map((s) => ({
              plain_text: (s.text && s.text.content) || s.plain_text || "",
            }));
          }
          const out = { id: "new-" + Math.random().toString(36).slice(2, 8), object: "block", type, has_children: false };
          out[type] = part;
          return out;
        });
        // El doble conserva el orden relativo: simplificacion suficiente,
        // porque la plataforma ordena con `after` y el humo no prueba el
        // orden de Notion sino que se pide.
        const after = body.after ? blocks.findIndex((b) => b.id === body.after) : blocks.length - 1;
        blocks.splice(after + 1, 0, ...made);
        window.__made = window.__made || [];
        for (const one of made) window.__made.push(one);
        // Lo creado también es guardado: el humo busca lo escrito aquí.
        for (const one of made) window.__saved.push(richOf(one));
        return json({ results: made });
      }

      // Editar un bloque: reemplaza su texto.
      if (method === "PATCH" && /^\/blocks\//.test(path)) {
        const id = path.slice(8);
        const body = JSON.parse(init && init.body ? init.body : "{}");
        const found = blocks.find((b) => b.id === id);
        if (found) {
          const type = Object.keys(body)[0];
          if (type) {
            found.type = type;
            const part = JSON.parse(JSON.stringify(body[type]));
            if (part && part.rich_text) {
              part.rich_text = part.rich_text.map((s) => ({
                plain_text: (s.text && s.text.content) || s.plain_text || "",
              }));
            }
            found[type] = part;
          }
          window.__saved.push(richOf(found));
          return json({ id });
        }
        return json({ code: "object_not_found" }, 404);
      }

      // Borrar un bloque: lo saca.
      if (method === "DELETE" && /^\/blocks\//.test(path)) {
        const id = path.slice(8);
        const at = blocks.findIndex((b) => b.id === id);
        if (at >= 0) blocks.splice(at, 1);
        return json({ id });
      }

      return json({ code: "not_stubbed", message: "sin doble: " + method + " " + endpoint }, 400);
    }
    return real(input, init);
  };

  function richOf(block) {
    const part = block[block.type];
    return (part && part.rich_text ? part.rich_text : []).map((s) => s.plain_text || (s.text && s.text.content) || "").join("");
  }

  /* Lo que hay hoy, para que el editor vea el mismo texto que siempre vio:
     el markdown se reconstruye de los bloques como lo haria blocksToMarkdown:
     un bloque por linea, su marca de id, y una linea vacia entre bloques. */
  function asMarkdown() {
    const out = [];
    let prev = "";
    for (const block of blocks) {
      const text = richOf(block);
      let line;
      if (block.type === "heading_2") line = "## " + text + " <!--b:" + block.id + "-->";
      else if (block.type === "heading_3") line = "### " + text + " <!--b:" + block.id + "-->";
      else if (block.type === "quote") line = "> " + text + " <!--b:" + block.id + "-->";
      else if (block.type === "bulleted_list_item") line = "- " + text + " <!--b:" + block.id + "-->";
      else line = text + " <!--b:" + block.id + "-->";
      if (prev) out.push("");
      out.push(line);
      prev = block.type;
    }
    return out.join(NL);
  }

  doc.text = asMarkdown();
})()
