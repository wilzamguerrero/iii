(() => {
  const NL = String.fromCharCode(10);

  /* Esta parte empieza sin credencial —es lo primero que comprueba—, y el perfil
     de Chrome es el mismo entre corridas: otra parte pudo dejar una puesta. */
  localStorage.removeItem("3i.ai.config");

  const review = {
    verdict: "Tiene el armazon de Indagar pero la naturaleza de la situacion esta vacia.",
    observations: [
      { kind: "falta", where: "Naturaleza de la situacion", note: "No dice de que tipo es la situacion, y de eso depende con que se indaga." },
      { kind: "respaldo", where: "El programa de Diseno Grafico no tiene", note: "Afirma una carencia del programa sin traer con que se sostiene." },
      { kind: "flojo", where: "", note: "Los antecedentes cuentan el problema, no lo que otros ya intentaron." },
    ],
  };

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
  const before = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : String(input.url || input);
    if (url.indexOf("/api/ai-chat") === 0) {
      window.__aiCalls.push(JSON.parse(init && init.body ? init.body : "{}"));
      return sse(JSON.stringify(review));
    }
    return before(input, init);
  };
})();
