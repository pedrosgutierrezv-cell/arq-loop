# arq-loop · ciclo arquitecto (Codex) ↔ implementador (Claude Code)

`arq-loop` es una skill de Claude Code que reparte el desarrollo entre agentes
con roles fijos:

| Rol | Quién | Qué hace |
|---|---|---|
| Arquitecto y validador | Codex (vía el plugin oficial `codex` para Claude Code), en **solo lectura** | Divide tu solicitud en *goals* verificables, revisa el plan cuando cambia algo y certifica cada entrega con un veredicto PASS/FAIL |
| Orquestador | Claude Code (Sonnet), sesión principal `arq-orchestrator` | Lanza a Codex y al implementador, lleva `STATUS.md` y mide el consumo |
| Implementador | Claude Code, subagente `arq-implementer` con contexto limpio por intento | Implementa cada goal, corre la verificación, deja evidencia reproducible y commitea |

Claude nunca escribe goals ni veredictos, y Codex nunca edita el repo. Un goal
solo queda en `pass` cuando Codex lo certifica. Antes de cada validate, un
pre-check local sin tokens revisa lo mecánico.

La documentación completa (cómo funciona, por qué gasta poco, modelos, medición
y solución de problemas) está en el
[README del repositorio](https://github.com/pedrosgutierrezv-cell/arq-loop).
Este archivo trae todo lo necesario para instalarla sin clonar.

## 1. Requisitos

- **Claude Code** con soporte de skills (`.claude/skills/`) y subagentes (`.claude/agents/`).
- **Plugin de Codex para Claude Code** instalado y configurado: ejecuta `/codex:setup`.
- **Node.js** 18 o superior y **git**.
- Una cuenta de Codex con cuota.

## 2. Instalación

Desde la raíz de tu proyecto (o con `DEST=~/.claude/skills/arq-loop` para una
instalación global). Cada archivo está marcado con `<!-- arq-loop:file <ruta> -->`;
los agentes usan la ruta `../../agents/`, así que quedan en `.claude/agents/`:

```bash
DEST=.claude/skills/arq-loop
awk -v dest="$DEST" '
  /^<!-- arq-loop:file / { path = $3; next }
  path != "" && /^~~~~/ { if (open) { close(out); open = 0; path = "" } else { out = dest "/" path; system("mkdir -p \"$(dirname \"" out "\")\""); open = 1; printf "" > out }; next }
  open { print >> out }
' arq-loop-skill.md
chmod +x "$DEST"/scripts/*
```

Después:

1. Completa `.claude/skills/arq-loop/project.md`, o crea
   `.claude/arq-loop.project.md`, que la skill busca primero.
2. Opcional: agrega a `.claude/settings.json` los permisos del ejemplo del
   README (`examples/settings.json`).
3. Abre una sesión nueva con `claude --agent arq-orchestrator` y ejecuta
   `/arq-loop plan <solicitud>`.

> **Instalación global:** las rutas dentro de `SKILL.md` y de los agentes son
> relativas a la raíz del repo (`.claude/skills/arq-loop/...`). Si la instalas
> en `~/.claude/skills/`, reemplázalas por `~/.claude/skills/arq-loop/...`.

## 3. Uso

| Comando | Qué hace |
|---|---|
| `/arq-loop plan <solicitud>` | Pide a Codex la cola de goals y te pide una sola aprobación con el modo (autónomo o supervisado) |
| `/arq-loop run` | Ejecuta goals hasta terminar la cola o llegar a una parada humana |
| `/arq-loop next` | Ejecuta un solo goal |
| `/arq-loop validate [G-XX]` | Pide el veredicto de Codex para la última entrega |
| `/arq-loop revise <G-XX[,G-YY]> <motivo>` | Codex revisa o agrega goals |
| `/arq-loop status` | Estado, desviaciones abiertas y siguiente goal |
| `/arq-loop usage` | Consumo de tokens por goal, intento, flujo y modelo |

---

## 4. Archivos de la skill

<!-- arq-loop:file SKILL.md -->
~~~~markdown
---
name: "arq-loop"
description: "Ciclo arquitecto-implementador: Codex (solo lectura) diseña goals verificables, Claude los implementa y Codex certifica cada entrega contra su diseño. Subcomandos: plan, run, next, validate, revise, status, usage."
argument-hint: "plan <solicitud> | run | next | validate [G-xx] | revise <G-xx> <motivo> | status | usage  [--spec <dir>]"
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

Antes de `plan`, `run`, `next`, `validate` o `revise`, mira en tu system prompt
con qué modelo corres. Si no es un Sonnet, avisa una sola vez: "El
orquestador está corriendo en <modelo>. Para que corra en Sonnet, abre la
sesión con `claude --agent arq-orchestrator`." Luego sigue, salvo que el
usuario prefiera reabrir.

Antes de `run` o `next`, corre `node SKILL_DIR/scripts/sync-agents.mjs --check`.
Si falla, corre el script sin `--check`, commitea la variante regenerada
(`chore(arq-loop): sincronizar variantes del implementador`) y avisa que hay
que abrir una sesión nueva para que Claude Code la cargue.

## Roles (invariantes)

| Rol | Quién | Permisos |
|---|---|---|
| Arquitecto y validador | Codex, vía `scripts/codex.sh` | Solo lectura. Nunca `--write`. |
| Orquestador | Claude (tú), en esta conversación | Lanza a Codex y al implementador, materializa y actualiza STATUS.md. No implementa. |
| Implementador | Claude, subagente `arq-implementer` | Único que modifica código, tests, entregas y evidencia |

- Los goals, los veredictos y las revisiones de plan los **escribe Codex**. Tú
  solo los materializas con `scripts/split.mjs`, sin editar su contenido. Si
  crees que un goal está mal, usa `revise`; no lo corrijas tú.
- El implementador escribe las entregas (`G-XX.delivery-N.md`), la evidencia y
  el código. Tú no los editas; si algo falla, lo corrige un nuevo intento.
- Tú actualizas `STATUS.md` (estados, intentos, commits). Es el único archivo
  de Codex que tocas, y solo en esas columnas, en la línea `Modo:`, en
  "Desviaciones abiertas" y en "Consumo de tokens" (esta última solo mediante
  `scripts/usage.mjs --write`).
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
   SKILL_DIR/scripts/codex.sh <model> <effort> <prompt> $TMPDIR/arq-loop/<nombre>-<goal>-<intento>.out.md
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

### Modelo y esfuerzo por flujo

Pasa siempre el modelo y el effort de esta tabla. No dependas de
`~/.codex/config.toml`: el costo quedaría atado a una configuración global.

| Flujo | Modelo | Effort |
|---|---|---|
| `plan` | `gpt-6-sol` | `high` |
| `revise` | `gpt-6-sol` | `high` |
| `validate` de un goal `arquitectura` | `gpt-6-sol` | `high` |
| `validate` de un goal `estandar` | `gpt-6-luna` | `high` |

Ajusta los nombres a los modelos que ofrece tu cuenta de Codex (los ves en
`~/.codex/models_cache.json`). `gpt-6-luna` en los goals `estandar` es la
opción de menor costo: ≈20 veces más barato que Sol y con mucha más cuota por
ventana de 5 h, a cambio de un validador menos exigente. Si prefieres rigor en
esos goals, usa `gpt-6-sol · medium` en esa fila. Para controlar el riesgo de
Luna:
- Cada veredicto registra `modelo_validador` en su frontmatter, y
  `scripts/usage.mjs` reporta la tasa de FAIL por modelo.
- Si un FAIL de Luna te parece injustificado (un criterio que la evidencia sí
  respalda), no lo discutas ni lo corrijas tú. Muéstraselo al usuario y ofrece
  repetir ese validate con `gpt-6-sol · high`.
- Al cerrar la feature, la sugerencia de `/codex:review` de `run` cubre los
  PASS de Luna.

Claude: el orquestador corre en el modelo de la sesión. Ábrela con
`claude --agent arq-orchestrator` (`.claude/agents/arq-orchestrator.md`), que
fija `sonnet · medium` para toda la sesión. Los agentes usan alias a
propósito, para correr siempre el modelo más reciente de cada familia; por eso
`usage.mjs` registra el ID real de cada llamada y avisa si falta su precio. No uses `model:` en el frontmatter
de este skill: dura solo el turno que lo invoca, cada notificación de un
subagente abre un turno nuevo con el modelo de la sesión, y cada cambio de
modelo parte la caché en dos. El implementador usa `sonnet` u `opus` según el
nivel del goal (ver `next`, paso 4).

## Modo de ejecución

El modo se decide **una vez, al aprobar el plan**, y queda escrito en
`STATUS.md` en la línea `Modo: autónomo · aprobado <fecha>` (o `supervisado`).
`run` y `next` lo leen de ahí y no preguntan, tampoco en una sesión nueva.

- `autónomo`: encadena implementar → pre-check → validar → corregir sin pausas,
  y se detiene solo en las paradas humanas (ver `run`).
- `supervisado`: antes de cada goal muestra objetivo, alcance y criterios, y
  espera la aprobación.
- `run --supervisado` o `run --autonomo` cambian el modo y actualizan la línea.
- Si STATUS.md no tiene la línea (un plan anterior a esta regla), pregunta una
  sola vez con `AskUserQuestion` (header `Modo`, opciones `Autónomo
  (Recomendado)` y `Revisar cada goal`) y escribe la línea.

No uses el plan mode de Claude Code para esto: es de solo lectura e impediría
correr Codex y `split.mjs`. La aprobación es la pregunta del paso 6 de `plan`.

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
6. **Aprobación única del plan.** Muestra la tabla de la cola (goal, título,
   nivel, dependencias), las preguntas abiertas de Codex y los goals que
   necesitan pasos manuales (sección "Pasos manuales" del perfil). Si hay preguntas que cambian el diseño, pide que las
   responda y usa `revise` antes. Luego pregunta una sola vez con
   `AskUserQuestion` (header `Plan`, con la tabla en `preview`):
   1. `Aprobar y ejecutar en autónomo (Recomendado)`
   2. `Aprobar y revisar cada goal`
   3. `Pedir cambios al arquitecto` → pide el motivo y ejecuta `revise`; luego
      vuelve a este paso.
   4. `Solo guardar el plan`
   Con 1 o 2, escribe la línea `Modo:` en STATUS.md, commitea
   `docs(<FEATURE>): plan aprobado (<modo>)` y, salvo con 4, sigue con `run`
   sin volver a preguntar.

### `next`

Ejecuta un único goal: el primero `pendiente` (o `fail` con menos de 2
intentos) cuyas dependencias estén todas en `pass`.

1. **Modo.** Léelo de la línea `Modo:` de STATUS.md (ver "Modo de ejecución").
2. **Aprobación**, solo en modo supervisado: muestra el goal (objetivo, alcance,
   criterios) y pregunta con `AskUserQuestion`:
   `Ejecutar` · `Pedir cambio al arquitecto` · `Saltar` · `Detener`.
   - Pedir cambio → pide el motivo y ejecuta `revise`; después vuelve a
     mostrar el goal revisado.
   - Saltar → estado `saltado`. Los goals que dependen de él quedan bloqueados.
3. **Preparar.** El árbol debe estar limpio. `BASE = git rev-parse HEAD`.
   Estado `en-curso` y registra el commit base. Comprueba el largo del goal en
   caracteres; si supera 3990, usa `revise`.
4. **Implementar en un subagente.** No implementes en esta conversación: cada
   intento corre en `arq-implementer` (`.claude/agents/arq-implementer.md`),
   que parte con contexto limpio, implementa, verifica, entrega, commitea y
   corre el pre-check. Así el contexto del orquestador no crece con el código.
   Lánzalo con la herramienta Agent, eligiendo `subagent_type` y `model` según
   esta tabla. Los agentes usan el alias `sonnet` (siempre el Sonnet más
   reciente); para Sonnet no hace falta pasar `model`:

   | Situación | `subagent_type` | `model` |
   |---|---|---|
   | goal `estandar`, intento 1, número de goal impar (G-01, G-03…) | `arq-implementer-medium` | no lo pases |
   | goal `estandar`, intento 1, número de goal par (G-02, G-04…) | `arq-implementer` | no lo pases |
   | goal `estandar`, intento 2 o más | `arq-implementer` | no lo pases |
   | goal `arquitectura` | `arq-implementer` | `opus` |
   | reintento manual guiado aprobado por el usuario (tras 2 FAIL) | `arq-implementer` | `opus` |
   | un Sonnet devolvió `bloqueado` por dificultad técnica, no por el goal | `arq-implementer` | `opus`, una vez, mismo intento |

   Las dos primeras filas son un A/B de effort (`medium` contra `high`) en los
   primeros intentos, que es donde se compara igual con igual. `usage.mjs`
   reporta llamadas, costo y % de FAIL por variante. Cuando haya al menos 3
   intentos de cada una, muéstrale el resultado al usuario para que elija la
   ganadora. Las variantes se generan con `scripts/sync-agents.mjs` desde
   `arq-implementer.md`: edita solo ese archivo y vuelve a correr el script.

   Antes de lanzarlo, genera su paquete de contexto (rutas, tamaños, imports y
   símbolos de los archivos del goal, mapa del módulo y, desde el intento 2,
   las ubicaciones del veredicto anterior). Así no las descubre de a una
   llamada:
   ```bash
   node SKILL_DIR/scripts/context-pack.mjs --goal G-XX --attempt N --spec SPEC_DIR \
     --out <TMPDIR>/arq-loop/context-G-XX-N.md
   ```
   Mensaje para el subagente (con rutas absolutas ya resueltas):
   ```text
   Implementa G-XX intento N de arq-loop.
   - Contexto: <TMPDIR>/arq-loop/context-G-XX-N.md (léelo primero)
   - SPEC_DIR: <ruta>   GOALS_DIR: <ruta>   BASE: <sha>
   - Nivel: estandar | arquitectura
   - Veredicto anterior: GOALS_DIR/G-XX.verdict-<N-1>.md | ninguno
   - Pre-check: node SKILL_DIR/scripts/precheck.mjs --goal G-XX --attempt N --spec SPEC_DIR --pack <TMPDIR>/arq-loop/pack-G-XX-N.md
   - Notas del usuario: <texto> | ninguna
   ```
   Espera la notificación de término y lee solo su respuesta (máximo 12
   líneas). No abras su transcripción.
5. **Según el estado que devuelva:**
   - `entregado` con pre-check OK → sigue al paso 6.
   - `necesita-usuario` → muestra los pasos al usuario, espera su respuesta y
     reenvíasela al mismo subagente con SendMessage, que conserva su contexto.
     El implementador usa caché de 5 minutos (más barata de escribir), así que
     tras una pausa reanudarlo reescribe su contexto una vez; aun así sale más
     barato que un subagente nuevo que tenga que releer todo. Lanza uno nuevo,
     con la respuesta en "Notas del usuario", solo si el anterior ya no existe
     (se cerró la sesión); retomará desde el árbol.
   - `bloqueado` → regístralo como desviación en STATUS.md. Si es un problema
     del goal, ejecuta `revise`; si es técnico y el modelo era `sonnet`,
     aplica la fila de escalamiento de la tabla; si no, detente y muéstraselo
     al usuario.
6. **Verifica lo que devolvió** sin repetir su trabajo, antes de tocar
   STATUS.md (una edición sin commitear ensucia el árbol): `git log -1
   --format=%H` coincide con `commit_entrega`, el árbol está limpio y el
   paquete existe. Si algo no calza, corre tú el pre-check. Luego marca el
   goal `entregado` en STATUS.md y registra `commit_entrega`; ese cambio se
   commitea junto con el veredicto.
7. Nunca continúes un intento en una conversación vieja (más de una hora sin
   actividad) si el goal quedó a medias: lanza un subagente nuevo. Retomar una
   conversación larga reescribe toda su caché.
8. **Validar.** Ejecuta `validate G-XX`.

### `validate [G-XX]`

Por defecto, el último goal en estado `entregado`.

1. `ATTEMPT` = número de la última entrega. `BASE` = commit base del goal.
   `HEAD` = commit de entrega.
2. Elige `CODEX_MODEL` y `CODEX_EFFORT` según el nivel del goal (tabla "Modelo
   y esfuerzo por flujo"). Renderiza `prompts/validate.md` con
   `PROJECT_CONTEXT`, `GOAL_ID`, `GOALS_DIR`, `ATTEMPT`, `BASE`, `HEAD`,
   `CODEX_MODEL`, `CODEX_EFFORT`, `EVIDENCE_PACK=@$TMPDIR/arq-loop/pack-G-XX-N.md`
   (si no existe o es de otro HEAD, corre tú el pre-check con el comando del
   paso 4 de `next`) y:
   - `PREVIOUS_VERDICT` = "- Veredicto anterior: GOALS_DIR/G-XX.verdict-<N-1>.md
     (comprueba que cada hallazgo se atendió)" si `ATTEMPT > 1`; si no, vacío.
   - `ARCH_LENS`, solo para goals `arquitectura`: "6. Además, cuestiona el
     enfoque: qué supuestos asume, qué goals posteriores podría romper y si hay
     un diseño más simple que cumpla el mismo objetivo." Vacío en otro caso.
3. Materializa y lee el `veredicto` del frontmatter. Actualiza el consumo
   antes de commitear, para que el commit del veredicto lo incluya:
   `node SKILL_DIR/scripts/usage.mjs --spec SPEC_DIR --write`
   (imprime una sola línea; no leas el bloque generado).
4. **PASS** → estado `pass` y registra el commit de entrega. Si Codex pidió
   actualizar el registro de decisiones del proyecto, hazlo. Commitea:
   `docs(G-XX): veredicto PASS`. Pasa los hallazgos menores a "Desviaciones
   abiertas".
5. **FAIL** → estado `fail`, suma un intento, commitea
   `docs(G-XX): veredicto FAIL intento N`.
   - Si hay menos de 2 intentos: vuelve a `next` sobre el mismo goal (en modo
     supervisado, pregunta primero si reintentar).
   - Si ya van 2 intentos, en modo **autónomo** y en un goal `estandar`: si el
     último veredicto no tiene hallazgos de severidad alta y quedan como
     máximo 2 criterios en FAIL, lanza **un** reintento guiado con `opus`
     (tabla del paso 4 de `next`) sin preguntar, e informa que lo hiciste. Si
     ese intento también falla, o no se cumplen esas condiciones, detente.
   - En cualquier otro caso con 2 intentos: **detente**. Muestra al usuario los
     dos veredictos resumidos y ofrece tres opciones: `revise` del goal,
     reintento manual guiado o saltarlo.
   - Si el usuario quiere cerrar con criterios pendientes y Codex lo rechazó,
     no lo marques `pass`: ofrece un intento más, dividir con `revise` o parar.
6. Desviaciones rechazadas que implican cambiar el plan → propón `revise`.

### `run`

**Pasos manuales, una sola vez.** Antes del primer goal, busca en los goals
pendientes cuáles dependen de un recurso de la sección "Pasos manuales" del
perfil (un dispositivo físico, una cuenta de prueba, un servicio externo). Si
hay alguno, dile al usuario en un solo mensaje qué goals son y qué necesita
dejar listo, y corre el comando de comprobación que indique el perfil. Si el
recurso no está disponible, sigue con los goals que no lo necesitan y deja los
otros para el final de la corrida, respetando las dependencias. No vuelvas a
preguntar por eso salvo que un implementador devuelva `necesita-usuario`.

Repite `next` (que incluye `validate`) hasta que ocurra una **parada humana**:
- no quedan goals `pendiente` ejecutables → la solicitud está completa;
- un goal no puede seguir tras sus intentos y la escalada automática (ver
  `validate`, paso 5);
- un goal de `arquitectura` falla por segunda vez;
- un goal queda `bloqueado`, Codex devuelve un error o se alcanza el límite
  de uso;
- un implementador devuelve `necesita-usuario` (un paso manual o una decisión
  del usuario);
- el siguiente paso sería un gate de producción del perfil (p. ej. un deploy o
  una migración en producción), que nunca ejecuta arq-loop;
- en modo supervisado, el usuario elige `Detener`.
Fuera de estas paradas no preguntes nada: informa el avance en una línea por
goal (goal, veredicto, costo según `usage.mjs`).

Al terminar, muestra la tabla de STATUS.md, la línea de total de "Consumo de
tokens" y el motivo del término. Si la cola
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

### `usage`

Ejecuta `node SKILL_DIR/scripts/usage.mjs --spec SPEC_DIR` y muestra su salida
tal cual: tokens y USD equivalentes por ronda (goal e intento), por goal y por
flujo y modelo, de Claude y de Codex, más el uso de la ventana de 5 h de Codex.
No invoca a Codex ni modifica archivos. Si el usuario pide guardarlo, agrega
`--write` y commitea `docs(<FEATURE>): consumo de tokens`.

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
  (`context-pack.mjs` arma el mapa del módulo con las rutas de esta sección
  que terminan en `/`.)

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

## Herramientas
Opcional. Scripts del proyecto que resuelven en una sola llamada lo que el
implementador haría en varias. Cada llamada relee todo su contexto, así que
esto baja el costo. Ejemplos:
- `scripts/test.sh <filtro>`: corre tests con el entorno listo e imprime
  `$ comando`, `exit=`, un resumen y la cola del log.
- `scripts/api.sh <símbolo>`: firmas públicas de una dependencia.

## Pasos manuales
Opcional. Lo que requiere a una persona: un dispositivo físico, una cuenta de
prueba, un servicio externo. `run` avisa una sola vez al inicio qué goals lo
necesitan y corre el comando de comprobación. Lo que dependa de esto se
entrega como "pendiente de prueba manual".

| Recurso | Qué debe dejar listo el usuario | Comprobación |
|---|---|---|
| `<dispositivo>` | `<conectado y con depuración activa>` | `<comando que lo verifica>` |

## Pre-check
Reglas para `scripts/precheck.mjs`: si el diff del goal toca una ruta, se
re-ejecuta su comando antes de llamar a Codex. Una fila por regla; el glob y
el comando van entre comillas invertidas.

| Si el diff toca | Comando |
|---|---|
| `src/**` | `<p. ej. npm test -- --ci>` |

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

## Evidencia precalculada
{{EVIDENCE_PACK}}

## Cómo validar
0. Presupuesto de exploración. La evidencia precalculada viene de comandos
   deterministas que ya corrieron sobre este rango: no los repitas. Vuelve a
   ejecutar un comando solo si sospechas que la evidencia no corresponde al
   código, y como máximo 3 en total. Lee los archivos del diff y las fuentes
   que cita el goal; no recorras el resto del repo. Si hay una sección
   "Revalidación incremental", da por buenos los criterios que pasaron en el
   intento anterior, salvo que los archivos cambiados desde entonces toquen su
   código o su evidencia. Concentra la revisión en los criterios que fallaron
   y en los hallazgos del veredicto anterior.
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
modelo_validador: {{CODEX_MODEL}} · {{CODEX_EFFORT}}
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

<!-- arq-loop:file scripts/codex.sh -->
~~~~bash
#!/usr/bin/env bash
#
# Invoca a Codex en modo SOLO LECTURA a traves del plugin codex-companion.
#
# Uso:  codex.sh <model> <effort> <prompt-file> <out-file>
#
#   model        modelo de Codex, p. ej. gpt-6-sol o gpt-6-luna (ver SKILL.md,
#                "Modelo y esfuerzo por flujo")
#   effort       none|minimal|low|medium|high|xhigh
#   prompt-file  prompt ya renderizado (sin placeholders)
#   out-file     donde queda la respuesta final de Codex
#
# El modelo es obligatorio: sin el, Codex usaria el de ~/.codex/config.toml y
# el costo dependeria de una configuracion global que el skill no controla.
# Nunca pasa --write: en arq-loop Codex es arquitecto y validador, no editor.
# La ruta del plugin incluye la version, por eso se busca la mas reciente.

set -euo pipefail

efforts="none minimal low medium high xhigh"

if [ "$#" -eq 3 ] && [[ " $efforts " == *" $1 "* ]]; then
    echo "Uso antiguo sin modelo. Ahora es: $0 <model> <effort> <prompt-file> <out-file>" >&2
    exit 64
fi
if [ "$#" -ne 4 ]; then
    echo "Uso: $0 <model> <effort> <prompt-file> <out-file>" >&2
    exit 64
fi

model="$1"
effort="$2"
prompt="$3"
out="$4"

if [[ " $efforts " != *" $effort "* ]]; then
    echo "Effort no valido: $effort. Usa uno de: $efforts" >&2
    exit 64
fi

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
node "$companion" task --fresh --model "$model" --effort "$effort" --prompt-file "$prompt" > "$out"

if [ ! -s "$out" ]; then
    echo "Codex no devolvio salida." >&2
    exit 1
fi
echo "Respuesta de Codex ($model · $effort) en $out"
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
// Las rutas son relativas a <goals-dir> y no pueden salir de el. El contenido
// se copia tal cual (Claude no reescribe lo que decide el arquitecto), salvo
// dos normalizaciones de formato: se quitan los espacios al final de cada
// linea y el archivo termina en un unico salto de linea. Sin ellas,
// `git diff --check` falla sobre el rango del goal por algo que no cambia el
// contenido (Codex suele dejar una línea en blanco al final).
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
  const content = body.replace(/[ \t]+$/gm, "").replace(/\s*$/, "") + "\n";
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

<!-- arq-loop:file scripts/precheck.mjs -->
~~~~javascript
#!/usr/bin/env node
//
// Pre-check determinista de una entrega, antes de gastar un validate de Codex.
//
// Uso:  node precheck.mjs --goal G-03 --attempt 2 [--spec <dir>] [--base <sha>]
//                         [--pack <archivo.md>] [--no-commands] [--allow-pending]
//
//   --goal / --attempt  goal e intento de la entrega (G-XX.delivery-N.md)
//   --spec              directorio de la spec; por defecto, el unico con goals/STATUS.md
//   --base              commit base; por defecto, commit_base de la entrega o STATUS.md
//   --pack              escribe el paquete de evidencia para el prompt de validate
//   --no-commands       no re-ejecuta los comandos del perfil (reintento tras
//                       corregir solo docs o evidencia)
//   --allow-pending     un criterio "no verificado" o "pendiente" es aviso, no falla
//                       (solo cuando el usuario ya acepto dejarlo pendiente)
//
// Sale con 0 si todo pasa y con 1 si algo falla. No escribe en el repo: los logs
// de los comandos van al paquete, asi el arbol sigue limpio y HEAD no cambia.
//
// Controles:
//   C1 arbol limpio            C5 archivos de Codex intactos
//   C2 entrega coherente       C6 logs reproducibles ($ comando + exit=)
//   C3 criterios cubiertos     C7 referencias de la entrega existen
//   C4 git diff --check rango  C8 datos sensibles en lineas agregadas
//   C9 comandos del perfil segun las rutas del diff (seccion "Pre-check")

import fs from "node:fs";
import path from "node:path";
import { execSync, spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const opt = { goal: null, attempt: null, spec: null, base: null, pack: null, commands: true, allowPending: false };
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--goal") opt.goal = args[++i];
  else if (a === "--attempt") opt.attempt = Number(args[++i]);
  else if (a === "--spec") opt.spec = args[++i];
  else if (a === "--base") opt.base = args[++i];
  else if (a === "--pack") opt.pack = args[++i];
  else if (a === "--no-commands") opt.commands = false;
  else if (a === "--allow-pending") opt.allowPending = true;
  else {
    console.error(`Argumento desconocido: ${a}`);
    process.exit(64);
  }
}
if (!/^G-\d+$/.test(opt.goal || "") || !(opt.attempt >= 1)) {
  console.error("Uso: node precheck.mjs --goal G-XX --attempt N [--spec <dir>] [--pack <archivo>]");
  process.exit(64);
}

// Raiz de specs: la linea "Raíz de specs: `<dir>`" del perfil, o "specs".
function specsRoot(repoRoot) {
  for (const p of [path.join(repoRoot, ".claude", "arq-loop.project.md"), path.join(repoRoot, ".claude", "skills", "arq-loop", "project.md")]) {
    if (!fs.existsSync(p)) continue;
    const m = fs.readFileSync(p, "utf8").match(/Ra[ií]z de specs:\s*`([^`<>]+)`/);
    if (m) return m[1].replace(/\/+$/, "");
  }
  return "specs";
}

const sh = (cmd) => execSync(cmd, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).trim();
const repoRoot = sh("git rev-parse --show-toplevel");
process.chdir(repoRoot);

// ---------- rutas ----------
function resolveSpec() {
  if (opt.spec) return path.resolve(opt.spec);
  const root = path.join(repoRoot, specsRoot(repoRoot));
  const found = fs.existsSync(root)
    ? fs.readdirSync(root).filter((d) => fs.existsSync(path.join(root, d, "goals", "STATUS.md")))
    : [];
  if (found.length !== 1) {
    console.error(`No pude resolver la spec (${found.length} candidatas). Usa --spec <dir>.`);
    process.exit(65);
  }
  return path.join(root, found[0]);
}
const specDir = resolveSpec();
const goalsDir = path.join(specDir, "goals");
const rel = (p) => path.relative(repoRoot, p);
const G = opt.goal;
const N = opt.attempt;
const goalFile = path.join(goalsDir, `${G}.md`);
const deliveryFile = path.join(goalsDir, `${G}.delivery-${N}.md`);
const evidenceDir = path.join(goalsDir, "evidence", G);
const read = (f) => (fs.existsSync(f) ? fs.readFileSync(f, "utf8") : null);
const frontmatter = (text) => {
  const m = (text || "").match(/^---\n([\s\S]*?)\n---/);
  const out = {};
  if (m) for (const line of m[1].split("\n")) {
    const kv = line.match(/^([\w-]+):\s*(.*)$/);
    if (kv) out[kv[1]] = kv[2].trim();
  }
  return out;
};

const goalText = read(goalFile);
if (!goalText) {
  console.error(`No existe ${rel(goalFile)}.`);
  process.exit(65);
}
const deliveryText = read(deliveryFile);
const deliveryFm = frontmatter(deliveryText);

function baseFromStatus() {
  const status = read(path.join(goalsDir, "STATUS.md")) || "";
  const row = status.split("\n").find((l) => l.startsWith(`| ${G} |`));
  if (!row) return null;
  const cells = row.split("|").map((c) => c.trim());
  // | Goal | Titulo | Nivel | Depende | Estado | Intentos | Commit base | Commit entrega |
  return cells[7] || null;
}
const BASE = opt.base || (/^[0-9a-f]{7,40}$/.test(deliveryFm.commit_base || "") ? deliveryFm.commit_base : null) || baseFromStatus();
const HEAD = sh("git rev-parse HEAD");
if (!BASE) {
  console.error("No encontré el commit base (entrega ni STATUS.md). Usa --base <sha>.");
  process.exit(65);
}

// ---------- controles ----------
const checks = [];
const add = (id, name, ok, detail = "", level = ok ? "OK" : "FALLA") => checks.push({ id, name, ok, level, detail });

const changed = sh(`git diff --name-only ${BASE}..${HEAD}`).split("\n").filter(Boolean);

// C1
const dirty = sh("git status --porcelain");
add("C1", "Árbol limpio", !dirty, dirty ? `Hay cambios sin commitear; Codex valida ${HEAD.slice(0, 7)}, no el working tree.` : "");

// C2
{
  const problems = [];
  if (!deliveryText) problems.push(`falta ${rel(deliveryFile)}`);
  else {
    if (deliveryFm.goal !== G) problems.push(`frontmatter goal=${deliveryFm.goal || "?"}`);
    if (String(deliveryFm.intento) !== String(N)) problems.push(`frontmatter intento=${deliveryFm.intento || "?"}`);
    if (deliveryFm.commit_base && !BASE.startsWith(deliveryFm.commit_base) && !deliveryFm.commit_base.startsWith(BASE))
      problems.push(`commit_base ${deliveryFm.commit_base} no coincide con ${BASE}`);
    if (!changed.includes(rel(deliveryFile))) problems.push("la entrega no está commiteada en el rango");
  }
  add("C2", "Entrega coherente", problems.length === 0, problems.join("; "));
}

// C3
const goalCAs = [...goalText.matchAll(/^\|\s*(CA-\d+)\s*\|/gm)].map((m) => m[1]);
{
  const rows = Object.fromEntries(
    [...(deliveryText || "").matchAll(/^\|\s*(CA-\d+)\s*\|\s*([^|]+?)\s*\|/gm)].map((m) => [m[1], m[2].toLowerCase()]),
  );
  const missing = goalCAs.filter((c) => !rows[c]);
  const pending = goalCAs.filter((c) => rows[c] && !/^cumple\b/.test(rows[c]));
  const detail = [
    missing.length ? `sin fila en la entrega: ${missing.join(", ")}` : "",
    pending.length ? `no declarados "cumple": ${pending.map((c) => `${c} (${rows[c]})`).join(", ")}` : "",
  ]
    .filter(Boolean)
    .join("; ");
  if (missing.length) add("C3", "Criterios cubiertos", false, detail);
  else if (pending.length && opt.allowPending) add("C3", "Criterios cubiertos", true, `${detail}. Codex los marcará FAIL.`, "AVISO");
  else if (pending.length) add("C3", "Criterios cubiertos", false, `${detail}. Codex marca FAIL todo criterio no cumplido; completa o usa --allow-pending si el usuario aceptó dejarlo pendiente.`);
  else add("C3", "Criterios cubiertos", true, `${goalCAs.length} criterios en "cumple"`);
}

// C4
{
  const r = spawnSync("git", ["diff", "--check", `${BASE}..${HEAD}`], { encoding: "utf8" });
  const lines = (r.stdout || "").split("\n").filter((l) => /^\S+:\d+:/.test(l));
  add("C4", `git diff --check ${BASE.slice(0, 7)}..${HEAD.slice(0, 7)}`, r.status === 0, r.status === 0 ? "" : `${lines.length} problema(s): ${lines.slice(0, 5).join(" · ")}${lines.length > 5 ? " …" : ""}`);
}

// C5
{
  const codexFiles = changed.filter((f) => f.startsWith(rel(goalsDir) + "/") && /\/(G-\d+\.md|G-\d+\.verdict-\d+\.md)$/.test(f));
  // Codex escribe estos archivos y llegan en commits "docs(...): veredicto ..." o
  // "docs(...): revisión del plan ...". Cualquier otro commit solo puede
  // normalizar espacios o el EOF.
  const codexCommit = /^docs\([^)]+\): (veredicto|revisi[oó]n del plan)/;
  const edited = [];
  for (const f of codexFiles) {
    for (const row of sh(`git log --format=%H%x09%s ${BASE}..${HEAD} -- "${f}"`).split("\n").filter(Boolean)) {
      const [sha, subject] = row.split("\t");
      if (codexCommit.test(subject)) continue;
      const parent = spawnSync("git", ["rev-parse", "--verify", "-q", `${sha}^`], { encoding: "utf8" }).stdout.trim();
      const d = parent ? sh(`git diff -w --ignore-blank-lines ${parent}..${sha} -- "${f}"`) : "x";
      if (d) edited.push(`${path.basename(f)} en ${sha.slice(0, 7)}`);
    }
  }
  add("C5", "Archivos de Codex intactos", edited.length === 0, edited.length ? `cambios de contenido fuera de un commit de veredicto o revisión: ${edited.join(", ")}` : "");
}

// C6
const evidenceLogs = changed.filter((f) => f.startsWith(rel(evidenceDir) + "/") && f.endsWith(".log") && fs.existsSync(f));
const logInfo = [];
{
  const noCmd = [];
  const noExit = [];
  for (const f of evidenceLogs) {
    const head = fs.readFileSync(f, "utf8").split("\n").slice(0, 6);
    const cmd = head[0]?.startsWith("$ ") ? head[0].slice(2) : null;
    const exit = head.map((l) => l.match(/^exit=(\d+)/)).find(Boolean)?.[1];
    logInfo.push({ file: path.basename(f), cmd, exit });
    if (!cmd) noCmd.push(path.basename(f));
    else if (exit == null) noExit.push(path.basename(f));
  }
  if (noCmd.length) add("C6", "Logs reproducibles", false, `sin "$ comando" en la línea 1: ${noCmd.join(", ")}`);
  else if (noExit.length) add("C6", "Logs reproducibles", true, `sin "exit=" en las primeras líneas: ${noExit.join(", ")}`, "AVISO");
  else add("C6", "Logs reproducibles", true, `${evidenceLogs.length} log(s) del rango`);
}

// C7
{
  const refs = [...(deliveryText || "").matchAll(/`([^`\s]+\.(?:log|png|txt|xml|json))(?::[\d,-]+)?`/g)].map((m) => m[1]);
  const matchesGlob = (dir, pattern) => {
    if (!fs.existsSync(dir)) return false;
    const re = new RegExp("^" + pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$");
    return fs.readdirSync(dir).some((n) => re.test(n));
  };
  const missing = [...new Set(refs)].filter((r) => {
    if (r.includes("*")) {
      const dirs = [path.dirname(r), path.join(goalsDir, path.dirname(r)), evidenceDir];
      return !dirs.some((d) => matchesGlob(path.resolve(d), path.basename(r)));
    }
    const candidates = [r, path.join(goalsDir, r), path.join(evidenceDir, r), path.join(evidenceDir, path.basename(r))];
    return !candidates.some((c) => fs.existsSync(c));
  });
  add("C7", "Referencias de la entrega existen", missing.length === 0, missing.length ? `no existen: ${missing.join(", ")}` : `${new Set(refs).size} referencia(s)`);
}

// C8 (solo se informa el tipo de hallazgo y la ubicacion, nunca el valor)
{
  const patterns = [
    ["clave de API (sk-, sb_, AKIA, ghp_, xox)", /\b(sk-(ant-|proj-)?[A-Za-z0-9_-]{20,}|sb_(secret|publishable)_[A-Za-z0-9]{8,}|AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{30,}|xox[baprs]-[A-Za-z0-9-]{10,})/],
    ["clave privada", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
    ["JWT", /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
    ["service_role", /service_role\s*[:=]\s*\S{12,}/i],
    ["password asignado", /pass(word)?\s*[:=]\s*["']?[^\s"']{4,}/i],
    ["IP privada", /\b(192\.168|10\.\d{1,3}|172\.(1[6-9]|2\d|3[01]))\.\d{1,3}\.\d{1,3}\b/],
  ];
  const hits = [];
  const forbidden = changed.filter((f) => /(^|\/)\.env(\.|$)|(^|\/)local\.properties$/.test(f));
  for (const f of forbidden) hits.push(`${f}: archivo prohibido`);
  let file = null;
  let line = 0;
  const diff = sh(`git diff -U0 --no-color ${BASE}..${HEAD}`);
  for (const l of diff.split("\n")) {
    if (l.startsWith("+++ ")) file = l.slice(6);
    else if (l.startsWith("@@")) line = Number(l.match(/\+(\d+)/)?.[1] || 0) - 1;
    else if (l.startsWith("+")) {
      line++;
      for (const [name, re] of patterns) if (re.test(l)) hits.push(`${file}:${line} (${name})`);
    }
  }
  add("C8", "Sin datos sensibles", hits.length === 0, hits.length ? hits.slice(0, 8).join(" · ") + (hits.length > 8 ? " …" : "") : "");
}

// C9
const profilePath = [path.join(repoRoot, ".claude", "arq-loop.project.md"), path.join(repoRoot, ".claude", "skills", "arq-loop", "project.md")].find(fs.existsSync);
const commandRuns = [];
{
  const profile = read(profilePath) || "";
  const section = profile.split(/^## /m).find((s) => s.startsWith("Pre-check")) || "";
  const rules = [...section.matchAll(/^\|\s*`([^`]+)`\s*\|\s*`([^`]+)`\s*\|/gm)].map((m) => ({ glob: m[1], cmd: m[2] }));
  const toRe = (g) =>
    new RegExp(
      "^" +
        g
          .split("**")
          .map((p) => p.split("*").map((q) => q.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join("[^/]*"))
          .join(".*") +
        "$",
    );
  const due = [];
  for (const r of rules) if (changed.some((f) => toRe(r.glob).test(f)) && !due.includes(r.cmd)) due.push(r.cmd);
  if (!section) add("C9", "Comandos del perfil", true, 'el perfil no tiene sección "Pre-check"', "AVISO");
  else if (!due.length) add("C9", "Comandos del perfil", true, "ninguna regla aplica a las rutas del diff");
  else if (!opt.commands) add("C9", "Comandos del perfil", true, `omitidos por --no-commands: ${due.length}`, "AVISO");
  else {
    for (const cmd of due) {
      const t0 = Date.now();
      const r = spawnSync("bash", ["-c", cmd], { cwd: repoRoot, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
      const out = `${r.stdout || ""}${r.stderr || ""}`.replace(/[ \t]+$/gm, "").trimEnd().split("\n");
      commandRuns.push({ cmd, exit: r.status, secs: Math.round((Date.now() - t0) / 1000), tail: out.slice(-15) });
    }
    const failed = commandRuns.filter((c) => c.exit !== 0);
    add("C9", "Comandos del perfil", failed.length === 0, commandRuns.map((c) => `exit=${c.exit} en ${c.secs}s: ${c.cmd.slice(0, 70)}`).join(" · "));
  }
}

// ---------- salida ----------
const failed = checks.filter((c) => !c.ok);
for (const c of checks) console.log(`${c.level.padEnd(5)} ${c.id} ${c.name}${c.detail ? ` — ${c.detail}` : ""}`);
console.log(failed.length ? `Pre-check ${G} intento ${N}: ${failed.length} falla(s). No llames a Codex hasta corregirlas.` : `Pre-check ${G} intento ${N}: OK.`);

if (opt.pack) {
  const P = [];
  P.push(`Generado por \`precheck.mjs\` sobre \`${BASE.slice(0, 7)}..${HEAD.slice(0, 7)}\`. Todo lo de esta sección es salida de comandos deterministas.`);
  P.push("", "### Resultado del pre-check", "| Control | Resultado | Detalle |", "|---|---|---|");
  for (const c of checks) P.push(`| ${c.id} ${c.name} | ${c.level} | ${(c.detail || "—").replace(/\|/g, "\\|")} |`);
  P.push("", "### Archivos cambiados", "```", sh(`git diff --stat=120 ${BASE}..${HEAD}`).split("\n").slice(-80).join("\n"), "```");
  if (logInfo.length) {
    P.push("", `### Logs de evidencia de ${G} en el rango`, "| Log | Comando (línea 1) | exit |", "|---|---|---|");
    if (logInfo.length > 40) P.push(`Se muestran los últimos 40 de ${logInfo.length}; el resto está en \`${rel(evidenceDir)}/\`.`);
    for (const l of logInfo.slice(-40)) P.push(`| \`${l.file}\` | \`${(l.cmd || "?").slice(0, 110).replace(/\|/g, "\\|")}\` | ${l.exit ?? "?"} |`);
  }
  for (const c of commandRuns) {
    P.push("", `### Re-ejecución: \`${c.cmd.slice(0, 90)}\``, `exit=${c.exit} · ${c.secs}s · últimas líneas:`, "```", ...c.tail, "```");
  }
  if (N > 1) {
    const prevFile = path.join(goalsDir, `${G}.verdict-${N - 1}.md`);
    const prev = read(prevFile);
    if (prev) {
      const prevHead = frontmatter(prev).commit_validado;
      const rows = [...prev.matchAll(/^\|\s*(CA-\d+)\s*\|\s*(PASS|FAIL)\s*\|/gm)];
      const pass = rows.filter((r) => r[2] === "PASS").map((r) => r[1]);
      const fail = rows.filter((r) => r[2] === "FAIL").map((r) => r[1]);
      let since = [];
      if (prevHead && spawnSync("git", ["cat-file", "-e", prevHead]).status === 0) {
        since = sh(`git diff --name-only ${prevHead}..${HEAD}`).split("\n").filter(Boolean);
      }
      P.push(
        "",
        "### Revalidación incremental",
        `- Veredicto anterior: \`${rel(prevFile)}\` sobre \`${(prevHead || "?").slice(0, 7)}\`.`,
        `- PASS en el intento anterior: ${pass.join(", ") || "ninguno"}.`,
        `- FAIL en el intento anterior: ${fail.join(", ") || "ninguno"}.`,
        `- Archivos cambiados desde el veredicto anterior (${since.length}):`,
        ...since.slice(0, 60).map((f) => `  - \`${f}\``),
      );
    }
  }
  fs.mkdirSync(path.dirname(path.resolve(opt.pack)), { recursive: true });
  fs.writeFileSync(opt.pack, P.join("\n") + "\n");
  console.log(`Paquete de evidencia en ${opt.pack}`);
}

process.exit(failed.length ? 1 : 0);
~~~~

<!-- arq-loop:file scripts/context-pack.mjs -->
~~~~javascript
#!/usr/bin/env node
//
// Paquete de contexto para el implementador: le entrega de una vez lo que
// antes descubria con decenas de ls/find/rg/sed, cada uno en una llamada que
// releia todo su contexto.
//
// Uso:  node context-pack.mjs --goal G-XX [--attempt N] [--spec <dir>] --out <archivo.md>
//
// Contenido:
//   1. Archivos que el goal nombra (entre comillas invertidas en cualquier
//      seccion), resueltos contra git ls-files, con lineas, tamano aproximado
//      en tokens, esquema de simbolos e imports agrupados por paquete.
//   2. Mapa del modulo: una linea por archivo de las raices de codigo del
//      perfil (las rutas terminadas en "/" de "Leer antes de diseñar").
//   3. Desde el intento 2, las ubicaciones archivo:linea citadas en el
//      veredicto anterior.
// No escribe en el repo.

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const args = process.argv.slice(2);
const opt = { goal: null, attempt: 1, spec: null, out: null };
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--goal") opt.goal = args[++i];
  else if (a === "--attempt") opt.attempt = Number(args[++i]);
  else if (a === "--spec") opt.spec = args[++i];
  else if (a === "--out") opt.out = args[++i];
  else {
    console.error(`Argumento desconocido: ${a}`);
    process.exit(64);
  }
}
if (!/^G-\d+$/.test(opt.goal || "") || !opt.out) {
  console.error("Uso: node context-pack.mjs --goal G-XX [--attempt N] [--spec <dir>] --out <archivo.md>");
  process.exit(64);
}

// Raiz de specs: la linea "Raíz de specs: `<dir>`" del perfil, o "specs".
function specsRoot(repoRoot) {
  for (const p of [path.join(repoRoot, ".claude", "arq-loop.project.md"), path.join(repoRoot, ".claude", "skills", "arq-loop", "project.md")]) {
    if (!fs.existsSync(p)) continue;
    const m = fs.readFileSync(p, "utf8").match(/Ra[ií]z de specs:\s*`([^`<>]+)`/);
    if (m) return m[1].replace(/\/+$/, "");
  }
  return "specs";
}

const sh = (cmd) => execSync(cmd, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).trim();
const repoRoot = sh("git rev-parse --show-toplevel");
process.chdir(repoRoot);
const read = (f) => (fs.existsSync(f) ? fs.readFileSync(f, "utf8") : null);

let specDir = opt.spec ? path.resolve(opt.spec) : null;
if (!specDir) {
  const root = path.join(repoRoot, specsRoot(repoRoot));
  const found = fs.existsSync(root) ? fs.readdirSync(root).filter((d) => fs.existsSync(path.join(root, d, "goals", "STATUS.md"))) : [];
  if (found.length !== 1) {
    console.error(`No pude resolver la spec (${found.length} candidatas). Usa --spec <dir>.`);
    process.exit(65);
  }
  specDir = path.join(root, found[0]);
}
const goalsDir = path.join(specDir, "goals");
const goalText = read(path.join(goalsDir, `${opt.goal}.md`));
if (!goalText) {
  console.error(`No existe ${opt.goal}.md en ${path.relative(repoRoot, goalsDir)}.`);
  process.exit(65);
}

const files = sh("git ls-files").split("\n").filter(Boolean);
const byBase = new Map();
for (const f of files) {
  for (const key of [path.basename(f), path.basename(f).replace(/\.[^.]+$/, "")]) {
    if (!byBase.has(key)) byBase.set(key, []);
    byBase.get(key).push(f);
  }
}
const approxTokens = (text) => Math.round(text.length / 3.6);

// ---------- 1. archivos que nombra el goal ----------
const section = (name) => (goalText.split(/^## /m).find((s) => s.startsWith(name)) || "");
const fm = (goalText.match(/^---\n([\s\S]*?)\n---/) || [])[1] || "";
const named = new Map(); // ruta -> secciones donde aparece
function addRef(ref, where) {
  const clean = ref.replace(/[:#].*$/, "").replace(/\(\)$/, "");
  let hits = [];
  if (files.includes(clean)) hits = [clean];
  else if (byBase.has(clean)) hits = byBase.get(clean);
  hits = hits.filter((h) => !h.includes("/goals/"));
  if (hits.length === 0 || hits.length > 4) return;
  for (const h of hits) {
    if (!named.has(h)) named.set(h, new Set());
    named.get(h).add(where);
  }
}
for (const name of ["Alcance", "Contexto", "Restricciones", "Criterios de aceptación", "Fuera de alcance"]) {
  for (const m of section(name).matchAll(/`([^`\s]+)`/g)) addRef(m[1], name);
}
const specRef = fm.match(/^spec:\s*(\S+)/m)?.[1];
if (specRef) addRef(specRef, "spec");

const KT_DECL =
  /^(\s*)(?:(?:private|internal|public|protected|override|data|sealed|enum|abstract|open|inline|suspend|operator|const|lateinit|annotation|value)\s+)*(fun|class|object|interface|val|var|typealias)\s+(?:<[^>]+>\s*)?(?:[\w.]+\.)?(\w+)/;

// Declaraciones por lenguaje: [indentacion, tipo, nombre].
const DECL = [
  [/\.(ts|tsx|js|jsx|mjs|cjs)$/, /^(\s*)(?:export\s+)?(?:default\s+)?(?:declare\s+)?(?:async\s+)?(function\*?|class|interface|type|enum|const|let)\s+(\w+)/],
  [/\.py$/, /^(\s*)(?:async\s+)?(def|class)\s+(\w+)/],
  [/\.go$/, /^()(func|type)\s+(?:\([^)]*\)\s*)?(\w+)/],
  [/\.(java|cs)$/, /^(\s*)(?:(?:public|private|protected|internal|static|final|abstract|sealed|partial|async)\s+)*(class|interface|enum|record|struct)\s+(\w+)/],
  [/\.swift$/, /^(\s*)(?:(?:public|private|internal|fileprivate|open|static|final)\s+)*(func|class|struct|enum|protocol|extension)\s+(\w+)/],
  [/\.rs$/, /^(\s*)(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(fn|struct|enum|trait|impl|mod)\s+(\w+)/],
];

function outline(file, maxIndent, limit) {
  const text = read(file) || "";
  const lines = text.split("\n");
  const out = [];
  const generic = DECL.find(([ext]) => ext.test(file));
  if (generic && !/\.(kt|kts)$/.test(file)) {
    for (let i = 0; i < lines.length && out.length < limit; i++) {
      const m = lines[i].match(generic[1]);
      if (!m || m[1].length > maxIndent) continue;
      if ((m[2] === "const" || m[2] === "let") && m[1].length > 0) continue;
      out.push(`${i + 1}: ${m[2]} ${m[3]}`);
    }
  } else if (/\.(kt|kts)$/.test(file)) {
    for (let i = 0; i < lines.length && out.length < limit; i++) {
      const m = lines[i].match(KT_DECL);
      if (!m || m[1].length > maxIndent) continue;
      if ((m[2] === "val" || m[2] === "var") && m[1].length > 0) continue; // variables locales o miembros: ruido
      const prev = lines.slice(Math.max(0, i - 3), i).join(" ");
      const tags = [prev.includes("@Composable") && "@Composable", prev.includes("@Preview") && "@Preview", prev.includes("@Test") && "@Test"].filter(Boolean);
      out.push(`${i + 1}: ${m[2]} ${m[3]}${tags.length ? ` ${tags.join(" ")}` : ""}`);
    }
  } else if (/\.md$/.test(file)) {
    for (let i = 0; i < lines.length && out.length < limit; i++) if (/^#{1,3} /.test(lines[i])) out.push(`${i + 1}: ${lines[i]}`);
  }
  return { text, lines: lines.length, out };
}

function importGroups(text) {
  const groups = {};
  for (const m of text.matchAll(/^import\s+([\w.]+)/gm)) {
    const key = m[1].split(".").slice(0, 4).join(".");  // Kotlin/Java
    groups[key] = (groups[key] || 0) + 1;
  }
  return Object.entries(groups)
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${k} (${n})`)
    .join(", ");
}

const P = [];
P.push(`# Paquete de contexto · ${opt.goal} · intento ${opt.attempt}`);
P.push("", "Generado por `context-pack.mjs` desde el goal y `git ls-files`. Úsalo en vez de listar o buscar archivos uno por uno.");
P.push("", "## Archivos que nombra el goal");
if (!named.size) P.push("El goal no nombra archivos concretos; parte del mapa del módulo.");
for (const [file, where] of named) {
  const o = outline(file, 4, 40);
  P.push("", `### \`${file}\``, `${o.lines} líneas · ~${approxTokens(o.text)} tokens · citado en: ${[...where].join(", ")}`);
  const imp = /\.(kt|kts)$/.test(file) ? importGroups(o.text) : "";
  if (imp) P.push(`Imports: ${imp}`);
  if (o.out.length) P.push("```", ...o.out, "```");
}

// ---------- 2. mapa del modulo ----------
const profile = read(path.join(repoRoot, ".claude", "arq-loop.project.md")) || read(path.join(repoRoot, ".claude", "skills", "arq-loop", "project.md")) || "";
const readFirst = profile.split(/^## /m).find((s) => s.startsWith("Leer antes de diseñar")) || "";
const roots = [...readFirst.matchAll(/`([^`{}<>\s]+\/)`/g)].map((m) => m[1]);
const codeExt = /\.(kt|kts|java|ts|tsx|js|mjs|sql|py|swift|go|rs)$/;
const mapped = files.filter((f) => roots.some((r) => f.startsWith(r)) && codeExt.test(f));
P.push("", "## Mapa del módulo", roots.length ? `Raíces del perfil: ${roots.map((r) => `\`${r}\``).join(", ")}. Formato: ruta · líneas · símbolos de primer nivel.` : "El perfil no declara raíces de código terminadas en \"/\".");
if (mapped.length) {
  P.push("```");
  let prevDir = null;
  for (const f of mapped) {
    const dir = path.dirname(f);
    if (dir !== prevDir) {
      P.push(`${dir}/`);
      prevDir = dir;
    }
    const o = outline(f, 0, 8);
    const names = o.out.map((l) => l.split(" ").slice(2).join(" ").replace(/ @\w+/g, "")).filter(Boolean);
    P.push(`  ${path.basename(f)} · ${o.lines} · ${names.join(", ")}${o.out.length === 8 ? ", …" : ""}`);
  }
  P.push("```");
}

// ---------- 3. veredicto anterior ----------
if (opt.attempt > 1) {
  const prev = read(path.join(goalsDir, `${opt.goal}.verdict-${opt.attempt - 1}.md`));
  if (prev) {
    const locs = [...new Set([...prev.matchAll(/`([\w./-]+\.\w+):([\d,\- ]+)`/g)].map((m) => `${m[1]}:${m[2].trim()}`))];
    P.push("", `## Ubicaciones citadas en ${opt.goal}.verdict-${opt.attempt - 1}.md`, ...(locs.length ? locs.map((l) => `- \`${l}\``) : ["Ninguna con archivo:línea."]));
  }
}

const out = P.join("\n") + "\n";
fs.mkdirSync(path.dirname(path.resolve(opt.out)), { recursive: true });
fs.writeFileSync(opt.out, out);
console.log(`Paquete de contexto en ${opt.out}: ${named.size} archivo(s) del goal, ${mapped.length} en el mapa, ~${approxTokens(out)} tokens.`);
~~~~

<!-- arq-loop:file scripts/usage.mjs -->
~~~~javascript
#!/usr/bin/env node
//
// Mide cuantos tokens gasta arq-loop por goal, intento, flujo y modelo.
//
// Uso:  node usage.mjs [--spec <dir>] [--write] [--json] [--since AAAA-MM-DD]
//
//   --spec <dir>   limita el reporte a una feature (p. ej. specs/001-mi-feature)
//   --write        reemplaza la seccion "Consumo de tokens" de <spec>/goals/STATUS.md
//                  e imprime una sola linea (para no inflar el contexto de Claude)
//   --json         imprime los datos crudos en JSON
//   --since        ignora actividad anterior a esa fecha (UTC)
//
// Fuentes (solo lectura):
//   Claude: ~/.claude/projects/<repo>/*.jsonl y <sesion>/subagents/*.jsonl
//   Codex:  $CODEX_HOME/sessions/**/rollout-*.jsonl (originator "Claude Code")
//
// Atribucion: cada llamada de Claude se asigna a la siguiente invocacion de
// codex.sh de su sesion. Asi, el trabajo previo a "validate-G-03-2" cuenta como
// "implementar G-03 intento 2", incluido leer el veredicto anterior. Lo que viene
// despues del ultimo codex.sh queda como "abierto". Cada corrida de Codex se une
// a su invocacion por hora de inicio.
//
// Los USD son equivalentes a precio de API (los planes de suscripcion miden uso,
// no dolares). Si cambian los precios, actualiza PRICES.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";

// USD por millon de tokens.
const PRICES = {
  claude: {
    // entrada, escritura 5m, escritura 1h, lectura de cache, salida
    "claude-opus-5-5": [4, 5, 8, 0.2, 20],
    "claude-opus-5": [5, 6.25, 10, 0.5, 25],
    "claude-sonnet-5": [2, 2.5, 4, 0.2, 10],
    // PROVISIONAL: sin precio publicado al 2026-09-28; se usa el de Sonnet 5.
    "claude-sonnet-5-5": [2, 2.5, 4, 0.2, 10],
    "claude-haiku-4-5": [1, 1.25, 2, 0.1, 5],
    "claude-fable-5-1": [10, 12.5, 20, 0.25, 50],
  },
  codex: {
    // entrada sin cache, entrada en cache, salida (incluye razonamiento)
    "gpt-5.6-sol": [4, 0.4, 20],
    "gpt-6-sol": [2, 0.2, 10],
    "gpt-6-luna": [0.1, 0.01, 0.5],
  },
};

// ---------- argumentos ----------
const args = process.argv.slice(2);
const opt = { spec: null, write: false, json: false, since: null };
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--spec") opt.spec = args[++i];
  else if (a === "--write") opt.write = true;
  else if (a === "--json") opt.json = true;
  else if (a === "--since") opt.since = args[++i];
  else {
    console.error(`Argumento desconocido: ${a}`);
    process.exit(64);
  }
}

let repoRoot = process.cwd();
try {
  repoRoot = execSync("git rev-parse --show-toplevel", { encoding: "utf8" }).trim();
} catch {}
const claudeDir = path.join(os.homedir(), ".claude", "projects", repoRoot.replace(/[^a-zA-Z0-9]/g, "-"));
const codexDir = path.join(process.env.CODEX_HOME || path.join(os.homedir(), ".codex"), "sessions");
const sinceTs = opt.since ? `${opt.since}T00:00:00` : "";

// ---------- utilidades ----------
// Raiz de specs: la linea "Raíz de specs: `<dir>`" del perfil, o "specs".
function specsRoot(repoRoot) {
  for (const p of [path.join(repoRoot, ".claude", "arq-loop.project.md"), path.join(repoRoot, ".claude", "skills", "arq-loop", "project.md")]) {
    if (!fs.existsSync(p)) continue;
    const m = fs.readFileSync(p, "utf8").match(/Ra[ií]z de specs:\s*`([^`<>]+)`/);
    if (m) return m[1].replace(/\/+$/, "");
  }
  return "specs";
}

function readJsonl(file) {
  const out = [];
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (!line) continue;
    try {
      out.push(JSON.parse(line));
    } catch {}
  }
  return out;
}

function walk(dir, pred, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, pred, acc);
    else if (pred(p)) acc.push(p);
  }
  return acc;
}

const fmt = (n) =>
  n >= 1e6 ? `${(n / 1e6).toFixed(2)} M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)} k` : String(n);
const usd = (n) => (n == null ? "—" : n.toFixed(2));
const normModel = (m) => (m || "?").replace(/-\d{8}$/, "");

const unpriced = new Set();
const PROVISIONAL = new Set(["claude-sonnet-5-5"]);
function claudeCost(model, u) {
  const p = PRICES.claude[normModel(model)];
  if (!p) {
    unpriced.add(normModel(model));
    return null;
  }
  const cc = u.cache_creation || {};
  const w5 = cc.ephemeral_5m_input_tokens ?? 0;
  const w1 = cc.ephemeral_1h_input_tokens ?? (cc.ephemeral_5m_input_tokens == null ? u.cache_creation_input_tokens || 0 : 0);
  return (
    ((u.input_tokens || 0) * p[0] + w5 * p[1] + w1 * p[2] + (u.cache_read_input_tokens || 0) * p[3] + (u.output_tokens || 0) * p[4]) /
    1e6
  );
}

function codexCost(model, t) {
  const p = PRICES.codex[model];
  if (!p) {
    unpriced.add(model);
    return null;
  }
  return ((t.input - t.cached) * p[0] + t.cached * p[1] + t.output * p[2]) / 1e6;
}

// Nombre del prompt -> ronda. Acepta plan-all-1, validate-G-01-2, revise-G01-1.
function parseLabel(label) {
  const m = label.match(/^(plan|validate|revise)-(.+)-(\d+)$/);
  if (!m) return { op: "otro", goal: "—", attempt: null };
  let goal = m[2];
  const g = goal.match(/^G-?(\d+)$/i);
  goal = g ? `G-${g[1].padStart(2, "0")}` : "—";
  return { op: m[1], goal, attempt: Number(m[3]) };
}

// ---------- Claude ----------
const sessions = [];
if (fs.existsSync(claudeDir)) {
  for (const name of fs.readdirSync(claudeDir)) {
    if (!name.endsWith(".jsonl")) continue;
    const id = name.slice(0, -6);
    const files = [path.join(claudeDir, name), ...walk(path.join(claudeDir, id, "subagents"), (p) => p.endsWith(".jsonl"))];
    const calls = new Map();
    const launches = [];
    const splits = [];
    let arqStart = null;
    for (const file of files) {
      let agentType = null;
      const metaFile = file.replace(/\.jsonl$/, ".meta.json");
      if (file.includes(`${path.sep}subagents${path.sep}`) && fs.existsSync(metaFile)) {
        try {
          agentType = JSON.parse(fs.readFileSync(metaFile, "utf8")).agentType || null;
        } catch {}
      }
      for (const d of readJsonl(file)) {
        const ts = d.timestamp || "";
        if (d.type === "user" && !d.isMeta) {
          const c = d.message?.content;
          const text = typeof c === "string" ? c : Array.isArray(c) ? c.map((b) => b.text || "").join(" ") : "";
          if (text.includes("<command-name>/arq-loop</command-name>") && (!arqStart || ts < arqStart)) arqStart = ts;
        }
        if (d.type !== "assistant") continue;
        const m = d.message || {};
        if (m.usage && m.model && m.model !== "<synthetic>") {
          calls.set(m.id || d.requestId || `${file}:${ts}`, { ts, model: m.model, usage: m.usage, sidechain: !!d.isSidechain, agentType });
        }
        for (const b of m.content || []) {
          if (b.type !== "tool_use" || b.name !== "Bash") continue;
          const cmd = String(b.input?.command || "");
          for (const mm of cmd.matchAll(/codex\.sh((?:\s+[^\s;&|]+){3,4})/g)) {
            const toks = mm[1].trim().split(/\s+/);
            const prompt = toks.find((t) => t.endsWith(".md") && !t.endsWith(".out.md"));
            if (!prompt || parseLabel(path.basename(prompt, ".md")).op === "otro") continue;
            const efforts = ["none", "minimal", "low", "medium", "high", "xhigh", "max"];
            launches.push({
              ts,
              session: id,
              label: path.basename(prompt, ".md"),
              effortArg: toks.find((t) => efforts.includes(t)) || null,
            });
          }
          for (const mm of cmd.matchAll(/split\.mjs\s+[^\s;&|]+\s+([^\s;&|]+)/g)) {
            const dir = mm[1].replace(/\/+$/, "");
            if (dir.endsWith("/goals") || dir === "goals") splits.push({ ts, feature: path.basename(path.dirname(dir)) });
          }
        }
      }
    }
    if (!launches.length && !arqStart) continue;
    launches.sort((a, b) => a.ts.localeCompare(b.ts));
    splits.sort((a, b) => a.ts.localeCompare(b.ts));
    sessions.push({ id, calls: [...calls.values()].sort((a, b) => a.ts.localeCompare(b.ts)), launches, splits, arqStart });
  }
}

// ---------- Codex ----------
const codexRuns = [];
for (const file of walk(codexDir, (p) => /rollout-.*\.jsonl$/.test(p))) {
  const rows = readJsonl(file);
  const meta = rows.find((r) => r.type === "session_meta")?.payload;
  if (!meta || meta.originator !== "Claude Code" || meta.cwd !== repoRoot) continue;
  if (sinceTs && (meta.timestamp || "") < sinceTs) continue;
  let ctx = {};
  let info = null;
  let rate = null;
  let tools = 0;
  let complete = false;
  for (const r of rows) {
    const p = r.payload || {};
    if (r.type === "turn_context") ctx = p;
    else if (r.type === "response_item" && (p.type === "custom_tool_call" || p.type === "function_call")) tools++;
    else if (r.type === "event_msg" && p.type === "token_count") {
      if (p.info) info = p.info;
      if (p.rate_limits?.primary) rate = p.rate_limits.primary;
    } else if (r.type === "event_msg" && p.type === "task_complete") complete = true;
  }
  const t = info?.total_token_usage || {};
  codexRuns.push({
    start: meta.timestamp,
    model: ctx.model || "?",
    effort: ctx.effort || "?",
    tools,
    complete,
    tokens: {
      input: t.input_tokens || 0,
      cached: t.cached_input_tokens || 0,
      output: t.output_tokens || 0,
      reasoning: t.reasoning_output_tokens || 0,
    },
    window: rate ? { used: rate.used_percent, resets: rate.resets_at } : null,
  });
}
codexRuns.sort((a, b) => a.start.localeCompare(b.start));
// Delta de la ventana de 5 h respecto de la corrida anterior en la misma ventana.
for (let i = 0; i < codexRuns.length; i++) {
  const cur = codexRuns[i].window;
  const prev = codexRuns[i - 1]?.window;
  if (cur && prev && prev.resets === cur.resets) cur.delta = cur.used - prev.used;
}

// ---------- rondas ----------
const rounds = [];
const used = new Set();
const allLaunches = sessions.flatMap((s) => s.launches).sort((a, b) => a.ts.localeCompare(b.ts));
const seen = {};

function featureOf(s, ts) {
  const after = s.splits.find((x) => x.ts >= ts);
  const before = [...s.splits].reverse().find((x) => x.ts < ts);
  return (after || before)?.feature || "?";
}

for (const s of sessions) {
  const keyed = s.launches.map((l) => {
    const n = (seen[l.label] = (seen[l.label] || 0) + 1);
    const r = {
      ...parseLabel(l.label),
      label: l.label,
      rerun: n > 1,
      ts: l.ts,
      session: s.id,
      feature: featureOf(s, l.ts),
      claude: { calls: 0, input: 0, cacheWrite: 0, cacheRead: 0, output: 0, usd: 0, models: {} },
      codex: null,
    };
    rounds.push(r);
    return r;
  });
  let tail = null;
  const start = s.arqStart || s.launches[0]?.ts || "";
  for (const c of s.calls) {
    if (c.ts < start || (sinceTs && c.ts < sinceTs)) continue;
    let r = keyed.find((k) => k.ts >= c.ts);
    if (!r) {
      if (!tail) {
        const last = keyed[keyed.length - 1];
        tail = {
          op: "abierto",
          goal: "—",
          attempt: null,
          label: last ? `abierto tras ${last.label}` : "abierto",
          ts: c.ts,
          session: s.id,
          feature: last ? last.feature : featureOf(s, c.ts),
          claude: { calls: 0, input: 0, cacheWrite: 0, cacheRead: 0, output: 0, usd: 0, models: {} },
          codex: null,
        };
        rounds.push(tail);
      }
      r = tail;
    }
    const u = c.usage;
    const cost = claudeCost(c.model, u) || 0;
    const a = r.claude;
    a.calls++;
    a.input += u.input_tokens || 0;
    a.cacheWrite += u.cache_creation_input_tokens || 0;
    a.cacheRead += u.cache_read_input_tokens || 0;
    a.output += u.output_tokens || 0;
    a.usd += cost;
    const mk = normModel(c.model) + (c.sidechain ? " (subagente)" : "");
    if (c.agentType && c.agentType.startsWith("arq-implementer")) {
      const v = (a.implementers ||= {});
      const k = `${c.agentType} · ${normModel(c.model)}`;
      (v[k] ||= { calls: 0, usd: 0 }).calls++;
      v[k].usd += cost;
    }
    a.models[mk] = (a.models[mk] || 0) + cost;
  }
}

// Unir cada invocacion con la primera corrida de Codex que arranca despues.
for (const r of rounds.filter((x) => x.op !== "abierto").sort((a, b) => a.ts.localeCompare(b.ts))) {
  const t0 = Date.parse(r.ts);
  const run = codexRuns.find((c, i) => !used.has(i) && Date.parse(c.start) >= t0 - 10e3 && Date.parse(c.start) <= t0 + 15 * 60e3);
  if (run) {
    used.add(codexRuns.indexOf(run));
    r.codex = { ...run, usd: codexCost(run.model, run.tokens) };
  }
}

// Veredicto de cada validate, leido de GOALS_DIR/G-XX.verdict-N.md. Si una
// invocacion se relanzo, el veredicto pertenece solo a la ultima.
const lastOfLabel = {};
for (const r of rounds) if (r.op === "validate" && (!lastOfLabel[r.label] || r.ts > lastOfLabel[r.label].ts)) lastOfLabel[r.label] = r;
for (const r of Object.values(lastOfLabel)) {
  const f = path.join(repoRoot, specsRoot(repoRoot), r.feature, "goals", `${r.goal}.verdict-${r.attempt}.md`);
  if (!fs.existsSync(f)) continue;
  const head = fs.readFileSync(f, "utf8").slice(0, 600);
  const v = head.match(/^veredicto:\s*(PASS|FAIL)\b/m);
  if (v) r.verdict = v[1];
}

let view = rounds.filter((r) => !sinceTs || r.ts >= sinceTs);
let specDir = opt.spec ? path.resolve(repoRoot, opt.spec) : null;
if (!specDir) {
  const features = [...new Set(view.map((r) => r.feature).filter((f) => f !== "?"))];
  if (opt.write && features.length === 1) specDir = path.join(repoRoot, specsRoot(repoRoot), features[0]);
}
if (specDir) {
  const feat = path.basename(specDir);
  view = view.filter((r) => r.feature === feat);
}
view.sort((a, b) => a.ts.localeCompare(b.ts));

// ---------- reporte ----------
function roundName(r) {
  if (r.op === "validate") return `${r.goal} · intento ${r.attempt}${r.rerun ? " (relanzado)" : ""}`;
  if (r.op === "revise") return `revise ${r.goal}${r.rerun ? " (relanzado)" : ""}`;
  if (r.op === "plan") return `plan${r.rerun ? " (relanzado)" : ""}`;
  return r.label;
}

function flowOf(r) {
  return { validate: "implementar", revise: "preparar revise", plan: "preparar plan" }[r.op] || "abierto";
}

const sum = (xs, f) => xs.reduce((a, x) => a + (f(x) || 0), 0);

function report() {
  const L = [];
  const totC = sum(view, (r) => r.claude.usd);
  const totX = sum(view, (r) => r.codex?.usd);
  L.push(`Actualizado: ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC · \`node .claude/skills/arq-loop/scripts/usage.mjs\``);
  L.push("");
  L.push(`Total: Claude $${usd(totC)} + Codex $${usd(totX)} = **$${usd(totC + totX)}** (USD equivalentes a precio de API).`);
  L.push("");
  L.push("| Ronda | Claude: llamadas | Claude: lect. caché | Claude: salida | Claude USD | Codex: modelo · effort | Codex: herram. | Codex: entrada | Codex USD | Ventana 5 h | Veredicto |");
  L.push("|---|---:|---:|---:|---:|---|---:|---:|---:|---|---|");
  for (const r of view) {
    const c = r.claude;
    const x = r.codex;
    const win = x?.window ? (x.window.delta != null ? `+${x.window.delta} (${x.window.used}%)` : `${x.window.used}%`) : "—";
    L.push(
      `| ${roundName(r)} | ${c.calls} | ${fmt(c.cacheRead)} | ${fmt(c.output)} | ${usd(c.usd)} | ${x ? `${x.model} · ${x.effort}` : "—"} | ${x ? x.tools : "—"} | ${x ? fmt(x.tokens.input) : "—"} | ${x ? usd(x.usd) : "—"} | ${win} | ${r.verdict || "—"} |`,
    );
  }
  // Por goal
  const goals = {};
  for (const r of view) {
    if (r.goal === "—") continue;
    const g = (goals[r.goal] ||= { validates: 0, claude: 0, codex: 0 });
    if (r.op === "validate") g.validates++;
    g.claude += r.claude.usd;
    g.codex += r.codex?.usd || 0;
  }
  if (Object.keys(goals).length) {
    L.push("", "| Goal | Validates | Claude USD | Codex USD | Total |", "|---|---:|---:|---:|---:|");
    for (const [k, g] of Object.entries(goals).sort()) L.push(`| ${k} | ${g.validates} | ${usd(g.claude)} | ${usd(g.codex)} | ${usd(g.claude + g.codex)} |`);
  }
  // Veredictos por modelo validador
  const byModel = {};
  for (const r of view) {
    if (r.op !== "validate" || !r.codex || !r.verdict) continue;
    const k = `${r.codex.model} · ${r.codex.effort}`;
    const m = (byModel[k] ||= { n: 0, fail: 0, usd: 0 });
    m.n++;
    if (r.verdict === "FAIL") m.fail++;
    m.usd += r.codex.usd || 0;
  }
  if (Object.keys(byModel).length) {
    L.push("", "| Validador | Validates | FAIL | % FAIL | USD por validate |", "|---|---:|---:|---:|---:|");
    for (const [k, m] of Object.entries(byModel)) L.push(`| ${k} | ${m.n} | ${m.fail} | ${Math.round((m.fail / m.n) * 100)}% | ${usd(m.usd / m.n)} |`);
  }
  // Variantes del implementador (A/B de effort). Cada ronda cuenta para la
  // variante que hizo la mayoria de sus llamadas.
  const variants = {};
  for (const r of view) {
    const v = r.claude.implementers;
    if (!v || r.op !== "validate") continue;
    const [k] = Object.entries(v).sort((a, b) => b[1].calls - a[1].calls)[0];
    const s = (variants[k] ||= { n: 0, calls: 0, usd: 0, fail: 0, judged: 0 });
    s.n++;
    s.calls += Object.values(v).reduce((x, y) => x + y.calls, 0);
    s.usd += Object.values(v).reduce((x, y) => x + y.usd, 0);
    if (r.verdict) {
      s.judged++;
      if (r.verdict === "FAIL") s.fail++;
    }
  }
  if (Object.keys(variants).length) {
    L.push("", "| Implementador | Intentos | Llamadas promedio | USD promedio | % FAIL |", "|---|---:|---:|---:|---:|");
    for (const [k, s] of Object.entries(variants)) L.push(`| ${k} | ${s.n} | ${Math.round(s.calls / s.n)} | ${usd(s.usd / s.n)} | ${s.judged ? Math.round((s.fail / s.judged) * 100) + "%" : "—"} |`);
  }
  // Por flujo y modelo
  const flows = {};
  for (const r of view) {
    for (const [m, v] of Object.entries(r.claude.models)) {
      const k = `Claude · ${flowOf(r)} · ${m}`;
      flows[k] = (flows[k] || 0) + v;
    }
    if (r.codex) {
      const k = `Codex · ${r.op} · ${r.codex.model} ${r.codex.effort}`;
      flows[k] = (flows[k] || 0) + (r.codex.usd || 0);
    }
  }
  L.push("", "| Flujo · modelo | USD | % |", "|---|---:|---:|");
  const tot = totC + totX || 1;
  for (const [k, v] of Object.entries(flows).sort((a, b) => b[1] - a[1])) L.push(`| ${k} | ${usd(v)} | ${Math.round((v / tot) * 100)}% |`);
  const provisional = [...new Set(view.flatMap((r) => Object.keys(r.claude.models)))].filter((m) => PROVISIONAL.has(m.replace(" (subagente)", "")));
  if (provisional.length) L.push("", `Precio provisional (igual a Sonnet 5, sin precio publicado): ${[...new Set(provisional.map((m) => m.replace(" (subagente)", "")))].join(", ")}.`);
  if (unpriced.size) L.push("", `Sin precio en PRICES (contados como $0): ${[...unpriced].join(", ")}. Agrégalos para que el total sea correcto.`);
  const unmatched = view.filter((r) => r.op !== "abierto" && !r.codex).length;
  if (unmatched) L.push("", `${unmatched} invocación(es) de codex.sh sin corrida de Codex asociada (error o límite de uso antes de arrancar).`);
  return L.join("\n");
}

if (opt.json) {
  console.log(JSON.stringify({ repoRoot, rounds: view }, null, 2));
  process.exit(0);
}

const md = report();
if (!opt.write) {
  console.log(md);
  process.exit(0);
}

if (!specDir) {
  console.error("No pude resolver la spec. Usa --spec <dir>.");
  process.exit(65);
}
if (!view.length) {
  console.error(`No hay rondas de arq-loop para ${path.basename(specDir)}; no se modifica STATUS.md.`);
  process.exit(66);
}
const statusPath = path.join(specDir, "goals", "STATUS.md");
if (!fs.existsSync(statusPath)) {
  console.error(`No existe ${statusPath}.`);
  process.exit(65);
}
const START = "<!-- arq-usage:start -->";
const END = "<!-- arq-usage:end -->";
const block = `${START}\n${md}\n${END}`;
let status = fs.readFileSync(statusPath, "utf8");
if (status.includes(START) && status.includes(END)) {
  status = status.slice(0, status.indexOf(START)) + block + status.slice(status.indexOf(END) + END.length);
} else {
  status = `${status.replace(/\s*$/, "")}\n\n## Consumo de tokens\n\n${block}\n`;
}
fs.writeFileSync(statusPath, status);
const totC = sum(view, (r) => r.claude.usd);
const totX = sum(view, (r) => r.codex?.usd);
console.log(`Consumo actualizado en ${path.relative(repoRoot, statusPath)}: Claude $${usd(totC)} + Codex $${usd(totX)} = $${usd(totC + totX)} en ${view.length} rondas.`);
~~~~

<!-- arq-loop:file scripts/sync-agents.mjs -->
~~~~javascript
#!/usr/bin/env node
//
// Genera las variantes del implementador desde .claude/agents/arq-implementer.md,
// para que todas compartan exactamente las mismas reglas.
//
// Uso:  node sync-agents.mjs [--dir <carpeta>]          escribe las variantes
//       node sync-agents.mjs [--dir <carpeta>] --check  sale con 1 si alguna quedo desactualizada
//
//   --dir  carpeta de los agentes; por defecto <raiz del repo>/.claude/agents
//
// La herramienta Agent no permite elegir el effort en cada invocacion, asi que
// cada effort necesita su propio agente. Edita solo arq-implementer.md y vuelve
// a correr este script.

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const repoRoot = execSync("git rev-parse --show-toplevel", { encoding: "utf8" }).trim();
const dirArg = process.argv.indexOf("--dir");
const dir = dirArg > 0 ? path.resolve(process.argv[dirArg + 1]) : path.join(repoRoot, ".claude", "agents");
const source = path.join(dir, "arq-implementer.md");
const VARIANTS = [{ suffix: "medium", effort: "medium" }];

const text = fs.readFileSync(source, "utf8");
if (!/^effort: \w+$/m.test(text) || !/^name: arq-implementer$/m.test(text)) {
  console.error("arq-implementer.md debe tener las líneas 'name: arq-implementer' y 'effort: <nivel>'.");
  process.exit(65);
}

let stale = 0;
for (const v of VARIANTS) {
  const name = `arq-implementer-${v.suffix}`;
  const out = text
    .replace(/^name: arq-implementer$/m, `name: ${name}`)
    .replace(/^description: (.*)$/m, `description: Variante con effort ${v.effort} de arq-implementer (A/B de costo). $1`)
    .replace(/^effort: \w+$/m, `effort: ${v.effort}`)
    .replace(/^---\n/, `---\n# Generado por .claude/skills/arq-loop/scripts/sync-agents.mjs desde arq-implementer.md. No editar.\n`);
  const target = path.join(dir, `${name}.md`);
  const current = fs.existsSync(target) ? fs.readFileSync(target, "utf8") : null;
  if (process.argv.includes("--check")) {
    if (current !== out) {
      console.error(`${name}.md está desactualizado. Corre: node .claude/skills/arq-loop/scripts/sync-agents.mjs`);
      stale++;
    }
  } else if (current !== out) {
    fs.writeFileSync(target, out);
    console.log(`Actualizado ${path.relative(repoRoot, target)}`);
  }
}
if (stale) process.exit(1);
if (process.argv.includes("--check")) console.log("Variantes del implementador al día.");
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
Modo: <autónomo|supervisado> · aprobado <fecha>

| Goal | Título | Nivel | Depende de | Estado | Intentos | Commit base | Commit entrega |
|---|---|---|---|---|---|---|---|
| G-01 | <titulo> | estandar | — | pendiente | 0 | | |

Estados: pendiente · aprobado-para-ejecutar · en-curso · entregado · pass · fail · bloqueado · saltado

## Desviaciones abiertas
Ninguna.

## Consumo de tokens

<!-- arq-usage:start -->
Se completa con `node .claude/skills/arq-loop/scripts/usage.mjs --write` después de cada veredicto.
<!-- arq-usage:end -->
~~~~

<!-- arq-loop:file ../../agents/arq-orchestrator.md -->
~~~~markdown
---
name: arq-orchestrator
description: Sesión principal para correr /arq-loop con el orquestador fijo en Sonnet. Se lanza con `claude --agent arq-orchestrator`; no se usa como subagente.
model: sonnet
effort: medium
color: purple
---
~~~~

<!-- arq-loop:file ../../agents/arq-implementer.md -->
~~~~markdown
---
name: arq-implementer
description: Implementa un intento de un goal de arq-loop en un contexto limpio. Lo invoca el orquestador de /arq-loop, nunca el usuario directamente.
model: sonnet
effort: high
maxTurns: 150
disallowedTools: Agent
color: cyan
experimental:
  cacheTtl: 5m
---

Eres el IMPLEMENTADOR de arq-loop. Codex diseñó el goal y validará tu entrega;
el orquestador te pasa en el mensaje el goal, el intento, las rutas y el
commit base. Trabajas en un contexto limpio a propósito: lee solo lo que el
goal necesita.

## Antes de empezar
1. Lee el paquete de contexto (ruta en el mensaje) y el perfil del proyecto:
   `.claude/arq-loop.project.md` (o, si no existe,
   `.claude/skills/arq-loop/project.md`).
2. Lee `GOALS_DIR/<GOAL>.md` completo y las fuentes que cita.
3. Desde el intento 2, lee `GOALS_DIR/<GOAL>.verdict-<N-1>.md` y atiende
   primero cada punto de "Instrucciones para el siguiente intento".
4. Si el árbol trae cambios sin commitear de este mismo goal (un intento que se
   cortó), revísalos con `git status` y `git diff` y continúa desde ellos. Si
   son de otra cosa, detente y devuelve `bloqueado`.

## Cómo leer (esto es lo que más cuesta)
Cada llamada que haces relee todo tu contexto, y cada resultado queda escrito
en la caché. Menos llamadas y resultados más útiles es menos costo.
- Empieza por el paquete de contexto que te pasa el orquestador. Trae las
  rutas, el tamaño, los imports y los símbolos de los archivos del goal, más
  un mapa del módulo. No uses `ls`, `find` ni `rg -l` para descubrir lo que ya
  aparece ahí.
- Lee cada archivo que vas a modificar completo y una sola vez, con Read. No
  lo pidas por trozos con `sed -n`, `cat`, `head` o `nl`.
- No vuelvas a leer un archivo que ya leíste, salvo para confirmar un cambio
  tuyo, y en ese caso solo la zona tocada.
- Agrupa las búsquedas: un solo `rg` con varios patrones (`-e A -e B`) sobre
  las rutas del goal, en vez de una búsqueda por llamada. Encadena en una sola
  llamada de Bash los comandos que no dependen entre sí.

## Compilar, probar y consultar APIs
- Usa los comandos y herramientas del perfil ("Verificación" y "Herramientas");
  no rearmes el entorno de compilación en cada llamada.
- Mientras iteras, corre solo lo necesario: compilar o los tests del área que
  tocaste. La suite completa (tests + lint), una vez, al final, y su salida es
  la evidencia.
- Para saber la firma de una API de una dependencia, usa la herramienta del
  perfil. No abras cachés ni descomprimas artefactos a mano.

## Reglas
- Implementa solo lo que está en "Alcance". Lo que está en "Fuera de alcance"
  no se toca aunque parezca fácil.
- Los goals, veredictos y revisiones son de Codex: no los edites. Tampoco
  edites `STATUS.md`; lo actualiza el orquestador.
- Si el goal es inviable o contradice el código o la spec, no improvises:
  regístralo como desviación en la entrega. Si bloquea, detente y devuelve
  `bloqueado` con la causa verificada.
- Nunca registres secretos, credenciales ni identificadores de dispositivos
  (seriales, IPs) en la evidencia.
- No hagas push ni abras PR.
- No puedes preguntarle al usuario. Si necesitas algo físico o manual (un dispositivo,
  una cuenta, un ajuste externo) o una decisión suya, deja el trabajo en
  un estado consistente y devuelve `necesita-usuario` con los pasos exactos.
  El orquestador te reenviará la respuesta en este mismo contexto.

## Verificar
Corre los comandos de la sección "Verificación" del perfil. Guarda en
`GOALS_DIR/evidence/<GOAL>/` logs reproducibles: la línea 1 es
`$ <comando exacto>`, luego `exit=<código>` y después el resultado (resumen y
cola del log, no artefactos de build). Sin espacios al final de las líneas.
Para los criterios críticos, agrega una mutación: rompe a propósito el código,
demuestra que la prueba falla, restaura y registra el log. Revisa tú mismo cada
criterio; si alguno no cumple y puedes arreglarlo dentro del alcance, arréglalo
antes de entregar. Lo que dependa de una prueba manual (sección "Pasos manuales"
del perfil) va como "pendiente de prueba manual", nunca como cumplido.

## Entregar
1. Escribe `GOALS_DIR/<GOAL>.delivery-<N>.md` con
   `.claude/skills/arq-loop/templates/delivery.md`. Lo no verificado se declara
   "no verificado"; nunca se presenta como cumplido.
2. Commitea el código, la entrega y la evidencia en un solo commit del goal:
   `feat(<GOAL>): <titulo>` (o `fix`, `test`, `refactor`, `docs`). Termina el
   mensaje con la línea de coautoría que indique la sesión.
3. Corre el pre-check con el comando que te pasó el orquestador. Si falla,
   corrige dentro del alcance, commitea `fix(<GOAL>): <qué>` y repítelo (con
   `--no-commands` si solo tocaste documentos o evidencia). Tras 3 vueltas sin
   pasar, devuelve `bloqueado` con la salida del pre-check.

## Respuesta al orquestador
Máximo 12 líneas, sin repetir el contenido de la entrega:

```
estado: entregado | necesita-usuario | bloqueado
commit_entrega: <sha>
entrega: <ruta de G-XX.delivery-N.md>
pre-check: OK | <controles que fallan>
paquete: <ruta del paquete de evidencia>
criterios: <n> cumple, <n> no verificado
desviaciones: <una línea cada una, o "ninguna">
pasos para el usuario: <solo si necesita-usuario>
```
~~~~

<!-- arq-loop:file ../../agents/arq-implementer-medium.md -->
~~~~markdown
---
# Generado por .claude/skills/arq-loop/scripts/sync-agents.mjs desde arq-implementer.md. No editar.
name: arq-implementer-medium
description: Variante con effort medium de arq-implementer (A/B de costo). Implementa un intento de un goal de arq-loop en un contexto limpio. Lo invoca el orquestador de /arq-loop, nunca el usuario directamente.
model: sonnet
effort: medium
maxTurns: 150
disallowedTools: Agent
color: cyan
experimental:
  cacheTtl: 5m
---

Eres el IMPLEMENTADOR de arq-loop. Codex diseñó el goal y validará tu entrega;
el orquestador te pasa en el mensaje el goal, el intento, las rutas y el
commit base. Trabajas en un contexto limpio a propósito: lee solo lo que el
goal necesita.

## Antes de empezar
1. Lee el paquete de contexto (ruta en el mensaje) y el perfil del proyecto:
   `.claude/arq-loop.project.md` (o, si no existe,
   `.claude/skills/arq-loop/project.md`).
2. Lee `GOALS_DIR/<GOAL>.md` completo y las fuentes que cita.
3. Desde el intento 2, lee `GOALS_DIR/<GOAL>.verdict-<N-1>.md` y atiende
   primero cada punto de "Instrucciones para el siguiente intento".
4. Si el árbol trae cambios sin commitear de este mismo goal (un intento que se
   cortó), revísalos con `git status` y `git diff` y continúa desde ellos. Si
   son de otra cosa, detente y devuelve `bloqueado`.

## Cómo leer (esto es lo que más cuesta)
Cada llamada que haces relee todo tu contexto, y cada resultado queda escrito
en la caché. Menos llamadas y resultados más útiles es menos costo.
- Empieza por el paquete de contexto que te pasa el orquestador. Trae las
  rutas, el tamaño, los imports y los símbolos de los archivos del goal, más
  un mapa del módulo. No uses `ls`, `find` ni `rg -l` para descubrir lo que ya
  aparece ahí.
- Lee cada archivo que vas a modificar completo y una sola vez, con Read. No
  lo pidas por trozos con `sed -n`, `cat`, `head` o `nl`.
- No vuelvas a leer un archivo que ya leíste, salvo para confirmar un cambio
  tuyo, y en ese caso solo la zona tocada.
- Agrupa las búsquedas: un solo `rg` con varios patrones (`-e A -e B`) sobre
  las rutas del goal, en vez de una búsqueda por llamada. Encadena en una sola
  llamada de Bash los comandos que no dependen entre sí.

## Compilar, probar y consultar APIs
- Usa los comandos y herramientas del perfil ("Verificación" y "Herramientas");
  no rearmes el entorno de compilación en cada llamada.
- Mientras iteras, corre solo lo necesario: compilar o los tests del área que
  tocaste. La suite completa (tests + lint), una vez, al final, y su salida es
  la evidencia.
- Para saber la firma de una API de una dependencia, usa la herramienta del
  perfil. No abras cachés ni descomprimas artefactos a mano.

## Reglas
- Implementa solo lo que está en "Alcance". Lo que está en "Fuera de alcance"
  no se toca aunque parezca fácil.
- Los goals, veredictos y revisiones son de Codex: no los edites. Tampoco
  edites `STATUS.md`; lo actualiza el orquestador.
- Si el goal es inviable o contradice el código o la spec, no improvises:
  regístralo como desviación en la entrega. Si bloquea, detente y devuelve
  `bloqueado` con la causa verificada.
- Nunca registres secretos, credenciales ni identificadores de dispositivos
  (seriales, IPs) en la evidencia.
- No hagas push ni abras PR.
- No puedes preguntarle al usuario. Si necesitas algo físico o manual (un dispositivo,
  una cuenta, un ajuste externo) o una decisión suya, deja el trabajo en
  un estado consistente y devuelve `necesita-usuario` con los pasos exactos.
  El orquestador te reenviará la respuesta en este mismo contexto.

## Verificar
Corre los comandos de la sección "Verificación" del perfil. Guarda en
`GOALS_DIR/evidence/<GOAL>/` logs reproducibles: la línea 1 es
`$ <comando exacto>`, luego `exit=<código>` y después el resultado (resumen y
cola del log, no artefactos de build). Sin espacios al final de las líneas.
Para los criterios críticos, agrega una mutación: rompe a propósito el código,
demuestra que la prueba falla, restaura y registra el log. Revisa tú mismo cada
criterio; si alguno no cumple y puedes arreglarlo dentro del alcance, arréglalo
antes de entregar. Lo que dependa de una prueba manual (sección "Pasos manuales"
del perfil) va como "pendiente de prueba manual", nunca como cumplido.

## Entregar
1. Escribe `GOALS_DIR/<GOAL>.delivery-<N>.md` con
   `.claude/skills/arq-loop/templates/delivery.md`. Lo no verificado se declara
   "no verificado"; nunca se presenta como cumplido.
2. Commitea el código, la entrega y la evidencia en un solo commit del goal:
   `feat(<GOAL>): <titulo>` (o `fix`, `test`, `refactor`, `docs`). Termina el
   mensaje con la línea de coautoría que indique la sesión.
3. Corre el pre-check con el comando que te pasó el orquestador. Si falla,
   corrige dentro del alcance, commitea `fix(<GOAL>): <qué>` y repítelo (con
   `--no-commands` si solo tocaste documentos o evidencia). Tras 3 vueltas sin
   pasar, devuelve `bloqueado` con la salida del pre-check.

## Respuesta al orquestador
Máximo 12 líneas, sin repetir el contenido de la entrega:

```
estado: entregado | necesita-usuario | bloqueado
commit_entrega: <sha>
entrega: <ruta de G-XX.delivery-N.md>
pre-check: OK | <controles que fallan>
paquete: <ruta del paquete de evidencia>
criterios: <n> cumple, <n> no verificado
desviaciones: <una línea cada una, o "ninguna">
pasos para el usuario: <solo si necesita-usuario>
```
~~~~
