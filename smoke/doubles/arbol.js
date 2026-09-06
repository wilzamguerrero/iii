(() => {
  const NL = String.fromCharCode(10);
  const span = (t) => ({ plain_text: t });

  const doc = (id, name, body) => ({
    id, object: "block", type: "code", has_children: false,
    code: { caption: [span(name)], rich_text: [span(body)], language: "markdown" },
  });

  const tree = {
    "root-1": [
      { id: "proj-1", object: "block", type: "toggle", has_children: true,
        toggle: { rich_text: [span("Senaletica del hospital")] } },
      { id: "proj-2", object: "block", type: "toggle", has_children: false,
        toggle: { rich_text: [span("Un proyecto vacio")] } },
      { id: "otro-1", object: "block", type: "paragraph", has_children: false },
    ],
    "proj-1": [
      doc("page-1", "Indagar", "# Indagar" + NL + NL + "## Antecedentes" + NL + NL + "Algo escrito."),
      doc("page-2", "Idear", "# Idear" + NL + NL + "Nada todavia."),
      doc("page-3", "Implementar", "# Implementar" + NL + NL + "Nada todavia."),
    ],
    "proj-2": [],
  };

  const blocks = {};
  for (const list of Object.values(tree)) {
    for (const block of list) blocks[block.id] = block;
  }

  const json = (value, status) => new Response(JSON.stringify(value), {
    status: status || 200, headers: { "Content-Type": "application/json" },
  });

  const before = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : String(input.url || input);
    if (url.indexOf("/api/notion") === 0) {
      const q = new URL(url, location.origin).searchParams;
      const endpoint = q.get("endpoint") || "";
      const method = q.get("method") || "GET";
      const path = endpoint.split("?")[0];
      if (method === "GET" && path.indexOf("/children") > 0) {
        const id = path.slice(8).replace("/children", "");
        return json({ results: tree[id] || [], next_cursor: null, has_more: false });
      }
      if (method === "GET" && path.indexOf("/blocks/") === 0) {
        const found = blocks[path.slice(8)];
        if (found) return json(found);
      }
    }
    return before(input, init);
  };
})();
