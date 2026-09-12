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
  /** Un id como los que devuelve Notion: UUID hexadecimal. */
  function uuid() {
    const hex = (n) => Array.from({ length: n }, () => "0123456789abcdef"[Math.floor(Math.random() * 16)]).join("");
    return hex(8) + "-" + hex(4) + "-" + hex(4) + "-" + hex(4) + "-" + hex(12);
  }

  /** Los bloques tal como quedan tras guardar: el humo lee de aqui el color. */
  window.__blocks = () => blocks;
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

  /* Un documento de verdad para el que lo pida: `route.js` deja puesta
     `window.__routeBlocks()`, que arma la ruta de Indagar con sus preguntas y
     sus respuestas dentro. Sin eso, el documento de arriba.

     Se mira en la primera lectura y no aqui arriba a proposito: los dobles se
     instalan en el orden en que se piden, y `route.js` puede venir despues, asi
     que preguntar por el ahora mismo seria preguntar antes de que exista. El
     editor no pide bloques hasta que la plataforma arranca, y para entonces
     `route.js` ya corrio. */
  let ready = null;
  function routeUp() {
    if (ready) return ready;
    ready = Promise.resolve()
      .then(() => (typeof window.__routeBlocks === "function" ? window.__routeBlocks() : null))
      .then((made) => { if (made) blocks.splice(0, blocks.length, ...made); })
      .catch((e) => { window.__routeError = String(e); });
    return ready;
  }

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
        await routeUp();
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
          const part = asRich(JSON.parse(JSON.stringify(child[type])));
          // Un id como los de Notion: UUID hexadecimal. El doble los inventaba
          // en base 36, con letras que un UUID no tiene, y eso no es lo que
          // devuelve Notion.
          const out = { id: uuid(), object: "block", type, has_children: false };
          out[type] = part;
          return out;
        });
        /* Se colocan como los coloca Notion, no como convendria.

           Con `after`, detras de ese bloque. **Sin `after`, al final de la
           pagina**: esa es la regla de Notion y aqui hay que obedecerla. El
           doble hacia otra cosa —los ponia detras del ultimo insertado— y con
           eso un fallo real de orden se veia bien en la prueba: tres parrafos
           escritos seguidos en medio del documento acababan al final en Notion
           y aqui parecian correctos. */
        if (body.after) {
          const at = blocks.findIndex((b) => b.id === body.after);
          if (at >= 0) blocks.splice(at + 1, 0, ...made);
          else blocks.push(...made);
        } else {
          blocks.push(...made);
        }
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
            found[type] = asRich(JSON.parse(JSON.stringify(body[type])));
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

  /* Se guarda como lo manda la plataforma y se devuelve como lo devolveria
     Notion: plain_text en cada fragmento y las anotaciones tal cual.

     Las anotaciones se conservan a proposito. El color de texto es lo que
     dice quien escribio cada trozo —la IA o la persona—, asi que un doble que
     lo tirase al guardar no podria ver nunca si eso llega a Notion, que es
     justo lo que hay que comprobar. */
  function asRich(part) {
    if (!part || !part.rich_text) return part;
    part.rich_text = part.rich_text.map((s) => {
      const one = { plain_text: (s.text && s.text.content) || s.plain_text || "" };
      if (s.annotations) one.annotations = s.annotations;
      return one;
    });
    return part;
  }

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
