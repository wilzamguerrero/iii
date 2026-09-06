(() => {
  const NL = String.fromCharCode(10);

  /* La ventana arranca sin nada visto y en su sitio: el perfil de Chrome es el
     mismo entre corridas y tanto la intención como la posición se recuerdan. */
  localStorage.removeItem("3i.intent");
  localStorage.removeItem("3i.pos.assistant.panel");
  localStorage.removeItem("3i.pos.assistant.handle");

  localStorage.setItem("3i.ai.config", JSON.stringify({
    provider: "openrouter",
    models: { openrouter: "un/modelo-de-prueba" },
    keys: { openrouter: "sk-de-prueba-para-el-humo" },
    custom: [],
  }));

  const ANSWER = "Falta decir quien se pierde y en que punto. "
    + "Que decide una persona al salir del ascensor?";

  const sse = (text) => {
    const parts = [];
    for (let i = 0; i < text.length; i += 40) {
      parts.push("data: " + JSON.stringify({ choices: [{ delta: { content: text.slice(i, i + 40) } }] }) + NL + NL);
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
  window.__reads = [];

  const before = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : String(input.url || input);

    if (url.indexOf("/api/ai-chat") === 0) {
      window.__aiCalls.push(JSON.parse(init && init.body ? init.body : "{}"));
      return sse(ANSWER);
    }

    /* Se apunta cada lectura de Notion para poder probar que el asistente no
       vuelve a pedir el documento que el editor ya tiene delante. */
    if (url.indexOf("/api/notion") === 0) {
      const q = new URL(url, location.origin).searchParams;
      const endpoint = q.get("endpoint") || "";
      const method = q.get("method") || "GET";
      if (method === "GET" && endpoint.indexOf("/blocks/") === 0 && endpoint.indexOf("/children") < 0) {
        window.__reads.push(endpoint);
      }
    }

    return before(input, init);
  };
})();
