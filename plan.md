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
| `reference/PFold-master` | La **técnica** del pliegue, no el plugin: bisagras anidadas con `preserve-3d`, giro de 180° sobre el borde y un velo por capa. El plugin clona el contenido dentro de un envoltorio por pliegue, y eso aquí rompería el campo, el foco y el registro (§12 D9). |

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
Cloudflare Pages **también sirve**, con un adaptador y no con once copias:
`functions/api/[[route]].ts` recoge todo `/api/*` con una ruta comodín y llama al
handler que toque. Es lo que la firma propia de `api/_types.ts` hacía posible desde el
principio. Lo que hubo que tocar del código común fueron tres cosas, todas mejores así:
`btoa` en vez de `Buffer` (el único uso de una API de Node que quedaba en `api/`), la
detección de entorno de `basePolicy()` —que preguntaba sólo por `VERCEL` y ahora supone
desplegado cuando no reconoce el sitio, que es el lado seguro— y `public/_routes.json`,
para que el CDN siga sirviendo lo estático.

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
tirador— con el espacio de trabajo:

```
┌──────────────────────────────────────────────────────┐
│                                                      │
│              ¿Descubramos cuál es tu intención?      │
│        ┌────────────────────────────────┐  🎤  ✈     │
│        └────────────────────────────────┘            │
│                                                      │
│    ┌────────────────────────────────────────────┐    │  ← no llega a los lados
│    │ ▲ │ TESIS ×│ FUENTES ×│ +      ◌  ✈  ⚙     │    │  ← la tira: pestañas y bandeja
│    ├────────────────────────────────────────────┤    │
│    │ PROYECTOS / TESIS   NUEVA PÁGINA · CARPETA │    │  ← dónde estás
│    │   ┌────┐  ┌────┐  ┌────┐                   │    │  ← las baldosas
│    │   │    │  │    │  │    │        ⋯          │    │
│    │   └────┘  └────┘  └────┘                   │    │
│    │   Indagar  Idear   Intención               │    │
│    └────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────┘
```

Empezó con tres pestañas de sección —Proyectos · Notion · IA— y se quedó en una sola
pantalla (2026-09-05; §12 D6). **Conectar Notion es el primer paso de esa pantalla**, no un
lugar aparte: sin conexión no hay proyectos que enseñar, y con conexión aquella pestaña no
tenía nada más que decir que el nombre del espacio y la página raíz. Y **el árbol se
recorre en horizontal**: la fila de arriba dice dónde estás —con la misma gramática que
tenían las pestañas: mayúsculas pequeñas y una línea bajo el sitio actual— y debajo va
sólo el contenido de esa carpeta, en baldosas. Se entra en una carpeta pulsándola y se
vuelve pulsando una miga.

La franja **no llega a los lados** y trae el borde, las esquinas y la sombra de la ventana
del asistente: se lee como una pestaña que sube desde abajo. Su tira lleva **pestañas de
navegación** —un recorrido por pestaña, y «Abrir en otra pestaña» en el menú de una
baldosa— y, en el extremo, tres botones que sirven **con la franja plegada**: la cuenta de
Notion (qué espacio, la raíz, desconectar), los **ajustes de IA** —los mismos de la
ventana del asistente, no una copia— y los del sistema, que hoy son el tema claro/oscuro.

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

### Fase 1 · Franja inferior + conexión Notion — **escrita**
Franja retráctil —tres pestañas de sección entonces; hoy un panel separado de los lados con
pestañas de navegación, §12 D6—. Flujo
OAuth completo: `getOAuthUrl` con `state`
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
`caption`), renombrar, borrar. Renderizado propio, blanco y plano —hoy en baldosas, §12 D6—.
Estado de sesión: última página abierta.

Dos cosas se decidieron al escribirla. **Los hijos se piden al entrar** en la carpeta, no
de golpe: con veinte proyectos serían veinte peticiones para pintar una lista que igual
nadie toca, y el límite de Notion son unas tres por segundo. Y **el árbol sólo muestra lo
que la plataforma crea** —desplegables con páginas de código markdown dentro—; lo demás
que haya bajo la página raíz se deja en paz, porque esto no es un visor de Notion sino la
estructura de la plataforma.

Mover quedaría para cuando arrastrar tenga a dónde llevar algo. Anidar sí llegó: una
carpeta puede contener otra, y por eso el árbol se recorre entrando en vez de desplegando
(§12 D6).
*Verificación:* crear un proyecto con tres páginas desde la app y verlas en Notion con la
jerarquía correcta; renombrar y borrar se reflejan en ambos lados; recargar restaura el
árbol y la última página. *Comprobado desde la terminal:* la ruta
`/blocks/{id}/children` del proxy llega de verdad a Notion —responde `unauthorized` a un
token falso— y `/v1/users` la rechaza la lista blanca. El viaje con un Notion real es del
navegador de quien lo usa: el token vive en su `localStorage`.

### Fase 3 · Editor tipo Notion — **escrita, y no como dice aquí (§12 D7)**
Lo de abajo es lo que se planeó; lo que se escribió es Markdown en un `textarea` con una
vista de lectura, sin ninguna de estas tres dependencias, y guardando solo en vez de con
botón. El por qué está en §12 D7, que es la decisión a confirmar o rechazar.

`@tiptap/core` + StarterKit + `tiptap-markdown`, **un editor por documento** —no uno por
bloque; la referencia documenta que lo contrario rompe Enter, arrastre y espaciado. Menú
"/", menú de burbuja, títulos, listas, citas, código, tablas.
Guardado **explícito**: borrador en IndexedDB en cada cambio, botón *Guardar*, `Ctrl/Cmd+S`,
aviso en `beforeunload` si hay cambios sin guardar. Sin autoguardado por tecla —el límite
de Notion es ~3 req/s.
*Verificación:* escribir, recargar sin guardar y recuperar el borrador **sin una sola
petición a Notion**; guardar y ver el Markdown correcto en Notion; ida y vuelta
markdown → editor → markdown sin pérdida en un documento con todos los tipos de bloque.

### Fase 4 · Voz — **escrita**
Web Speech API (`es-ES`, continuo, sólo resultados finales, reinicio automático en `onend`,
`aborted` ignorado) en dos sitios: el campo de intención del inicio y el editor. Manejo de
permiso denegado y de navegador sin soporte —el botón se oculta, no falla.
*Verificación:* dictar un párrafo en el campo de intención y enviarlo; dictar dentro del
editor con los espacios correctos antes y después de signos de puntuación; probar en un
navegador sin soporte y confirmar que la UI no se rompe.

Quedó en **tres** sitios y no en dos —la intención, la hoja y la ventana del asistente: al
asistente también se le habla—, y el idioma se toma del navegador cuando ya es español
(`es-CO` reconoce el habla de aquí mejor que un `es-ES` genérico). El reencendido tras cada
pausa lleva tope: seis en tres segundos y se apaga, que un bucle no es escuchar.

### Fase 5 · Asistente de IA flotante — **escrita, adelantada**
Se adelantó a las Fases 3 y 4 porque el asistente es lo que hace que la plataforma
pregunte, y preguntar no necesita editor: con la intención y una página leída de Notion ya
tiene de qué. Capa multi-proveedor (D3) + ajustes en la propia ventana del asistente
—botón «Ajustes», junto a «Nueva»—: elegir proveedor,
guardar o quitar la clave, conectar la cuenta de GitHub por alta de dispositivo y elegir
modelo del catálogo real del proveedor, con una hora de caché y un botón para releerlo.
Streaming SSE con cancelación.

**Añadir un proveedor cualquiera** es parte de esos ajustes, no una pantalla aparte: nombre,
URL base, clave opcional, y —desplegando «Autenticación y cabeceras»— la cabecera por la que
viaja la clave y hasta ocho cabeceras propias. El modelo se elige del catálogo o **se
escribe**, para que una API sin `/models` siga sirviendo. «Probar conexión» manda una
pregunta mínima de verdad y dice qué contestó. Y un desplegable dice **qué formato habla** esa
API: el de OpenAI o el de Anthropic (`/messages`), que el servidor traduce en los dos
sentidos sin que el cliente lo note. Lo portado de kilocode, y la única cosa que se dejó
fuera —la indirección `{env:VARIABLE}`, que aquí sería una fuga—, está en §12 D3.

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

### Fase 6 · Motor de intención — **empezada**
Aquí la aplicación deja de ser un editor con IA y empieza a ser la plataforma 3i.
Diálogo guiado por las ocho operaciones de §6.1, con una salida firmada por el autor en
cada paso. Prompts distintos por operación, todos bajo la misma regla: **la IA pregunta y
formula, no concluye**. Al cerrar, se genera la página *Marco Estratégico de Ideación* y se
escribe la naturaleza en los metadatos del proyecto.
*Verificación:* partiendo de un párrafo hablado en bruto —del tipo *"quiero hacer algo con
los vendedores del centro pero no sé qué"*— llegar a un Marco Estratégico completo con las
seis piezas de §4.6.1; que la IA haya cuestionado al menos una formulación del autor en el
camino; que el Marco quede guardado en Notion y sea reabrible.

Escrito ya: la intención se manda desde la entrada y **se vuelve un proyecto**. La IA propone
un nombre y las preguntas que hay que responder para ese caso —ninguna viene hecha de
antemano—, se crean la carpeta y los tres documentos (Indagar, Idear, Implementar) bajo la
raíz elegida, y la franja se abre en el proyecto nuevo. Falta el diálogo de las ocho
operaciones y el Marco.

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
│   ├── _anthropic.ts           · traduce OpenAI ↔ Anthropic, sólo en el servidor
│   ├── _registry.ts            · models.dev: metadatos y respaldo, caché de 6 h
│   ├── health.ts               · comprobación de vida
│   ├── notion-oauth.ts         · intercambio del código por token
│   ├── notion.ts               · proxy con lista blanca de rutas
│   ├── ai-chat.ts              · conversación en flujo (SSE)
│   ├── ai-models.ts            · catálogo de modelos del proveedor
│   ├── ai-registry.ts          · el directorio de proveedores compatibles
│   └── github-device.ts        · alta por dispositivo; `client_id` fijo aquí
├── src/
│   ├── app.ts                  · entrada; atiende `intent:submit` y el retorno de OAuth
│   ├── main.js                 · intro Three.js — SIN CAMBIOS
│   ├── core/
│   │   ├── store.ts            · estado con subscribe
│   │   ├── notion/             · oauth · client · types · tree (proyectos y páginas)
│   │   ├── ai/                 · types · config · wire · models · device · chat
│   │   │                         prompt (el sistema 3i) · conversation (el hilo)
│   │   │                         review (la columna de la derecha) · json (respuestas
│   │   │                         con forma) · scaffold (de la intención al proyecto)
│   │   ├── state/              · intent · selection — lo que el asistente ve
│   │   │                         theme — claro · oscuro · automático
│   │   ├── persist/            · session (Notion) · drafts (IndexedDB)
│   │   ├── project/            · create — la carpeta y sus tres documentos
│   │   ├── method/             · structures — las tres formas del Reglamento
│   │   └── voice/              · dictate — el reconocedor del navegador
│   ├── methodology/            · (Fases 7-9)
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
│   │   ├── icons.ts            · los trazos, todos en la rejilla de 24
│   │   ├── afterIntro.ts       · la señal de «la intro ya terminó»
│   │   ├── drag.ts             · ponlo donde quieras, y que ahí se quede
│   │   ├── dock/               · la franja: dock · tabs · tray · workspace
│   │   │                         folders · tree (desde la raíz) · menu · reload
│   │   ├── start/              · de la intención al proyecto: entry · begin · open
│   │   ├── assistant/          · el tirador de papel, su ventana y los ajustes
│   │   │                         fold — el pliego que la despliega (§12 D9)
│   │   ├── writer/             · la hoja: writer · markdown · outline · panel
│   │   │                         save · structure  (§12 D7, no es tiptap)
│   │   ├── voice/              · mic — el mismo botón en los tres sitios
│   │   └── fase/               · panel de estado 3i (Fase 6)
│   └── styles/
│       ├── app.css             · único punto de entrada de la cascada
│       ├── tokens.css          · los originales sin tocar, más el tema oscuro
│       ├── intro.css           · el resto del CSS de la intro, intacto
│       ├── dock.css            · la franja, las pestañas, las baldosas, el panel
│       ├── writer.css          · la hoja, sus columnas y la vista de lectura
│       ├── begin.css           · el arranque de un proyecto
│       ├── voice.css           · el botón de dictar
│       ├── assistant.css       · el tirador y la ventana flotante
│       └── fold.css           · la geometría del papel que se dobla
├── smoke/                      · 169 comprobaciones en un Chrome sin ventana (§12 D8)
│   ├── run.mjs · part.mjs · cdp.mjs · README.md
│   ├── parts/                  · siete, una por lo que hace la plataforma
│   └── doubles/                · Notion, el modelo y la voz, fingidos
├── docs/                       · Documento Maestro 3i, estructura CESMAG
├── reference/                  · sólo consulta; ni se compila ni se vigila
└── plan.md
```

Hoy están hechas las Fases 0 a 5 y el arranque de la 6. La intención vive en
`core/state/intent.ts`, que era la costura que `main.js` emitía sin que nadie escuchara.
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
| Interfaz | Página en blanco | Franja-panel con pestañas, baldosas y tema claro/oscuro | Igual, con editor y panel de fase |
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
   añadir cualquier API con el formato de OpenAI («＋ Otro» en los ajustes del asistente). Los tres de
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

   **Segunda ampliación (2026-09-05): lo que se trajo de kilocode.** Se revisó
   `reference/kilocode-main` —una extensión de VS Code con casi cincuenta proveedores— para
   ver si su forma de añadir APIs era mejor que la de opencode, la referencia anterior. Su
   ventaja no está en el descubrimiento, que es peor que el nuestro, sino en no depender de
   él: en kilocode el modelo **se escribe** y la lista es una ayuda. Cuatro cosas se
   portaron, y todas viven sólo en el destino `custom`:

   - **Cabeceras propias.** Hasta ocho pares `Nombre: valor` por proveedor. Las revisa
     `safeHeaders` en el servidor —nombre de `token` HTTP, valor ASCII imprimible, tope de
     tamaño— y rechaza las que gobiernan la conexión o el cuerpo (`Host`, `Content-Length`,
     `Content-Type`, `Cookie`, `Transfer-Encoding`…). Van al final del bloque de cabeceras a
     propósito: es lo que permite un `Authorization` con otro esquema sin que el endpoint
     tenga que conocer cada pasarela.
   - **La cabecera de la clave se elige.** `Authorization: Bearer` por omisión, `api-key`
     para Azure, `x-api-key` para quien copie el estilo de Anthropic, o cualquier nombre
     válido. Antes, una API que no leyera `Bearer` era inservible aunque estuviera bien
     configurada.
   - **El modelo se puede escribir a mano.** Un proveedor sin `/models`, o cuyo `/models`
     devuelve algo que no sirve, deja de ser un callejón sin salida.
   - **Tiempos de espera.** Quince segundos por destino al pedir el catálogo (kilocode usa
     los mismos quince) y ciento veinte para una respuesta sin flujo. El flujo no lleva
     tope: una respuesta larga no se corta.

   Y una quinta, que es nuestra: **«Probar conexión»**, que manda una pregunta mínima de
   verdad por el mismo camino que una real. Nace del caso que se vivió configurando una
   pasarela: su `GET /v1/models` funcionaba —cuatro modelos en la lista, todo con aspecto de
   estar bien— y su `POST /v1/chat/completions` devolvía 403 desde Cloudflare. Eso se
   descubría al preguntar lo primero; ahora se descubre al configurar.

   **Lo que no se portó, y por qué.** La **indirección `{env:VARIABLE}`** de kilocode, que
   deja escribir el nombre de una variable de entorno en vez de la clave. Allí es inofensiva
   —la extensión corre en el ordenador de quien la usa—; aquí el servidor es compartido, y
   una variable elegida desde el navegador junto a una URL elegida desde el navegador es un
   camino para sacar los secretos del despliegue hacia el destino que quiera quien pregunte.
   **No debe portarse.**

   **Tercera ampliación (2026-09-05): el formato de Anthropic.** Esta misma tabla decía, unas
   líneas más arriba, que `/v1/messages` quedaba fuera porque las cabeceras no arreglan un
   cuerpo distinto. Se escribió el mismo día, en cuanto apareció el caso que lo pedía: una
   pasarela cuya lista de modelos se lee sin problema, cuyo `POST /v1/chat/completions`
   devuelve 403 desde Cloudflare —comprobado con la clave de verdad, sin clave, con `Bearer`,
   con `x-api-key`, sin `User-Agent`, con uno de navegador y con `GET` en lugar de `POST`: 403
   en los siete— y cuyo `POST /v1/messages` contesta 200 con la respuesta entera. Cualquier
   ruta que contenga `chat/completions`, incluso una que no existe en esa aplicación, la para
   su cortafuegos; `/v1/inventada` llega y devuelve un 404 de la API. No era nada nuestro:
   esa pasarela sólo sirve el camino de Anthropic.

   La traducción vive **sólo en el servidor** (`api/_anthropic.ts`), y es la condición que la
   hace aceptable: `src/core/ai/chat.ts` sigue hablando un único formato, el de OpenAI, y no
   sabe que esto existe. Entra un cuerpo de OpenAI y sale uno de OpenAI, aunque por el medio
   la conversación haya ido y vuelto en el otro. Lo que hace la traducción: saca los mensajes
   `system` a un campo aparte, junta los seguidos del mismo papel y descarta un asistente que
   abra la conversación —las tres cosas que Anthropic rechaza con un 400—, pone el
   `max_tokens` que exige (4096, que cabe en todos los modelos), y convierte los eventos del
   flujo en trozos de OpenAI. Los bloques `thinking` se dejan pasar de largo: son el
   razonamiento del modelo y enseñarlos sería dar el borrador por respuesta. La clave viaja en
   `x-api-key` y `anthropic-version` se fija en el servidor.

   En los ajustes es un desplegable en la ficha del proveedor —«Formato OpenAI ·
   /chat/completions» o «Formato Anthropic · /messages»—, fuera del pliegue de autenticación
   porque no es un detalle de la clave: cambia la ruta y la forma del cuerpo. Y una URL
   pegada sin ruta (`https://api.ejemplo.com`, que es como la documentan las APIs que siguen
   a Anthropic) se completa con `/v1`, que es la ruta de todas.
4. ~~**D4 — Vercel** como destino de despliegue.~~ **Aplicada en la Fase 0** (`vercel.json`). Cloudflare Pages añadido después (`functions/api/[[route]].ts`), sin tocar ningún handler.
5. **La tabla de naturaleza → herramientas de §6.2** es una propuesta derivada del catálogo
   del Documento Maestro. Conviene revisarla con Edison antes de la Fase 7, porque de ella
   depende la coherencia que se quiere como diferencia.

6. ~~**D6 — Una sola pantalla en la franja, y las carpetas en horizontal.**~~ **Aplicada el
   2026-09-05.** Las tres pestañas se pidieron al principio y se quitaron al usarlas. La de
   IA se fue a la ventana del asistente: configurar el modelo y hablar con él son el mismo
   acto, y tenerlos en dos sitios obligaba a cerrar uno para arreglar el otro. La de Notion
   se disolvió dentro de Proyectos: conectar es el estado inicial de esa pantalla, y una vez
   conectada sólo quedaba el nombre del espacio y la raíz, que caben en una línea al final
   de la lista. Con una sola pantalla, las pestañas no tenían nada que separar.

   El árbol pasó a recorrerse **entrando** en vez de desplegando. En una franja de 340 px de
   alto, dos niveles abiertos dejaban la lista sin sitio, y la sangría contaba la jerarquía
   dos veces —una con la línea, otra con el margen—. Ahora la fila de arriba dice dónde
   estás y debajo va sólo el contenido de esa carpeta; la fila hereda la gramática de las
   pestañas que sustituye, porque es el mismo gesto —decir qué se mira— y no había razón
   para inventarle otra forma. Lo que esto habilita, y el árbol no: carpetas dentro de
   carpetas, sin que la pantalla se estreche a cada nivel.

   **Ampliación (2026-09-05): la franja es un panel, con pestañas de navegación.** Lo que se
   quitó arriba eran pestañas de **sección** —tres nombres para tres pantallas—, y eso sigue
   quitado. Las que entran ahora son de **sitio**: cada una es un recorrido por las carpetas,
   y «Abrir en otra pestaña» está en el menú de una baldosa. No parten una pantalla en tres;
   abren varias veces la misma, que es lo que pedía tener la tesis en una y las fuentes en
   otra. Cada pestaña guarda su espacio de trabajo montado y vivo —cambiar de pestaña no
   vuelve a pedirle nada a Notion—, y lo que es de la conexión y no del recorrido —sesión,
   raíz, avisos— vive una sola vez y se repinta en todas.

   La franja pasó a leerse como **panel**: separada de los lados de la pantalla, con el borde,
   las esquinas y la sombra de la ventana del asistente —`--r-panel` y `--shadow`, ya
   declarados— y pegada al filo de abajo, que es de donde sube. El árbol pasó a **baldosas**:
   icono y nombre en una rejilla, en vez de filas. El panel recorta lo que se sale de él —es
   lo que le da las esquinas—, así que los menús de las baldosas y las ventanitas de la
   bandeja cuelgan del `<body>`.

   En el extremo de la tira, **tres botones**: la cuenta de Notion, los ajustes de IA y los
   del sistema. Los tres se abren con la franja plegada, y por eso están ahí: la tira es lo
   único que queda a la vista al plegarse, así que se llega a los ajustes sin abrirla. Esto no
   deshace la mitad de D6 que mandó los ajustes de IA a la ventana del asistente: no es una
   segunda copia sino la misma —`mountAiSettings` se suscribe a la configuración, y lo que se
   cambia en un sitio ya está cambiado en el otro—, y no viven *dentro* de la franja sino
   colgados de su borde.

   Y el **tema claro/oscuro/automático**, en los ajustes del sistema. Es una segunda tabla de
   variables en `tokens.css` y nada más: la intro no cambia de color, porque el lienzo es
   transparente y la coreografía está calibrada contra ese blanco. Se aplica en un `<script>`
   clásico de `index.html` —un módulo diferido pintaría el blanco primero y se vería el
   salto— y `core/state/theme.ts` gobierna de ahí en adelante.

7. **D7 — El editor es Markdown en un `textarea`, no tiptap.** **Aplicada en la Fase 3
   (2026-09-05), y se aparta de lo que esta misma tabla planeaba.** La Fase 3 de §7 pedía
   `@tiptap/core` + StarterKit + `tiptap-markdown`. Se escribió sin ninguna de las tres, y
   conviene decirlo en vez de dejar el plan diciendo otra cosa.

   Por qué: la página **ya es Markdown** (D2), así que un editor rico obliga a traducir en
   los dos sentidos en cada apertura y en cada guardado, y toda pérdida de esa ida y vuelta
   es texto de alguien. El brief pedía además «una interfaz muy simple y blanca»; tiptap son
   unas trescientas kilobytes de dependencias en el navegador para un documento que se lee y
   se guarda de una vez. Y lo que la plataforma tiene que hacer bien no es negrita ni
   tablas: es **preguntar sobre lo escrito**, y para eso el texto plano es mejor material.

   Qué hay en su lugar: un `textarea` con el Markdown, una vista de **lectura** que lo pinta
   (`writer/markdown.ts`, sin `innerHTML`), la columna de apartados a la izquierda sacada del
   propio texto, la de revisión a la derecha, las tres estructuras del reglamento
   insertables, y las tres acciones sobre lo marcado. **Sí se cumplió** lo que la Fase 3
   pedía del guardado: borrador en IndexedDB —a los 500 ms, gratis— antes de tocar la red, y
   Notion a los 1400 ms de haber parado de teclear, con `Ctrl+S` y aviso al cerrar. Lo que
   no se cumplió es el guardado **explícito**: guarda solo y lo dice en la barra. Un botón
   «Guardar» en 2026 es trabajo que se pierde cuando alguien no lo pulsa.

   El precio, asumido: no hay menú «/» ni burbuja de formato, y las tablas se escriben a
   mano. Si más adelante hace falta un editor rico, el cambio afecta a `ui/writer/` y no al
   resto: lo que entra y sale de `core/notion/tree.ts` seguiría siendo Markdown.

8. **D8 — El humo vive en el repositorio (`smoke/`).** **Aplicada el 2026-09-05, y es la
   que más conviene confirmar o rechazar.** Las siete partes que comprueban la plataforma se
   escribieron como guiones de usar y tirar en un directorio temporal; ahora están dentro,
   con `npm run smoke`. Son 169 comprobaciones sobre la plataforma de verdad en un Chrome sin
   ventana, y **sin una sola dependencia nueva**: `smoke/cdp.mjs` son sesenta líneas de
   protocolo de depuración sobre el `WebSocket` y el `fetch` que ya trae Node.

   A favor: es lo que hizo posible «que sea sin errores y en bucle», y ya encontró dos fallos
   que ningún `tsc` iba a ver —el micrófono que se apagaba sin decir que era por falta de
   permiso, y la barra de selección que volvía sola un instante después de preguntar—. En
   contra: es código que hay que mantener cuando la interfaz cambie, y sus dobles de Notion y
   del modelo pueden quedarse viejos y dar por bueno algo que ya no lo es. `smoke/README.md`
   dice qué finge cada uno y qué no puede probar ninguno.

9. **D9 — Lo que se pliega es un pliego de papel en blanco, no la ventana.** **Aplicada el
   2026-09-06.** La ventana del asistente aparecía y desaparecía con un `hidden` seco; ahora
   el papel sale volando del asa y se despliega —cuarto de pliego, tres pliegues, 640 ms al
   abrir y 300 al recoger— en `ui/assistant/fold.ts` y `styles/fold.css`.

   De `reference/PFold-master` se toma la técnica y no el código, y ahí está la decisión: el
   plugin **clona el contenido** dentro de un envoltorio por cada pliegue. Hacer eso con la
   ventana viva la rompe —el campo de texto, el foco, la selección, el desplazamiento del
   registro y sus suscripciones—, así que lo que se dobla son **ocho hojas de papel en
   blanco** y la ventana de verdad aparece opaca en el fotograma en que el papel acaba de
   desplegarse. El relevo no se nota porque el último fotograma del pliego es su rectángulo
   exacto, con el mismo `--paper` y las mismas esquinas. Hay tres razones más, todas de
   producción: el texto dentro de un `rotateX/Y` sale borroso en Chromium y repinta el
   registro en cada fotograma; el velo de cada capa necesita una capa encima de cada cara, y
   sobre la ventana viva no hay dónde ponerla; y los quince nodos se construyen y se tiran en
   cada gesto, sin dejar nada montado.

   Y se corrige lo que en PFold se lee como rígido: allí un pliegue espera a que acabe el
   anterior, con retardo fijo y curva lineal. Aquí cada uno arranca al 42 % del anterior y
   todo se declara con **la misma duración**, con el escalonado en los `offset`. Eso vuelve la
   coreografía un solo guion, que se invierte en marcha —`playbackRate` negativo— desde donde
   esté y sin salto: pulsar dos veces seguidas no puede dejar la ventana a medias.

   Lo que no se negocia: el estado —`hidden`, `aria-expanded`, el foco— es **inmediato**, y el
   adorno no retrasa lo que anuncia un lector de pantalla; con movimiento reducido no se
   construye nada; y ni un `filter` ni un `will-change` dentro del pliego, que aplanan el
   contexto 3D o pierden el orden de las caras a media vuelta.

   El precio, asumido: el pliego mide el panel al empezar, así que redimensionar la ventana en
   mitad del gesto lo termina de golpe; y el papel no es la ventana, de modo que si algún día
   el panel dejara de ser un rectángulo de un solo color, el relevo se notaría. Los pliegues
   son datos —`CREASES = ["x", "y", "y"]`—: cambiar esa lista cambia el origami y nada más.

---

## 13. Estado y siguiente paso

**Fases 0 a 5 escritas** (2026-09-05), más la parte de la Fase 6 que convierte una intención
en un proyecto. La intro sigue byte a byte como estaba. La franja se reordenó dos veces ese
mismo día, las dos al usarla (§12 D6): primero una sola pantalla en vez de tres pestañas de
sección, los ajustes de IA dentro de la ventana del asistente y las carpetas recorridas en
horizontal; después la franja pasó a ser un panel separado de los lados, con pestañas de
navegación, las carpetas en baldosas, tres botones en el extremo de la tira —Notion, IA y
sistema— y tema claro/oscuro.

**Las diez cosas que se pidieron ese día, y dónde quedó cada una:**

1. El tema **claro por defecto**: sin nada guardado, `data-theme="light"`.
2. **Fuera el botón «Ajustes»** de la ventana del asistente. Ya estaba en la tira, y tenerlo
   dos veces no lo hacía más fácil de encontrar.
3. **Esquinas rectas** como las de los paneles: `--r-panel: 3px` gobierna las dos cosas, y
   ningún botón se redondea más que un panel.
4. **Iconos de material-symbols-light**, todos en la misma rejilla de `0 0 24 24` y a 36 px,
   que es lo que les da unidad gráfica.
5. **El árbol desde la raíz**, a la izquierda del explorador, como en la referencia: el
   triángulo abre un proyecto y deja ver sus tres documentos sin salir de donde estás.
6. **La intención se vuelve proyecto**: la carpeta con Indagar, Idear e Implementar dentro, y
   las preguntas que la IA propone escritas **para ese caso** —ninguna viene hecha de
   antemano, que es la condición del método—.
7. **Lo mejor de las otras plataformas** donde tenía sentido: la columna de revisión que
   marca faltas, respaldos y flojos sobre el texto abierto, y las tres acciones sobre lo
   marcado —Cuestionar, Explicar, Precisar—. Revisa mientras se escribe; no escribe por nadie.
8. **El espacio para leer las estructuras**: la vista de lectura, y las tres formas del
   Reglamento del CESMAG —Idea, Anteproyecto, Trabajo de Grado— insertables una sola vez,
   sabiendo cuál sigue ya el documento.
9. **La voz**, en los tres sitios donde se escribe: la intención de la entrada, la ventana
   del asistente y la hoja. Cae donde está el cursor, con su espacio, y sin permiso se apaga
   diciendo por qué.
10. **«Sin errores y en bucle hasta que todo quede perfecto»**: de ahí salió el humo, abajo.

Lo que hay en pie:

- **La franja**, que se revela cuando la intro termina —una sola regla para todo lo que
  aparece después (`ui/afterIntro.ts`), no un observador por pieza—. Es un panel: separado
  de los lados, con el borde, las esquinas y la sombra de la ventana del asistente, pegado
  al filo de abajo. Dentro, **pestañas de navegación**: cada una es un recorrido propio por
  las carpetas, con su espacio de trabajo montado y vivo, y «Abrir en otra pestaña» en el
  menú de cada baldosa. En el extremo de la tira, tres botones que funcionan **con la franja
  plegada**: la cuenta de Notion, los ajustes de IA y los del sistema.
- **Notion**: intercambio OAuth del lado del servidor, `state` CSRF, limpieza de la URL,
  proxy con lista blanca y elección de página raíz. Conectar es el estado inicial de esa
  pantalla, y cuando ya está conectada queda en el botón de Notion del extremo de la tira:
  de qué espacio es, cambiar raíz, desconectar.
- **Proyectos**: las carpetas bajo esa raíz, recorridas en horizontal —migas arriba,
  contenido debajo, se entra y se vuelve—. Crear carpeta y página, renombrar, borrar con
  confirmación en el propio botón, abrir un documento —que es lo que el asistente pasa a
  ver—.
- **IA**: tres proveedores de casa más los que la persona añada («＋ Otro»: cualquier API
  con el formato de OpenAI, con la URL filtrada en el servidor, la cabecera de la clave a
  elegir y hasta ocho cabeceras propias revisadas en el servidor), clave por navegador o por
  entorno, alta por dispositivo para GitHub, y catálogo pedido al proveedor —completado por
  el registro de models.dev— con caché de una hora, quince segundos de espera por destino y
  el modelo escrito a mano si esa API no lo publica. Un proveedor propio puede hablar el
  formato de OpenAI o el de Anthropic; la traducción es del servidor. «Probar conexión» manda una pregunta
  mínima de verdad antes de que haga falta. No hay ninguna lista de modelos escrita.
  Todo eso se configura en «Ajustes», que está en dos sitios que son el mismo: la ventana
  del asistente y el botón de papel del extremo de la franja.
- **El asistente**: tirador de papel y ventana, los dos arrastrables y persistentes; el
  hilo de la conversación fuera de la interfaz; el sistema 3i escrito para preguntar. Lo que
  ve es **lo que se acaba de escribir**, no lo último guardado: mientras la hoja está
  delante, el contexto se toma de ella y no se le vuelve a pedir nada a Notion. Y su ventana
  **se pliega**: el papel sale volando del asa y se despliega en tres pliegues, en la técnica
  de `reference/PFold-master` y sin su plugin (§12 D9). El estado va delante del adorno.
- **El documento** (Fase 3, y §12 D7 dice en qué se apartó del plan): el Markdown en un
  `textarea`, la vista de lectura que lo pinta, los apartados a la izquierda sacados del
  propio texto, la revisión a la derecha, las tres estructuras del Reglamento insertables y
  las tres acciones sobre lo marcado. Guarda solo y lo dice: borrador en IndexedDB a los
  500 ms, Notion a los 1400 ms de parar de teclear, `Ctrl+S` y aviso al cerrar.
- **La voz** (Fase 4): el reconocedor del navegador, en español, sólo frases terminadas, con
  reencendido tras cada pausa y tope para que no se vuelva un bucle. El mismo botón en los
  tres sitios donde se escribe, y no se pinta donde el navegador no sepa hacerlo.
- **El arranque de un proyecto** desde la intención (lo primero de la Fase 6): la IA propone
  nombre y preguntas para ese caso, se crean la carpeta y los tres documentos en la raíz, y
  la franja se abre en el proyecto nuevo.
- **El tema** claro, oscuro o automático, en los ajustes del sistema: una segunda tabla de
  variables en `tokens.css`, aplicada antes del primer pintado. La intro no cambia de color.

**El humo: 169 comprobaciones sobre la plataforma de verdad** (`npm run smoke`; qué finge
cada doble y qué no puede probar ninguno está en `smoke/README.md`). Siete partes que abren
la plataforma en un Chrome sin ventana y la manejan como la manejaría una persona; sólo se
finge lo que está fuera —Notion, el modelo y el reconocedor de voz del navegador—. Sin una
dependencia nueva: el cliente del protocolo de depuración son sesenta líneas sobre el
`WebSocket` y el `fetch` que ya trae Node. Que viva en el repositorio es lo que §12 D8 pone
a confirmar.

Y sirvió para lo que se puso: **dos fallos que ningún `tsc` iba a ver**.

- **El micrófono se apagaba sin decir por qué.** Al fingir el reconocedor con fidelidad
  —`abort()` acaba también en `onend`, como en Chrome— salió que el apagón se contaba dos
  veces, y el segundo aviso, que no trae motivo, devolvía el botón a «Dictar»: quien no había
  dado permiso al micrófono se quedaba sin saber por qué había dejado de escuchar.
  `core/voice/dictate.ts` cuenta ahora una sola vez por encendido.
- **La barra de selección volvía sola.** Pedir una de las tres acciones lleva el foco a la
  ventana del asistente, y mover el foco avisa de que la selección cambió; ese aviso volvía a
  mirar lo marcado —que sigue marcado, porque el texto no se toca— y devolvía la barra un
  instante después de haberla quitado. `ui/writer/writer.ts` recuerda ahora para qué se quitó.

**Lo que el humo no prueba**, y por tanto queda a ojo en el navegador de quien lo usa:

1. **Las carpetas contra un Notion real.** El token vive en el `localStorage` del navegador
   que autorizó, así que la vuelta entera —crear una carpeta, tres páginas dentro, entrar,
   volver por las migas, verlas en Notion con la jerarquía correcta, renombrar, borrar,
   recargar— sólo la puede hacer quien conectó, y con ella el camino de OAuth. Sin página
   raíz elegida la pantalla no ofrece otra cosa: sin raíz no hay dónde colgar nada.
2. **Una respuesta viva.** No hay ninguna clave en el entorno de este servidor a propósito.
   En «Ajustes» —la ventana del asistente o el botón de papel de la franja—: pegar una clave
   de OpenRouter, o conectar la cuenta de GitHub con el código que aparece. Después, abrir
   una página y preguntarle qué le falta. El humo prueba que **le llega** lo escrito; que lo
   que contesta sirva, y que las preguntas del arranque valgan para un caso de verdad, sólo
   se ve preguntando.
3. **Un proveedor añadido a mano contra su API real.** El servidor se probó con un eco
   local y contra una pasarela de verdad: las cabeceras llegan como se escribieron, las
   prohibidas se rechazan con 400, el corte de quince segundos salta, y por el camino de
   Anthropic la traducción va y vuelve —`system` aparte, `thinking` descartado, `[DONE]`
   al final— con respuesta viva. Lo que no se puede probar sin la cuenta de alguien es la
   vuelta completa en el navegador: añadir la API, desplegar «Autenticación y cabeceras»,
   elegir `api-key` o `x-api-key` si toca, guardar, ver el catálogo o escribir el modelo, y
   «Probar conexión» hasta que conteste.
4. **El micrófono de verdad.** El humo dobla el reconocedor del navegador: prueba nuestro
   lado —cuándo se enciende, dónde cae lo dicho, cómo se apaga y qué dice al apagarse—, no
   que Chrome entienda el español de aquí. Queda dictar un párrafo hablando, en la entrada y
   en la hoja.
5. **Cómo se ve.** Ni `tsc --noEmit`, ni `npm run build`, ni 169 comprobaciones dicen nada de
   la tipografía, del aire, del tema oscuro con la intro blanca dentro, ni de cómo queda todo
   en una pantalla pequeña. Y los cinco actos de la intro, que el código no demuestra por no
   haber cambiado.

**Siguiente: Fase 6 — motor de intención.** Lo primero de esa fase ya está —una intención se
vuelve un proyecto con sus tres documentos, y las preguntas se escriben para el caso—, y lo
que falta es el diálogo entero: las ocho operaciones de §6.1, cada una con su salida firmada
por el autor, hasta el *Marco Estratégico de Ideación* y la naturaleza escrita en los
metadatos del proyecto. Es lo que hace que la plataforma deje de ser un editor con IA. La
Fase 7 depende de que la tabla de §6.2 pase por Edison antes (§12.5), así que el orden se
mantiene.
