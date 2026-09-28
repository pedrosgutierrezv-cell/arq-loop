# arq-loop

**Ciclo arquitecto ↔ implementador para Claude Code.** Codex diseña y certifica;
Claude implementa. Ningún trabajo queda "terminado" sin un veredicto
independiente respaldado por evidencia, y el ciclo está diseñado para gastar
la menor cantidad posible de tokens de ambos planes.

`arq-loop` es una [skill de Claude Code](https://docs.claude.com/en/docs/claude-code/skills)
con dos agentes que reparten cada cambio en roles fijos:

| Rol | Quién | Qué hace |
|---|---|---|
| **Arquitecto y validador** | Codex, vía el plugin oficial `codex` para Claude Code, en **solo lectura** | Divide tu solicitud en *goals* pequeños y verificables, revisa el plan cuando algo cambia y emite un veredicto **PASS/FAIL** por cada entrega |
| **Orquestador** | Claude Code (Sonnet), en la sesión principal | Lanza a Codex y al implementador, materializa sus archivos, lleva `STATUS.md` y mide el consumo. No escribe código |
| **Implementador** | Claude Code, subagente `arq-implementer` con contexto limpio por intento | Implementa cada goal, ejecuta tus tests y builds, deja evidencia reproducible y commitea |

Reglas que no se rompen:

- Claude nunca escribe ni edita goals o veredictos; Codex nunca edita el repo.
- Un goal pasa a `pass` solo con un veredicto de Codex que lo diga.
- Lo que no se verificó se declara "no verificado" y nunca se presenta como cumplido.
- Antes de gastar un validate, la entrega pasa un pre-check local sin tokens.

---

## Cómo funciona

```
claude --agent arq-orchestrator          # sesión del orquestador (Sonnet)

/arq-loop plan <solicitud>
   └─ Codex lee tu repo y escribe G-01…G-NN + STATUS.md      (rama arq/<feature>)
   └─ Una sola pregunta: apruebas la cola y eliges el modo (autónomo o supervisado)

/arq-loop run
   └─ por cada goal ejecutable:
        context-pack.mjs arma el mapa del goal
        arq-implementer (subagente, contexto limpio) implementa → verifica → entrega
        precheck.mjs revisa lo mecánico sin tokens ─┐ falla → el implementador corrige
        Codex valida con el paquete de evidencia  ←┘
          ├─ PASS → siguiente goal
          ├─ FAIL → intento 2 con las instrucciones del veredicto (solo lo que falló)
          └─ 2 FAIL → reintento guiado con Opus (en autónomo, si el caso lo permite) o se detiene

/arq-loop revise G-XX <motivo>
   └─ Codex ajusta el plan: hallazgos, cambios de alcance, goals nuevos

/arq-loop usage
   └─ tokens y USD equivalentes por goal, intento, flujo y modelo, de Claude y Codex
```

Todo queda versionado en tu repo:

```
<spec>/goals/
├── STATUS.md                 # estado, modo, intentos, commits, desviaciones y consumo
├── G-01.md                   # goal (Codex)
├── G-01.delivery-1.md        # entrega (Claude)
├── G-01.verdict-1.md         # veredicto (Codex)
└── evidence/G-01/            # logs y capturas (Claude)
```

---

## Diseñado para gastar poco

Medido en uso real, el costo casi nunca viene de lo que el modelo escribe: viene
de **releer contexto**. Cada llamada de un agente reenvía toda su conversación, y
cada resultado de herramienta se escribe en la caché y se relee en cada llamada
siguiente. Por eso arq-loop ataca la cantidad de llamadas y el tamaño del
contexto, no la calidad de los modelos:

| Mecanismo | Qué evita |
|---|---|
| **Un subagente por intento** (`arq-implementer`) | Que el contexto crezca goal tras goal en una sola conversación y cada llamada lea cientos de miles de tokens |
| **Orquestador fijo en Sonnet** (`claude --agent arq-orchestrator`) | El `model:` del frontmatter de una skill dura un solo turno; cada notificación de un subagente abre otro turno con el modelo de la sesión |
| **Modelo y effort de Codex fijados por flujo** (`codex.sh <model> <effort>`) | Que el costo dependa de `~/.codex/config.toml`, que puede apuntar a un modelo antiguo o caro |
| **Pre-check local** (`precheck.mjs`) | Gastar un validate en fallas mecánicas: espacios finales, EOF, criterios sin evidencia, logs sin `exit=`, secretos |
| **Paquete de evidencia y presupuesto de exploración** | Que Codex recorra el repo y repita comandos: recibe el diff, los logs y los resultados ya ejecutados, y puede re-ejecutar como máximo 3 |
| **Revalidación incremental** | Que un reintento vuelva a revisar criterios que ya pasaron |
| **Paquete de contexto** (`context-pack.mjs`) | Que el implementador descubra archivos con decenas de `ls`, `find`, `rg` y `sed`, una llamada por pedazo |
| **Caché de 5 minutos en el implementador** | Pagar la escritura de caché de 1 h (2× el precio de entrada) en llamadas que van casi seguidas |
| **Herramientas del proyecto** (sección del perfil) | Rearmar el entorno de build o buscar firmas de API a mano en cada intento |
| **A/B de effort** (`arq-implementer-medium`) | Elegir el effort a ciegas: se mide con `usage.mjs` |
| **Aprobación única del plan** | Preguntas repetidas: el modo queda en `STATUS.md` y `run` no vuelve a preguntar |

---

## Requisitos

- [Claude Code](https://docs.claude.com/en/docs/claude-code) con soporte de skills y subagentes.
- **Plugin de Codex para Claude Code** instalado y configurado. Ejecuta
  `/codex:setup` dentro de Claude Code. `scripts/codex.sh` busca
  `~/.claude/plugins/cache/openai-codex/codex/*/scripts/codex-companion.mjs`.
- **Node.js 18+** para los scripts.
- **git**.
- Una cuenta de Codex con cuota disponible.

## Instalación

### Opción A · clonar y copiar (recomendada)

```bash
git clone https://github.com/pedrosgutierrezv-cell/arq-loop.git
cd tu-proyecto
mkdir -p .claude/skills .claude/agents
cp -R ../arq-loop/skill/arq-loop .claude/skills/arq-loop
cp ../arq-loop/agents/*.md .claude/agents/
chmod +x .claude/skills/arq-loop/scripts/*
# Opcional: permisos para que el ciclo no se detenga a pedir confirmaciones
cp ../arq-loop/examples/settings.json .claude/settings.json   # o combínalo con el tuyo
```

Commitea `.claude/skills/arq-loop/` y `.claude/agents/` en tu proyecto: así la
skill viaja con el repo y todo tu equipo la tiene. Abre una sesión nueva de
Claude Code para que cargue los agentes.

### Opción B · un solo archivo

[`arq-loop-skill.md`](arq-loop-skill.md) contiene la documentación y todos los
archivos embebidos, agentes incluidos. Desde la raíz de tu proyecto:

```bash
DEST=.claude/skills/arq-loop
awk -v dest="$DEST" '
  /^<!-- arq-loop:file / { path = $3; next }
  path != "" && /^~~~~/ { if (open) { close(out); open = 0; path = "" } else { out = dest "/" path; system("mkdir -p \"$(dirname \"" out "\")\""); open = 1; printf "" > out }; next }
  open { print >> out }
' arq-loop-skill.md
chmod +x "$DEST"/scripts/*
```

Los agentes se extraen en `.claude/agents/` (su ruta embebida es `../../agents/`).

### Instalación global (opcional)

Para usarla en todos tus proyectos, copia `skill/arq-loop` a
`~/.claude/skills/arq-loop/` y `agents/*.md` a `~/.claude/agents/`. Luego:

1. Reemplaza en `SKILL.md` y en los agentes las rutas `.claude/skills/arq-loop/...`
   por `~/.claude/skills/arq-loop/...`.
2. Crea un perfil por proyecto en `<proyecto>/.claude/arq-loop.project.md`. La
   skill lo busca antes que el `project.md` de la carpeta de la skill.

## Configuración: `project.md`

Es lo único que tienes que editar. Codex lo recibe en **cada** prompt; Claude usa
sus comandos para verificar y sus herramientas para trabajar con menos
llamadas. Si sigue con los textos de ejemplo, la skill se detiene y te pide
completarlo.

| Sección | Para qué |
|---|---|
| Contexto | Qué es el producto y su stack |
| Leer antes de diseñar | Documentos fuente de verdad. Las rutas que terminan en `/` son las raíces de código del mapa del módulo |
| Restricciones | Reglas que todo goal debe respetar |
| Verificación | Comandos **exactos** de tests, build y lint |
| Herramientas | Opcional. Scripts que resuelven en una llamada lo que el implementador haría en varias |
| Pasos manuales | Opcional. Recursos que requieren a una persona (un dispositivo, una cuenta de prueba) y cómo comprobarlos |
| Pre-check | Qué comando re-ejecuta `precheck.mjs` según las rutas que toca el diff |
| Specs | Raíz de las specs (`specs` por defecto) |
| Registro de decisiones | Dónde anota el validador las decisiones |

Ejemplo:

```markdown
# Perfil del proyecto para arq-loop

## Contexto
Acme Store: tienda web B2C. Stack: Next.js 14, TypeScript, PostgreSQL.

## Leer antes de diseñar
- `README.md`
- `docs/ARCHITECTURE.md`
- `docs/DECISIONS.md`
- El código existente en `src/` y `tests/` que toque la solicitud.

## Restricciones
- Node 20. Sin dependencias nuevas sin justificarlas en DECISIONS.md.
- LCP < 2,5 s en la home. Accesibilidad WCAG 2.1 AA.

## Verificación
- Tests: `npm test -- --ci`
- Build: `npm run build`
- Lint / tipos: `npm run lint && npx tsc --noEmit`

## Herramientas
- `scripts/test.sh <filtro>`: tests de un área, con salida resumida y `$ comando` + `exit=`.

## Pasos manuales
| Recurso | Qué debe dejar listo el usuario | Comprobación |
|---|---|---|
| `staging` | Base de datos de staging con datos semilla | `npm run staging:ping` |

## Pre-check
| Si el diff toca | Comando |
|---|---|
| `src/**` | `npm test -- --ci` |
| `db/migrations/**` | `npm run db:check` |

## Specs
Raíz de specs: `specs`

## Registro de decisiones
`docs/DECISIONS.md`
```

## Uso

Abre la sesión con el orquestador. Así corre en Sonnet de principio a fin:

```bash
claude --agent arq-orchestrator
```

| Comando | Qué hace |
|---|---|
| `/arq-loop plan <solicitud>` | Crea la rama `arq/<feature>`, pide a Codex la cola de goals y te pide una sola aprobación con el modo |
| `/arq-loop run` | Ejecuta goals hasta terminar la cola o llegar a una parada humana |
| `/arq-loop next` | Ejecuta un solo goal: implementar → pre-check → validar |
| `/arq-loop validate [G-XX]` | Pide el veredicto de Codex para la última entrega |
| `/arq-loop revise <G-XX[,G-YY]> <motivo>` | Codex revisa o agrega goals |
| `/arq-loop status` | Muestra el estado, las desviaciones abiertas y el siguiente goal |
| `/arq-loop usage` | Consumo de tokens y USD equivalentes por ronda, goal, flujo y modelo |

**Modos.** Al aprobar el plan eliges uno, y queda en `STATUS.md`:

- **Autónomo:** encadena implementar → pre-check → validar → corregir y solo se
  detiene en una parada humana: la cola terminó, un goal no puede seguir tras
  sus intentos, un goal de arquitectura falló dos veces, un bloqueo, un error o
  límite de Codex, un paso manual o un gate de producción.
- **Supervisado:** antes de cada goal te lo muestra y espera tu aprobación.

`run --autonomo` y `run --supervisado` cambian el modo.

### Ejemplo de sesión

```text
> /arq-loop plan agregar recuperación de contraseña por email

  Codex propone:
  | Goal | Título                                   | Nivel        | Depende de |
  | G-01 | Modelo y almacenamiento de tokens        | arquitectura | —          |
  | G-02 | Endpoint de solicitud con rate limit     | estandar     | G-01       |
  | G-03 | Pantalla de restablecimiento             | estandar     | G-02       |
  | G-04 | Aceptación end-to-end                    | estandar     | G-03       |
  ¿Aprobar y ejecutar en autónomo? → Sí

  G-01 … FAIL (falta expirar tokens usados) → intento 2 → PASS · $1,20
  G-02 … PASS · $0,85
  G-03 … pre-check: espacios finales en un log → corregido → PASS · $0,70
  G-04 … PASS · $0,60
  Cola completa. Sugerencia: /codex:review --base <commit del plan>
```

### Cuando alguien prueba el producto y encuentra algo

No lo parches fuera del plan. Usa `revise` con la cita textual, la causa
verificada y lo ya comprobado. Codex agrega un goal y hace depender de él el
goal de aceptación:

```text
> /arq-loop revise G-04 "QA: el botón Enviar queda habilitado con el email vacío"
```

## Modelos

Las tablas están en `SKILL.md`. Ajusta los nombres a lo que ofrezca tu cuenta.

**Codex** (siempre explícitos en `codex.sh`; los modelos disponibles están en `~/.codex/models_cache.json`):

| Flujo | Modelo · effort |
|---|---|
| `plan`, `revise`, `validate` de arquitectura | `gpt-6-sol · high` |
| `validate` estándar | `gpt-6-luna · high`: el más barato y con más cuota, a cambio de un validador menos exigente. Para más rigor, `gpt-6-sol · medium` |

Cada veredicto registra `modelo_validador`, y `usage.mjs` muestra el % de FAIL
por modelo para que veas si el validador barato está a la altura.

**Claude** (los agentes usan alias, así siempre corre el modelo más reciente de cada familia):

| Quién | Modelo · effort |
|---|---|
| Orquestador (`arq-orchestrator`) | `sonnet · medium` |
| Implementador, goals estándar | `sonnet`: A/B entre `arq-implementer-medium` (goals impares) y `arq-implementer` en high (pares) en los intentos 1 |
| Implementador, goals de arquitectura, reintentos guiados y escaladas | `opus · high` |

El alias depende de la versión de Claude Code instalada: mantenla actualizada.
Si aparece un modelo sin precio, `usage.mjs` lo avisa en vez de contarlo en $0.

## Medir el consumo

```bash
node .claude/skills/arq-loop/scripts/usage.mjs [--spec <dir>] [--since AAAA-MM-DD] [--write] [--json]
```

Cruza los transcripts de Claude Code (incluidos los subagentes) con las
sesiones de Codex y reporta:

- por ronda (goal e intento): llamadas, lecturas de caché, salida y USD de
  Claude; modelo, effort, herramientas, entrada y USD de Codex; uso de la
  ventana de 5 h; veredicto;
- por goal, por validador (% de FAIL), por variante del implementador (A/B) y
  por flujo y modelo.

Con `--write` actualiza la sección "Consumo de tokens" de `STATUS.md`; el skill
lo hace solo después de cada veredicto. Los USD son equivalentes a precio de
API: los planes de suscripción miden uso, pero en proporción a los mismos
tokens. Actualiza `PRICES` en el script si cambian los precios.

## Buenas prácticas

- **Evidencia reproducible.** Cada log empieza con `$ <comando exacto>` y
  `exit=<código>`. El pre-check lo exige y los veredictos rechazan logs que
  solo resumen.
- **Mutaciones.** Para los criterios críticos, rompe el código a propósito,
  demuestra que la prueba falla, restaura y guarda ese log.
- **Aceptación manual explícita.** Declara los recursos en "Pasos manuales".
  Lo que nadie probó se entrega como "pendiente de prueba manual".
- **Herramientas de una llamada.** Si el implementador repite la misma
  secuencia de comandos, conviértela en un script y declárala en
  "Herramientas".
- **Goals chicos.** Cada `G-NN.md` tiene como máximo 3990 caracteres.
  `split.mjs` rechaza los más largos y Codex los divide.
- **Árbol limpio.** `plan` y cada goal parten de un árbol de git limpio. Un
  goal equivale a un commit base y una o más entregas.
- **Mide antes de optimizar.** `usage.mjs --since <fecha>` compara un cambio
  del flujo contra las corridas anteriores.

## Estructura del repositorio

```
arq-loop/
├── README.md
├── CHANGELOG.md
├── LICENSE
├── arq-loop-skill.md              # versión de un solo archivo (opción B), generada
├── agents/                        # van a .claude/agents/
│   ├── arq-orchestrator.md        # sesión principal: claude --agent arq-orchestrator
│   ├── arq-implementer.md         # implementador (effort high)
│   └── arq-implementer-medium.md  # variante A/B, generada por sync-agents.mjs
├── examples/
│   └── settings.json              # permisos sugeridos para .claude/settings.json
├── tools/
│   ├── build-single-file.mjs      # regenera arq-loop-skill.md
│   └── single-file-header.md
└── skill/arq-loop/                # va a .claude/skills/arq-loop/
    ├── SKILL.md                   # instrucciones que ejecuta el orquestador
    ├── project.md                 # perfil de proyecto (plantilla a completar)
    ├── prompts/
    │   ├── plan.md                # Codex: diseñar la cola de goals
    │   ├── revise.md              # Codex: revisar el plan
    │   └── validate.md            # Codex: certificar una entrega
    ├── scripts/
    │   ├── codex.sh               # invoca a Codex en solo lectura con modelo y effort
    │   ├── render.mjs             # rellena plantillas; falla si falta un placeholder
    │   ├── split.mjs              # materializa los archivos que devuelve Codex
    │   ├── precheck.mjs           # pre-check local y paquete de evidencia
    │   ├── context-pack.mjs       # paquete de contexto para el implementador
    │   ├── usage.mjs              # medición de consumo
    │   └── sync-agents.mjs        # genera las variantes del implementador
    └── templates/
        ├── goal.md
        ├── delivery.md
        └── STATUS.md
```

## Solución de problemas

| Síntoma | Causa y solución |
|---|---|
| `No se encontro el plugin de Codex` | Instala o configura el plugin con `/codex:setup` |
| `You've hit your usage limit` | Codex sin cuota. El ciclo se detiene; relanza cuando se renueve |
| `Agent type 'arq-implementer' not found` | Los agentes se cargan al abrir la sesión. Abre una sesión nueva después de copiarlos |
| El skill avisa que el orquestador no corre en Sonnet | Abriste la sesión con `claude` a secas. Usa `claude --agent arq-orchestrator` |
| `sync-agents.mjs --check` falla | Editaste `arq-implementer.md`. Corre `sync-agents.mjs` sin `--check`, commitea y abre una sesión nueva |
| `Uso antiguo sin modelo` | `codex.sh` exige `<model> <effort>`. Usa la tabla de `SKILL.md` |
| El pre-check falla | Lee el control (C1–C9) que falló. El implementador lo corrige antes de llamar a Codex |
| `usage.mjs` avisa "Sin precio en PRICES" | Hay un modelo nuevo. Agrega su precio al script |
| `split.mjs` sale con código 3 | Un goal supera 3990 caracteres. La skill reintenta una vez pidiendo a Codex que lo divida |
| `render.mjs` sale con código 65 | Falta un valor para algún `{{PLACEHOLDER}}`. El mensaje lista cuáles |
| La skill pide completar `project.md` | El perfil no existe o sigue con los textos de ejemplo |

## Contribuir

Issues y pull requests son bienvenidos. Para cambios en la skill:

1. Mantén los roles: Codex en solo lectura; el orquestador no implementa; el
   implementador es el único que escribe código.
2. No agregues nada específico de un proyecto; usa `project.md`.
3. Si cambias un script o un agente, verifica al menos:
   ```bash
   for f in skill/arq-loop/scripts/*.mjs tools/*.mjs; do node --check "$f"; done
   bash -n skill/arq-loop/scripts/codex.sh
   node skill/arq-loop/scripts/sync-agents.mjs --dir agents --check
   ```
4. Edita solo `agents/arq-implementer.md`; la variante se regenera con
   `node skill/arq-loop/scripts/sync-agents.mjs --dir agents`.
5. Regenera la versión de un archivo con `node tools/build-single-file.mjs` y
   anota el cambio en `CHANGELOG.md`.

## Licencia

[MIT](LICENSE).
