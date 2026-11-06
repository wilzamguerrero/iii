/* Un cliente CDP mínimo con lo que trae Node: WebSocket global y fetch. */
export async function attach(port = 9222) {
  let list = [];
  for (let i = 0; i < 60; i += 1) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/list`);
      list = await r.json();
      if (list.some((t) => t.type === "page")) break;
    } catch { /* Chrome todavía no abrió el puerto */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  const page = list.find((t) => t.type === "page");
  if (!page) throw new Error("no page target");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

  let id = 0;
  const waiting = new Map();
  const logs = [];
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && waiting.has(msg.id)) {
      const { res, rej } = waiting.get(msg.id);
      waiting.delete(msg.id);
      if (msg.error) rej(new Error(JSON.stringify(msg.error)));
      else res(msg.result);
      return;
    }
    /* Un diálogo del navegador —el «¿seguro que quieres salir?» que la hoja
       arma cuando hay texto sin mandar— hay que contestarlo, y tiene que
       contestarlo quien esté enchufado: en cuanto un cliente hace `Page.enable`
       Chrome deja de resolverlos solo y se queda esperando. Sin esto, el primer
       `Page.navigate` con cambios sin guardar congela el renderer y todo lo que
       venga después —incluido el `attach` de la parte siguiente— se cuelga sin
       decir nada. Se acepta, que es lo que hace falta para poder recargar. */
    if (msg.method === "Page.javascriptDialogOpening") {
      id += 1;
      ws.send(JSON.stringify({
        id, method: "Page.handleJavaScriptDialog", params: { accept: true },
      }));
      logs.push(`[dialogo] ${msg.params.type}: ${msg.params.message || "(sin texto)"}`);
      return;
    }
    if (msg.method === "Runtime.consoleAPICalled") {
      const text = (msg.params.args ?? []).map((a) => a.value ?? a.description ?? a.type).join(" ");
      logs.push(`[${msg.params.type}] ${text}`);
    }
    if (msg.method === "Runtime.exceptionThrown") {
      const d = msg.params.exceptionDetails;
      logs.push(`[error] ${d.exception?.description ?? d.text}`);
    }
  };

  const send = (method, params = {}) => new Promise((res, rej) => {
    id += 1;
    waiting.set(id, { res, rej });
    ws.send(JSON.stringify({ id, method, params }));
  });

  const evaluate = async (expression) => {
    const out = await send("Runtime.evaluate", {
      expression, awaitPromise: true, returnByValue: true,
    });
    if (out.exceptionDetails) {
      throw new Error(out.exceptionDetails.exception?.description ?? out.exceptionDetails.text);
    }
    return out.result.value;
  };

  await send("Runtime.enable");
  await send("Page.enable");
  return { send, evaluate, logs, close: () => ws.close() };
}
