/**
 * Cuatro ayudas para construir DOM sin plantillas.
 *
 * Se usa `textContent` y nunca `innerHTML`: los títulos de las páginas los
 * escribe el usuario en Notion y vuelven aquí como texto ajeno. Con `textContent`
 * la inyección no es posible, y no hay que acordarse de escapar nada.
 */

export interface ElementProps {
  class?: string;
  text?: string;
  attrs?: Record<string, string | number | boolean | null | undefined>;
  on?: { [K in keyof HTMLElementEventMap]?: (event: HTMLElementEventMap[K]) => void };
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: ElementProps = {},
  children: readonly (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);

  if (props.class) node.className = props.class;
  if (props.text !== undefined) node.textContent = props.text;

  for (const [name, value] of Object.entries(props.attrs ?? {})) {
    if (value === null || value === undefined || value === false) continue;
    node.setAttribute(name, value === true ? "" : String(value));
  }

  for (const [type, listener] of Object.entries(props.on ?? {})) {
    node.addEventListener(type, listener as EventListener);
  }

  for (const child of children) {
    node.append(typeof child === "string" ? document.createTextNode(child) : child);
  }

  return node;
}

export function clear(node: Element): void {
  while (node.firstChild) node.firstChild.remove();
}

/** Reemplaza el contenido de un contenedor de una sola vez. */
export function render(container: Element, ...children: readonly (Node | string)[]): void {
  clear(container);
  for (const child of children) {
    container.append(typeof child === "string" ? document.createTextNode(child) : child);
  }
}

/**
 * Agrupa las pulsaciones seguidas: el buscador de páginas no debe lanzar una
 * petición por tecla, que el límite de Notion son unas tres por segundo.
 */
export function debounce<A extends unknown[]>(
  fn: (...args: A) => void,
  ms: number,
): (...args: A) => void {
  // El proyecto tiene los tipos de Node cargados (para api/ y tools/), donde
  // setTimeout devuelve un Timeout y no un número. Se toma el tipo de la propia
  // función en vez de suponer cuál de las dos plataformas gana.
  let timer: ReturnType<typeof setTimeout> | undefined;
  return (...args: A) => {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => { fn(...args); }, ms);
  };
}
