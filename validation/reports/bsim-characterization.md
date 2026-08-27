# Caracterización no bloqueante de la brecha BSIM3

Resultado: **PASS** — 1/1 casos aprobados.
Observaciones: **5/5** dentro de tolerancia.

- Suite: `bsim3-gap-characterization`
- Solver: `0.1.0`
- Git: `05532fbe19ac` (`dirty`)
- Plataforma: `windows-x86_64`
- ngspice: `** ngspice-47 : Circuit level simulation program`

| Caso | Análisis | Observación | Actual | Esperado | Error absoluto | Límite | Estado |
|---|---:|---|---:|---:|---:|---:|:---:|
| external-dc-bsim3-nmos-transfer | DC SWEEP | drain_current_0_8v | -6.4402003407e-4 A | -6.5262837801e-4 A | 8.608e-6 | 1.632e-4 | PASS |
| external-dc-bsim3-nmos-transfer | DC SWEEP | drain_current_1_0v | -1.5708388049e-3 A | -1.5112781977e-3 A | 5.956e-5 | 3.778e-4 | PASS |
| external-dc-bsim3-nmos-transfer | DC SWEEP | drain_current_1_2v | -2.6535594850e-3 A | -2.6203834459e-3 A | 3.318e-5 | 6.551e-4 | PASS |
| external-dc-bsim3-nmos-transfer | DC SWEEP | drain_current_1_4v | -3.8013166884e-3 A | -3.9241936876e-3 A | 1.229e-4 | 9.810e-4 | PASS |
| external-dc-bsim3-nmos-transfer | DC SWEEP | drain_current_1_6v | -4.9711150933e-3 A | -5.3388786922e-3 A | 3.678e-4 | 1.335e-3 | PASS |

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
