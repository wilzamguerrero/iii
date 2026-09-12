/* Un documento de Indagar de verdad, con la ruta escrita dentro.
 *
 * Las otras partes del humo abren un documento cualquiera: sirve para el editor,
 * la revisión y el asistente, pero no lleva ruta ninguna, así que la columna de
 * Indagar no se abre sola y el mapa no tiene nada que dibujar. Esta parte sí.
 *
 * El texto no se escribe a mano. Se pide a `indagar.ts` —el mismo módulo que la
 * plataforma usa para fabricar el documento de una fase— y se convierte con
 * `blocks.ts`, que es la traducción de verdad. Escribirlo a mano sería más corto
 * y estaría mintiendo en cuanto cambie una pregunta: el humo pasaría a probar un
 * texto que ya no existe.
 *
 * Lo único que se añade a mano son las respuestas, porque son lo único que no
 * sale del método: las preguntas de los tres primeros pasos van respondidas y
 * las del cuarto no. Así el documento cae en «toca diagnosticar» —el punto
 * exacto donde la ruta se bifurca— y el mapa se abre en su momento más
 * interesante.
 *
 * `notion.js` pregunta por `window.__routeBlocks()` en su primera lectura de
 * bloques: con esto puesto, sirve la ruta; sin esto, el documento de siempre.
 */

(() => {
  const NL = String.fromCharCode(10);

  /**
   * Respuestas con pinta de escritas por alguien. Deterministas, sin azar.
   *
   * Se reparten en orden entre las preguntas de los tres primeros apartados, y
   * están escritas para que cualquiera de ellas siente bien debajo de
   * cualquiera de esas preguntas: si el método añade una pregunta o le cambia
   * la redacción, esto sigue valiendo. Emparejarlas por el texto de la pregunta
   * sería atarlas a una redacción concreta, que es justo lo que este doble
   * evita al pedirle el documento al método en vez de escribirlo a mano.
   */
  const SAID = [
    "El programa de Diseño Gráfico no tiene un sitio donde el estudiante vea de dónde viene lo que hace.",
    "Necesito que el método deje de ser una lámina y pase a ser algo que se recorre escribiendo.",
    "Que un estudiante pueda abrir su proyecto y ver en qué paso va sin preguntárselo a nadie.",
    "El campo es el aula de proyectos del programa, y los actores son los estudiantes y quien acompaña.",
    "Ya se intentó con plantillas de Word y con una carpeta compartida; ninguna de las dos dice en qué paso va nadie.",
    "Lo que hay escrito hoy vive en apuntes sueltos que nadie vuelve a abrir después de la entrega.",
    "La restricción es el tiempo del semestre: lo que no quepa en dieciséis semanas no se sostiene.",
    "Se sabría que sirve cuando alguien lo use sin que haya que explicarle el método antes.",
  ];

  /**
   * El Markdown de la ruta con las respuestas dentro.
   *
   * Se responden **todas** las preguntas de los tres primeros apartados comunes
   * —`## 1.`, `## 2.` y `## 3.`— y se deja el cuarto sin tocar. Tienen que ser
   * todas: un paso con preguntas está hecho cuando están respondidas, así que
   * dejar una suelta deja el paso a medias y el documento no llega al punto de
   * la bifurcación, que es lo que esta parte del humo va a probar.
   *
   * No cuentan como preguntas las citas de fontanería que el método pone en
   * cada apartado —`Avanza cuando:` y la regla del diagnóstico—: son criterio,
   * no pregunta, y responderlas no significaría nada.
   */
  async function markdown() {
    const indagar = await import("/src/core/method/indagar.ts");
    const lines = indagar
      .indagarDocument("quiero un programa que acompañe el método 3i")
      .split(NL);

    const out = [];
    let section = 0;
    let at = 0;
    for (const line of lines) {
      out.push(line);
      if (/^##\s/.test(line)) { section += 1; continue; }
      if (section < 1 || section > 3) continue;
      if (!/^>\s/.test(line)) continue;
      if (/^>\s*(Avanza cuando|La naturaleza de la situación)/.test(line)) continue;
      // Las líneas vacías alrededor: es lo que hace que la respuesta no quede
      // pegada a la cita de la pregunta siguiente.
      out.push("", SAID[at % SAID.length], "");
      at += 1;
    }
    return out.join(NL);
  }

  /** Los bloques de Notion de la ruta, como los devolvería la API. */
  async function build() {
    const { markdownToBlocks } = await import("/src/core/notion/blocks.ts");
    const heads = { 1: "heading_1", 2: "heading_2", 3: "heading_3" };
    const named = {
      paragraph: "paragraph", bullet: "bulleted_list_item",
      number: "numbered_list_item", quote: "quote",
    };

    const blocks = [];
    let at = 0;
    for (const block of markdownToBlocks(await markdown())) {
      // El `#` del documento es el título de la página, no un bloque de dentro.
      if (block.type === "heading" && block.level === 1) continue;
      const type = block.type === "heading"
        ? heads[block.level || 2] || "heading_2"
        : named[block.type] || "paragraph";
      at += 1;
      blocks.push({
        // Un id con forma de uuid, como los de Notion: la plataforma reconoce
        // la marca de bloque por su forma —hexadecimal y guiones—, así que un
        // id inventado con otras letras se quedaría escrito dentro del texto.
        id: "00000000-0000-4000-8000-" + String(at).padStart(12, "0"),
        object: "block",
        type,
        has_children: false,
        [type]: { rich_text: [{ plain_text: block.text }] },
      });
    }
    return blocks;
  }

  let ready = null;
  window.__routeBlocks = () => {
    // Se apunta cuántos salieron para que la parte pueda decir cuántos bloques
    // trae el documento sin contar el DOM entero.
    if (!ready) {
      ready = build().then((made) => { window.__routeMade = made.length; return made; });
    }
    return ready;
  };
})();
