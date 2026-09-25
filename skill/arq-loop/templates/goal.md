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
