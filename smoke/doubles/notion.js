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

  localStorage.setItem("3i.notion.session", JSON.stringify({
    token: "fake-token-for-the-smoke-test",
    botId: "bot", workspaceName: "Prueba", workspaceIcon: null,
    rootPageId: "root-1", rootPageTitle: "Raiz", connectedAt: new Date().toISOString(),
  }));

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
      if (method === "GET" && endpoint.indexOf("/blocks/") === 0) {
        return json({
          id: endpoint.slice(8), type: "code",
          code: {
            caption: [{ plain_text: "Indagar" }],
            rich_text: [{ plain_text: doc.text }],
            language: "markdown",
          },
        });
      }
      if (method === "PATCH" && endpoint.indexOf("/blocks/") === 0) {
        const body = JSON.parse(init && init.body ? init.body : "{}");
        const spans = (body.code && body.code.rich_text) || [];
        const joined = spans.map((s) => (s.text && s.text.content) || "").join("");
        window.__saved.push(joined);
        doc.text = joined;
        return json({ id: "patched" });
      }
      return json({ code: "not_stubbed", message: "sin doble: " + method + " " + endpoint }, 400);
    }
    return real(input, init);
  };
})();
