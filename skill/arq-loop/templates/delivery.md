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
