(() => {
  const span = (t) => ({ plain_text: t });

  /* El arbol nuevo: paginas hijas de paginas. Un proyecto es una pagina con
     paginas dentro; la raiz, la pagina de proyectos. */
  const tree = {
    "root-1": [
      { id: "proj-1", type: "child_page", has_children: true, child_page: { title: "Senaletica del hospital" } },
      { id: "proj-2", type: "child_page", has_children: false, child_page: { title: "Un proyecto vacio" } },
      { id: "otro-1", type: "paragraph", has_children: false },
    ],
    "proj-1": [
      { id: "page-1", type: "child_page", has_children: true, child_page: { title: "Indagar" } },
      { id: "page-2", type: "child_page", has_children: true, child_page: { title: "Idear" } },
      { id: "page-3", type: "child_page", has_children: true, child_page: { title: "Implementar" } },
    ],
    "proj-2": [],
    "page-1": [
      { id: "p1-a", type: "heading_2", has_children: false, heading_2: { rich_text: [span("Idear")] } },
      { id: "p1-b", type: "paragraph", has_children: false, paragraph: { rich_text: [span("Algo escrito.")] } },
    ],
    "page-2": [
      { id: "p2-a", type: "heading_2", has_children: false, heading_2: { rich_text: [span("Idear")] } },
      { id: "p2-b", type: "paragraph", has_children: false, paragraph: { rich_text: [span("Nada todavia.")] } },
    ],
    "page-3": [
      { id: "p3-a", type: "heading_2", has_children: false, heading_2: { rich_text: [span("Implementar")] } },
      { id: "p3-b", type: "paragraph", has_children: false, paragraph: { rich_text: [span("Nada todavia.")] } },
    ],
  };

  const pages = {
    "page-1": { title: "Indagar" },
    "page-2": { title: "Idear" },
    "page-3": { title: "Implementar" },
    "proj-1": { title: "Senaletica del hospital" },
    "proj-2": { title: "Un proyecto vacio" },
  };

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
      if (method === "GET" && /^\/pages\//.test(path)) {
        const id = path.slice(7);
        const title = pages[id] ? pages[id].title : "Sin titulo";
        return json({
          object: "page", id,
          properties: { title: { type: "title", title: [span(title)] } },
        });
      }
    }
    return before(input, init);
  };
})();
