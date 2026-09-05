# plan.md — Plataforma 3i

> Plan de ejecución por fases. Punto de partida acordado el 2026-09-04.
> Fuentes: `instruction.md`, `docs/Documento Maestro 3i .md`,
> `docs/estructura idea anteproyecto trabajo de grado.md`, `reference/`.

---

## 1. Qué se está construyendo

Una plataforma para **desarrollar un proyecto de investigación acompañado por una IA**,
estructurada sobre la metodología **3i (Indagar · Idear · Implementar)**.

El principio que gobierna todas las decisiones del producto —y que viene del propio
Documento Maestro— es este: **la persona lidera, la IA no resuelve**. La IA pregunta,
devuelve la formulación al autor, señala vacíos, contrasta y aclara; no escribe el
proyecto en lugar de nadie. El modelo 3i dice que la intención se declara *para ponerla
a prueba*, no para darla por buena (§5.7.1). La IA es el instrumento de esa prueba.

El recorrido del usuario:

| # | Momento | Qué pasa |
|---|---------|----------|
| 1 | **Intención** | La pantalla que ya existe: la frase y la pregunta *¿Descubramos cuál es tu intención?* Se puede escribir o **dictar por voz**. |
| 2 | **Descubrimiento** | La persona cuenta en bruto lo que tiene en la cabeza. La IA no lo acepta tal cual: lo devuelve formulado, pregunta lo que falta y ayuda a **descubrir la intención real**. |
| 3 | **Indagar** | Diálogo guiado por las ocho operaciones de la fase (§5.7): intención → escenario → observación → relación → interpretación → situación → **naturaleza** → desafío. |
| 4 | **Despliegue de herramientas** | Identificada la **naturaleza de la situación**, la plataforma despliega el instrumental que le corresponde —y sólo ése. Un problema abre árbol de causas; un deseo latente abre mapa de empatía o etnografía creativa. |
| 5 | **Documentos** | Cada proyecto contiene páginas: *idea*, *anteproyecto*, *trabajo de grado*, más las páginas de instrumento. Se generan desde las salidas de 3i, no desde cero. |
| 6 | **Persistencia** | Todo vive en el Notion del usuario, conectado por OAuth. Cerrar y volver no pierde nada. |

Sobre la interfaz: **blanca, simple, tipográfica**, con los tokens que ya tiene
`styles.css`. De `reference/` se traen **funciones, no apariencia**. La UI definitiva se
diseñará encima de esta base, así que lo que se construye ahora tiene que aguantar ese
rediseño sin reescribirse.

---

## 2. Qué se trae de `reference/` y qué no

`reference/wzglexical-dev_mimem` es una app React + Vite + TipTap. Está bien separada: la
lógica vive en `services/` (TypeScript sin framework) y React sólo aparece en la capa de
UI. Eso es lo que hace viable el traslado sin arrastrar la interfaz.

**Se trae (lógica, portable tal cual o casi):**

| Pieza de referencia | Para qué aquí |
|---|---|
| `services/notionService.ts` | Cliente de Notion: OAuth, árbol de toggles, CRUD de bloques, paginación, caché. |
| `api/notion-oauth.ts` · `api/notion.ts` | Intercambio de `code` por token y proxy de la API. El `client_secret` nunca sale del servidor. |
| `services/copilotService.ts` | Capa multi-proveedor de IA: claves, modelos, `chatCompletion`, streaming SSE. |
| `api/openrouter-ai.ts` · `api/openrouter-models.ts` | Proxy de IA. Los de GitHub/NVIDIA quedan disponibles para después. |
| `services/documentStore.ts` · `draftCache.ts` | Estado del documento y borrador local. Ya son *framework-free*; `hooks/useDocument.ts` es sólo el enchufe a React y se descarta. |
| `services/blockParser.ts` · `blockSerializer.ts` · `blockEditorBridge.ts` · `richText.ts` | Notion ↔ modelo de bloques ↔ JSON de TipTap. |
| `services/slashCommands.ts` | Menú "/" del editor. |
| Dictado por voz (`components/MarkdownPreview.tsx:2235-2305`) | Web Speech API con reinicio automático. ~70 líneas. |
| Panel de IA arrastrable (`components/AIChatPanel.tsx`) | El **comportamiento**: posición persistida, contexto del editor, insertar/reemplazar en el documento. La UI se rehace. |
| `components/FileTree.tsx` | El **comportamiento** del árbol de toggles. La UI se rehace. |
| `GUIA_NOTION_OAUTH.md` | Checklist de verificación del flujo OAuth. |

**No se trae:** presentaciones, temas de reporte, mapa mental, galería masonry, subidas
multipart, PWA, notificaciones push, compartir por enlace, Monaco, CodeMirror, Lexical.
Nada de eso pertenece a este producto todavía.

---

## 3. Decisiones de arquitectura

**D1 · Stack: Vite + módulos ES en TypeScript, sin framework de UI.**
Hoy el proyecto no tiene build y presume de ello en el README. Ese rasgo se pierde de
todos modos: el intercambio OAuth exige un backend, porque el `client_secret` no puede
estar en el navegador. Añadir Vite es el paso mínimo que habilita npm, TypeScript y
variables de entorno.
No se adopta React porque lo único reutilizable de la referencia es la lógica, que no lo
necesita, y porque la UI se va a reescribir entera de todas formas. El editor no obliga:
`@tiptap/core` es agnóstico (`new Editor({ element, extensions })`). El estado compartido
lo resuelve un store con `subscribe` —el patrón que la referencia ya usa en
`documentStore.ts`.
*Coste asumido:* sin React hay que escribir a mano el renderizado del árbol y de las
listas. Es trabajo acotado y predecible.
**La intro en Three.js no se toca**: sigue en JS y se monta dentro del shell nuevo.

**D2 · Una página = un bloque `code` con Markdown dentro.**
La referencia tiene dos modelos: markdown en un `code block`, y bloques nativos de Notion
dentro de un toggle. El segundo se ve mejor dentro de Notion, pero exige motor de diff y
serialización bloque a bloque —su propio `plan.md` lo llama *"el trabajo real de la Fase
2"* y su *"riesgo principal"*. El primero es una lectura y una escritura, sin pérdida.
Empezamos por Markdown; los bloques nativos quedan como fase futura y opcional.
*Coste asumido:* dentro de Notion la página se ve como un bloque de código, no como texto
formateado.

**D3 · Proveedor de IA: OpenRouter primero, capa abierta.**
Una sola clave da acceso a Claude, GPT, Gemini y demás, y el proxy ya existe en la
referencia. La capa multi-proveedor se conserva íntegra para añadir después Anthropic
directo, GitHub Copilot o NVIDIA sin tocar la aplicación.
**La clave la pone el usuario** en el panel de configuración y se guarda en su navegador;
el servidor sólo la reenvía.

**D4 · Despliegue: Vercel, y en desarrollo las funciones dentro del propio Vite.**
`api/*.ts` se despliega como funciones. En local **no** se levanta un segundo proceso en
otro puerto como hace la referencia: un plugin de Vite (`tools/vite-api-plugin.ts`) carga
esos mismos archivos con `ssrLoadModule` y les añade el `req`/`res` que añade Vercel
—`query`, `body`, `status()`, `json()`, `send()`—. Un solo comando, un solo puerto, cero
dependencias extra, y el handler se escribe una vez.
Cloudflare Pages queda como alternativa (`functions/api/`) si hace falta.

**D5 · La literatura académica se resuelve con APIs abiertas.**
No se replica Consensus, Elicit ni Scite: se construyen sus funciones sobre **OpenAlex**
(libre, sin clave), **Crossref**, **Semantic Scholar** y **Europe PMC**.
Regla dura del producto: **ninguna cita entra en un documento sin resolver contra un DOI
real**. La IA propone, la API confirma, y si no confirma no se inserta. En una herramienta
académica una referencia inventada no es una molestia, es un fallo grave.

---

## 4. Modelo de datos

En el Notion del usuario:

```
Página raíz (la elige el usuario tras el OAuth)      ← espacio de trabajo
├── toggle  "Proyecto A"                            ← PROYECTO (grupo)
│   ├── code  "Idea"                (markdown)      ← PÁGINA
│   ├── code  "Anteproyecto"        (markdown)
│   ├── code  "Trabajo de grado"    (markdown)
│   ├── code  "Marco Estratégico de Ideación"       ← salida de Indagar
│   └── toggle "Instrumentos"                       ← subgrupo
│       ├── code  "Mapa de actores"
│       └── code  "Árbol de causas"
└── toggle  "Proyecto B"
```

`toggle` = grupo (proyecto o carpeta, anidable). `code` = página con Markdown.
El nombre de la página va en el `caption` del bloque; el del proyecto, en el `rich_text`
del toggle. Todo esto ya está implementado en `notionService.ts` y se porta directo.

**Metadatos del proyecto** —naturaleza identificada, fase actual, modo de ideación, tipo
de realidad, trazabilidad— en un bloque `code` JSON oculto dentro del toggle del proyecto:
el patrón `DocumentConfig` de la referencia, con centinela `__3i`. Así el estado
metodológico viaja con el proyecto y no depende del navegador.

**En el navegador:** borrador en IndexedDB (`draftCache`), sesión y preferencias en
`localStorage`, token de Notion y clave de IA en `localStorage`.
*Riesgo declarado:* con un XSS, un token en `localStorage` es robable. Aceptable para una
herramienta personal o de equipo pequeño; si la plataforma pasa a multiusuario real, los
tokens tienen que moverse a sesión de servidor. Anotado en §11.

---

## 5. Mapa de pantallas

Dos vistas, no más.

**A · Inicio.** Lo que ya existe, intacto: intro de origami, frase, y el formulario de
intención. Debajo, una **franja inferior retráctil** —oculta por defecto, se sube con un
tirador— con tres pestañas, tal como se pidió:

```
┌──────────────────────────────────────────────────────┐
│                                                      │
│              ¿Descubramos cuál es tu intención?      │
│        ┌────────────────────────────────┐  🎤  ✈     │
│        └────────────────────────────────┘            │
│                                                      │
├──────────────────────────────────────────────────────┤
│  ▲   Proyectos   ·   Notion   ·   IA                 │  ← franja retráctil
└──────────────────────────────────────────────────────┘
```

- **Proyectos** — el árbol: proyectos, páginas dentro, última abierta, crear y borrar.
- **Notion** — conectar / desconectar, página raíz elegida, estado de sincronía.
- **IA** — proveedor, clave o cuenta, modelo, y la puerta al asistente.

El asistente no espera al espacio de trabajo: en cuanto la intro termina aparece su
tirador, con la forma del papel de enviar la intención, y se puede arrastrar a donde se
quiera. Ahí ya sirve, porque lo primero que hay que interrogar es la intención misma.

**B · Espacio de trabajo.** Se entra al abrir un proyecto o al enviar la intención.

```
┌──────────┬───────────────────────────────────┬────────┐
│  árbol   │            editor                 │  fase  │
│ proyectos│         (tipo Notion)             │  3i    │
│ └ páginas│                                   │        │
│          │                                   │        │
└──────────┴───────────────────────────────────┴────────┘
                              ⌜ asistente IA flotante ⌟
```

Izquierda: árbol de proyectos y páginas. Centro: editor. Derecha: panel de fase (dónde
está el proyecto en 3i, qué falta, qué herramienta sigue). Flotante y arrastrable: el
asistente de IA, que **ve** el documento abierto, la selección y el proyecto.

Ambas vistas en blanco, con `--paper`, `--ink`, `--ink-soft`, `--ink-line`, `--sans`,
`--serif` y las curvas de easing que ya están definidas. Sin sombras de color, sin
degradados, sin acentos nuevos.

---

## 6. El núcleo metodológico

Es la parte que ninguna plataforma existente tiene y por la que esto vale la pena.

### 6.1 Motor de intención (Indagar)

Ocho operaciones, cada una con una salida verificable (§5.7). La IA conduce la
conversación, pero **la salida la firma el autor**: nada avanza hasta que la persona
acepta o corrige la formulación.

| # | Operación | Salida |
|---|---|---|
| 1 | Declarar la intención | Ficha de intención |
| 2 | Delimitar el escenario | Escenario delimitado |
| 3 | Observar | Inventario / matriz descriptiva |
| 4 | Relacionar | Mapa relacional (poder, flujos, tensiones, incentivos) |
| 5 | Interpretar | Síntesis estructural |
| 6 | Declarar la situación de diseño | Actores clave · dinámica · condición estructural · consecuencia observable |
| 7 | **Tipificar la naturaleza** | Tipificación argumentada |
| 8 | Formular el desafío | Desafío estratégico |

Las ocho salidas se consolidan en el **Marco Estratégico de Ideación** (§4.6.1), que es la
página que habilita la fase Idear.

### 6.2 Naturaleza de la situación → herramientas

**Corrección sobre el brief:** en `instruction.md` se dice *"esas situaciones creo que son
como cinco"*. El Documento Maestro define **seis**, más la combinación: **problema,
tensión, oportunidad, deseo latente, fricción sistémica, potencial no activado**
(verificado en nueve pasajes del documento, entre ellos §4.5 y §5.7.7). Trabajamos con
seis.

El Documento Maestro **no incluye** el mapeo naturaleza → herramienta. Lo dice él mismo en
§12.3.2, al reconocer como límite actual que falta *"un toolkit completo con formatos
propios; matrices específicas adaptadas a cada fase"*. **Construir ese mapeo es el aporte
propio de la plataforma**, y es exactamente lo que pidió Edison: que las herramientas no
se repitan ni redunden en una situación donde no le sirven al diseñador.

Semilla del catálogo —cada naturaleza con instrumental distinto y con el rastro que debe
dejar (§9.9.5). A validar con Edison antes de codificarla:

| Naturaleza | Qué es | Instrumental | Rastro exigido |
|---|---|---|---|
| **Problema** | Algo falla o falta | Árbol de causas y efectos · matriz de variables críticas · análisis de causa raíz | Cadena causal explícita |
| **Tensión** | Dos fuerzas se sostienen en oposición | Campo de fuerzas · matriz de intereses en conflicto · esquema de tensiones | El par de fuerzas y su punto de equilibrio |
| **Oportunidad** | Hay una ventana abierta sin tomar | Mapa de ventanas de oportunidad · lectura de tendencias · matriz atractivo–capacidad | Condición temporal + capacidad disponible |
| **Deseo latente** | Existe una aspiración que sus propios actores no han formulado | **Mapa de empatía · etnografía creativa** · escucha de relatos · laddering | Voz textual de los actores |
| **Fricción sistémica** | Dos partes del sistema rozan estructuralmente | Mapa de flujos y cuellos de botella · diagrama de dependencias · bucles causales · análisis institucional | El punto de roce y su bucle |
| **Potencial no activado** | Hay capacidad existente sin uso | Inventario de capacidades subutilizadas · mapa de activos · matriz recurso–uso posible | El recurso y la causa de su no activación |

**Regla de no redundancia, implementada como dato:** cada herramienta declara su `función
metodológica` (las 22 de §9.5.1: declarar, delimitar, observar, relacionar, interpretar,
tipificar, sistematizar…), su `condición interna`, su `nivel` (básico / intermedio /
avanzado) y su `rastro`. El selector devuelve **una** herramienta recomendada por
operación, más alternativas del mismo nivel, y **nunca ofrece dos herramientas con la
misma función metodológica para la misma operación**. Si dos coinciden en función, una de
las dos está mal clasificada: se detecta al cargar el catálogo, no en tiempo de uso.

Orientación —no regla— de naturaleza a modo de ideación (§6.8.5), que la plataforma sugiere
y el autor puede sobrescribir: problema y fricción sistémica → *consecuente*; tensión y
oportunidad → *orientada*; deseo latente y potencial no activado → *libre*.

### 6.3 De las salidas de 3i a los documentos exigidos

La plataforma sabe dónde aterriza cada salida metodológica. Esto es lo que evita que el
estudiante tenga que traducir a mano su trabajo a la estructura del reglamento.

| Salida de 3i | Idea (Art. 13) | Anteproyecto (Art. 16) | Informe final (Art. 21) |
|---|---|---|---|
| Intención validada | Título provisional | Introducción | Introducción |
| Escenario delimitado | — | 1.1 Objeto o tema de estudio | 1.1 |
| Línea de investigación | Línea de investigación | 1.2 | 1.2 |
| Comprensión estructural | — | 1.3 Planteamiento | 1.3 |
| Situación de diseño + naturaleza | Formulación del problema | 1.4 Formulación | 1.4 |
| Desafío estratégico | Objetivos general y específicos | 1.5 Objetivos | 1.5 |
| Argumento de la tipificación | — | 1.6 Justificación | 1.6 |
| Observación + literatura | — | 2.1 Antecedentes | 2.1 |
| Anclaje teórico | — | 2.2 Marco teórico | 2.2 |
| Modo de ideación + secuencia | — | 3. Metodología | 3. Metodología |
| Tipo de realidad + activación | — | 4. Recursos y cronograma | 4. Análisis de resultados |
| Evidencia + lectura crítica | — | — | 4 |
| Iteración + consolidación | — | — | 5 Conclusiones · 6 Recomendaciones |
| Memoria metodológica | — | Anexos | Anexos |

Los esquemas de documento son **datos, no código**: un JSON por estructura. Añadir otra
universidad, o una revista, es añadir un archivo. Se entrega con tres: **CESMAG idea**,
**CESMAG anteproyecto**, **CESMAG informe final**, más un genérico **IMRaD** (introducción,
métodos, resultados, discusión) para artículo científico. Cada esquema declara sus
secciones, si son obligatorias, el límite de páginas y de qué salida de 3i se alimentan.

### 6.4 Lo mejor de las plataformas de referencia

De cada una se toma la función, no el producto, y se ata a 3i:

| Origen | Función que se trae | Dónde vive aquí |
|---|---|---|
| **Jenni AI** | Autocompletado consciente del contexto, parafraseo, sugerencia línea a línea | Editor: continuación en gris tenue con `Tab` para aceptar; el contexto incluye la sección del esquema y las salidas de 3i del proyecto |
| **SciSpace** | Plantillas de estructura + copiloto que resume y explica | Los esquemas JSON de §6.3 + acciones *explicar*, *resumir* sobre la selección |
| **Paperpal** | Redacción académica: gramática, léxico formal, tono | Revisor de sección: señala informalidad, primera persona indebida, imprecisión; propone y el autor decide |
| **Consensus** | Respuestas apoyadas sólo en literatura revisada por pares | Búsqueda sobre OpenAlex / Semantic Scholar, con la afirmación siempre atada a su fuente |
| **Elicit** | Tabla comparativa automática de literatura | Tabla de antecedentes: autor, año, objetivo, método, hallazgo, DOI — insertable en 2.1 |
| **Scite.ai** | Si una afirmación fue apoyada, mencionada o contrastada | Verificador de afirmaciones para la discusión, sobre citas de Semantic Scholar |

Lo que **no** se promete: acceso a texto completo de artículos de pago, ni citas generadas
sin verificación. Ver D5.

---

## 7. Fases

Cada fase deja la aplicación en un estado usable y verificable. No se empieza una sin
cerrar la verificación de la anterior.

### Fase 0 · Cimientos — **hecha**
Vite 8 + TypeScript 7 sobre el proyecto actual, sin tocar la intro. `vercel.json`,
`.env.example`, `.gitignore` con los secretos fuera de git. `styles.css` partido en
`src/styles/tokens.css` y `src/styles/intro.css`, con `app.css` como único punto de
entrada de la cascada. `api/health.ts` como primer endpoint, servido en desarrollo por
`tools/vite-api-plugin.ts`.
Dos cosas cambiaron respecto a lo planeado, ambas a menos piezas: no hay `server.ts` en el
puerto 3001 (ver D4) y el `importmap` de `index.html` se retiró, porque el alias de Vite ya
resuelve `three` al archivo vendorizado y mantener dos mecanismos era engañoso.
*Verificación —ejecutada:*
- `npm run typecheck` y `npm run build` limpios; `dist/` de 590 kB (three es casi todo).
- `src/main.js`, `scene.js`, `choreography.js`, `phrase.js`, `origami.js`, `utils.js` y
  `vendor/` **idénticos byte a byte** a `HEAD` (`git diff --stat` vacío).
- `intro.css` idéntico a `styles.css:46+`; `tokens.css` idéntico a `styles.css:6-44`. Ni un
  valor cambiado.
- `three` se resuelve a `/vendor/three/three.module.min.js` en desarrollo y queda dentro
  del bundle en el build.
- `/`, `/?intro=0` y `/?seek=8.4` responden 200; `/api/health` responde 200 con
  `Cache-Control: no-store` e informa si el OAuth está configurado sin revelar valores;
  `/api/no-existe` y `/api/_types` responden 404 —los helpers con `_` no son invocables.
- *Pendiente de confirmar a ojo:* que los cinco actos se vean igual. El código de la intro
  no cambió, pero eso no lo demuestra una terminal.

### Fase 1 · Franja inferior + conexión Notion
Franja retráctil con las tres pestañas. Flujo OAuth completo: `getOAuthUrl` con `state`
CSRF, `api/notion-oauth.ts`, validación del `state`, limpieza de `code`/`state` de la URL
con `history.replaceState`, `api/notion.ts` como proxy. Selector de página raíz vía
`POST /v1/search`. Conectar, ver el espacio, desconectar.
*Verificación:* recorrer el checklist de `GUIA_NOTION_OAUTH.md`; `/v1/search` devuelve 200
con páginas reales; la conexión sobrevive al recargar; el `client_secret` no aparece en el
bundle (`grep` sobre `dist/`).

Dos cosas que el puerto endurece respecto del original de `reference/`, porque tal cual
estaban no se pueden desplegar:

- **Sin `Access-Control-Allow-Origin: *`, y sin clave de servidor de reserva.** El proxy
  original caía en `NOTION_KEY` cuando la petición no traía token y además aceptaba
  cualquier origen: las dos cosas juntas son un lector público del Notion de quien
  desplegó. Aquí, sin `X-Notion-Token` no hay petición.
- **`endpoint` contra lista blanca.** El original lo concatenaba a la base de la API, y
  `fetch` normaliza los `..` del camino. La lista cubre ya las rutas de las fases
  siguientes (`/search`, `/users/me`, `/pages`, `/pages/{id}`, `/blocks/{id}`,
  `/blocks/{id}/children`) y sólo admite `start_cursor` y `page_size` como parámetros.

El `redirect_uri` sale del entorno y no del cuerpo de la petición: Notion exige que el de
la autorización y el del intercambio sean idénticos, así que el servidor publica el mismo
que va a usar (`GET /api/notion-oauth`) y el navegador no puede inducir otro.

### Fase 2 · Árbol de proyectos y páginas — **escrita**
Puerto de `extractFileTree` y del CRUD: crear proyecto (toggle), crear página (code con
`caption`), renombrar, borrar. Renderizado propio del árbol, blanco y plano. Estado de
sesión: última página abierta.

Dos cosas se decidieron al escribirla. **Los hijos se piden al desplegar**, no al abrir la
pestaña: con veinte proyectos serían veinte peticiones para pintar una lista que igual
nadie toca, y el límite de Notion son unas tres por segundo. Y **el árbol sólo muestra lo
que la plataforma crea** —desplegables con páginas de código markdown dentro—; lo demás
que haya bajo la página raíz se deja en paz, porque esto no es un visor de Notion sino la
estructura de la plataforma.

Mover y anidar quedan para cuando haya más de un nivel real de proyectos; hoy la jerarquía
es proyecto → página y arrastrar no tendría a dónde llevar nada.
*Verificación:* crear un proyecto con tres páginas desde la app y verlas en Notion con la
jerarquía correcta; renombrar y borrar se reflejan en ambos lados; recargar restaura el
árbol y la última página. *Comprobado desde la terminal:* la ruta
`/blocks/{id}/children` del proxy llega de verdad a Notion —responde `unauthorized` a un
token falso— y `/v1/users` la rechaza la lista blanca. El viaje con un Notion real es del
navegador de quien lo usa: el token vive en su `localStorage`.

### Fase 3 · Editor tipo Notion
`@tiptap/core` + StarterKit + `tiptap-markdown`, **un editor por documento** —no uno por
bloque; la referencia documenta que lo contrario rompe Enter, arrastre y espaciado. Menú
"/", menú de burbuja, títulos, listas, citas, código, tablas.
Guardado **explícito**: borrador en IndexedDB en cada cambio, botón *Guardar*, `Ctrl/Cmd+S`,
aviso en `beforeunload` si hay cambios sin guardar. Sin autoguardado por tecla —el límite
de Notion es ~3 req/s.
*Verificación:* escribir, recargar sin guardar y recuperar el borrador **sin una sola
petición a Notion**; guardar y ver el Markdown correcto en Notion; ida y vuelta
markdown → editor → markdown sin pérdida en un documento con todos los tipos de bloque.

### Fase 4 · Voz
Web Speech API (`es-ES`, continuo, sólo resultados finales, reinicio automático en `onend`,
`aborted` ignorado) en dos sitios: el campo de intención del inicio y el editor. Manejo de
permiso denegado y de navegador sin soporte —el botón se oculta, no falla.
*Verificación:* dictar un párrafo en el campo de intención y enviarlo; dictar dentro del
editor con los espacios correctos antes y después de signos de puntuación; probar en un
navegador sin soporte y confirmar que la UI no se rompe.

### Fase 5 · Asistente de IA flotante — **escrita, adelantada**
Se adelantó a las Fases 3 y 4 porque el asistente es lo que hace que la plataforma
pregunte, y preguntar no necesita editor: con la intención y una página leída de Notion ya
tiene de qué. Capa multi-proveedor (D3) + pestaña de configuración: elegir proveedor,
guardar o quitar la clave, conectar la cuenta de GitHub por alta de dispositivo y elegir
modelo del catálogo real del proveedor, con una hora de caché y un botón para releerlo.
Streaming SSE con cancelación.

**Contexto del documento**, que es lo que hace que "vea la información": la intención
declarada, el proyecto y la página abiertos y su contenido recortado a 12 000 caracteres.
Va como mensaje `system` aparte y se reconstruye en cada envío, para que abrir otra página
a media conversación se note en el turno siguiente sin arrastrar la anterior.

El asistente no está anclado a un borde: es un tirador con la forma del papel de enviar la
intención —la misma figura de `src/ui/origami.ts`, para que evolucione en los dos sitios a
la vez— y una ventana, y las dos se arrastran y se quedan donde se las deje. La
**conversación vive fuera de la interfaz** (`core/ai/conversation.ts`), así que mover o
cerrar la ventana no pierde el hilo.

Redimensionar el panel, las sesiones de chat con historial y las acciones sobre la
selección (explicar, mejorar, cuestionar, insertar, reemplazar) esperan a la Fase 3: sin
editor no hay selección sobre la que actuar ni sitio donde insertar.
*Verificación:* preguntar *"¿qué le falta a esta sección?"* y obtener una respuesta que
demuestre haber leído el documento abierto; cortar una respuesta a mitad de stream sin
dejar el panel colgado; error de clave inválida mostrado como mensaje claro, no como
excepción. *Comprobado desde la terminal:* el catálogo de OpenRouter se lee sin clave; un
`provider` inventado y las claves de prototipo (`constructor`, `__proto__`) se rechazan con
400 sin llegar a construir ninguna URL; `ai-chat` responde 405 al método, 400 al cuerpo
vacío y 401 sin credencial; el alta por dispositivo de GitHub devuelve un `user_code` real
con su intervalo y su caducidad. Falta una respuesta viva, que necesita la clave de quien
lo usa.

### Fase 6 · Motor de intención
Aquí la aplicación deja de ser un editor con IA y empieza a ser la plataforma 3i.
Diálogo guiado por las ocho operaciones de §6.1, con una salida firmada por el autor en
cada paso. Prompts distintos por operación, todos bajo la misma regla: **la IA pregunta y
formula, no concluye**. Al cerrar, se genera la página *Marco Estratégico de Ideación* y se
escribe la naturaleza en los metadatos del proyecto.
*Verificación:* partiendo de un párrafo hablado en bruto —del tipo *"quiero hacer algo con
los vendedores del centro pero no sé qué"*— llegar a un Marco Estratégico completo con las
seis piezas de §4.6.1; que la IA haya cuestionado al menos una formulación del autor en el
camino; que el Marco quede guardado en Notion y sea reabrible.

### Fase 7 · Catálogo instrumental y despliegue por situación
El catálogo como JSON con el esquema de §6.2. Validador que rechaza dos herramientas con la
misma función metodológica en la misma condición interna. Selector que, dada la naturaleza,
despliega el instrumental —y sólo ése. Cada herramienta genera su página con su plantilla y
su rastro exigido.
*Verificación:* dos proyectos con naturalezas distintas despliegan conjuntos **distintos y
sin solapamiento**; un deseo latente ofrece mapa de empatía o etnografía creativa y **no**
árbol de causas; el validador falla a propósito al duplicar una función en el JSON.

### Fase 8 · Documentos académicos
Los cuatro esquemas de §6.3 como datos. Generación de cada documento desde las salidas de
3i, con trazabilidad: cada sección sabe de qué salida viene y lo muestra. Indicador de
cobertura —qué secciones están vacías, cuáles incompletas, cuántas páginas van frente al
límite del reglamento. Acciones de IA por sección: cuestionar, aclarar, mejorar el tono
académico (Paperpal), continuar en contexto (Jenni). Exportar a Markdown, DOCX y PDF.
*Verificación:* un proyecto que completó Indagar genera una *Idea* con los cuatro elementos
del Art. 13 sin campos vacíos; el anteproyecto respeta la numeración exacta del Art. 16;
el contador de páginas avisa al pasar de 20; el DOCX abre en Word con la jerarquía de
títulos intacta.

### Fase 9 · Literatura y citas
Búsqueda en OpenAlex y Semantic Scholar desde el editor. Tabla comparativa de antecedentes
al estilo Elicit. Verificador de afirmaciones al estilo Scite para la discusión. Gestor de
referencias por proyecto, citación en APA 7.
**Toda cita pasa por resolución de DOI antes de insertarse** (D5).
*Verificación:* buscar un tema y obtener resultados con DOI resoluble; generar una tabla de
cinco antecedentes con método y hallazgo por fila; intentar insertar una cita inventada a
mano y comprobar que la plataforma la rechaza; la bibliografía final coincide con las citas
del cuerpo.

### Fase 10 · Idear e Implementar
Fase Idear: modo de ideación (libre / orientada / consecuente), su instrumental, y la
**Unidad Proyectual de Implementación** como producto de transferencia (§4.6).
Fase Implementar: tipo de realidad (inmediata / simulada / proyectada), captura de
evidencia, bitácora de iteración, consolidación.
*Verificación:* un proyecto recorre las tres fases de punta a punta y la trazabilidad
permite ir desde una conclusión del informe final hasta la intención inicial que la
originó.

### Fase 11 · Rigor y cierre metodológico
Criterios de calidad por fase como rúbricas (§5.9, §6.12, §7.12). Compuertas de transición
(§8.6, §8.7): no se pasa de fase sin las salidas mínimas. Huella metodológica exportable
como anexo del documento.
*Verificación:* un proyecto incompleto **no** puede avanzar de fase y la plataforma dice
exactamente qué falta; la memoria metodológica se exporta y es legible por un jurado.

---

## 8. Estructura de archivos objetivo

Lo que ya existe va sin marca; lo que todavía es destino de una fase lleva **(Fase n)**.

```
├── index.html                  · shell (se mantiene y se extiende)
├── package.json · vite.config.ts · tsconfig.json · vercel.json
├── .env.example · .gitignore    · secretos fuera de git
├── tools/
│   └── vite-api-plugin.ts      · sirve api/*.ts en desarrollo (D4)
├── api/
│   ├── _types.ts               · firma compartida; los `_` no son endpoints
│   ├── _ai.ts                  · tabla de proveedores, claves, relevo del stream
│   ├── health.ts               · comprobación de vida
│   ├── notion-oauth.ts         · intercambio del código por token
│   ├── notion.ts               · proxy con lista blanca de rutas
│   ├── ai-chat.ts              · conversación en flujo (SSE)
│   ├── ai-models.ts            · catálogo de modelos del proveedor
│   └── github-device.ts        · alta por dispositivo; `client_id` fijo aquí
├── src/
│   ├── app.ts                  · entrada; atiende `intent:submit` y `dock:open`
│   ├── main.js                 · intro Three.js — SIN CAMBIOS
│   ├── core/
│   │   ├── store.ts            · estado con subscribe
│   │   ├── notion/             · oauth · client · types · tree (proyectos y páginas)
│   │   ├── ai/                 · types · config · wire · models · device · chat
│   │   │                         prompt (el sistema 3i) · conversation (el hilo)
│   │   ├── state/              · intent · selection — lo que el asistente ve
│   │   ├── persist/            · session (Notion) · draftCache IndexedDB (Fase 3)
│   │   ├── editor/             · TipTap, markdown, comandos «/» (Fase 3)
│   │   └── voice/              · dictado (Fase 4)
│   ├── methodology/            · (Fases 6-9)
│   │   ├── fases.ts            · las 8 operaciones de Indagar, modos, realidades
│   │   ├── naturalezas.ts      · las 6 + combinación
│   │   ├── catalogo.json       · instrumental con función, nivel, rastro
│   │   ├── validador.ts        · detecta redundancia en el catálogo
│   │   └── esquemas/           · cesmag-idea · anteproyecto · informe · imrad
│   ├── boot/
│   │   └── oauth-callback.ts   · limpia la URL antes de que arranque la intro
│   ├── ui/
│   │   ├── dom.ts              · el(), render(), debounce — sin innerHTML
│   │   ├── origami.ts          · la figura de papel, una sola fuente
│   │   ├── afterIntro.ts       · la señal de «la intro ya terminó»
│   │   ├── drag.ts             · ponlo donde quieras, y que ahí se quede
│   │   ├── dock/               · la franja: proyectos · notion · ia
│   │   ├── assistant/          · el tirador de papel y su ventana de chat
│   │   ├── editor/             · contenedor del editor (Fase 3)
│   │   └── fase/               · panel de estado 3i (Fase 6)
│   └── styles/
│       ├── app.css             · único punto de entrada de la cascada
│       ├── tokens.css          · los tokens originales, sin un valor cambiado
│       ├── intro.css           · el resto del CSS de la intro, intacto
│       ├── dock.css            · la franja, el árbol y los primitivos del panel
│       └── assistant.css       · el tirador y la ventana flotante
├── docs/                       · Documento Maestro 3i, estructura CESMAG
├── reference/                  · sólo consulta; ni se compila ni se vigila
└── plan.md
```

Hoy están hechas las Fases 0, 1, 2 y 5. La intención vive ya en `core/state/intent.ts`,
que era la costura que `main.js` emitía sin que nadie escuchara.
---

## 9. Antes y después

| | Al empezar | Hoy (Fases 0-2 y 5) | Al cerrar la Fase 8 |
|---|---|---|---|
| Intro | Origami, cinco actos | Igual, intacta | Igual, intacta |
| Intención | Campo que emitía un evento sin destinatario | Se recuerda y el asistente la ve | Alimenta el motor de Indagar |
| Almacenamiento | Ninguno | Notion del usuario por OAuth, con árbol de proyectos | Igual, con metadatos de fase |
| Escritura | No hay | La página se lee, todavía no se edita (Fase 3) | Documentos con esquema y cobertura |
| Voz | No hay | Todavía no (Fase 4) | Dictado en la intención y en el editor |
| IA | No hay | Asistente flotante que lee la página abierta y pregunta | Además cuestiona por sección |
| Metodología | Sólo en el PDF | En el sistema del asistente: pregunta, no concluye | Operativa: naturaleza → herramientas → documentos |
| Build | Sin build | Vite + funciones serverless | Igual |

---

## 10. Riesgos

**Riesgo principal: que la IA escriba el proyecto en lugar del autor.** Es el riesgo del
producto, no de la implementación, y contradice la metodología entera. Mitigación
estructural, no cosmética: cada salida de fase exige aceptación explícita del autor; los
prompts de las fases metodológicas están escritos para preguntar y devolver, no para
concluir; la trazabilidad hace visible qué párrafo salió de dónde.

| Riesgo | Mitigación |
|---|---|
| Límite de ~3 req/s de Notion | Guardado explícito, nunca por tecla; lotes de 100 bloques; caché de 5 s; reintento con retroceso |
| Redundancia en el catálogo instrumental | Validador que falla al cargar si dos herramientas comparten función y condición |
| Citas inventadas por la IA | Resolución obligatoria de DOI antes de insertar (D5) |
| Token en `localStorage` frente a XSS | Aceptado para uso personal; migración a sesión de servidor si hay multiusuario |
| Ida y vuelta Markdown con pérdida | Prueba de round-trip con todos los tipos de bloque como criterio de cierre de la Fase 3 |
| Romper la intro al introducir el build | Los invariantes del README son criterio de verificación de la Fase 0 |
| Alcance: la Fase 8 en adelante es grande | Cada fase entrega algo usable; se puede detener en la 8 y ya es un producto |

---

## 11. Fuera de alcance por ahora

Bloques nativos de Notion en lugar de Markdown · multiusuario real con tokens en servidor ·
colaboración en tiempo real · modo sin conexión · PWA instalable · control de versiones de
documentos · exportación a plantillas de revista concretas · aplicación móvil.

Ninguno queda bloqueado por las decisiones de este plan.

---

## 12. Decisiones que necesitan confirmación

1. ~~**D1 — Vite + TypeScript sin React.**~~ **Aplicada en la Fase 0.** Volver a React
   ahora costaría reescribir la configuración, no el código de la intro, que quedó intacto.
2. ~~**D2 — Página como Markdown en bloque `code`.**~~ **Aplicada en la Fase 2.** Un
   proyecto es una lista desplegable (`toggle`) y una página un bloque `code` con
   `language: "markdown"`, el nombre en el `caption` y el documento en el `rich_text`.
   Se eligió así porque el `caption` da un nombre editable sin bloque aparte y porque un
   solo bloque se lee y se guarda de una vez, sin reconstruir un árbol de bloques
   nativos en cada guardado —con el límite de ~3 req/s de Notion, esa diferencia es la
   fase entera. El precio, asumido: dentro de Notion el documento se ve como código.
   Si más adelante importa que se vea formateado, el cambio afecta a `core/notion/tree.ts`
   y a la Fase 3, no al resto.
3. ~~**D3 — OpenRouter como proveedor inicial.**~~ **Aplicada en la Fase 5 y abierta a
   cualquier proveedor.** `openrouter`, `nvidia` y `github` (Copilot) van en una tabla fija
   del servidor, porque los tres hablan el formato de OpenAI y el coste de admitirlos era
   esa tabla, no una capa. La clave la pone cada persona: el navegador la manda en
   `X-Ai-Key` y el servidor sólo recurre a su propio entorno si no viene ninguna. GitHub
   no usa clave sino el alta por dispositivo, con el `client_id` fijado en el servidor
   para que ese camino no pueda usarse contra otra aplicación.

   **Ampliación (2026-09-05): proveedores propios y catálogo sin lista.** La persona puede
   añadir cualquier API con el formato de OpenAI («＋ Otro» en la pestaña IA). Los tres de
   casa siguen ignorando la URL que venga del navegador —su dirección está en la tabla—;
   sólo el destino `custom` la acepta, y pasa por un filtro en el servidor: `https`, sin
   credenciales embebidas, sin parámetros, sin redes internas ni direcciones de metadatos,
   y con `redirect: "manual"` para que un 302 no lleve la petición a una red privada.
   `AI_CUSTOM_PROVIDERS` gobierna el permiso (`local` en desarrollo, `public` desplegado,
   `off` para cerrarlo). Límite anotado en el código: un nombre público que resuelva a una
   IP privada pasa el filtro, porque fijar la IP resuelta no se puede sin un agente propio.
   El catálogo se le pide al proveedor en cada consulta y el registro de models.dev
   (`api/_registry.ts`, seis horas de caché) sólo completa metadatos o hace de respaldo
   cuando la API no tiene `/models`; `source` dice de dónde salió la lista. Ninguna lista
   de modelos vive en el repositorio.
4. ~~**D4 — Vercel** como destino de despliegue.~~ **Aplicada en la Fase 0** (`vercel.json`).
5. **La tabla de naturaleza → herramientas de §6.2** es una propuesta derivada del catálogo
   del Documento Maestro. Conviene revisarla con Edison antes de la Fase 7, porque de ella
   depende la coherencia que se quiere como diferencia.

---

## 13. Estado y siguiente paso

**Fases 0, 1, 2 y 5 escritas** (2026-09-05). La intro sigue byte a byte como estaba.

Lo que hay en pie:

- **La franja** con sus tres pestañas, que se revela cuando la intro termina —una sola
  regla para todo lo que aparece después (`ui/afterIntro.ts`), no un observador por pieza.
- **Notion**: intercambio OAuth del lado del servidor, `state` CSRF, limpieza de la URL,
  proxy con lista blanca y selector de página raíz.
- **Proyectos**: el árbol bajo esa raíz. Crear proyecto y página, renombrar, borrar con
  confirmación en el propio botón, abrir una página —que es lo que el asistente pasa a ver.
- **IA**: tres proveedores de casa más los que la persona añada («＋ Otro»: cualquier API
  con el formato de OpenAI, con la URL filtrada en el servidor), clave por navegador o por
  entorno, alta por dispositivo para GitHub, y catálogo pedido al proveedor —completado por
  el registro de models.dev— con caché de una hora. No hay ninguna lista de modelos escrita.
- **El asistente**: tirador de papel y ventana, los dos arrastrables y persistentes; el
  hilo de la conversación fuera de la interfaz; el sistema 3i escrito para preguntar.

**Lo que no se puede verificar desde una terminal**, y por tanto queda a ojo en el
navegador de quien lo usa:

1. **El árbol contra un Notion real.** El token vive en el `localStorage` del navegador que
   autorizó, así que la vuelta entera —crear un proyecto, tres páginas dentro, verlas en
   Notion con la jerarquía correcta, renombrar, borrar, recargar— sólo la puede hacer
   quien conectó. Si la pestaña Proyectos dice que falta la página raíz, el botón que
   ahora lleva ahí es el camino: sin raíz no hay dónde colgar nada.
2. **Una respuesta viva del asistente.** No hay ninguna clave en el entorno de este
   servidor a propósito. En la pestaña IA: pegar una clave de OpenRouter, o conectar la
   cuenta de GitHub con el código que aparece. Después, abrir una página y preguntarle qué
   le falta: si responde citando lo que hay escrito, el contexto funciona.
3. **Los cinco actos de la intro**, que el código no demuestra por no haber cambiado.

**Siguiente: Fase 3 — editor tipo Notion.** Es la que falta para que la plataforma escriba
y no sólo lea: hoy una página se abre para que el asistente la vea, pero el texto se sigue
editando en Notion. Con el editor dentro llegan también las acciones sobre la selección que
la Fase 5 dejó pendientes —explicar, cuestionar, insertar, reemplazar— y el borrador en
IndexedDB que hace que el guardado explícito no cueste nada perder.
