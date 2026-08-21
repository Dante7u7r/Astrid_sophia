# Campaña local de diversidad — Fase 5

Resultado: **PASS** — 500/500 ejecuciones dentro de tolerancia.

- Dataset SHA-256: `fd0b35761ecb2784be1a11735819f13dee70ab26d6244469e7eaea56889ecd2f`
- Parámetros únicos: 500
- Sesiones cronológicas: 20
- Familias: 5
- Modos de análisis: AC, DC, TRAN
- Tiempo: 1116 ms

| Familia | Análisis | Ejecuciones | Aprobadas | Error absoluto máximo |
|---|---:|---:|---:|---:|
| ac-rc-cutoff | AC | 100 | 100 | 2.220446e-15 |
| ac-rl-cutoff | AC | 100 | 100 | 2.131628e-14 |
| dc-loaded-bridge | DC | 100 | 100 | 3.552714e-15 |
| dc-resistive-divider | DC | 100 | 100 | 1.776357e-15 |
| transient-rc-tau | TRAN | 100 | 100 | 9.752014e-5 |

## Límites

- Campaña automatizada local; no representa decisiones ni aceptación de usuarios reales.
- Cinco familias paramétricas no cubren todo el espacio de circuitos, modelos o hardware.
- Las sesiones de campaña son lotes cronológicos reproducibles, no sesiones futuras de campo.
