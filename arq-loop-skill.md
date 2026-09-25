# arq-loop · ciclo arquitecto (Codex) ↔ implementador (Claude Code)

`arq-loop` es una skill de Claude Code que reparte el desarrollo entre dos agentes
con roles fijos:

| Rol | Quién | Qué hace |
|---|---|---|
| Arquitecto y validador | Codex (vía el plugin oficial `codex` para Claude Code), en **solo lectura** | Divide tu solicitud en *goals* verificables, revisa el plan cuando cambia algo y certifica cada entrega con un veredicto PASS/FAIL |
| Implementador | Claude Code | Implementa cada goal, corre la verificación, deja evidencia reproducible y commitea |

Claude nunca escribe goals ni veredictos, y Codex nunca edita el repo. Un goal
sólo queda en `pass` cuando Codex lo certifica. Tras dos intentos fallidos, el
ciclo se detiene y te pregunta.

```
/arq-loop plan <solicitud>  →  Codex escribe G-01…G-NN + STATUS.md
/arq-loop run               →  por cada goal: Claude implementa → Codex valida
                               ├─ PASS → siguiente goal
                               ├─ FAIL → intento 2 con las instrucciones del veredicto
                               └─ 2 FAIL → se detiene y te pregunta
/arq-loop revise G-XX <motivo>  →  Codex ajusta el plan (hallazgos, cambios de alcance)
```

---

## 1. Requisitos

- **Claude Code** con soporte de skills (`.claude/skills/`).
- **Plugin de Codex para Claude Code** instalado y configurado: ejecuta `/codex:setup`.
  `scripts/codex.sh` busca `~/.claude/plugins/cache/openai-codex/codex/*/scripts/codex-companion.mjs`.
- **Node.js** 18 o superior (lo usan `split.mjs`, `render.mjs` y el plugin).
- **git**: el ciclo trabaja en una rama `arq/<feature>` y hace un commit por paso.
- Una cuenta de Codex con cuota. Si Codex responde "usage limit", el ciclo se
  detiene: no hay que sustituirlo.

## 2. Instalación

Elige dónde vivirá la skill:

- **Por proyecto** (recomendado; queda versionada con el repo): `<repo>/.claude/skills/arq-loop/`
- **Global** (todos tus proyectos): `~/.claude/skills/arq-loop/`

Extrae los archivos de este documento con un solo comando, que no necesita
dependencias. Cada archivo está marcado con `<!-- arq-loop:file <ruta> -->`:

```bash
# Desde la raíz de tu proyecto; ajusta DEST si la instalas global.
DEST=.claude/skills/arq-loop
awk -v dest="$DEST" '
  /^<!-- arq-loop:file / { path = $3; next }
  path != "" && /^~~~~/ { if (open) { close(out); open = 0; path = "" } else { out = dest "/" path; system("mkdir -p \"$(dirname \"" out "\")\""); open = 1; printf "" > out }; next }
  open { print >> out }
' arq-loop-skill.md
chmod +x "$DEST"/scripts/*.sh
ls -R "$DEST"
```

Resultado:

```
.claude/skills/arq-loop/
├── SKILL.md
├── project.md              ← perfil de TU proyecto (edítalo)
├── prompts/{plan,revise,validate}.md
├── scripts/{codex.sh,split.mjs,render.mjs}
└── templates/{goal,delivery,STATUS}.md
```

> **Instalación global:** las rutas dentro de `SKILL.md` son relativas a la raíz
> del repo (`.claude/skills/arq-loop/...`). Si la instalas en `~/.claude/skills/`,
> reemplaza esas rutas por `~/.claude/skills/arq-loop/...` y crea un `project.md`
> por proyecto en `<repo>/.claude/arq-loop.project.md`, que `SKILL.md` busca
> primero.

## 3. Configura tu proyecto: `project.md`

Es lo único que tienes que editar. Codex lo recibe en cada prompt y Claude lo
usa para verificar. Sé concreto: los criterios de aceptación y la validación
dependen de estos datos.

- **Contexto:** qué es el producto, stack y plataformas.
- **Leer antes de diseñar:** documentos fuente de verdad (spec, decisiones,
  arquitectura, diseño canónico).
- **Restricciones:** plataforma, rendimiento, seguridad y reglas de diseño que
  todo goal debe respetar.
- **Verificación:** comandos **exactos** de tests, build y lint. Claude los
  ejecuta en cada goal y los copia a la evidencia.
- **Specs:** dónde viven (`specs/` si usas spec-kit; si no, `docs/arq/`).

## 4. Uso

| Comando | Qué hace |
|---|---|
| `/arq-loop plan <solicitud>` | Crea la rama `arq/<feature>` y pide a Codex la cola de goals. Commitea `docs(<feature>): plan de goals del arquitecto` |
| `/arq-loop run` | Ejecuta goals hasta terminar la cola, llegar a 2 FAIL o encontrar un bloqueo. La primera vez pregunta el modo: **revisar cada goal** o **autónomo** |
| `/arq-loop next` | Ejecuta un solo goal (implementar → verificar → entregar → validar) |
| `/arq-loop validate [G-XX]` | Pide el veredicto de Codex para la última entrega |
| `/arq-loop revise <G-XX[,G-YY]> <motivo>` | Codex revisa o agrega goals. Úsalo para hallazgos del usuario, fallos que exigen cambiar el plan o cambios de alcance |
| `/arq-loop status` | Muestra `STATUS.md`, las desviaciones abiertas y el siguiente goal ejecutable |

Todo queda en `<spec>/goals/`:

```
goals/
├── STATUS.md                 # tabla de estado, intentos, commits y desviaciones abiertas
├── G-01.md                   # goal (Codex)
├── G-01.delivery-1.md        # entrega (Claude)
├── G-01.verdict-1.md         # veredicto (Codex)
└── evidence/G-01/            # logs y capturas (Claude)
```

### Buenas prácticas aprendidas en uso real

- **Evidencia reproducible.** Cada log empieza con `$ <comando exacto>` y
  `exit=<código>`. Los validadores rechazan logs que sólo resumen.
- **Mutaciones.** Para los criterios críticos, rompe el código a propósito,
  demuestra que la prueba falla, restaura y guarda ese log. Detecta pruebas
  que nunca fallan.
- **Hallazgos humanos → `revise`.** Si alguien prueba el producto y encuentra
  algo, no lo parches fuera de plan: pide a Codex un goal nuevo y haz depender
  de él el goal de aceptación.
- **Aceptación manual.** Declara como "no verificado" lo que nadie probó. Codex
  rechaza criterios marcados como cumplidos sin evidencia, aunque el usuario
  pida cerrar.
- **Límite de goal: 3990 caracteres.** `split.mjs` rechaza goals más largos y
  Codex los divide.
- **Procesos largos.** Codex puede tardar más de 10 minutos. Lanza `codex.sh` en
  segundo plano y espera la notificación; no uses `&` dentro de un comando.

## 5. Publicación

Para un repositorio público, sugerencia de estructura:

```
arq-loop/
├── README.md        ← secciones 1 a 4 de este documento
├── LICENSE          ← p. ej. MIT
└── skill/arq-loop/  ← los archivos de la sección 6
```

---

## 6. Archivos de la skill

<!-- arq-loop:file SKILL.md -->
~~~~markdown
---
name: "arq-loop"
description: "Ciclo arquitecto-implementador: Codex (solo lectura) diseña goals verificables, Claude los implementa y Codex certifica cada entrega contra su diseño. Subcomandos: plan, run, next, validate, revise, status."
argument-hint: "plan <solicitud> | run | next | validate [G-xx] | revise <G-xx> <motivo> | status  [--spec <dir>]"
user-invocable: true
disable-model-invocation: true
---

# arq-loop

## Entrada

```text
$ARGUMENTS
```

Si la entrada no empieza con un subcomando, trátala como `plan <entrada>`. Si
viene vacía, muestra `status` y los subcomandos disponibles.

## Roles (invariantes)

| Rol | Quién | Permisos |
|---|---|---|
| Arquitecto y validador | Codex, vía `scripts/codex.sh` | Solo lectura. Nunca `--write`. |
| Implementador | Claude (tú) | Único que modifica código, tests y archivos del repo |

- Los goals, los veredictos y las revisiones de plan los **escribe Codex**. Tú
  solo los materializas con `scripts/split.mjs`, sin editar su contenido. Si
  crees que un goal está mal, usa `revise`; no lo corrijas tú.
- Tú escribes las entregas (`G-XX.delivery-N.md`), la evidencia y el código.
- Tú actualizas `STATUS.md` (estados, intentos, commits). Es el único archivo
  de Codex que tocas, y solo en esas columnas y en "Desviaciones abiertas".
- Nunca marques un goal como `pass` sin un veredicto de Codex que lo diga.
- **Límite de goal: 3990 caracteres como máximo** por archivo `G-NN.md`,
  frontmatter incluido. `split.mjs` lo hace cumplir. Si un goal lo supera, no
  lo ejecutes: usa `revise` para que Codex lo divida.

Rutas de esta skill (relativas a la raíz del repo): `SKILL_DIR =
.claude/skills/arq-loop`.

## Perfil del proyecto

Antes de cualquier subcomando, lee el perfil del proyecto. El primero que exista
de estos dos:
1. `.claude/arq-loop.project.md`
2. `SKILL_DIR/project.md`

Si ninguno existe, o sigue con los textos de ejemplo, detente y pide al usuario
que lo complete: sin comandos de verificación reales no hay evidencia.
`PROJECT_CONTEXT` = contenido completo del perfil.

## Estructura en el repo

```
<SPEC_DIR>/goals/
├── STATUS.md
├── G-01.md                     # goal (Codex)
├── G-01.delivery-1.md          # entrega intento 1 (Claude)
├── G-01.verdict-1.md           # veredicto intento 1 (Codex)
├── G-01.delivery-2.md          # solo si el intento 1 fue FAIL
└── evidence/G-01/              # logs de tests, capturas (Claude)
```

## Resolver la spec

`SPECS_ROOT` = la raíz de specs del perfil (por defecto `specs`).
1. Si viene `--spec <dir>`, usa ese directorio.
2. Si no, y hay un único `SPECS_ROOT/*/goals/STATUS.md`, usa esa spec.
3. Si no, y solo existe un directorio en `SPECS_ROOT/`, usa ese.
4. Si `SPECS_ROOT` no existe y el subcomando es `plan`, propone un nombre corto
   (`kebab-case`) para la feature y usa `SPECS_ROOT/<nombre>`.
5. En otro caso, pregunta con `AskUserQuestion` listando los directorios.

`SPEC_DIR` = la spec elegida. `GOALS_DIR = SPEC_DIR/goals`. `FEATURE` = nombre
del directorio de la spec.

## Cómo invocar a Codex

1. Renderiza la plantilla con `scripts/render.mjs`, que falla si queda algún
   `{{PLACEHOLDER}}` sin reemplazar:
   ```bash
   node SKILL_DIR/scripts/render.mjs SKILL_DIR/prompts/<nombre>.md \
     $TMPDIR/arq-loop/<nombre>-<goal>-<intento>.md \
     PROJECT_CONTEXT=@<perfil> CLAVE=valor CLAVE=@archivo CLAVE_OPCIONAL=
   ```
   `CLAVE=@archivo` inserta el contenido del archivo. Un placeholder opcional
   sin contenido se pasa vacío (`CLAVE=`).
2. Ejecuta con Bash y `run_in_background: true`, porque Codex puede tardar más
   de 10 minutos:
   ```bash
   SKILL_DIR/scripts/codex.sh <effort> <prompt> $TMPDIR/arq-loop/<nombre>-<goal>-<intento>.out.md
   ```
   Espera la notificación de término; no hagas polling ni uses `&`.
3. Si sale con error (incluido el límite de uso), muéstralo al usuario y
   detente. No reintentes más de una vez ni sustituyas a Codex haciendo tú su
   parte. Ofrece esperar y relanzar, o parar.
4. Materializa: `node SKILL_DIR/scripts/split.mjs <out> <GOALS_DIR>`.
   Si sale con **código 3**, uno o más goals superan el límite y no se escribió
   nada. No recortes el goal tú. Vuelve a invocar a Codex **una vez** con el
   mismo prompt más esta nota al final: "Tu respuesta anterior fue rechazada:
   <salida de split.mjs>. Reescribe esos goals para que cada uno tenga como
   máximo 3990 caracteres; si no cabe, divídelo en dos goals con dependencia."
   Si vuelve a fallar, detente y muéstraselo al usuario.
5. Muestra al usuario el texto de Codex que quedó fuera de los bloques
   (supuestos, preguntas, resúmenes).

Esfuerzo: `plan` y `revise` → `high`. `validate` → `medium` para goals
`estandar` y `high` para goals `arquitectura`.

## Modo de la sesión

La **primera vez en la sesión** que vayas a ejecutar goals (`run` o `next`),
pregunta con `AskUserQuestion`:

- Pregunta: "¿Quieres revisar cada goal antes de ejecutarlo en esta sesión, o
  prefieres que corran de forma autónoma hasta que algo falle 2 veces o se
  complete tu solicitud?"
- Header: `Modo`
- Opciones, en este orden:
  1. `Revisar cada goal (Recomendado)`: te muestro cada goal y espero tu
     aprobación antes de implementarlo.
  2. `Autónomo`: encadena implementar → validar → corregir sin pausas; se
     detiene si un goal falla 2 veces, si algo se bloquea o cuando la cola
     termina.

Recuerda la respuesta el resto de la sesión. Si el usuario pide cambiar de
modo, cámbialo. Si pierdes el contexto y no sabes qué modo eligió, vuelve a
preguntar.

## Subcomandos

### `plan <solicitud>`

1. Verifica que el árbol de git esté limpio (`git status --porcelain`). Si no
   lo está, muestra qué hay sin commitear y detente: el usuario decide si lo
   commitea o lo guarda con stash. No lo hagas tú.
2. Si `GOALS_DIR/STATUS.md` ya existe, pregunta si ampliar la cola existente
   (Codex recibe los goals actuales en `EXISTING_GOALS`) o cancelar.
3. Crea o reutiliza la rama `arq/<FEATURE>` desde el HEAD actual.
4. Renderiza `prompts/plan.md` con:
   `PROJECT_CONTEXT`; `REQUEST` = la solicitud textual; `SPEC_DIR`;
   `GOALS_DIR`; `HEAD`; `GOAL_TEMPLATE=@templates/goal.md`;
   `STATUS_TEMPLATE=@templates/STATUS.md`; `EXISTING_GOALS` = "- Goals
   existentes: GOALS_DIR/ (amplía la cola; no reescribas goals en estado
   pass)" o vacío.
5. Materializa, verifica que STATUS.md liste todos los goals entregados y
   commitea: `docs(<FEATURE>): plan de goals del arquitecto`.
6. Muestra una tabla resumida de la cola y las preguntas abiertas de Codex. Si
   Codex planteó preguntas que cambian el diseño, pide al usuario que las
   responda y usa `revise` antes de ejecutar.

### `next`

Ejecuta un único goal: el primero `pendiente` (o `fail` con menos de 2
intentos) cuyas dependencias estén todas en `pass`.

1. **Modo.** Si aún no hay modo en la sesión, pregunta (ver arriba).
2. **Aprobación**, solo en modo revisar: muestra el goal (objetivo, alcance,
   criterios) y pregunta con `AskUserQuestion`:
   `Ejecutar` · `Pedir cambio al arquitecto` · `Saltar` · `Detener`.
   - Pedir cambio → pide el motivo y ejecuta `revise`; después vuelve a
     mostrar el goal revisado.
   - Saltar → estado `saltado`. Los goals que dependen de él quedan bloqueados.
3. **Preparar.** El árbol debe estar limpio. `BASE = git rev-parse HEAD`.
   Estado `en-curso` y registra el commit base. Comprueba el largo del goal en
   caracteres; si supera 3990, usa `revise`.
4. **Implementar.** Lee el goal y las fuentes que cita. Implementa solo lo que
   está en "Alcance". En el intento 2, atiende primero cada punto de
   "Instrucciones para el siguiente intento" del veredicto anterior.
   Si descubres que el goal es inviable o contradice el código o la spec, no
   improvises: regístralo como desviación y, si bloquea, detente y ejecuta
   `revise`.
5. **Verificar.** Corre los comandos de la sección "Verificación" del perfil.
   Guarda en `GOALS_DIR/evidence/G-XX/` logs **reproducibles**: cada uno empieza
   con `$ <comando exacto>` y `exit=<código>`, y luego el resultado (resumen y
   cola del log, no artefactos de build). Para los criterios críticos, agrega
   una mutación: rompe a propósito el código, demuestra que la prueba falla,
   restaura y registra el log. Revisa tú mismo cada criterio: si alguno no
   cumple y puedes arreglarlo dentro del alcance, arréglalo antes de entregar.
6. **Entregar.** Escribe `G-XX.delivery-N.md` con `templates/delivery.md`.
   Lo que no se pudo verificar se declara "no verificado"; nunca se presenta
   como cumplido. Commitea el código, la entrega y la evidencia:
   `feat(G-XX): <titulo>` (o `fix`, `test`, `refactor` o `docs` según
   corresponda). Estado `entregado`.
7. **Validar.** Ejecuta `validate G-XX`.

### `validate [G-XX]`

Por defecto, el último goal en estado `entregado`.

1. `ATTEMPT` = número de la última entrega. `BASE` = commit base del goal.
   `HEAD` = commit de entrega.
2. Renderiza `prompts/validate.md` con `PROJECT_CONTEXT`, `GOAL_ID`,
   `GOALS_DIR`, `ATTEMPT`, `BASE`, `HEAD`, y:
   - `PREVIOUS_VERDICT` = "- Veredicto anterior: GOALS_DIR/G-XX.verdict-<N-1>.md
     (comprueba que cada hallazgo se atendió)" si `ATTEMPT > 1`; si no, vacío.
   - `ARCH_LENS`, solo para goals `arquitectura`: "6. Además, cuestiona el
     enfoque: qué supuestos asume, qué goals posteriores podría romper y si hay
     un diseño más simple que cumpla el mismo objetivo." Vacío en otro caso.
3. Materializa y lee el `veredicto` del frontmatter.
4. **PASS** → estado `pass` y registra el commit de entrega. Si Codex pidió
   actualizar el registro de decisiones del proyecto, hazlo. Commitea:
   `docs(G-XX): veredicto PASS`. Pasa los hallazgos menores a "Desviaciones
   abiertas".
5. **FAIL** → estado `fail`, suma un intento, commitea
   `docs(G-XX): veredicto FAIL intento N`.
   - Si hay menos de 2 intentos: vuelve a `next` sobre el mismo goal (en modo
     revisar, pregunta primero si reintentar).
   - Si ya van 2 intentos: **detente**. Muestra al usuario los dos veredictos
     resumidos y ofrece tres opciones: `revise` del goal, reintento manual
     guiado o saltarlo.
   - Si el usuario quiere cerrar con criterios pendientes y Codex lo rechazó,
     no lo marques `pass`: ofrece un intento más, dividir con `revise` o parar.
6. Desviaciones rechazadas que implican cambiar el plan → propón `revise`.

### `run`

Repite `next` (que incluye `validate`) hasta que ocurra alguna de estas
condiciones:
- no quedan goals `pendiente` ejecutables → la solicitud está completa;
- un goal llega a 2 intentos fallidos;
- un goal queda `bloqueado` o Codex devuelve un error;
- en modo revisar, el usuario elige `Detener`.

Al terminar, muestra la tabla de STATUS.md y el motivo del término. Si la cola
se completó, sugiere cerrar con `/codex:review --base <commit del plan>` para
una revisión integral de la rama. Solo sugiérelo: ese comando lo lanza el
usuario.

### `revise <G-XX[,G-YY]> <motivo>`

Úsalo también cuando el usuario pruebe el producto y reporte un hallazgo: no lo
parches fuera del plan. Incluye en el motivo la cita del usuario, la causa
verificada y lo ya comprobado.

Renderiza `prompts/revise.md` con `PROJECT_CONTEXT`, `GOALS_DIR`, `GOAL_IDS` y
`REASON`. Si Codex devuelve archivos, materialízalos, muestra su resumen y
commitea `docs(<FEATURE>): revisión del plan (<GOAL_IDS>)`. Un goal revisado en
estado `fail` reinicia sus intentos a 0.

### `status`

Muestra la tabla de `STATUS.md`, las desviaciones abiertas y cuál sería el
siguiente goal ejecutable. No invoca a Codex.

## Reglas

- Un goal = un commit base y una o más entregas. Nunca mezcles dos goals en un
  commit.
- Los commits terminan con la línea de coautoría que indique la sesión.
- No hagas push ni abras PR salvo que el usuario lo pida.
- No registres secretos, credenciales ni identificadores de dispositivos en la
  evidencia.
- Todo lo que muestres al usuario, en su idioma.
~~~~

<!-- arq-loop:file project.md -->
~~~~markdown
# Perfil del proyecto para arq-loop

> Reemplaza cada sección con datos reales de tu proyecto. Codex recibe este
> archivo completo en cada prompt; Claude usa "Verificación" en cada goal.

## Contexto
<Nombre del producto>: <qué es en una o dos líneas>. Stack: <lenguajes,
frameworks, plataformas objetivo>.

## Leer antes de diseñar
- `README.md`
- `<ruta al documento de estado actual del proyecto>`
- `<ruta a decisiones de arquitectura, p. ej. docs/DECISIONS.md>`
- `<ruta al diseño canónico o guía de UI, si aplica>`
- El código existente en `<src/>` y `<tests/>` que toque la solicitud.

## Restricciones
- <Plataforma y versiones mínimas>.
- <Presupuestos de rendimiento, memoria o tamaño>.
- <Reglas de diseño: qué fuente manda cuando hay conflicto>.
- <Seguridad, privacidad, dependencias prohibidas>.

## Verificación
Comandos exactos, ejecutables desde la raíz del repo:
- Tests: `<p. ej. npm test -- --ci>`
- Build: `<p. ej. npm run build>`
- Lint / tipos: `<p. ej. npm run lint && npx tsc --noEmit>`

## Specs
Raíz de specs: `specs` (si no usas spec-kit, por ejemplo `docs/arq`).

## Registro de decisiones
`<ruta, p. ej. docs/DECISIONS.md>`. El validador indica cuándo actualizarlo.
~~~~

<!-- arq-loop:file prompts/plan.md -->
~~~~markdown
Eres el ARQUITECTO de la solución. Otro agente (Claude) implementará; tú
diseñas y luego validarás su trabajo contra lo que escribas aquí.

Trabajas en SOLO LECTURA. No modifiques archivos. Tu salida son archivos
entregados como texto con marcadores; se guardarán tal cual.

## Perfil del proyecto
{{PROJECT_CONTEXT}}

## Solicitud del usuario
{{REQUEST}}

## Feature
Directorio de la spec: {{SPEC_DIR}}
Directorio de goals: {{GOALS_DIR}}
HEAD actual: {{HEAD}}

## Lee antes de diseñar
- Los documentos de "Leer antes de diseñar" del perfil.
- Los documentos de {{SPEC_DIR}} que existan (spec, plan, tareas, contratos).
- El código existente que toque la solicitud.
{{EXISTING_GOALS}}

## Qué debes producir
1. Una cola ordenada de goals que, completados, satisfagan la solicitud.
   - Cada goal es un incremento pequeño, entregable en un commit y verificable
     por sí solo. Prefiere 3 a 8 goals; divide si uno toca demasiados módulos.
   - Marca `nivel: arquitectura` solo si el goal define estructura que otros
     goals asumen (modelos, contratos, persistencia, navegación, APIs).
   - Declara dependencias reales entre goals.
   - Cada criterio de aceptación debe ser verificable: nombra el test existente
     o el test nuevo que debe existir, el snapshot, el comando o la inspección
     concreta. Evita criterios de opinión ("código limpio", "buena UX").
   - Si la solicitud exige verificación manual o en un entorno real, crea un
     goal de aceptación explícito al final, que dependa de los de código.
   - Traza cada goal a requisitos, criterios de éxito, contratos o tareas.
   - No repitas trabajo que el código o la evidencia ya muestran terminado.
   - LÍMITE DURO: cada archivo G-NN.md debe tener como máximo 3990 caracteres
     en total (frontmatter y espacios incluidos). Sobre 4000 caracteres el
     implementador no puede ejecutar el goal. Un goal que supere el límite se
     rechaza entero. Si no cabe, divídelo en dos goals con dependencia; no
     comprimas quitando criterios de aceptación. Remite a la spec o a los
     contratos por su ruta en vez de copiar su contenido.
2. STATUS.md con la tabla de todos los goals en estado `pendiente`.

Usa exactamente la plantilla de goal siguiente para cada goal:

```
{{GOAL_TEMPLATE}}
```

Y esta plantilla para STATUS.md:

```
{{STATUS_TEMPLATE}}
```

## Formato de salida (obligatorio)
Entrega cada archivo así, con rutas relativas al directorio de goals:

<<<FILE G-01.md>>>
...contenido completo...
<<<END>>>

<<<FILE STATUS.md>>>
...contenido completo...
<<<END>>>

Fuera de los bloques, escribe como máximo 10 líneas: supuestos que hiciste y
preguntas abiertas para el usuario. Si la solicitud es ambigua de forma que
cambie el diseño, dilo ahí en vez de adivinar.
~~~~

<!-- arq-loop:file prompts/revise.md -->
~~~~markdown
Eres el ARQUITECTO que diseñó los goals de {{GOALS_DIR}}. Trabajas en SOLO
LECTURA: no modifiques archivos.

## Perfil del proyecto
{{PROJECT_CONTEXT}}

## Motivo de la revisión
{{REASON}}

Goals afectados: {{GOAL_IDS}}

Lee STATUS.md y los goals afectados en {{GOALS_DIR}}, más lo que necesites del
repo. Decide si el motivo justifica cambiar el diseño. Si no lo justifica,
explica por qué en 5 líneas como máximo y no entregues archivos.

Si lo justifica, entrega completos los archivos que cambian (goals revisados,
goals nuevos y STATUS.md actualizado), con el mismo formato de plantilla que ya
usan. No renumeres goals existentes: los nuevos toman el siguiente número libre.
No cambies goals en estado `pass`. Si un goal de aceptación depende del
cambio, actualiza sus dependencias y conserva la evidencia ya obtenida.

LÍMITE DURO: cada archivo G-NN.md debe tener como máximo 3990 caracteres en
total (frontmatter y espacios incluidos). Sobre 4000 el implementador no puede
ejecutarlo y el goal se rechaza. Si no cabe, divídelo en dos goals con
dependencia en vez de quitar criterios de aceptación.

<<<FILE G-XX.md>>>
...contenido completo...
<<<END>>>

Fuera de los bloques, resume en 5 líneas como máximo qué cambió y por qué.
~~~~

<!-- arq-loop:file prompts/validate.md -->
~~~~markdown
Eres el ARQUITECTO que diseñó el goal {{GOAL_ID}}. Otro agente (Claude) lo
implementó. Tu trabajo ahora es certificar si la entrega cumple el goal y el
diseño. Trabajas en SOLO LECTURA: no modifiques archivos.

## Perfil del proyecto
{{PROJECT_CONTEXT}}

## Qué revisar
- Goal: {{GOALS_DIR}}/{{GOAL_ID}}.md
- Entrega: {{GOALS_DIR}}/{{GOAL_ID}}.delivery-{{ATTEMPT}}.md
- Evidencia: {{GOALS_DIR}}/evidence/{{GOAL_ID}}/
- Cambios: `git diff {{BASE}}..{{HEAD}}` y `git log {{BASE}}..{{HEAD}}`
{{PREVIOUS_VERDICT}}

## Cómo validar
1. Para cada criterio de aceptación decide PASS o FAIL con evidencia concreta
   (archivo:línea, test, log). La palabra de la entrega no es evidencia; el
   diff y los logs sí. Si un log no respalda lo que la entrega afirma, es FAIL.
   Un criterio declarado "no verificado" o "parcial" es FAIL, aunque el
   usuario haya pedido cerrar.
2. Verifica el alcance: cambios fuera de "Alcance" o dentro de "Fuera de
   alcance" son hallazgos.
3. Verifica las restricciones del perfil del proyecto.
4. Evalúa cada desviación declarada: aceptada (y si requiere actualizar el
   registro de decisiones del perfil) o rechazada.
5. Busca defectos que rompan el comportamiento aunque los criterios pasen:
   regresiones, estados no manejados, condiciones de carrera, fugas de memoria,
   trabajo costoso en rutas críticas.
{{ARCH_LENS}}

El veredicto global es PASS solo si todos los criterios son PASS y no hay
hallazgos de severidad alta. Los hallazgos menores no bloquean: regístralos.

## Formato de salida (obligatorio)
Entrega un único archivo:

<<<FILE {{GOAL_ID}}.verdict-{{ATTEMPT}}.md>>>
---
goal: {{GOAL_ID}}
intento: {{ATTEMPT}}
veredicto: PASS | FAIL
commit_validado: {{HEAD}}
---

# Veredicto {{GOAL_ID}} · intento {{ATTEMPT}}: PASS | FAIL

## Criterios
| # | Resultado | Evidencia |
|---|---|---|

## Hallazgos
| Severidad | Ubicación | Problema | Qué se espera |
|---|---|---|---|

## Desviaciones
Aceptada/rechazada y por qué. Indica si el registro de decisiones debe
actualizarse.

## Instrucciones para el siguiente intento
Solo si FAIL: lista concreta y priorizada de lo que debe cambiar.
<<<END>>>
~~~~

<!-- arq-loop:file templates/goal.md -->
~~~~markdown
---
id: G-XX
titulo: <verbo + resultado observable>
nivel: estandar            # estandar | arquitectura
depende_de: []             # p. ej. [G-01, G-02]
spec: <SPEC_DIR>/spec.md
trazabilidad: []           # requisitos, criterios de éxito, contratos o tareas que cubre
---
<!-- Límite duro: este archivo completo no puede superar 3990 caracteres. -->

# G-XX · <titulo>

## Objetivo
Qué debe existir o comportarse distinto al terminar, en una o dos frases.

## Contexto
- Por qué ahora y qué decisión o parte del plan lo justifica.
- Fuentes que el implementador debe leer (spec, contratos, diseño).

## Alcance
- Archivos o módulos que se pueden crear o modificar.

## Fuera de alcance
- Lo que NO se toca aunque parezca relacionado.

## Restricciones
- Las del perfil del proyecto que apliquen a este goal.

## Criterios de aceptación
| # | Criterio | Cómo se verifica |
|---|---|---|
| CA-1 | <comportamiento observable> | <test, snapshot, comando o inspección concreta> |

## Notas del arquitecto
Riesgos, alternativas descartadas o pistas de diseño. Opcional.
~~~~

<!-- arq-loop:file templates/delivery.md -->
~~~~markdown
---
goal: G-XX
intento: 1
commit_base: <sha antes de empezar el goal>
commit_entrega: <sha del commit de entrega, o "el commit que introduce este archivo">
---

# Entrega G-XX · intento 1

## Resumen
Qué se implementó y cómo, en pocas líneas.

## Archivos modificados
- `ruta/archivo` — qué cambió.

## Criterio → evidencia
| # | Estado | Evidencia |
|---|---|---|
| CA-1 | cumple / no cumple / parcial / no verificado | test que pasa, ruta del log o captura en `evidence/G-XX/` |

## Tests ejecutados
Comando exacto, resultado (pasaron/fallaron/cuántos) y ruta del log. Cada log
de evidencia empieza con `$ <comando>` y `exit=<código>`. Incluye las
mutaciones que demuestran que las pruebas críticas fallan cuando deben.

## Desviaciones
Diferencias con el goal o con el plan y por qué. "Ninguna" si no las hubo.
Una desviación no es una decisión tomada: la valida el arquitecto.

## Respuesta a hallazgos previos
Solo desde el intento 2: cómo se atendió cada hallazgo del veredicto anterior.
~~~~

<!-- arq-loop:file templates/STATUS.md -->
~~~~markdown
# Estado de goals · <feature>

Solicitud: <lo que pidió el usuario en /arq-loop plan>
Rama: arq/<feature>
Plan generado: <fecha> · commit <sha>

| Goal | Título | Nivel | Depende de | Estado | Intentos | Commit base | Commit entrega |
|---|---|---|---|---|---|---|---|
| G-01 | <titulo> | estandar | — | pendiente | 0 | | |

Estados: pendiente · aprobado-para-ejecutar · en-curso · entregado · pass · fail · bloqueado · saltado

## Desviaciones abiertas
Ninguna.
~~~~

<!-- arq-loop:file scripts/codex.sh -->
~~~~bash
#!/usr/bin/env bash
#
# Invoca a Codex en modo SOLO LECTURA a traves del plugin codex-companion.
#
# Uso:  codex.sh <effort> <prompt-file> <out-file>
#
#   effort       none|minimal|low|medium|high|xhigh
#   prompt-file  prompt ya renderizado (sin placeholders)
#   out-file     donde queda la respuesta final de Codex
#
# Nunca pasa --write: en arq-loop Codex es arquitecto y validador, no editor.
# La ruta del plugin incluye la version, por eso se busca la mas reciente.

set -euo pipefail

if [ "$#" -ne 3 ]; then
    echo "Uso: $0 <effort> <prompt-file> <out-file>" >&2
    exit 64
fi

effort="$1"
prompt="$2"
out="$3"

companion="$(ls -d "$HOME"/.claude/plugins/cache/openai-codex/codex/*/scripts/codex-companion.mjs 2>/dev/null | sort -V | tail -1 || true)"
if [ -z "$companion" ]; then
    echo "No se encontro el plugin de Codex. Ejecuta /codex:setup." >&2
    exit 2
fi

if [ ! -s "$prompt" ]; then
    echo "El prompt $prompt no existe o esta vacio." >&2
    exit 65
fi

if grep -q '{{[A-Z_]*}}' "$prompt"; then
    echo "El prompt aun tiene placeholders sin reemplazar:" >&2
    grep -o '{{[A-Z_]*}}' "$prompt" | sort -u >&2
    exit 65
fi

mkdir -p "$(dirname "$out")"
node "$companion" task --fresh --effort "$effort" --prompt-file "$prompt" > "$out"

if [ ! -s "$out" ]; then
    echo "Codex no devolvio salida." >&2
    exit 1
fi
echo "Respuesta de Codex en $out"
~~~~

<!-- arq-loop:file scripts/render.mjs -->
~~~~javascript
#!/usr/bin/env node
//
// Renderiza una plantilla de prompt reemplazando {{CLAVE}}.
//
// Uso:  node render.mjs <plantilla> <salida> CLAVE=valor CLAVE=@archivo CLAVE=
//
//   CLAVE=valor    reemplaza {{CLAVE}} por el texto literal
//   CLAVE=@ruta    reemplaza {{CLAVE}} por el contenido del archivo
//   CLAVE=         reemplaza {{CLAVE}} por vacío (placeholder opcional)
//
// Sale con código 65 si queda algún {{PLACEHOLDER}} sin valor: un prompt a medio
// renderizar no debe llegar a Codex.

import fs from "node:fs";
import path from "node:path";

const [template, output, ...pairs] = process.argv.slice(2);
if (!template || !output) {
  console.error("Uso: node render.mjs <plantilla> <salida> CLAVE=valor CLAVE=@archivo ...");
  process.exit(64);
}

let text = fs.readFileSync(template, "utf8");
for (const pair of pairs) {
  const eq = pair.indexOf("=");
  if (eq <= 0) {
    console.error(`Par inválido (se espera CLAVE=valor): ${pair}`);
    process.exit(64);
  }
  const key = pair.slice(0, eq);
  let value = pair.slice(eq + 1);
  if (value.startsWith("@")) value = fs.readFileSync(value.slice(1), "utf8").replace(/\n$/, "");
  text = text.split(`{{${key}}}`).join(value);
}

const missing = [...new Set(text.match(/\{\{[A-Z_]+\}\}/g) ?? [])];
if (missing.length > 0) {
  console.error(`Placeholders sin valor: ${missing.join(", ")}`);
  process.exit(65);
}

fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
fs.writeFileSync(output, text);
console.log(output);
~~~~

<!-- arq-loop:file scripts/split.mjs -->
~~~~javascript
#!/usr/bin/env node
//
// Materializa los archivos que Codex devuelve en su respuesta.
//
// Uso:  node split.mjs <codex-output> <goals-dir>
//
// Codex corre en solo lectura, asi que entrega cada archivo entre marcadores:
//
//   <<<FILE G-01.md>>>
//   ...contenido...
//   <<<END>>>
//
// Las rutas son relativas a <goals-dir> y no pueden salir de el. Se copian
// tal cual: Claude no reescribe lo que decide el arquitecto.
//
// Regla dura: un goal (G-NN.md) no puede superar MAX_GOAL_CHARS caracteres,
// porque sobre 4000 Claude no lo ejecuta. Si alguno se pasa no se escribe
// ningun archivo y sale con codigo 3, para que Codex lo reescriba.

import fs from "node:fs";
import path from "node:path";

const [outputFile, goalsDir] = process.argv.slice(2);
if (!outputFile || !goalsDir) {
  console.error("Uso: node split.mjs <codex-output> <goals-dir>");
  process.exit(64);
}

const text = fs.readFileSync(outputFile, "utf8");
const root = path.resolve(goalsDir);
const MAX_GOAL_CHARS = 3990;
const GOAL_NAME = /^G-\d+\.md$/;
const pattern = /^<<<FILE ([^>\n]+)>>>\n([\s\S]*?)^<<<END>>>$/gm;

const files = [];
for (const [, rawName, body] of text.matchAll(pattern)) {
  const name = rawName.trim();
  const target = path.resolve(root, name);
  if (target !== root && !target.startsWith(root + path.sep)) {
    console.error(`Ruta rechazada, sale de ${goalsDir}: ${name}`);
    process.exit(65);
  }
  const content = body.endsWith("\n") ? body : body + "\n";
  files.push({ name, target, content });
}

if (files.length === 0) {
  console.error("La respuesta de Codex no contiene bloques <<<FILE ...>>>.");
  process.exit(1);
}

// Caracteres, no bytes: las tildes cuentan como uno.
const tooLong = files
  .filter(({ name }) => GOAL_NAME.test(path.basename(name)))
  .map(({ name, content }) => ({ name, length: [...content].length }))
  .filter(({ length }) => length > MAX_GOAL_CHARS);

if (tooLong.length > 0) {
  console.error(`Goals sobre el limite de ${MAX_GOAL_CHARS} caracteres; no se escribio ningun archivo:`);
  for (const { name, length } of tooLong) {
    console.error(`  ${name}: ${length} caracteres (sobra ${length - MAX_GOAL_CHARS})`);
  }
  process.exit(3);
}

for (const { target, content } of files) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}
console.log(files.map(({ target }) => path.relative(process.cwd(), target)).join("\n"));
~~~~
