/**
 * Los trazos de la interfaz.
 *
 * Son los de **Material Symbols Light** (peso 300, 24×24), traídos una sola vez
 * y guardados aquí como datos: la plataforma no pide iconos a ningún servidor al
 * arrancar, y la figura que se ve en la franja es la misma que se verá mañana en
 * el editor. La unidad gráfica se pidió explícitamente, y ésta es la manera de
 * tenerla sin depender de una fuente ni de una red.
 *
 * Vienen rellenos y no dibujados a trazo: el color lo pone el CSS con
 * `currentColor` sobre el `<svg>`, y el `<path>` lo hereda. Por eso `.ico` lleva
 * `fill: currentColor` y no `stroke`, y por eso un mismo icono sirve a 16 px en
 * la bandeja y a 40 px en una baldosa sin retocar grosores.
 *
 * Cada figura tiene dos versiones cuando hace falta distinguir estados: la de
 * contorno es la de todos los días y la maciza es la de «esto está abierto»
 * (`page` / `pageFull`, `folder` / `folderFull`). Cambiar de una a otra sin
 * rehacer el nodo es lo que hace `setIcon`.
 */

const SVG_NS = "http://www.w3.org/2000/svg";

/** Todas en la misma cuadrícula: es la de Material y no se toca. */
const BOX = "0 0 24 24";

const GLYPHS = {
  /** Un proyecto. */
  folder: ["M4.616 19q-.691 0-1.153-.462T3 17.384V6.616q0-.691.463-1.153T4.615 5h4.981l2 2h7.789q.69 0 1.153.463T21 8.616v8.769q0 .69-.462 1.153T19.385 19zm0-1h14.769q.269 0 .442-.173t.173-.442v-8.77q0-.269-.173-.442T19.385 8h-8.19l-2-2h-4.58q-.269 0-.442.173T4 6.616v10.769q0 .269.173.442t.443.173M4 18V6z"],
  /** El proyecto donde se está trabajando. */
  folderFull: ["M4.616 19q-.691 0-1.153-.462T3 17.384V6.616q0-.691.463-1.153T4.615 5h4.981l2 2h7.789q.69 0 1.153.463T21 8.616v8.769q0 .69-.462 1.153T19.385 19z"],
  /** El proyecto abierto: se está mirando dentro. */
  folderOpen: ["M4.5 19q-.633 0-1.066-.434Q3 18.133 3 17.5V6.616q0-.633.491-1.125Q3.983 5 4.615 5h4.981l2 2h7.789q.517 0 .903.28t.539.72h-9.633l-2-2H4.615q-.269 0-.442.173T4 6.616v10.769q0 .211.106.346t.279.23l2.265-7.576h16.216l-2.268 7.556q-.142.476-.545.768q-.403.291-.9.291zm.927-1h14.112l1.972-6.616H7.4zm0 0L7.4 11.385zM4 8V6z"],
  /** Un documento. */
  page: ["M8.5 17.5h7v-1h-7zm0-4h7v-1h-7zM6.616 21q-.691 0-1.153-.462T5 19.385V4.615q0-.69.463-1.152T6.616 3H14.5L19 7.5v11.885q0 .69-.462 1.153T17.384 21zM14 8V4H6.616q-.231 0-.424.192T6 4.615v14.77q0 .23.192.423t.423.192h10.77q.23 0 .423-.192t.192-.424V8zM6 4v4zv16z"],
  /** El documento que está abierto y el asistente ve. */
  pageFull: ["M8.5 17.5h7v-1h-7zm0-4h7v-1h-7zM6.616 21q-.691 0-1.153-.462T5 19.385V4.615q0-.69.463-1.152T6.616 3H14.5L19 7.5v11.885q0 .69-.462 1.153T17.384 21zM14 8h4l-4-4z"],
  /** Quien conectó su Notion, cuando el espacio no tiene icono. */
  person: ["M9.877 10.508Q9 9.63 9 8.385t.877-2.123T12 5.385t2.123.877T15 8.385t-.877 2.123t-2.123.877t-2.123-.877M5 18.616v-1.647q0-.619.36-1.158q.361-.54.97-.838q1.416-.679 2.834-1.018q1.417-.34 2.836-.34t2.837.34t2.832 1.018q.61.298.97.838q.361.539.361 1.158v1.646zm1-1h12v-.647q0-.332-.215-.625q-.214-.292-.593-.494q-1.234-.598-2.546-.916T12 14.616t-2.646.318t-2.546.916q-.38.202-.593.494Q6 16.637 6 16.97zm7.413-7.819Q14 9.21 14 8.385t-.587-1.413T12 6.385t-1.412.587T10 8.385t.588 1.412t1.412.588t1.413-.588M12 17.616"],
  /** Los ajustes de la plataforma. */
  tune: ["M11.5 20.5v-5h1v2h8v1h-8v2zm-8-2v-1h5v1zm4-4v-2h-4v-1h4v-2h1v5zm4-2v-1h9v1zm4-4v-5h1v2h4v1h-4v2zm-12-2v-1h9v1z"],
  /** Cerrar: la pestaña, la ventanita. */
  cross: ["m6.4 18.308l-.708-.708l5.6-5.6l-5.6-5.6l.708-.708l5.6 5.6l5.6-5.6l.708.708l-5.6 5.6l5.6 5.6l-.708.708l-5.6-5.6z"],
  /** Otra pestaña, otro documento. */
  plus: ["M11.5 12.5H6v-1h5.5V6h1v5.5H18v1h-5.5V18h-1z"],
  /** Las acciones de una baldosa. */
  more: ["M6.462 13q-.413 0-.707-.294T5.462 12t.293-.706t.707-.294t.706.294t.293.706t-.293.706T6.46 13M12 13q-.413 0-.706-.294T11 12t.294-.706T12 11t.706.294T13 12t-.294.706T12 13m5.539 0q-.413 0-.707-.294T16.538 12t.294-.706t.706-.294t.707.294t.293.706t-.293.706t-.707.294"],
  /** Entrar; en el árbol, una rama cerrada. */
  right: ["m13.292 12l-4.6-4.6l.708-.708L14.708 12L9.4 17.308l-.708-.708z"],
  /** Volver. */
  left: ["M14 17.308L8.692 12L14 6.692l.708.708l-4.6 4.6l4.6 4.6z"],
  /** En el árbol, una rama abierta. */
  down: ["M12 14.702L6.692 9.394l.708-.707l4.6 4.6l4.6-4.6l.708.707z"],
  /** Salir de la carpeta. */
  back: ["m6.921 12.5l5.793 5.792L12 19l-7-7l7-7l.714.708L6.92 11.5H19v1z"],
  /** Volver a leer de Notion. */
  refresh: ["M12.077 19q-2.931 0-4.966-2.033q-2.034-2.034-2.034-4.964t2.034-4.966T12.077 5q1.783 0 3.339.847q1.555.847 2.507 2.365V5h1v5.23h-5.23v-1h3.7q-.782-1.495-2.198-2.363T12.077 6q-2.5 0-4.25 1.75T6.077 12t1.75 4.25t4.25 1.75q1.925 0 3.475-1.1t2.175-2.9h1.062q-.662 2.246-2.514 3.623T12.077 19"],
  /** Buscar una página del espacio. */
  search: ["m19.485 20.154l-6.262-6.262q-.75.639-1.725.989t-1.96.35q-2.398 0-4.064-1.666Q3.808 11.898 3.808 9.5t1.666-4.064t4.064-1.667t4.065 1.667T15.269 9.5q0 1.042-.369 2.017t-.97 1.668l6.262 6.261zM9.539 14.23q1.99 0 3.36-1.37t1.37-3.361t-1.37-3.36t-3.36-1.37t-3.361 1.37t-1.37 3.36t1.37 3.36t3.36 1.37"],
  /** Renombrar, o escribir en el documento. */
  edit: ["M5 19h1.098L16.796 8.302l-1.098-1.098L5 17.902zm-1 1v-2.52L17.18 4.288q.155-.137.34-.212T17.907 4t.39.064q.19.063.35.228l1.067 1.074q.165.159.226.35q.06.19.06.38q0 .204-.068.39q-.069.185-.218.339L6.519 20zM19.02 6.092l-1.112-1.111zm-2.782 1.67l-.54-.558l1.098 1.098z"],
  /** Eliminar. */
  trash: ["M7.616 20q-.672 0-1.144-.472T6 18.385V6H5V5h4v-.77h6V5h4v1h-1v12.385q0 .69-.462 1.153T16.384 20zM17 6H7v12.385q0 .269.173.442t.443.173h8.769q.23 0 .423-.192t.192-.424zM9.808 17h1V8h-1zm3.384 0h1V8h-1zM7 6v13z"],
  /** Confirmado. */
  check: ["m9.55 17.308l-4.97-4.97l.714-.713l4.256 4.256l9.156-9.156l.713.714z"],
  /** El árbol: la jerarquía desde la raíz. */
  tree: ["M15.5 20.5v-3h-4v-10h-3v3h-6v-7h6v3h7v-3h6v7h-6v-3h-3v9h3v-3h6v7zm-12-16v5zm13 10v5zm0-10v5zm0 5h4v-5h-4zm0 10h4v-5h-4zm-13-10h4v-5h-4z"],
  /** Indagar: mirar afuera antes de decidir. */
  indagar: ["M12 21q-1.864 0-3.506-.71q-1.642-.711-2.857-1.926q-1.216-1.216-1.926-2.858Q3 13.864 3 12t.71-3.506t1.927-2.857T8.494 3.71Q10.137 3 12 3q3.496 0 6.032 2.307t2.903 5.699h-1.012q-.263-2.171-1.568-3.897T15 4.562V5q0 .825-.587 1.413T13 7h-2v2q0 .425-.288.713T10 10H8v2h1.846v3H9l-4.8-4.8q-.075.45-.137.9T4 12q0 3.275 2.3 5.625T12 20zm9.023-.27l-3.45-3.41q-.448.319-.971.5q-.523.18-1.102.18q-1.471 0-2.485-1.014Q12 15.97 12 14.5t1.015-2.485T15.5 11t2.486 1.015T19 14.5q0 .598-.19 1.13q-.19.533-.53.981l3.45 3.412zm-3.748-4.455Q18 15.55 18 14.5t-.725-1.775T15.5 12t-1.775.725T13 14.5t.725 1.775T15.5 17t1.775-.725"],
  /** Idear: la propuesta. */
  idear: ["M10.799 20.691q-.51-.462-.607-1.152h3.616q-.096.69-.607 1.152T12 21.154t-1.201-.463M8.5 17.77v-1h7v1zM8.558 15q-1.417-.929-2.238-2.356T5.5 9.5q0-2.721 1.89-4.61T12 3t4.61 1.89T18.5 9.5q0 1.717-.82 3.144T15.442 15zm.292-1h6.3q1.125-.8 1.738-1.975T17.5 9.5q0-2.3-1.6-3.9T12 4T8.1 5.6T6.5 9.5q0 1.35.613 2.525T8.85 14M12 14"],
  /** Implementar: ponerlo en el mundo. */
  implementar: ["m5.189 11.217l2.45 1.037q.465-.931 1.013-1.802t1.21-1.694l-1.535-.294q-.154-.039-.298.009t-.26.163zm3.242 1.671l2.83 2.826q1.185-.535 2.385-1.36t2.308-1.933q1.615-1.615 2.468-3.445t.959-4.226q-2.396.106-4.22.959q-1.822.853-3.438 2.468q-1.107 1.108-1.932 2.317t-1.36 2.394m4.74-3.431q0-.617.44-1.057q.441-.44 1.07-.44t1.069.44t.44 1.057t-.44 1.056t-1.07.44t-1.068-.44t-.44-1.056m-.259 9.504l2.581-2.58q.115-.116.164-.26q.048-.144.01-.298l-.295-1.535q-.823.662-1.694 1.207t-1.802 1.01zM20.316 3.83q.168 2.756-.78 5.07q-.947 2.315-2.95 4.318l-.174.173l-.173.173l.404 2.052q.081.404-.03.783q-.112.379-.404.671l-3.642 3.623l-1.658-3.905l-3.564-3.564l-3.905-1.677l3.617-3.623q.292-.292.674-.413t.786-.04l2.09.422q.096-.096.163-.173t.164-.173q2.004-2.004 4.315-2.944t5.068-.773m-15.2 12.337q.587-.586 1.426-.58t1.426.594t.584 1.426q-.003.84-.59 1.426q-.51.51-1.635.873t-2.605.502q.139-1.48.512-2.605t.882-1.636m.714.727q-.289.289-.539.942t-.33 1.347q.694-.081 1.347-.338q.652-.256.941-.545q.3-.3.306-.715q.005-.416-.295-.716t-.715-.287q-.415.012-.715.312"],
  /** Dictar en vez de escribir. */
  mic: ["M10.577 12.423Q10 11.846 10 11V5q0-.846.577-1.423T12 3t1.423.577T14 5v6q0 .846-.577 1.423T12 13t-1.423-.577M11.5 20.5v-3.517q-2.35-.216-3.925-1.922T6 11h1q0 2.075 1.463 3.538T12 16t3.538-1.463T17 11h1q0 2.356-1.575 4.062t-3.925 1.92V20.5zm1.213-8.787Q13 11.425 13 11V5q0-.425-.288-.712T12 4t-.712.288T11 5v6q0 .425.288.713T12 12t.713-.288"],
  /** Detener el dictado o la respuesta. */
  stop: ["M8.5 15.5h7v-7h-7zm3.503 5.5q-1.867 0-3.51-.708q-1.643-.709-2.859-1.924t-1.925-2.856T3 12.003t.709-3.51Q4.417 6.85 5.63 5.634t2.857-1.925T11.997 3t3.51.709q1.643.708 2.859 1.922t1.925 2.857t.709 3.509t-.708 3.51t-1.924 2.859t-2.856 1.925t-3.509.709M12 20q3.35 0 5.675-2.325T20 12t-2.325-5.675T12 4T6.325 6.325T4 12t2.325 5.675T12 20m0-8"],
  /** Un borrador que todavía no está en Notion. */
  draft: ["M6.616 21q-.691 0-1.153-.462T5 19.385V4.615q0-.69.463-1.152T6.616 3H14.5L19 7.5v11.885q0 .69-.462 1.153T17.384 21zM14 8V4H6.616q-.231 0-.424.192T6 4.615v14.77q0 .23.192.423t.423.192h10.77q.23 0 .423-.192t.192-.424V8zM6 4v4zv16z"],
  /** Los tres documentos de un proyecto. */
  notes: ["M8 19.385V9.61q0-.671.475-1.14T9.621 8h9.764q.67 0 1.143.472q.472.472.472 1.144v6.961L16.577 21H9.615q-.67 0-1.143-.472Q8 20.056 8 19.385M3.025 6.596q-.13-.671.258-1.208t1.06-.669l9.619-1.694q.67-.13 1.208.258t.669 1.06l.211 1.273h-1.012l-.213-1.193q-.038-.211-.23-.336T14.17 4L4.52 5.714q-.269.038-.404.25q-.134.211-.096.48l1.596 9.016v1.936q-.342-.167-.581-.475q-.24-.307-.315-.705zM9 9.616v9.769q0 .269.173.442t.443.173H16v-4h4V9.616q0-.27-.173-.443T19.385 9h-9.77q-.269 0-.442.173T9 9.616m5.5 4.884"],
} satisfies Record<string, readonly string[]>;

export type IconName = keyof typeof GLYPHS;

export function icon(name: IconName, className = "ico"): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", className);
  svg.setAttribute("viewBox", BOX);
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  paint(svg, name);
  return svg;
}

/**
 * Cambia la figura de un icono ya pintado.
 *
 * Existe para los estados: la baldosa del documento abierto pasa de contorno a
 * maciza, y quien lo marca (`folders.ts`) recorre el DOM en vez de guardar una
 * tabla de nodos, porque las baldosas se tiran al cambiar de carpeta.
 */
export function setIcon(svg: SVGSVGElement, name: IconName): void {
  paint(svg, name);
}

function paint(svg: SVGSVGElement, name: IconName): void {
  while (svg.firstChild) svg.firstChild.remove();
  for (const d of GLYPHS[name]) {
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", d);
    svg.append(path);
  }
}
