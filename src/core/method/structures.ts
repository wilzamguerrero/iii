/**
 * Las estructuras: las del método y las de la institución.
 *
 * Dos cosas distintas viven aquí porque las dos son «la forma que toma el
 * documento», y tenerlas juntas evita la duda de a cuál obedecer:
 *
 * - Las FASES del método 3I —Indagar, Idear, Implementar— dicen qué decide cada
 *   documento. Salen de `docs/Documento Maestro 3i .md` y son las mismas para
 *   cualquier universidad.
 * - Las ESTRUCTURAS de la Universidad CESMAG —idea, anteproyecto, informe final—
 *   dicen cómo se entrega. Salen del Reglamento de Trabajo de Grado (artículos
 *   13, 16 y 21, en `docs/estructura idea anteproyecto trabajo de grado.md`) y
 *   son de esa institución: otra pondrá otras y por eso están en una tabla y no
 *   repartidas por la interfaz.
 *
 * Lo que no hay aquí son preguntas. Las preguntas las hace el asistente a partir
 * de la intención de cada proyecto, y un cuestionario escrito de antemano sería
 * lo contrario: el mismo formulario para todos, que es lo que el método niega.
 */

export type PhaseId = "indagar" | "idear" | "implementar";

export interface Phase {
  id: PhaseId;
  /** Como se llama el documento. */
  name: string;
  /** Qué decide esta fase, en una línea. */
  decides: string;
  /** Los apartados con los que nace el documento. Son operaciones, no un molde. */
  headings: readonly string[];
}

export const PHASES: readonly Phase[] = [
  {
    id: "indagar",
    name: "Indagar",
    decides:
      "Identificar la naturaleza de la situación: si es un problema, una tensión, " +
      "una oportunidad, un deseo latente, una fricción sistémica o un potencial no " +
      "activado. La lectura es sistémica —actores, relaciones, flujos, incentivos, " +
      "restricciones—, no una descripción de hechos.",
    headings: [
      "Naturaleza de la situación",
      "Lectura sistémica: actores, relaciones, flujos",
      "Antecedentes y evidencia",
      "Qué falta por averiguar",
    ],
  },
  {
    id: "idear",
    name: "Idear",
    decides:
      "Definir el modo de ideación —libre, orientada o consecuente— según cuánto " +
      "debe apoyarse la propuesta en la evidencia de la indagación, y sostener por " +
      "qué ese modo y no otro.",
    headings: [
      "Modo de ideación y por qué",
      "Ideas en juego",
      "Qué de la indagación sostiene cada idea",
      "Decisión y descartes",
    ],
  },
  {
    id: "implementar",
    name: "Implementar",
    decides:
      "Determinar el tipo de realidad implementativa —inmediata, simulada o " +
      "proyectada— justificado por las condiciones de posibilidad. Implementar " +
      "produce evidencia y ajuste; no es un cierre decorativo.",
    headings: [
      "Tipo de realidad implementativa y sus condiciones",
      "Qué se pone a prueba",
      "Evidencia obtenida",
      "Ajustes y qué sigue",
    ],
  },
];

export function phaseOf(id: PhaseId): Phase {
  const found = PHASES.find((phase) => phase.id === id);
  // La tabla es fija y `PhaseId` sólo admite estos tres; el respaldo es para que
  // el tipo no arrastre un `undefined` por toda la aplicación.
  return found ?? (PHASES[0] as Phase);
}

/* --- el documento con el que nace cada fase -------------------------------- */

/** Un título de nivel 2, y debajo el sitio en blanco donde se escribe. */
function section(title: string): string {
  return `## ${title}\n\n\n`;
}

/**
 * El documento de una fase, listo para guardarse en Notion.
 *
 * Lleva la intención copiada arriba —el documento tiene que poder leerse solo,
 * fuera de la plataforma— y las preguntas que el asistente hizo para *este*
 * proyecto. Si no hubo asistente configurado no se inventan: se dice que faltan.
 */
export function phaseDocument(
  id: PhaseId,
  intent: string,
  questions: readonly string[] = [],
): string {
  const phase = phaseOf(id);
  const parts: string[] = [
    `# ${phase.name}`,
    "",
    `> Intención: ${intent.trim()}`,
    "",
    phase.decides,
    "",
  ];

  if (questions.length > 0) {
    parts.push("## Preguntas para empezar", "");
    parts.push(...questions.map((question) => `- ${question}`));
    parts.push(
      "",
      "*Las hizo el asistente a partir de esta intención. Responderlas aquí es " +
      "empezar el documento; borrarlas cuando ya no hagan falta también.*",
      "",
    );
  } else {
    parts.push(
      "## Preguntas para empezar",
      "",
      "*Aún ninguna: el asistente las hace a partir de la intención cuando hay un " +
      "proveedor de IA conectado. Se piden desde la ventana del asistente.*",
      "",
    );
  }

  parts.push(...phase.headings.map(section));
  return parts.join("\n").replace(/\n{4,}/g, "\n\n\n").trimEnd() + "\n";
}

/* --- las estructuras de la institución ------------------------------------- */

export interface StructureItem {
  /** 1, 2 o 3: la profundidad del apartado, no su numeración. */
  level: 1 | 2 | 3;
  text: string;
}

export interface Structure {
  id: string;
  name: string;
  /** De dónde sale, literal, para que se pueda comprobar. */
  source: string;
  /** Cuándo se usa, en una línea. */
  when: string;
  items: readonly StructureItem[];
}

function h(level: 1 | 2 | 3, text: string): StructureItem {
  return { level, text };
}

/** Los apartados del problema y del marco, que idea, anteproyecto e informe comparten. */
function problema(planteamiento: string): StructureItem[] {
  return [
    h(1, "1. Problema"),
    h(2, "1.1 Objeto o tema de estudio"),
    h(2, "1.2 Línea de investigación"),
    h(2, `1.3 ${planteamiento}`),
    h(2, "1.4 Formulación del problema"),
    h(2, "1.5 Objetivos"),
    h(3, "1.5.1 Objetivo general"),
    h(3, "1.5.2 Objetivos específicos"),
    h(2, "1.6 Justificación"),
    h(1, "2. Marco referencial"),
    h(2, "2.1 Antecedentes"),
    h(2, "2.2 Marco teórico"),
    h(1, "3. Metodología"),
  ];
}

/**
 * Las tres formas del reglamento de la Universidad CESMAG.
 *
 * Están aquí como datos, no como plantillas de texto, porque el documento que se
 * escribe es del proyecto y no de la estructura: esto sólo pone los títulos en su
 * sitio y en su orden. Otra universidad traerá otra tabla y nada más cambiará.
 */
export const STRUCTURES: readonly Structure[] = [
  {
    id: "idea",
    name: "Idea de trabajo de grado",
    source: "Reglamento de Trabajo de Grado, Art. 13",
    when: "Lo primero que se presenta: una hoja para que aprueben por dónde va.",
    items: [
      h(1, "1. Título provisional"),
      h(1, "2. Línea de investigación"),
      h(1, "3. Formulación del problema"),
      h(1, "4. Objetivos"),
      h(2, "4.1 Objetivo general"),
      h(2, "4.2 Objetivos específicos"),
    ],
  },
  {
    id: "anteproyecto",
    name: "Anteproyecto",
    source: "Reglamento de Trabajo de Grado, Art. 16 (máximo 20 páginas)",
    when: "Aprobada la idea: qué se va a hacer, con qué y en cuánto tiempo.",
    items: [
      h(1, "Preliminares"),
      h(2, "Portada"),
      h(2, "Subportada"),
      h(2, "Tabla de contenido"),
      h(1, "Introducción"),
      ...problema("Planteamiento del problema"),
      h(1, "4. Recursos"),
      h(2, "4.1 Talento humano"),
      h(2, "4.2 Recursos físicos"),
      h(2, "4.3 Presupuesto"),
      h(2, "4.4 Financiación"),
      h(2, "4.5 Cronograma de actividades"),
      h(1, "Referencias"),
      h(1, "Anexos"),
    ],
  },
  {
    id: "informe",
    name: "Informe final",
    source: "Reglamento de Trabajo de Grado, Art. 21 (pregrado, máximo 120 páginas)",
    when: "El trabajo terminado, con resultados y conclusiones.",
    items: [
      h(1, "Preliminares"),
      h(2, "Portada"),
      h(2, "Subportada"),
      h(2, "Nota de aceptación"),
      h(2, "Nota de exclusión de responsabilidad"),
      h(2, "Dedicatoria"),
      h(2, "Agradecimientos"),
      h(2, "Contenido"),
      h(2, "Listas especiales"),
      h(2, "Glosario"),
      h(2, "Resumen"),
      h(1, "Introducción"),
      ...problema("Planteamiento o descripción del problema"),
      h(1, "4. Análisis de resultados"),
      h(1, "5. Conclusiones"),
      h(1, "6. Recomendaciones"),
      h(1, "Referencias"),
      h(1, "Anexos"),
    ],
  },
];

export function structureOf(id: string): Structure | null {
  return STRUCTURES.find((one) => one.id === id) ?? null;
}

/**
 * La estructura como texto, para insertarla en un documento.
 *
 * Los niveles bajan uno respecto a los del documento —`##`, `###`, `####`— porque
 * el `#` ya está puesto arriba y es el del documento. Cada apartado queda vacío: lo
 * que va dentro se escribe, no se rellena.
 */
export function structureMarkdown(id: string): string {
  const structure = structureOf(id);
  if (!structure) return "";

  const lines = [
    `> Estructura: ${structure.name} · ${structure.source}`,
    "",
  ];
  for (const item of structure.items) {
    lines.push(`${"#".repeat(item.level + 1)} ${item.text}`, "", "");
  }
  return lines.join("\n").replace(/\n{4,}/g, "\n\n\n").trimEnd() + "\n";
}

/**
 * La fase a la que pertenece un documento, por su nombre.
 *
 * Los tres documentos de un proyecto se llaman Indagar, Idear e Implementar
 * porque los crea `project/create.ts` con el nombre de la fase, así que el nombre
 * es el dato. Si alguien renombra el suyo, esto devuelve `null` y quien pregunta
 * se queda sin ese contexto: es preferible a suponer una fase equivocada y revisar
 * el documento contra lo que no es.
 */
export function phaseByName(name: string): PhaseId | null {
  const clean = name.trim().toLocaleLowerCase("es");
  return PHASES.find((phase) => phase.name.toLocaleLowerCase("es") === clean)?.id ?? null;
}

/**
 * La estructura que sigue un documento, leyéndola del propio documento.
 *
 * `structureMarkdown` deja su nombre en la primera línea —«> Estructura: …»— y esa
 * línea es la que se busca aquí. No hace falta guardar en ninguna parte qué forma
 * eligió cada documento: la elección está escrita dentro de él, que es donde puede
 * verla y cambiarla la persona.
 */
export function structureInText(text: string): Structure | null {
  const found = /^\s*>\s*Estructura:\s*(.+?)(?:\s*·|$)/mi.exec(text);
  const name = found?.[1]?.trim().toLocaleLowerCase("es");
  if (!name) return null;
  return STRUCTURES.find((one) => one.name.toLocaleLowerCase("es") === name) ?? null;
}
