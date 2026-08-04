# Caracterización no bloqueante de la brecha BSIM3

Resultado: **FAIL** — 0/1 casos aprobados.
Observaciones: **0/5** dentro de tolerancia.

- Suite: `bsim3-gap-characterization`
- Solver: `0.1.0`
- Git: `72e630f141e7` (`dirty`)
- Plataforma: `windows-x86_64`
- ngspice: `** ngspice-46 : Circuit level simulation program`

| Caso | Análisis | Observación | Actual | Esperado | Error absoluto | Límite | Estado |
|---|---:|---|---:|---:|---:|---:|:---:|
| external-dc-bsim3-nmos-transfer | DC SWEEP | drain_current_0_8v | -1.3903708279e-5 A | -6.5262837801e-4 A | 6.387e-4 | 1.632e-4 | FAIL |
| external-dc-bsim3-nmos-transfer | DC SWEEP | drain_current_1_0v | -2.0140804926e-5 A | -1.5112781977e-3 A | 1.491e-3 | 3.778e-4 | FAIL |
| external-dc-bsim3-nmos-transfer | DC SWEEP | drain_current_1_2v | -2.5483653511e-5 A | -2.6203834459e-3 A | 2.595e-3 | 6.551e-4 | FAIL |
| external-dc-bsim3-nmos-transfer | DC SWEEP | drain_current_1_4v | -3.0799437896e-5 A | -3.9241936876e-3 A | 3.893e-3 | 9.810e-4 | FAIL |
| external-dc-bsim3-nmos-transfer | DC SWEEP | drain_current_1_6v | -3.5079156876e-5 A | -5.3388786922e-3 A | 5.304e-3 | 1.335e-3 | FAIL |

## Referencias y derivaciones

- **external-dc-bsim3-nmos-transfer** — ngspice_live: ngspice ejecutado en vivo con BSIM3v3 LEVEL=49, VDS=1 V, W=10 um, L=0.18 um, VTH0=0.4 V, TOX=4 nm, U0=450 cm2/Vs y VSAT=8e4 m/s.
  - `drain_current_0_8v`: i(VD) en VG=0.8 V
  - `drain_current_1_0v`: i(VD) en VG=1.0 V
  - `drain_current_1_2v`: i(VD) en VG=1.2 V
  - `drain_current_1_4v`: i(VD) en VG=1.4 V
  - `drain_current_1_6v`: i(VD) en VG=1.6 V

## Limitaciones

- La correlación ngspice cubre únicamente los casos marcados como referencia externa; el resto conserva referencias analíticas cerradas.
- El solver no emite un punto de operación separado en t=0; la primera muestra publicada es la primera solución integrada en t=dt.
- El caso externo de diodo correlaciona un modelo ideal de Shockley configurado de forma equivalente; no valida alta inyección, ruptura, resistencia serie ni un dispositivo físico.
- La matriz principal valida un caso PSS lineal y una extracción reducida de polos/ceros, pero no valida ruido, sensibilidad, estabilidad de lazo ni MCU.
- La caracterización BSIM3 separada cuantifica una discrepancia de corriente frente a ngspice y no certifica el modelo.
- Aprobar la suite sólo demuestra conformidad con los casos, residuos y tolerancias versionados.
