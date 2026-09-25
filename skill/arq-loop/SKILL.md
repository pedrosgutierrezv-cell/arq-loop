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
