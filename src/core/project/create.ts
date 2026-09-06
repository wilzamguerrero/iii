import { createPage, createProject, type TreeNode } from "../notion/tree.ts";
import { PHASES, phaseDocument } from "../method/structures.ts";
import type { Seed } from "../ai/scaffold.ts";

/**
 * Crear el proyecto: la carpeta y sus tres documentos.
 *
 * Cuatro escrituras en Notion, una detrás de otra y en este orden, porque los tres
 * documentos van dentro del desplegable y hasta que no exista no hay dónde
 * ponerlos. No se lanzan en paralelo a propósito: Notion admite unas tres
 * peticiones por segundo y cuatro a la vez es justo el borde donde empieza a
 * devolver 429 —lo reintenta `client.ts`, pero pedirlo despacio es mejor que
 * pedirlo mal.
 *
 * Si falla a mitad no se deshace lo hecho. Es deliberado: lo escrito ya es de la
 * persona y está en su Notion, y borrar bloques suyos para dejar limpio un fallo
 * nuestro es peor que dejarle un proyecto con dos documentos y decírselo.
 */

export interface Step {
  /** Cuántos pasos van hechos, contando desde 0. */
  done: number;
  total: number;
  /** Qué se está haciendo ahora, para escribirlo tal cual. */
  label: string;
}

export interface CreateOptions {
  token: string;
  /** La página raíz, o la carpeta dentro de la que se crea. */
  parentId: string;
  name: string;
  /** La intención, que va citada al principio de cada documento. */
  intent: string;
  /** Las preguntas por fase que propuso el asistente. Puede venir vacío. */
  seeds?: readonly Seed[];
  onStep?: (step: Step) => void;
}

export interface Created {
  project: TreeNode;
  /** Los tres documentos, en el orden del método. */
  pages: TreeNode[];
}

export async function createFromIntent(options: CreateOptions): Promise<Created> {
  const { token, parentId, name, intent } = options;
  const total = 1 + PHASES.length;
  const step = (done: number, label: string): void => options.onStep?.({ done, total, label });

  step(0, `Creando «${name.trim() || "el proyecto"}» en Notion…`);
  const project = await createProject(token, parentId, name);

  const pages: TreeNode[] = [];
  for (const [index, phase] of PHASES.entries()) {
    step(1 + index, `Escribiendo ${phase.name}…`);
    const questions = options.seeds?.find((seed) => seed.phase === phase.id)?.questions ?? [];
    pages.push(await createPage(
      token,
      project.id,
      phase.name,
      phaseDocument(phase.id, intent, questions),
    ));
  }

  step(total, "Listo.");
  return { project, pages };
}
