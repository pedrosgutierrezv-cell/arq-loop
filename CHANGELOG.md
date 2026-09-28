# Changelog

## 2.0.0 · 2026-09-28

Rediseño orientado a costo, a partir de mediciones de uso real. El ciclo
arquitecto ↔ implementador no cambia; cambia quién hace cada parte y cuánto
contexto relee.

### Nuevo

- **Agentes** en `agents/`:
  - `arq-orchestrator`: sesión principal (`claude --agent arq-orchestrator`) con
    el modelo y el effort fijos para toda la sesión.
  - `arq-implementer`: implementa cada intento en un subagente con contexto
    limpio, caché de 5 minutos y reglas de lectura para gastar menos llamadas.
  - `arq-implementer-medium`: variante con effort `medium` para un A/B, generada
    por `scripts/sync-agents.mjs`.
- `scripts/precheck.mjs`: pre-check local (C1–C9) antes de cada validate. Revisa
  árbol limpio, entrega, criterios, `git diff --check` del rango, archivos de
  Codex intactos, logs reproducibles, referencias, secretos y los comandos del
  perfil según el diff. Genera el paquete de evidencia para Codex, con
  revalidación incremental desde el intento 2.
- `scripts/context-pack.mjs`: paquete de contexto para el implementador, con
  archivos del goal, esquema de símbolos e imports, mapa del módulo y
  ubicaciones del veredicto anterior. Entiende Kotlin, TS/JS, Python, Go,
  Java/C#, Swift y Rust.
- `scripts/usage.mjs` y el subcomando `usage`: tokens y USD equivalentes por
  ronda, goal, flujo, modelo, validador y variante del implementador, de Claude
  y Codex, más el uso de la ventana de 5 h de Codex. Actualiza la sección
  "Consumo de tokens" de `STATUS.md` después de cada veredicto.
- **Aprobación única del plan**: una sola pregunta aprueba la cola y elige el
  modo, que queda en `STATUS.md` (`Modo:`).
- Perfil: secciones "Herramientas", "Pasos manuales" y "Pre-check".
- `examples/settings.json`: permisos sugeridos (`allow`, `ask` y `deny`).
- `tools/build-single-file.mjs`: regenera `arq-loop-skill.md`.

### Cambios

- `codex.sh <model> <effort> <prompt> <out>`: el modelo es obligatorio y se
  rechaza la firma anterior. Matriz por flujo en `SKILL.md`: Sol high para
  plan, revise y validate de arquitectura; Luna high para validate estándar
  (ajustable).
- `prompts/validate.md`: recibe `EVIDENCE_PACK` y un presupuesto de exploración
  (no repetir comandos ya ejecutados, como máximo 3 re-ejecuciones y, en los
  reintentos, solo lo que falló). Cada veredicto registra `modelo_validador`.
- `split.mjs`: quita los espacios finales y deja un único salto de línea al
  final, porque rompían `git diff --check`.
- `run`: pasos manuales avisados una sola vez al inicio, paradas humanas
  explícitas y, en modo autónomo, un reintento guiado con Opus tras 2 FAIL de
  un goal estándar sin hallazgos altos.
- El orquestador ya no implementa; `SKILL.md` ya no usa `model:` en su
  frontmatter, porque dura solo el turno que lo invoca.

### Migración desde 1.x

1. Copia `agents/*.md` a `.claude/agents/` y abre una sesión nueva.
2. Reemplaza `.claude/skills/arq-loop/` por la versión nueva y conserva tu perfil.
3. Agrega a tu perfil las secciones "Pre-check" y, si aplican, "Herramientas" y
   "Pasos manuales".
4. Abre las sesiones de arq-loop con `claude --agent arq-orchestrator`.

## 1.0.0

Versión inicial: ciclo plan → run → validate → revise con Codex en solo
lectura y Claude Code como implementador.
