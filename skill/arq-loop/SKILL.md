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
