/**
 * Dictar: hablar y que se escriba.
 *
 * Es la escritura por voz que ya existía en la referencia (`reference/
 * wzglexical-dev_mimem`), traída sin su envoltorio: el navegador reconoce, la
 * plataforma sólo enciende, apaga y recoge frases.
 *
 * Va contra `SpeechRecognition`, que es del navegador y no un servicio nuestro:
 * no hay clave que guardar ni audio que subir a ningún sitio de la plataforma.
 * Chrome y Edge lo hacen enviando el audio a Google; Firefox todavía no lo trae,
 * y por eso `available()` existe y quien lo use debe poder no pintar el botón.
 *
 * Sólo se entregan frases terminadas. La referencia hacía lo mismo
 * (`interimResults = false`) y la razón se sostiene: lo provisional cambia de
 * palabra mientras se habla, y verlo bailar dentro del documento que se está
 * escribiendo distrae más de lo que informa.
 */

/** Lo que este módulo usa del reconocedor del navegador, y nada más. */
interface Recogniser {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: RecogniserEvent) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
}

interface RecogniserEvent {
  resultIndex: number;
  results: { length: number; [index: number]: { isFinal: boolean; [index: number]: { transcript: string } } };
}

type RecogniserCtor = new () => Recogniser;

function ctor(): RecogniserCtor | null {
  const win = window as unknown as {
    SpeechRecognition?: RecogniserCtor;
    webkitSpeechRecognition?: RecogniserCtor;
  };
  return win.SpeechRecognition ?? win.webkitSpeechRecognition ?? null;
}

/** ¿Sabe este navegador? Si no, no se pinta el botón en vez de fallar al pulsarlo. */
export function available(): boolean {
  return ctor() !== null;
}

/**
 * El idioma del dictado. El del navegador si es español —así un «es-CO» reconoce
 * el habla de aquí mejor que un «es-ES» genérico—, y si no, el de la página.
 */
function defaultLang(): string {
  const preferred = navigator.language;
  if (preferred && /^es\b/i.test(preferred)) return preferred;
  return document.documentElement.lang || preferred || "es-ES";
}

const NO_PERMISSION =
  "El navegador no dio permiso para el micrófono. Habilítalo en la barra de direcciones.";

function why(error: string | undefined): string | null {
  switch (error) {
    case "aborted":
      return null;            // lo paró la persona
    case "no-speech":
      return null;            // silencio; se reintenta y no se cuenta nada
    case "not-allowed":
    case "service-not-allowed":
      return NO_PERMISSION;
    case "audio-capture":
      return "No se encontró micrófono.";
    case "network":
      return "El reconocimiento de voz necesita conexión y no la hay.";
    case "language-not-supported":
      return "El navegador no reconoce este idioma.";
    default:
      return "Se cortó el dictado.";
  }
}

export interface DictateOptions {
  /** Cada frase terminada, ya recortada. */
  onText: (text: string) => void;
  /**
   * Se apagó. Con motivo si fue un fallo, con `null` si fue la persona o el
   * silencio. Se llama una sola vez por encendido.
   */
  onStop?: (reason: string | null) => void;
  lang?: string;
}

export interface Dictation {
  start(): void;
  stop(): void;
  on(): boolean;
}

/**
 * El reconocedor se para solo: cada pausa larga cierra la sesión y hay que
 * volver a encenderlo. Se reencende mientras la persona no haya dicho que no,
 * que es lo que hacía la referencia. Y se cuenta: si se reencendiera diez veces
 * en tres segundos, algo va mal y seguir sería un bucle.
 */
const BURST = 6;
const BURST_MS = 3000;

export function dictation(options: DictateOptions): Dictation | null {
  const found = ctor();
  if (!found) return null;
  /* Se copia a una constante ya sin nulo: `spin` se declara antes de esta
     comprobación, y dentro de una función el tipo tiene que valerse solo. */
  const Recogniser: RecogniserCtor = found;

  let live: Recogniser | null = null;
  let want = false;
  let told = false;
  let restarts = 0;
  let since = 0;

  /**
   * Se apaga, y se cuenta una sola vez.
   *
   * El aviso de cierre llega después de `abort()` y después de `stop()`, así que
   * un apagado deja dos avisos: el que lo apagó y el del navegador cerrando la
   * sesión. Sin este cerrojo el segundo pisaba al primero —quien pinta el botón
   * lo devuelve a «Dictar» al recibirlo— y el micrófono se apagaba sin decir que
   * había sido por falta de permiso. Es el motivo lo que hace útil el apagón.
   */
  function finish(reason: string | null): void {
    want = false;
    live = null;
    if (told) return;
    told = true;
    options.onStop?.(reason);
  }

  function start(): void {
    if (live) return;
    want = true;
    told = false;
    restarts = 0;
    since = Date.now();
    spin();
  }

  function spin(): void {
    const recogniser = new Recogniser();
    recogniser.lang = options.lang ?? defaultLang();
    recogniser.continuous = true;
    recogniser.interimResults = false;

    recogniser.onresult = (event) => {
      let said = "";
      for (let at = event.resultIndex; at < event.results.length; at += 1) {
        const result = event.results[at];
        if (result?.isFinal) said += result[0]?.transcript ?? "";
      }
      const clean = said.trim();
      if (clean) options.onText(clean);
    };

    recogniser.onerror = (event) => {
      const reason = why(event.error);
      // Un fallo con motivo se cuenta y apaga; el silencio deja que `onend`
      // vuelva a encender.
      if (reason) {
        try { recogniser.abort(); } catch { /* ya estaba cerrado */ }
        finish(reason);
      }
    };

    recogniser.onend = () => {
      if (!want) { finish(null); return; }

      if (Date.now() - since > BURST_MS) { restarts = 0; since = Date.now(); }
      restarts += 1;
      if (restarts > BURST) { finish(null); return; }

      try {
        recogniser.start();
      } catch {
        finish(null);
      }
    };

    try {
      recogniser.start();
      live = recogniser;
    } catch {
      // Encender dos veces la misma instancia lanza; encender sin permiso, no.
      finish(null);
    }
  }

  return {
    start,
    stop() {
      if (!live) return;
      const going = live;
      // Se cuenta aquí y no en el cierre que llegará luego: quien lo paró es la
      // persona, y `finish` ya se encarga de que sólo se cuente una vez.
      finish(null);
      // `stop` entrega lo que estuviera oyendo; `abort` lo tiraría.
      try { going.stop(); } catch { /* ya estaba cerrado */ }
    },
    on() {
      return live !== null;
    },
  };
}
