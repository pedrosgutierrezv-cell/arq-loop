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
