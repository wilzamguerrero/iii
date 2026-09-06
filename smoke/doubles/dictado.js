(() => {
  /* Un reconocedor de mentira, para poder probar el dictado sin hablarle a
     Chrome: el navegador de verdad manda el audio a un servicio y aquí no hay
     ni micrófono ni red que lo valga. Lo que se prueba es nuestro lado —cuándo
     se enciende, dónde cae lo dicho, cómo se apaga— y eso no necesita voz. */

  localStorage.removeItem("3i.intent");
  localStorage.removeItem("3i.pos.assistant.panel");
  localStorage.removeItem("3i.pos.assistant.handle");

  localStorage.setItem("3i.ai.config", JSON.stringify({
    provider: "openrouter",
    models: { openrouter: "un/modelo-de-prueba" },
    keys: { openrouter: "sk-de-prueba-para-el-humo" },
    custom: [],
  }));

  const made = [];
  window.__mics = made;

  function Fake() {
    this.lang = "";
    this.continuous = false;
    this.interimResults = false;
    this.onresult = null;
    this.onerror = null;
    this.onend = null;
    this.state = "new";
    this.starts = 0;
    this.aborts = 0;
    made.push(this);
  }

  Fake.prototype.start = function start() {
    // Encender dos veces la misma instancia lanza, como en el navegador.
    if (this.state === "on") throw new Error("ya estaba encendido");
    this.state = "on";
    this.starts += 1;
  };

  Fake.prototype.stop = function stop() {
    if (this.state !== "on") return;
    this.state = "off";
    // El navegador cierra la sesión después, no dentro de `stop`.
    setTimeout(() => { if (this.onend) this.onend(); }, 0);
  };

  Fake.prototype.abort = function abort() {
    if (this.state !== "on") { this.aborts += 1; return; }
    this.state = "off";
    this.aborts += 1;
    // Chrome desconecta el servicio y avisa: `abort` también acaba en `end`.
    setTimeout(() => { if (this.onend) this.onend(); }, 0);
  };

  window.SpeechRecognition = Fake;
  window.webkitSpeechRecognition = Fake;

  const last = () => made[made.length - 1] || null;
  window.__mic = last;

  /** Una frase, terminada por defecto. */
  window.__say = (text, isFinal) => {
    const one = last();
    if (!one || !one.onresult) return false;
    const result = { isFinal: isFinal !== false, 0: { transcript: text } };
    one.onresult({ resultIndex: 0, results: { length: 1, 0: result } });
    return true;
  };

  /** Se cerró la sesión sola, como en cada pausa larga. */
  window.__end = () => {
    const one = last();
    if (!one || !one.onend) return false;
    one.state = "off";
    one.onend();
    return true;
  };

  window.__fail = (code) => {
    const one = last();
    if (!one || !one.onerror) return false;
    one.onerror({ error: code });
    return true;
  };

  window.__micState = (selector) => {
    const node = document.querySelector(selector);
    const one = last();
    const path = node ? node.querySelector("svg path") : null;
    return {
      there: !!node,
      on: node ? node.getAttribute("aria-pressed") : null,
      title: node ? node.title : null,
      glyph: path ? path.getAttribute("d").slice(0, 24) : null,
      sessions: made.length,
      starts: one ? one.starts : 0,
      state: one ? one.state : null,
    };
  };
})();
