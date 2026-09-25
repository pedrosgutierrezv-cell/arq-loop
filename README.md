# arq-loop

**Ciclo arquitecto ↔ implementador para Claude Code.** Codex diseña y certifica;
Claude implementa. Ningún trabajo queda "terminado" sin un veredicto
independiente respaldado por evidencia.

`arq-loop` es una [skill de Claude Code](https://docs.claude.com/en/docs/claude-code/skills)
que reparte cada cambio entre dos agentes con roles fijos:

| Rol | Quién | Qué hace |
|---|---|---|
| **Arquitecto y validador** | Codex, vía el plugin oficial `codex` para Claude Code, en **solo lectura** | Divide tu solicitud en *goals* pequeños y verificables, revisa el plan cuando algo cambia y emite un veredicto **PASS/FAIL** por cada entrega |
| **Implementador** | Claude Code | Implementa cada goal, ejecuta tus tests y builds, deja evidencia reproducible y commitea |

Reglas que no se rompen:

- Claude nunca escribe ni edita goals o veredictos; Codex nunca edita el repo.
- Un goal pasa a `pass` sólo con un veredicto de Codex que lo diga.
- Tras **dos** intentos fallidos, el ciclo se detiene y te pregunta cómo seguir.
- Lo que no se verificó se declara "no verificado" y nunca se presenta como cumplido.

---

## Cómo funciona

```
/arq-loop plan <solicitud>
   └─ Codex lee tu repo y escribe G-01…G-NN + STATUS.md   (rama arq/<feature>)

/arq-loop run
   └─ por cada goal ejecutable:
        Claude implementa → verifica → entrega (commit)
        Codex valida el diff y la evidencia
          ├─ PASS → siguiente goal
          ├─ FAIL → intento 2 con las instrucciones del veredicto
          └─ 2 FAIL → se detiene y te pregunta

/arq-loop revise G-XX <motivo>
   └─ Codex ajusta el plan: hallazgos, cambios de alcance, goals nuevos
```

Todo queda versionado en tu repo:

```
<spec>/goals/
├── STATUS.md                 # estado, intentos, commits y desviaciones abiertas
├── G-01.md                   # goal (Codex)
├── G-01.delivery-1.md        # entrega (Claude)
├── G-01.verdict-1.md         # veredicto (Codex)
└── evidence/G-01/            # logs y capturas (Claude)
```

---

## Requisitos

- [Claude Code](https://docs.claude.com/en/docs/claude-code) con soporte de skills.
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
mkdir -p .claude/skills
cp -R ../arq-loop/skill/arq-loop .claude/skills/arq-loop
chmod +x .claude/skills/arq-loop/scripts/*
```

Commitea `.claude/skills/arq-loop/` en tu proyecto: así la skill viaja con el
repo y todo tu equipo la tiene.

### Opción B · un solo archivo

[`arq-loop-skill.md`](arq-loop-skill.md) contiene la documentación y todos los
archivos embebidos. Desde la raíz de tu proyecto:

```bash
DEST=.claude/skills/arq-loop
awk -v dest="$DEST" '
  /^<!-- arq-loop:file / { path = $3; next }
  path != "" && /^~~~~/ { if (open) { close(out); open = 0; path = "" } else { out = dest "/" path; system("mkdir -p \"$(dirname \"" out "\")\""); open = 1; printf "" > out }; next }
  open { print >> out }
' arq-loop-skill.md
chmod +x "$DEST"/scripts/*
```

### Instalación global (opcional)

Para usarla en todos tus proyectos, copia `skill/arq-loop` a
`~/.claude/skills/arq-loop/`. Luego:

1. Reemplaza en `SKILL.md` las rutas `.claude/skills/arq-loop/...` por
   `~/.claude/skills/arq-loop/...`.
2. Crea un perfil por proyecto en `<proyecto>/.claude/arq-loop.project.md`. La
   skill lo busca antes que el `project.md` de la carpeta de la skill.

## Configuración: `project.md`

Es lo único que tienes que editar. Codex lo recibe en **cada** prompt, y Claude
usa sus comandos para verificar cada goal. Si sigue con los textos de ejemplo,
la skill se detiene y te pide completarlo.

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

## Specs
Raíz de specs: `specs`

## Registro de decisiones
`docs/DECISIONS.md`
```

Cuanto más concretos sean los comandos de verificación y las restricciones,
mejores serán los criterios de aceptación que escribe Codex y más estricta la
validación.

## Uso

| Comando | Qué hace |
|---|---|
| `/arq-loop plan <solicitud>` | Crea la rama `arq/<feature>` y pide a Codex la cola de goals |
| `/arq-loop run` | Ejecuta goals hasta terminar, llegar a 2 FAIL o encontrar un bloqueo |
| `/arq-loop next` | Ejecuta un solo goal: implementar → verificar → entregar → validar |
| `/arq-loop validate [G-XX]` | Pide el veredicto de Codex para la última entrega |
| `/arq-loop revise <G-XX[,G-YY]> <motivo>` | Codex revisa o agrega goals |
| `/arq-loop status` | Muestra el estado, las desviaciones abiertas y el siguiente goal |

La primera vez que ejecutas goals en una sesión, la skill pregunta el modo:

- **Revisar cada goal:** te muestra cada goal y espera tu aprobación, o que
  pidas un cambio al arquitecto, lo saltes o detengas el ciclo.
- **Autónomo:** encadena implementar → validar → corregir hasta terminar la
  cola, llegar a 2 FAIL o encontrar un bloqueo.

### Ejemplo de sesión

```text
> /arq-loop plan agregar recuperación de contraseña por email

  Codex propone:
  | Goal | Título                                   | Nivel        | Depende de |
  | G-01 | Modelo y almacenamiento de tokens        | arquitectura | —          |
  | G-02 | Endpoint de solicitud con rate limit     | estandar     | G-01       |
  | G-03 | Pantalla de restablecimiento             | estandar     | G-02       |
  | G-04 | Aceptación end-to-end                    | estandar     | G-03       |

> /arq-loop run
  G-01 … veredicto FAIL (falta expirar tokens usados) → intento 2 → PASS
  G-02 … PASS
  G-03 … PASS
  G-04 … PASS
  Cola completa. Sugerencia: /codex:review --base <commit del plan>
```

### Cuando alguien prueba el producto y encuentra algo

No lo parches fuera del plan. Usa `revise` con la cita textual, la causa
verificada y lo ya comprobado. Codex agrega un goal y hace depender de él el
goal de aceptación:

```text
> /arq-loop revise G-04 "QA: el botón Enviar queda habilitado con el email vacío"
```

## Buenas prácticas

- **Evidencia reproducible.** Cada log empieza con `$ <comando exacto>` y
  `exit=<código>`. Los veredictos rechazan logs que sólo resumen.
- **Mutaciones.** Para los criterios críticos, rompe el código a propósito,
  demuestra que la prueba falla, restaura y guarda ese log. Así se descubren
  pruebas que nunca fallan.
- **Aceptación manual explícita.** Si algo sólo se puede probar a mano (un
  dispositivo o un entorno real), el plan debe tener un goal de aceptación.
  Lo que nadie probó se declara "no verificado".
- **Goals chicos.** Cada `G-NN.md` tiene como máximo 3990 caracteres.
  `split.mjs` rechaza los más largos y Codex los divide.
- **Árbol limpio.** `plan` y cada goal parten de un árbol de git limpio. Un
  goal equivale a un commit base y una o más entregas.

## Estructura del repositorio

```
arq-loop/
├── README.md
├── LICENSE
├── arq-loop-skill.md          # versión de un solo archivo (opción B)
└── skill/arq-loop/
    ├── SKILL.md               # instrucciones que ejecuta Claude Code
    ├── project.md             # perfil de proyecto (plantilla a completar)
    ├── prompts/
    │   ├── plan.md            # Codex: diseñar la cola de goals
    │   ├── revise.md          # Codex: revisar el plan
    │   └── validate.md        # Codex: certificar una entrega
    ├── scripts/
    │   ├── codex.sh           # invoca a Codex en solo lectura
    │   ├── render.mjs         # rellena plantillas; falla si falta un placeholder
    │   └── split.mjs          # materializa los archivos que devuelve Codex
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
| `split.mjs` sale con código 3 | Un goal supera 3990 caracteres. La skill reintenta una vez pidiendo a Codex que lo divida |
| `render.mjs` sale con código 65 | Falta un valor para algún `{{PLACEHOLDER}}`. El mensaje lista cuáles |
| La skill pide completar `project.md` | El perfil no existe o sigue con los textos de ejemplo |
| Codex tarda más de 10 minutos | Es normal en `plan` y `revise` con esfuerzo `high`; la skill lo corre en segundo plano |

## Contribuir

Issues y pull requests son bienvenidos. Para cambios en la skill:

1. Mantén los roles: Codex en solo lectura; Claude, único que escribe.
2. No agregues nada específico de un proyecto; usa `project.md`.
3. Si cambias un script, verifica al menos:
   ```bash
   node --check skill/arq-loop/scripts/split.mjs
   node --check skill/arq-loop/scripts/render.mjs
   bash -n skill/arq-loop/scripts/codex.sh
   ```
4. Si cambias archivos de `skill/`, regenera `arq-loop-skill.md` para que
   ambas versiones coincidan.

## Licencia

[MIT](LICENSE).
