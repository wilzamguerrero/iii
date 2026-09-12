/**
 * Indagar, entero: sus reglas, su secuencia y sus naturalezas.
 *
 * Esto es la transcripción de las dos láminas del método —«INDAGAR, parte 1 de
 * 2» y «parte 2 de 2»— a datos. Está aquí y no repartido por la interfaz por la
 * misma razón que las estructuras de la universidad viven en `structures.ts`:
 * el método es contenido, no pantalla. Cambiar una regla, añadir una naturaleza
 * o corregir un criterio se hace en este archivo y lo demás obedece.
 *
 * Tres cosas hay que entender antes de tocar nada:
 *
 * - La secuencia común son **cuatro pasos** iguales para cualquier proyecto, y
 *   el cuarto no es un paso más: es el diagnóstico, y desde ahí la ruta se
 *   bifurca. Hasta que no haya evidencia del contexto no hay naturaleza que
 *   diagnosticar, y por eso el orden no es decorativo.
 * - Las naturalezas son **siete**, y la séptima —situación mixta— no es una más:
 *   es la combinación de las otras seis. El plan del proyecto (§6.2) nombra seis
 *   «más la combinación»; las láminas la hacen explícita, y explícita se queda,
 *   porque una situación mixta mal declarada es una ruta mal recorrida.
 * - Las herramientas de cada naturaleza son **orientativas**. Aquí están para
 *   que la persona sepa qué se suele usar, no para obligarla: el método lo dice
 *   y la interfaz no las impone en ningún sitio.
 *
 * La pregunta de cada paso está escrita, no la inventa un modelo. Es lo que
 * permite que la plataforma pregunte dentro del documento sin IA conectada; el
 * modelo añade **preguntas de este proyecto** encima de éstas, que es lo único
 * que un modelo hace mejor que una lámina.
 */

/* --- las reglas operativas ------------------------------------------------ */

export interface Rule {
  n: number;
  name: string;
  /** Qué pide la regla, en una línea. */
  says: string;
}

export const RULES: readonly Rule[] = [
  { n: 1, name: "Sé claro", says: "Di qué quieres saber sin rodeos: una pregunta confusa devuelve una respuesta confusa." },
  { n: 2, name: "Da contexto", says: "Sitúa lo que preguntas: dónde ocurre, con quiénes y desde cuándo." },
  { n: 3, name: "Basa en evidencia", says: "Lo que afirmes tiene que poder mostrarse; si aún no hay evidencia, dilo." },
  { n: 4, name: "Considera múltiples ángulos", says: "Mira la situación desde más de una posición antes de cerrarla." },
  { n: 5, name: "Itera y ajusta", says: "Cada respuesta cambia la pregunta siguiente; volver atrás es parte del método." },
  { n: 6, name: "Mantén el foco", says: "Abrir el contexto no es abrirlo todo: lo que no orienta la decisión, fuera." },
];

/* --- la secuencia común --------------------------------------------------- */

export interface CommonStep {
  id: string;
  /** Su número en la secuencia: 1 a 4. */
  n: number;
  name: string;
  /** Con qué se llega al paso. */
  entry: string;
  /** Qué se hace en él. */
  action: string;
  /** Las preguntas clave, tal como las trae la lámina. */
  asks: readonly string[];
  /** Con qué se sale. */
  output: string;
  /** Cuándo se puede avanzar. No es una opinión: es el criterio del método. */
  criterion: string;
}

export const COMMON: readonly CommonStep[] = [
  {
    id: "quiero",
    n: 1,
    name: "Quiero algo",
    entry: "un impulso, una necesidad o un interés",
    action: "poner en palabras lo que se quiere lograr",
    asks: ["¿Qué quiero lograr?"],
    output: "un objetivo inicial simple",
    criterion: "la necesidad está expresada en palabras simples",
  },
  {
    id: "intencion",
    n: 2,
    name: "Clarificar la intención inicial",
    entry: "el objetivo inicial",
    action:
      "precisar qué se quiere preservar, habilitar, evitar, reparar, activar, " +
      "conocer o transformar",
    asks: [
      "¿Qué necesito realmente?",
      "¿Para qué lo necesito?",
      "¿Qué éxito se vería como resultado?",
    ],
    output: "una intención inicial clara",
    criterion:
      "hay claridad sobre la transformación deseada, el campo, los actores, el " +
      "sentido y las condiciones críticas",
  },
  {
    id: "contexto",
    n: 3,
    name: "Abrir el contexto",
    entry: "la intención inicial",
    action: "observar el entorno y reunir la información relevante",
    asks: [
      "¿Cuál es el contexto?",
      "¿Qué información es importante?",
      "¿Qué se ha intentado ya?",
      "¿Qué restricciones existen?",
    ],
    output: "un contexto pertinente",
    criterion: "se reconocen actores, recursos, relaciones, restricciones y antecedentes",
  },
  {
    id: "diagnostico",
    n: 4,
    name: "Diagnosticar la naturaleza de la situación",
    entry: "la evidencia del contexto",
    action: "analizar y clasificar lo que está ocurriendo",
    asks: [
      "¿Qué está pasando realmente?",
      "¿Cuál es la naturaleza de la situación?",
      "¿Qué se necesita para avanzar?",
    ],
    output: "la naturaleza diagnosticada",
    criterion: "la clasificación puede justificarse con evidencia del contexto",
  },
];

/** Lo que la lámina dice justo antes de la bifurcación, y que manda sobre todo. */
export const DIAGNOSIS_RULE =
  "La naturaleza de la situación no se elige por intuición; se infiere a partir " +
  "de la evidencia del contexto.";

/** Los tres avisos con los que abre la segunda lámina. */
export const FRAMING: readonly string[] = [
  "La naturaleza se infiere de la evidencia del contexto, no se elige por intuición.",
  "Las herramientas son orientativas, no obligatorias.",
  "Si la evidencia cambia, vuelve al diagnóstico y reajusta la ruta.",
];

/** Lo del pie de la lámina, que se confunde a menudo. */
export const NOT_A_TYPE = "Tipo de proyecto ≠ naturaleza de la situación.";

/* --- las siete naturalezas ------------------------------------------------ */

export type NatureId =
  | "problema" | "tension" | "oportunidad" | "deseo"
  | "friccion" | "potencial" | "mixta";

export interface NatureStep {
  /** Su número dentro de la naturaleza: 1 a 5. */
  n: number;
  name: string;
  /** La pregunta con la que el paso empieza dentro del documento. */
  ask: string;
}

export interface Nature {
  id: NatureId;
  name: string;
  /** La pregunta central: si no se puede responder, la naturaleza es otra. */
  question: string;
  steps: readonly NatureStep[];
  /** Lo que se suele usar. Orientativo. */
  tools: readonly string[];
  /** Con qué termina la indagación por esta ruta. */
  output: string;
  /** La séptima: no es una naturaleza más, es la combinación de las otras. */
  combined?: true;
}

function steps(...rows: readonly (readonly [string, string])[]): NatureStep[] {
  return rows.map(([name, ask], index) => ({ n: index + 1, name, ask }));
}

export const NATURES: readonly Nature[] = [
  {
    id: "problema",
    name: "Problema",
    question: "¿Qué está fallando y por qué es importante resolverlo?",
    steps: steps(
      ["Delimitar el problema", "¿Qué entra en este problema y qué queda fuera de él?"],
      ["Explorar causas raíz", "¿Por qué ocurre? ¿Y por qué ocurre eso?"],
      ["Analizar impactos", "¿Qué se pierde, y quién lo pierde, mientras esto sigue así?"],
      ["Validar con actores clave", "¿Quiénes lo viven de cerca y qué dicen ellos que es el problema?"],
      ["Sintetizar el problema real", "Con lo anterior a la vista, ¿cuál es el problema real?"],
    ),
    tools: ["5 porqués", "mapa de causas", "entrevistas", "análisis de actores", "mapa de impacto"],
    output: "un problema comprendido y delimitado, con causas e impactos claros",
  },
  {
    id: "tension",
    name: "Tensión",
    question: "¿Qué tensión existe entre lo que es y lo que debería ser?",
    steps: steps(
      ["Identificar la tensión", "¿Entre qué dos cosas está la tensión: lo que es y lo que debería ser?"],
      ["Explorar ambas realidades", "¿Cómo es hoy de verdad, y cómo sería si estuviera resuelta?"],
      ["Comprender sus causas", "¿Qué sostiene la distancia entre esas dos realidades?"],
      ["Mapear actores y perspectivas", "¿Quién está en cada lado y qué defiende cada uno?"],
      ["Sintetizar la tensión clave", "¿Cuál es la tensión que, si se mueve, mueve todo lo demás?"],
    ),
    tools: ["mapa de tensión", "entrevistas", "matriz de percepciones", "línea de tiempo", "mapa de actores"],
    output: "una tensión comprendida, con sus dimensiones y sus actores",
  },
  {
    id: "oportunidad",
    name: "Oportunidad",
    question: "¿Qué oportunidad podemos aprovechar y por qué ahora?",
    steps: steps(
      ["Identificar señales", "¿Qué señales indican que aquí hay una oportunidad?"],
      ["Explorar su contexto", "¿Qué está pasando alrededor que la hace posible ahora?"],
      ["Validar interés y viabilidad", "¿A quién le interesa de verdad y con qué se podría hacer?"],
      ["Analizar actores y condiciones", "¿Quién tendría que participar y qué condiciones hacen falta?"],
      ["Sintetizar la oportunidad", "¿Cuál es la oportunidad, y por qué ahora y no antes?"],
    ),
    tools: ["escaneo de entorno", "entrevistas", "benchmarking", "mapa de actores", "matriz de oportunidades"],
    output: "una oportunidad definida, con condiciones, actores y potencial de valor",
  },
  {
    id: "deseo",
    name: "Deseo latente",
    question: "¿Qué necesidad o deseo no expresado podemos descubrir?",
    steps: steps(
      ["Explorar experiencias actuales", "¿Cómo es hoy la experiencia de las personas, paso a paso?"],
      ["Identificar necesidades no dichas", "¿Qué hacen que no piden, y qué evitan sin decirlo?"],
      ["Comprender emociones y motivaciones", "¿Qué sienten y qué las mueve cuando esto ocurre?"],
      ["Validar hallazgos con usuarios", "¿Se reconocen en lo que encontraste cuando se lo cuentas?"],
      ["Sintetizar el deseo latente", "¿Cuál es el deseo que todavía nadie ha nombrado?"],
    ),
    tools: [
      "entrevistas en profundidad", "mapa de empatía", "journey del usuario",
      "técnicas proyectivas", "análisis de necesidades",
    ],
    output: "un deseo latente comprendido, con insights de motivaciones",
  },
  {
    id: "friccion",
    name: "Fricción sistémica",
    question: "¿Qué barreras del sistema están dificultando el avance?",
    steps: steps(
      ["Identificar la fricción", "¿Dónde exactamente se atasca el avance?"],
      ["Analizar el sistema completo", "¿Qué partes, flujos y reglas componen el sistema donde ocurre?"],
      ["Comprender sus causas", "¿Qué hace que la fricción se repita y no se resuelva sola?"],
      ["Explorar puntos de apalancamiento", "¿Dónde un cambio pequeño movería mucho?"],
      ["Sintetizar la fricción clave", "¿Cuál es la fricción que hay que tocar primero, y por qué ésa?"],
    ),
    tools: [
      "mapa de procesos", "análisis sistémico", "mapa de actores",
      "diagrama causal", "entrevistas multinivel",
    ],
    output: "una fricción comprendida, con causas y puntos de intervención priorizados",
  },
  {
    id: "potencial",
    name: "Potencial no activado",
    question: "¿Qué capacidades, recursos o fortalezas no estamos aprovechando?",
    steps: steps(
      ["Identificar recursos existentes", "¿Qué hay ya —personas, saberes, medios— que no se está usando?"],
      ["Explorar su potencial", "¿Qué se podría hacer con eso que hoy no se hace?"],
      ["Analizar barreras de activación", "¿Qué impide que se active: permiso, tiempo, conocimiento, vínculo?"],
      ["Validar con actores clave", "¿Quién tendría que reconocerlo para que empiece a usarse?"],
      ["Sintetizar el potencial", "¿Cuál es el potencial y qué haría falta para activarlo?"],
    ),
    tools: [
      "mapa de recursos", "análisis de capacidades", "entrevistas",
      "benchmarking", "matriz de potencial",
    ],
    output: "un potencial comprendido, con recursos, barreras y oportunidades de activación",
  },
  {
    id: "mixta",
    name: "Situación mixta",
    question: "¿Qué combinación de elementos estamos observando?",
    combined: true,
    steps: steps(
      ["Identificar elementos presentes", "¿Qué naturalezas están a la vez en esta situación?"],
      ["Analizar sus interrelaciones", "¿Cómo se alimentan unas a otras?"],
      ["Priorizar dimensiones clave", "¿Cuál de ellas ordena a las demás?"],
      ["Comprender dinámicas sistémicas", "¿Qué hace que el conjunto se mantenga como está?"],
      ["Sintetizar la situación", "¿Cómo se describe la situación completa sin reducirla a una sola cosa?"],
    ),
    tools: [
      "mapa sistémico", "análisis de escenarios", "entrevistas",
      "diagrama de relaciones", "matriz de priorización",
    ],
    output: "una situación integral comprendida, con sus elementos clave y sus prioridades",
  },
];

export function natureOf(id: string): Nature | null {
  return NATURES.find((one) => one.id === id) ?? null;
}

/** Normaliza para comparar nombres escritos a mano: sin tildes, sin mayúsculas. */
export function flat(text: string): string {
  return text
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * La naturaleza por su nombre, como está escrita en el documento.
 *
 * Se busca así y no por un identificador guardado en otro sitio porque la ruta
 * vive dentro del documento: lo que la persona ve escrito es lo que la
 * plataforma lee. Si alguien escribe «tension» sin tilde, se encuentra igual.
 */
export function natureByName(name: string): Nature | null {
  const want = flat(name);
  if (!want) return null;
  return NATURES.find((one) => flat(one.name) === want) ?? null;
}

/* --- la salida común ------------------------------------------------------ */

/** Los siete puntos de la síntesis de situación 3i, como preguntas. */
export const SYNTHESIS: readonly string[] = [
  "¿Qué está pasando?",
  "¿Por qué importa?",
  "¿A quiénes afecta?",
  "¿Qué aprendimos?",
  "¿Qué oportunidades se abren?",
  "¿Qué preguntas siguen abiertas?",
  "¿Qué necesitamos para avanzar?",
];

export const SYNTHESIS_HEAD = "Síntesis de situación 3i";
export const SITUATED_HEAD = "Intención situada";

export const SITUATED_ASK =
  "¿Cuál es la intención situada: qué foco, con qué personas y en qué contexto?";

export const SITUATED_SAYS =
  "Con base en lo aprendido, clarifica el foco, las personas y el contexto para " +
  "orientar la ideación.";

/* --- los títulos de la ruta dentro del documento -------------------------- */

/**
 * El título de un paso común: «1. Quiero algo».
 *
 * El número va delante porque la secuencia es una secuencia, y el nombre es el
 * de la lámina para que quien lea el documento en Notion reconozca dónde está
 * sin tener la plataforma abierta.
 */
export function commonHead(step: CommonStep): string {
  return `${step.n}. ${step.name}`;
}

/**
 * El título de un paso de la naturaleza: «Problema · 1. Delimitar el problema».
 *
 * Lleva el nombre de la naturaleza delante por una razón práctica: cambiar de
 * naturaleza no borra lo escrito, así que dos rutas pueden convivir en el mismo
 * documento y sus apartados no pueden llamarse igual. Además, leído en Notion,
 * dice de qué ruta es cada apartado.
 */
export function natureHead(nature: Nature, step: NatureStep): string {
  return `${nature.name} · ${step.n}. ${step.name}`;
}

/* --- el documento --------------------------------------------------------- */

/** Una pregunta, como bloque de cita con su línea en blanco detrás. */
function ask(question: string): string[] {
  return [`> ${question}`, ""];
}

/**
 * Un apartado de la secuencia común, con su entrada, sus preguntas y su criterio.
 *
 * Las citas van separadas por una línea en blanco a propósito: en Notion, dos
 * líneas `>` seguidas se leen como **una sola** cita, y entonces la pregunta y
 * el criterio volverían pegados en el mismo bloque. Separadas, cada una es su
 * bloque y sobrevive al viaje de ida y vuelta.
 */
function commonSection(step: CommonStep, extra: readonly string[] = []): string[] {
  const out = [
    `## ${commonHead(step)}`,
    "",
    `Entrada: ${step.entry}. Acción: ${step.action}. Salida: ${step.output}.`,
    "",
  ];
  for (const one of [...step.asks, ...extra]) out.push(...ask(one));
  if (step.id === "diagnostico") out.push(`> ${DIAGNOSIS_RULE}`, "");
  out.push(`> Avanza cuando: ${step.criterion}.`, "");
  return out;
}

/**
 * La línea que declara la naturaleza diagnosticada.
 *
 * Es la misma costura que `> Estructura:` en `structures.ts`: la decisión se
 * escribe **dentro del documento**, no en un almacén paralelo. Así viaja a
 * Notion, se puede leer sin la plataforma, se puede corregir a mano y no hay dos
 * versiones de la verdad que puedan contradecirse.
 */
export function natureLine(nature: Nature): string {
  return `> Naturaleza: ${nature.name} · ${nature.question}`;
}

/** La línea de herramientas. Dice que son orientativas porque lo son. */
export function toolsLine(nature: Nature): string {
  return `Herramientas sugeridas —orientativas, no obligatorias—: ${nature.tools.join(", ")}.`;
}

/** La línea con la que la ruta declara en qué termina. */
export function endLine(nature: Nature): string {
  return `> Esta ruta termina en: ${nature.output}.`;
}

/**
 * Los apartados de una naturaleza, listos para entrar en el documento.
 *
 * `kept` trae, por número de paso, el cuerpo que ese apartado ya tenía escrito.
 * Se respeta tal cual —con sus marcas de bloque, que es lo que evita que Notion
 * reescriba bloques que no cambiaron— porque cambiar de naturaleza y volver no
 * puede costarle a nadie lo que ya había puesto ahí.
 */
export function natureMarkdown(
  id: NatureId,
  kept: ReadonlyMap<number, readonly string[]> = new Map(),
): string {
  const nature = natureOf(id);
  if (!nature) return "";

  const lines = [natureLine(nature), "", toolsLine(nature), ""];
  for (const step of nature.steps) {
    const body = kept.get(step.n);
    lines.push(`## ${natureHead(nature, step)}`, "");
    if (body && body.length > 0) lines.push(...body, "");
    else lines.push(...ask(step.ask));
  }
  lines.push(endLine(nature), "");
  return tidy(lines);
}

/** La síntesis de situación 3i: sus siete puntos, uno por pregunta. */
export function synthesisMarkdown(): string {
  const lines = [`## ${SYNTHESIS_HEAD}`, ""];
  for (const one of SYNTHESIS) lines.push(...ask(one));
  return tidy(lines);
}

/** La intención situada, con la que Indagar pasa a Idear. */
export function situatedMarkdown(): string {
  return tidy([`## ${SITUATED_HEAD}`, "", SITUATED_SAYS, "", ...ask(SITUATED_ASK)]);
}

/**
 * La salida común entera.
 *
 * Va en dos funciones y no en una porque al cambiar de naturaleza hay que poder
 * reponer la mitad que falte sin duplicar la que ya está escrita.
 */
export function outMarkdown(): string {
  return `${synthesisMarkdown()}\n${situatedMarkdown()}`;
}

/**
 * El documento con el que nace Indagar.
 *
 * Trae la secuencia común entera y **no** trae naturaleza: diagnosticarla es el
 * cuarto paso y ponerla de antemano sería elegirla por intuición, que es
 * exactamente lo que el método prohíbe. Los apartados de la naturaleza y la
 * salida común entran cuando se toma la ruta, desde el mapa.
 *
 * Las preguntas del modelo —si hubo modelo— entran dentro del paso al que
 * pertenecen y no en una lista aparte: una pregunta sirve para responderla
 * donde toca, y un cuestionario al principio del documento es lo que había
 * antes y lo que se pidió cambiar.
 */
export function indagarDocument(
  intent: string,
  questions: readonly string[] = [],
): string {
  const lines: string[] = [
    "# Indagar",
    "",
    `> Intención: ${intent.replace(/\s+/g, " ").trim()}`,
    "",
    "Indagar no describe hechos: lee la situación hasta poder decir de qué " +
    "naturaleza es y sostenerlo con evidencia. La ruta se recorre aquí dentro: " +
    "cada apartado trae sus preguntas y responderlas es avanzar.",
    "",
  ];

  for (const step of COMMON) {
    // Las preguntas que el modelo hizo para este proyecto entran dentro del paso
    // de la intencion inicial, que es donde se decide que se quiere de verdad.
    lines.push(...commonSection(step, step.id === "intencion" ? questions : []));
  }

  return tidy(lines);
}

/** Sin líneas en blanco de más y con un salto final: como se guarda. */
function tidy(lines: readonly string[]): string {
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}
