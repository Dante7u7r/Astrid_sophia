# Correlación científica externa de Astryd Sophia — Fase 4

Resultado: **PASS** — 15/15 casos aprobados.
Observaciones: **50/50** dentro de tolerancia.

- Suite: `phase4-external-correlation`
- Solver: `0.1.0`
- Git: `cb208e285cb6` (`dirty`)
- Plataforma: `windows-x86_64`
- ngspice: `** ngspice-47 : Circuit level simulation program`

| Caso | Análisis | Observación | Actual | Esperado | Error absoluto | Límite | Estado |
|---|---:|---|---:|---:|---:|---:|:---:|
| dc-resistive-divider | DC | vout | 4.0000000000e0 V | 4.0000000000e0 V | 0.000e0 | 4.000e-9 | PASS |
| dc-resistive-divider | DC | kcl_node_2 | 0.0000000000e0 A | 0.0000000000e0 A | 0.000e0 | 1.000e-12 | PASS |
| dc-diode-shockley-sweep | DC SWEEP | source_current_0_1v | -4.6954861294e-11 A | -4.6854861294e-11 A | 1.000e-13 | 5.000e-13 | PASS |
| dc-diode-shockley-sweep | DC SWEEP | source_current_0_2v | -2.2892877495e-9 A | -2.2890877495e-9 A | 2.000e-13 | 5.000e-12 | PASS |
| dc-diode-shockley-sweep | DC SWEEP | source_current_0_3v | -1.0959113160e-7 A | -1.0959083160e-7 A | 3.000e-13 | 2.192e-10 | PASS |
| dc-diode-shockley-sweep | DC SWEEP | source_current_0_4v | -5.2445013003e-6 A | -5.2445009003e-6 A | 4.000e-13 | 1.049e-8 | PASS |
| dc-diode-shockley-sweep | DC SWEEP | source_current_0_5v | -2.5097491050e-4 A | -2.5097491000e-4 A | 5.000e-13 | 5.019e-7 | PASS |
| ac-rc-low-pass-cutoff | AC | gain_at_fc | -3.0102999566e0 dB | -3.0102999566e0 dB | 4.441e-16 | 2.000e-3 | PASS |
| ac-rc-low-pass-cutoff | AC | phase_at_fc | -4.5000000000e1 deg | -4.5000000000e1 deg | 0.000e0 | 2.000e-2 | PASS |
| ac-rc-low-pass-cutoff | AC | kcl_at_fc | 2.1684043450e-19 A | 0.0000000000e0 A | 2.168e-19 | 1.000e-10 | PASS |
| ac-rl-low-pass-sweep | AC | gain_fc_over_10 | -4.3213737826e-2 dB | -4.3213737826e-2 dB | 1.166e-15 | 2.000e-3 | PASS |
| ac-rl-low-pass-sweep | AC | phase_fc_over_10 | -5.7105931375e0 deg | -5.7105931375e0 deg | 8.882e-16 | 2.000e-2 | PASS |
| ac-rl-low-pass-sweep | AC | kcl_fc_over_10 | 1.0408340856e-17 A | 0.0000000000e0 A | 1.041e-17 | 1.000e-10 | PASS |
| ac-rl-low-pass-sweep | AC | gain_fc | -3.0102999566e0 dB | -3.0102999566e0 dB | 4.441e-16 | 3.010e-3 | PASS |
| ac-rl-low-pass-sweep | AC | phase_fc | -4.5000000000e1 deg | -4.5000000000e1 deg | 0.000e0 | 4.500e-2 | PASS |
| ac-rl-low-pass-sweep | AC | kcl_fc | 1.7347234760e-18 A | 0.0000000000e0 A | 1.735e-18 | 1.000e-10 | PASS |
| ac-rl-low-pass-sweep | AC | gain_10fc | -2.0043213738e1 dB | -2.0043213738e1 dB | 0.000e0 | 2.004e-2 | PASS |
| ac-rl-low-pass-sweep | AC | phase_10fc | -8.4289406863e1 deg | -8.4289406863e1 deg | 0.000e0 | 8.429e-2 | PASS |
| ac-rl-low-pass-sweep | AC | kcl_10fc | 1.0842021725e-19 A | 0.0000000000e0 A | 1.084e-19 | 1.000e-10 | PASS |
| ac-rlc-band-pass-resonance | AC | gain_at_resonance | 0.0000000000e0 dB | 0.0000000000e0 dB | 0.000e0 | 2.000e-3 | PASS |
| ac-rlc-band-pass-resonance | AC | phase_at_resonance | 0.0000000000e0 deg | 0.0000000000e0 deg | 0.000e0 | 2.000e-2 | PASS |
| ac-rlc-band-pass-resonance | AC | kcl_at_resonance | 2.8177377798e-18 A | 0.0000000000e0 A | 2.818e-18 | 1.000e-10 | PASS |
| transient-rc-step-tau | TRAN | vc_at_tau | 3.1514439384e0 V | 3.1606027941e0 V | 9.159e-3 | 3.000e-2 | PASS |
| transient-rc-step-tau | TRAN | kcl_at_tau | 6.5052130349e-18 A | 0.0000000000e0 A | 6.505e-18 | 1.000e-9 | PASS |
| transient-rc-step-trap | TRAN | vc_at_0_25tau | 1.1058104565e0 V | 1.1059960846e0 V | 1.856e-4 | 1.106e-3 | PASS |
| transient-rc-step-trap | TRAN | vc_at_1tau | 3.1605266065e0 V | 3.1606027941e0 V | 7.619e-5 | 3.161e-3 | PASS |
| transient-rc-step-trap | TRAN | vc_at_2tau | 4.3233011952e0 V | 4.3233235838e0 V | 2.239e-5 | 4.323e-3 | PASS |
| transient-rc-step-gear2 | TRAN | vc_at_0_25tau | 1.1055399832e0 V | 1.1059960846e0 V | 4.561e-4 | 1.106e-3 | PASS |
| transient-rc-step-gear2 | TRAN | vc_at_1tau | 3.1604336880e0 V | 3.1606027941e0 V | 1.691e-4 | 3.161e-3 | PASS |
| transient-rc-step-gear2 | TRAN | vc_at_2tau | 4.3232841030e0 V | 4.3233235838e0 V | 3.948e-5 | 4.323e-3 | PASS |
| transient-rl-step-sweep | TRAN | source_current_0_25tau | -1.1035696590e-2 A | -1.1059960846e-2 A | 2.426e-5 | 3.000e-4 | PASS |
| transient-rl-step-sweep | TRAN | source_current_0_5tau | -1.9635661193e-2 A | -1.9673467014e-2 A | 3.781e-5 | 3.000e-4 | PASS |
| transient-rl-step-sweep | TRAN | source_current_1tau | -3.1560138574e-2 A | -3.1606027941e-2 A | 4.589e-5 | 3.161e-4 | PASS |
| transient-rl-step-sweep | TRAN | source_current_2tau | -4.3199430211e-2 A | -4.3233235838e-2 A | 3.381e-5 | 4.323e-4 | PASS |
| transient-rl-step-sweep | TRAN | source_current_5tau | -4.9658879163e-2 A | -4.9663102650e-2 A | 4.223e-6 | 4.966e-4 | PASS |
| external-dc-resistive-divider | DC | vout | 4.0000000000e0 V | 4.0000000000e0 V | 0.000e0 | 4.000e-9 | PASS |
| external-ac-rc-low-pass-cutoff | AC | gain_at_fc | -3.0102999566e0 dB | -3.0102999566e0 dB | 0.000e0 | 2.000e-6 | PASS |
| external-ac-rc-low-pass-cutoff | AC | phase_at_fc | -4.5000000000e1 deg | -4.5000000000e1 deg | 0.000e0 | 2.000e-5 | PASS |
| external-transient-rc-step-trap | TRAN | vc_at_0_25tau | 1.1058104565e0 V | 1.1059683931e0 V | 1.579e-4 | 1.106e-3 | PASS |
| external-transient-rc-step-trap | TRAN | vc_at_1tau | 3.1605266065e0 V | 3.1606012100e0 V | 7.460e-5 | 3.161e-3 | PASS |
| external-transient-rc-step-trap | TRAN | vc_at_2tau | 4.3233011952e0 V | 4.3233346044e0 V | 3.341e-5 | 4.323e-3 | PASS |
| external-dc-diode-shockley-sweep | DC SWEEP | source_current_0_1v | -4.6954861294e-11 A | -4.6954924125e-11 A | 6.283e-17 | 1.000e-13 | PASS |
| external-dc-diode-shockley-sweep | DC SWEEP | source_current_0_2v | -2.2892877495e-9 A | -2.2892937630e-9 A | 6.014e-15 | 2.289e-13 | PASS |
| external-dc-diode-shockley-sweep | DC SWEEP | source_current_0_3v | -1.0959113160e-7 A | -1.0959156327e-7 A | 4.317e-13 | 1.096e-11 | PASS |
| external-dc-diode-shockley-sweep | DC SWEEP | source_current_0_4v | -5.2445013003e-6 A | -5.2445288435e-6 A | 2.754e-11 | 5.245e-10 | PASS |
| external-dc-diode-shockley-sweep | DC SWEEP | source_current_0_5v | -2.5097491050e-4 A | -2.5097655809e-4 A | 1.648e-9 | 2.510e-8 | PASS |
| pss-rc-sine-steady-state | PSS | output_peak_to_peak | 1.5678268895e0 V | 1.5717672548e0 V | 3.940e-3 | 3.144e-2 | PASS |
| stability-rc-pole-zero | STABILITY | dominant_pole_real | -2.0000000000e3 rad/s | -2.0000000000e3 rad/s | 2.274e-13 | 1.000e1 | PASS |
| stability-rc-pole-zero | STABILITY | transmission_zero_real | -1.0000000000e3 rad/s | -1.0000000000e3 rad/s | 0.000e0 | 1.000e1 | PASS |
| stability-rc-pole-zero | STABILITY | stable_flag | 1.0000000000e0 boolean | 1.0000000000e0 boolean | 0.000e0 | 0.000e0 | PASS |

## Referencias y derivaciones

- **dc-resistive-divider** — closed_form: Ley de Ohm y divisor resistivo ideal.
  - `vout`: Vout = Vin·R2/(R1+R2) = 12·1000/(2000+1000)
  - `kcl_node_2`: \|(V2−V1)/R1 + V2/R2\|
- **dc-diode-shockley-sweep** — closed_form: Ecuación de Shockley con Is=1 pA, n=1 y Vt=kT/q a T=300 K.
  - `source_current_0_1v`: −Is·(exp(0.1/Vt)−1)
  - `source_current_0_2v`: −Is·(exp(0.2/Vt)−1)
  - `source_current_0_3v`: −Is·(exp(0.3/Vt)−1)
  - `source_current_0_4v`: −Is·(exp(0.4/Vt)−1)
  - `source_current_0_5v`: −Is·(exp(0.5/Vt)−1)
- **ac-rc-low-pass-cutoff** — closed_form: Función de transferencia H(jω)=1/(1+jωRC).
  - `gain_at_fc`: 20·log10(1/√2)
  - `phase_at_fc`: -atan(ωRC), con ωRC=1
  - `kcl_at_fc`: \|(Vout−Vin)/R + jωC·Vout\|
- **ac-rl-low-pass-sweep** — closed_form: H(jω)=R/(R+jωL), con R=100 Ω, L=100 mH y fc=R/(2πL).
  - `gain_fc_over_10`: −10·log10(1+0.1²)
  - `phase_fc_over_10`: −atan(0.1)
  - `kcl_fc_over_10`: \|Vout/R + (Vout−Vin)/(jωL)\|
  - `gain_fc`: −10·log10(2)
  - `phase_fc`: −atan(1)
  - `kcl_fc`: \|Vout/R + (Vout−Vin)/(jωL)\|
  - `gain_10fc`: −10·log10(1+10²)
  - `phase_10fc`: −atan(10)
  - `kcl_10fc`: \|Vout/R + (Vout−Vin)/(jωL)\|
- **ac-rlc-band-pass-resonance** — closed_form: RLC serie ideal con salida en R y f0=1/(2π√LC).
  - `gain_at_resonance`: 20·log10(R/\|R+j(ωL−1/ωC)\|), con ωL=1/ωC
  - `phase_at_resonance`: −atan((ωL−1/ωC)/R)=0
  - `kcl_at_resonance`: \|Vout/R + jωC·(Vout−V2)\|
- **transient-rc-step-tau** — closed_form: Respuesta al escalón de un circuito RC ideal.
  - `vc_at_tau`: Vc(τ)=5·(1-e^-1); tolerancia incluye error global O(dt/τ) de Backward Euler con dt=τ/100
  - `kcl_at_tau`: \|(Vc−Vin)/R + C·(Vc[n]−Vc[n−1])/dt\|
- **transient-rc-step-trap** — closed_form: Respuesta RC ideal Vc(t)=5·(1−e^(−t/RC)); TRAP con dt=τ/100.
  - `vc_at_0_25tau`: 5·(1−e^−0.25)
  - `vc_at_1tau`: 5·(1−e^−1)
  - `vc_at_2tau`: 5·(1−e^−2)
- **transient-rc-step-gear2** — closed_form: Respuesta RC ideal Vc(t)=5·(1−e^(−t/RC)); BDF2 con arranque BE y dt=τ/100.
  - `vc_at_0_25tau`: 5·(1−e^−0.25)
  - `vc_at_1tau`: 5·(1−e^−1)
  - `vc_at_2tau`: 5·(1−e^−2)
- **transient-rl-step-sweep** — closed_form: Respuesta de corriente de un RL serie: I(t)=V/R·(1−e^(−tR/L)), con τ=L/R=1 ms.
  - `source_current_0_25tau`: −0.05·(1−e^−0.25)
  - `source_current_0_5tau`: −0.05·(1−e^−0.5)
  - `source_current_1tau`: −0.05·(1−e^−1)
  - `source_current_2tau`: −0.05·(1−e^−2)
  - `source_current_5tau`: −0.05·(1−e^−5); tolerancia incluye error de Backward Euler con dt=τ/200
- **external-dc-resistive-divider** — ngspice_live: ngspice ejecutado en vivo; versión registrada en el reporte y fixture versionado validation/ngspice/dc_resistive_divider.cir.
  - `vout`: v(2) del raw ASCII generado en cada ejecución
- **external-ac-rc-low-pass-cutoff** — ngspice_live: ngspice ejecutado en vivo; versión registrada en el reporte y fixture versionado validation/ngspice/ac_rc_low_pass_cutoff.cir.
  - `gain_at_fc`: 20·log10(\|v(2)\|) del raw complejo generado en cada ejecución
  - `phase_at_fc`: arg(v(2)) del raw complejo generado en cada ejecución
- **external-transient-rc-step-trap** — ngspice_live: ngspice ejecutado en vivo con method=trap y raw adaptativo; versión registrada en el reporte.
  - `vc_at_0_25tau`: v(2) interpolado en t=0.25τ desde el raw generado en cada ejecución
  - `vc_at_1tau`: v(2) interpolado en t=τ desde el raw generado en cada ejecución
  - `vc_at_2tau`: v(2) interpolado en t=2τ desde el raw generado en cada ejecución
- **external-dc-diode-shockley-sweep** — ngspice_live: ngspice ejecutado en vivo; diodo ideal Is=1 pA, N=1, TEMP=TNOM=26.85 °C y versión registrada en el reporte.
  - `source_current_0_1v`: i(V1) en V1=0.1 V del raw generado en cada ejecución
  - `source_current_0_2v`: i(V1) en V1=0.2 V del raw generado en cada ejecución
  - `source_current_0_3v`: i(V1) en V1=0.3 V del raw generado en cada ejecución
  - `source_current_0_4v`: i(V1) en V1=0.4 V del raw generado en cada ejecución
  - `source_current_0_5v`: i(V1) en V1=0.5 V del raw generado en cada ejecución
- **pss-rc-sine-steady-state** — analytic_closed_form: Función de transferencia H(jw)=1/(1+jwRC), amplitud pico a pico=2 Vin \|H\|.
  - `output_peak_to_peak`: 10/sqrt(1+(2*pi*1000*1000*1e-6)^2)
- **stability-rc-pole-zero** — analytic_closed_form: Red RC: polo -2000 rad/s, cero -1000 rad/s y todos los polos en semiplano izquierdo.
  - `dominant_pole_real`: -2000
  - `transmission_zero_real`: -1000
  - `stable_flag`: all(Re(p)) < 0

## Limitaciones

- La correlación ngspice cubre únicamente los casos marcados como referencia externa; el resto conserva referencias analíticas cerradas.
- El solver no emite un punto de operación separado en t=0; la primera muestra publicada es la primera solución integrada en t=dt.
- El caso externo de diodo correlaciona un modelo ideal de Shockley configurado de forma equivalente; no valida alta inyección, ruptura, resistencia serie ni un dispositivo físico.
- La matriz principal valida un caso PSS lineal y una extracción reducida de polos/ceros, pero no valida ruido, sensibilidad, estabilidad de lazo ni MCU.
- La caracterización BSIM3 separada cuantifica una discrepancia de corriente frente a ngspice y no certifica el modelo.
- Aprobar la suite sólo demuestra conformidad con los casos, residuos y tolerancias versionados.
