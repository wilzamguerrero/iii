import { askAssistant } from "../assistant/assistant.ts";
import type { MenuItem } from "../dock/menu.ts";

/**
 * El menú de la IA sobre lo seleccionado.
 *
 * Lo que aparece en cualquier plataforma de escritura con IA: se marca un
 * fragmento, se pulsa el botón derecho y están ahí las preguntas que se le
 * pueden hacer a ese fragmento —cuestionar, explicar, precisar, y las de
 * investigación: resumir, buscar respaldo, parafrasear—. Sin marcar nada no
 * aparece: un menú de la IA sin fragmento es un menú de preguntas al aire.
 *
 * Las tres del método (Cuestionar, Explicar, Precisar) ya estaban en la barra
 * que salía al seleccionar; este menú las reúne con las de investigación para
 * que el clic derecho sea el único gesto que hay que conocer. La barra sigue
 * existiendo: es lo que se ve al seleccionar, y el menú es su versión
 * completa.
 *
 * Todas contestan en la ventana del asistente —un solo sitio donde el modelo
 * habla, que es el principio de no redundancia de la plataforma— y ninguna
 * reemplaza texto: el documento se defiende delante de un jurado y sólo se
 * defiende lo que uno escribió.
 */

/** Lo que se le puede pedir a un fragmento, con su orden al modelo. */
export interface FragmentAction {
  id: string;
  label: string;
  title: string;
  /** Cómo se le habla al modelo: la orden y lo que no debe hacer. */
  order: string;
}

/**
 * Las acciones de investigación, pensadas como las de SciSpace y demás
 * plataformas de escritura con IA: lo que un investigador le pide de verdad
 * a un fragmento de su documento.
 */
export const ACTIONS: readonly FragmentAction[] = [
  {
    id: "cuestionar",
    label: "Cuestionar",
    title: "Qué doy por supuesto en este fragmento",
    order: "Cuestiona este fragmento de mi documento: qué doy por supuesto, qué no queda " +
      "dicho y qué tendría que decidir. No lo reescribas.",
  },
  {
    id: "explicar",
    label: "Explicar",
    title: "Qué papel cumple este fragmento en la fase",
    order: "Explícame qué papel cumple este fragmento dentro de la fase en la que estoy y " +
      "qué le falta para cumplirlo. No lo reescribas.",
  },
  {
    id: "precisar",
    label: "Precisar",
    title: "Dónde se puede leer de dos maneras",
    order: "Dime dónde este fragmento se puede leer de dos maneras y qué decisiones me " +
      "faltan para que sólo se lea de una. No lo reescribas: no me devuelvas el párrafo " +
      "corregido.",
  },
  {
    id: "resumir",
    label: "Resumir",
    title: "El fragmento en una o dos frases",
    order: "Resume este fragmento en una o dos frases que sirvan para recordarlo, sin " +
      "añadir nada que no esté dicho.",
  },
  {
    id: "respaldar",
    label: "Buscar respaldo",
    title: "Qué evidencia haría falta y dónde buscarla",
    order: "Este fragmento hace una afirmación que necesita respaldo. Di qué clase de " +
      "evidencia la sostendría —dato, estudio, caso, norma— y dónde habría que buscarla " +
      "con DOI. No inventes referencias: si no la tienes, di qué habría que buscar.",
  },
  {
    id: "parafrasear",
    label: "Parafrasear",
    title: "Otras maneras de decirlo, para elegir",
    order: "Dame dos o tres maneras distintas de decir esto mismo —cambiar el orden, el " +
      "énfasis o el nivel— para que yo elija. No reemplaces el fragmento: yo decido " +
      "qué queda.",
  },
];

/** Traduce las acciones a la forma del menú de baldosas. */
export function menuItems(fragment: string, pageName: string): MenuItem[] {
  return ACTIONS.map((action) => ({
    label: action.label,
    run: () => { ask(action.order, fragment, pageName); },
  }));
}

function ask(order: string, fragment: string, pageName: string): void {
  askAssistant(`${order}\n\nDocumento «${pageName}». Fragmento:\n«${fragment}»`);
}
