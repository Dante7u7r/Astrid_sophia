# Suite de validación científica

La suite ejecuta circuitos canónicos con el solver Rust real y compara observaciones numéricas
contra referencias versionadas. Un caso aprobado significa únicamente que esas observaciones
cumplen las tolerancias declaradas.

## Ejecución

Desde la raíz del repositorio:

```bash
# Windows: descarga portátil oficial, verifica SHA-256 y no modifica PATH
npm run setup:ngspice:windows

npm run validate:scientific
```

El comando devuelve:

- código `0` si todos los casos cumplen sus tolerancias;
- código `1` si al menos un caso científico falla;
- código `2` si el manifiesto, un caso, una referencia o el reporte son inválidos.

Los reportes se generan en:

- `validation/reports/latest.json`, para automatización;
- `validation/reports/latest.md`, para revisión humana.

## Estructura

```text
validation/
  manifest.json
  cases/          circuitos, ajustes de solver y selectores de observación
  ngspice/        netlists externos ejecutados en batch
  references/     valores esperados, derivaciones, unidades y tolerancias
  reports/        resultado generado
  bootstrap-ngspice.ps1
```

Los archivos usan `schemaVersion: 1`. El ejecutor rechaza IDs duplicados, referencias cruzadas
incorrectas, tolerancias negativas, coordenadas ausentes y valores no finitos.

## Matriz científica actual

| Caso | Análisis | Referencia |
|---|---|---|
| `dc-resistive-divider` | DC | Divisor resistivo cerrado |
| `dc-diode-shockley-sweep` | Barrido DC | Shockley ideal a 300 K, cinco puntos |
| `ac-rc-low-pass-cutoff` | AC | `H(jω)=1/(1+jωRC)` en `fc` |
| `ac-rl-low-pass-sweep` | AC | RL en `0.1fc`, `fc` y `10fc` |
| `ac-rlc-band-pass-resonance` | AC | RLC serie en resonancia |
| `transient-rc-step-tau` | Transitorio BE | `Vc(t)=V(1-e^{-t/RC})` en `t=τ` |
| `transient-rc-step-trap` | Transitorio TRAP | RC en `0.25τ`, `τ` y `2τ` |
| `transient-rc-step-gear2` | Transitorio Gear2 | RC en `0.25τ`, `τ` y `2τ` |
| `transient-rl-step-sweep` | Transitorio | `I(t)=V/R·(1-e^{-tR/L})`, cinco puntos |
| `external-dc-resistive-divider` | DC externo | Punto de operación ngspice |
| `external-ac-rc-low-pass-cutoff` | AC externo | Fasor complejo ngspice |
| `external-transient-rc-step-trap` | Transitorio externo | Raw adaptativo TRAP de ngspice |
| `external-dc-diode-shockley-sweep` | Barrido DC externo | Diodo ideal ngspice, cinco puntos |
| `pss-rc-sine-steady-state` | PSS | Régimen periódico de un RC lineal |
| `stability-rc-pole-zero` | Polos/ceros | Polo y cero analíticos de una red RC |

La matriz contiene 15 casos y 50 observaciones. Además de tensiones, magnitudes, fases y
corrientes, calcula residuos KCL DC, AC complejo y transitorio RC. Los transitorios usan
BE, TRAP y Gear2 con pasos y tolerancias documentados; no se presentan como soluciones exactas.

El reloj transitorio representa el último tiempo aceptado. Cada solución se evalúa y publica en
`t + dtAceptado`; el `dt` candidato siguiente no altera esa coordenada. La primera muestra se
publica en `t=dt`, no como un falso estado inicial en `t=0`, y el último paso se recorta para
terminar exactamente en `tMax`.

Durante esta fase se detectó y corrigió que el análisis transitorio conservaba las
aproximaciones DC de capacitores e inductores además de sus companion models. Esa doble
estampación añadía conductancias artificiales de `1 nS` y `1 kS`, respectivamente. Una prueba
de regresión impide reintroducirla. Al retirar esas conductancias también quedó expuesto y se
corrigió el signo del término histórico del capacitor en TRAP. La Fase 3 añadió arranque BE al
primer paso TRAP, porque todavía no existe historia trapezoidal en `t=0`.

## Referencia externa

Cuatro casos ejecutan `ngspice` realmente en cada corrida. El arnés genera un raw ASCII temporal,
valida su estructura y extrae tensiones, corrientes y fasores complejos. Para transitorio interpola
entre los dos puntos adaptativos que rodean el tiempo solicitado. La versión exacta de ngspice
queda registrada en el reporte.

La suite busca `NGSPICE_BIN`, después `ngspice`/`ngspice_con.exe` en `PATH` y finalmente el
binario portátil de `validation/.tools`. Ese directorio está ignorado por Git. El bootstrap de
Windows fija ngspice 46 y verifica el archivo oficial con SHA-256 antes de extraerlo. CI instala
ngspice explícitamente; si falta el ejecutable, los casos externos fallan y no se omiten.

Esto es correlación independiente de implementación, pero todavía no es validación de silicio:
el caso no lineal usa un diodo Shockley ideal configurado de forma equivalente en ambos motores.

La caracterización BSIM3 se ejecuta por separado con `npm run characterize:bsim`. Es
deliberadamente no bloqueante para la entrega porque documenta una brecha conocida: el caso NMOS
versionado falla sus cinco observaciones y presenta errores relativos de corriente entre 97.9 % y
99.3 % frente a ngspice. Un fallo de ese comando es actualmente el resultado esperado, no una
certificación del modelo.
