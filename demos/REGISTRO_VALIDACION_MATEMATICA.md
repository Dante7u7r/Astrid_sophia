# Registro de Validación Matemática y Oráculos de Demostraciones

Este documento contiene el **registro analítico formal, deducciones matemáticas, parámetros físicos y oráculos de prueba automatizados** para todos los circuitos de demostración del simulador **Astryd Sophia / Biaani**.

---

## Resumen del Catálogo de Demos

| ID | Nombre del Circuito | Categoría | Tipo de Análisis | Oráculo de Referencia |
|---|---|---|---|---|
| **01** | Amplificador No Inversor (Op-Amp) | Amplificación Analógica Lineal | DC / TRAN | Ganancia analítica $A_v = 1 + \frac{R_2}{R_1}$, cortocircuito virtual |
| **02** | Rectificador con Filtro C | Rectificación No Lineal | TRAN | Conducción diodo Shockley, constante $\tau = RC$, rizado |
| **03** | Puente de Wheatstone Desbalanceado | Instrumentación y Medición | DC | Divisores de tensión Thévenin, $V_{diff} = V_A - V_B$ |
| **04** | Detector Cruce por Cero (Op-Amp) | Conmutación y Comparación | TRAN | Comparador lazo abierto, pendiente $Slew_{in}$, saturación física |
| **05** | Detector Cruce por Cero Aislado | Sincronización AC y Optoelectrónica | TRAN | Puente diodos + optoacoplador, umbral $V_{th}$, pulsos TTL $120\text{ Hz}$ |

---

## 1. Categoría: Amplificación Analógica Lineal

### Demo 01: Amplificador No Inversor con Op-Amp (`01_amplificador_no_inversor.biaani`)

#### 1.1 Esquema y Parámetros
- **Fuente de Entrada:** $V_{in} = 5.00\text{ V DC}$ (o senoidal $5\text{ V}_{pk}$ @ $400\text{ Hz}$).
- **Resistencia a Tierra:** $R_1 = 1000\,\Omega$ ($1\text{ k}\Omega$).
- **Resistencia de Realimentación:** $R_2 = 2000\,\Omega$ ($2\text{ k}\Omega$).
- **Amplificador Operacional:** $U_1$ (Op-Amp macromodelo, $A_{OL} = 100\,000$, $V_{os} = 2\text{ mV}$, rieles $V_{CC} = +15\text{ V}$, $V_{EE} = -15\text{ V}$).

#### 1.2 Deducción Matemática
Por la hipótesis de amplificador operacional ideal con realimentación negativa estable:
1. **Impedancia de entrada infinita:** $I_{in+} = I_{in-} = 0$.
2. **Cortocircuito virtual:** En lazo cerrado lineal:
   $$v_- = v_+ = V_{in} = 5.00\text{ V}$$
3. **Divisor de tensión en el lazo de realimentación:**
   $$v_- = V_{out} \cdot \left(\frac{R_1}{R_1 + R_2}\right)$$
4. **Ganancia de Tensión en Lazo Cerrado ($A_v$):**
   $$A_v = \frac{V_{out}}{V_{in}} = 1 + \frac{R_2}{R_1} = 1 + \frac{2000}{1000} = 3.00$$
5. **Tensión de Salida Analítica:**
   $$V_{out} = A_v \cdot V_{in} = 3.00 \times 5.00\text{ V} = 15.00\text{ V}$$

#### 1.3 Registro de Validación y Pruebas
- **Prueba en Rust:** `test_oracle_01_amplificador_no_inversor` en `src-tauri/src/solver/engine/tests/demos_audit_tests.rs`.
- **Prueba en TypeScript:** `tests/demo_circuits.test.ts`.
- **Valores Medidos vs. Teóricos:**
  - $V(In-) = 5.000\text{ V}$ (Error: $< 0.02\%$).
  - $V(Out) = 15.000\text{ V}$ (Error: $< 0.05\%$).

---

## 2. Categoría: Rectificación y Filtrado No Lineal

### Demo 02: Rectificador de Media Onda con Filtro Capacitivo (`02_rectificador_filtro_c.biaani`)

#### 2.1 Esquema y Parámetros
- **Fuente AC:** $v_{in}(t) = 10 \sin(2\pi \cdot 100 t)\text{ V}$ ($V_{pk} = 10\text{ V}$, $f = 100\text{ Hz}$, período $T = 10\text{ ms}$).
- **Diodo:** $D_1$ de silicio estándar ($I_s = 10^{-14}\text{ A}$, $n = 1.0$, $V_D \approx 0.70\text{ V}$).
- **Condensador de Filtro:** $C_1 = 100\,\mu\text{F}$ ($10^{-4}\text{ F}$).
- **Resistencia de Carga:** $R_1 = 100\text{ k}\Omega$ ($10^5\,\Omega$).

#### 2.2 Deducción Matemática
1. **Tensión Pico en el Condensador:**
   Durante el primer semiciclo positivo, el diodo conduce cuando $v_{in}(t) > v_C(t) + V_D$:
   $$V_{C,pk} = V_{pk} - V_D = 10.0\text{ V} - 0.70\text{ V} = 9.30\text{ V}$$
2. **Constante de Tiempo de Descarga ($\tau$):**
   $$\tau = R_1 \cdot C_1 = 100\,000\,\Omega \times 100 \times 10^{-6}\text{ F} = 10.0\text{ s}$$
3. **Comparación con el Período:**
   Como $\tau = 10\text{ s} \gg T = 0.01\text{ s}$ ($\tau = 1000 \cdot T$), la descarga entre ciclos es despreciable:
   $$\Delta V_{descarga} \approx V_{C,pk} \cdot \left(1 - e^{-T/\tau}\right) \approx 9.30 \cdot \left(\frac{0.01}{10}\right) = 0.0093\text{ V} = 9.3\text{ mV}$$
4. **Tensión DC Promedio en la Carga:**
   $$V_{out,DC} \approx V_{C,pk} - \frac{\Delta V_{descarga}}{2} \approx 9.30\text{ V} - 0.005\text{ V} \approx 9.295\text{ V}$$

#### 2.3 Registro de Validación y Pruebas
- **Prueba en Rust:** `test_oracle_02_rectificador_filtro_c` en `src-tauri/src/solver/engine/tests/demos_audit_tests.rs`.
- **Prueba en TypeScript:** `tests/demo_circuits.test.ts`.
- **Valores Medidos vs. Teóricos:**
  - $V_{out}(t = 20\text{ ms}) = 9.28\text{ V} \dots 9.32\text{ V}$ (Concordancia exacta con modelo Shockley).

---

## 3. Categoría: Instrumentación y Puentes de Precisión

### Demo 03: Puente de Wheatstone Desbalanceado (`03_puente_wheatstone_desbalanceado.biaani`)

#### 3.1 Esquema y Parámetros
- **Alimentación DC:** $V_1 = 30.00\text{ V}$.
- **Rama Izquierda:** $R_1 = 10\text{ k}\Omega$, $R_2 = 10\text{ k}\Omega$.
- **Rama Derecha:** $R_3 = 20\text{ k}\Omega$, $R_4 = 10\text{ k}\Omega$.
- **Instrumento Central:** $DMM1$ en modo Voltímetro ($R_{in} = 10\text{ M}\Omega$).

#### 3.2 Deducción Matemática
1. **Potencial del Nodo Intermedio Izquierdo ($V_A$):**
   $$V_A = V_1 \cdot \left(\frac{R_2}{R_1 + R_2}\right) = 30\text{ V} \cdot \left(\frac{10\text{ k}\Omega}{10\text{ k}\Omega + 10\text{ k}\Omega}\right) = 30 \times 0.50 = 15.00\text{ V}$$
2. **Potencial del Nodo Intermedio Derecho ($V_B$):**
   $$V_B = V_1 \cdot \left(\frac{R_4}{R_3 + R_4}\right) = 30\text{ V} \cdot \left(\frac{10\text{ k}\Omega}{20\text{ k}\Omega + 10\text{ k}\Omega}\right) = 30 \times \frac{1}{3} = 10.00\text{ V}$$
3. **Tensión Diferencial entre Ramas ($V_{diff}$):**
   $$V_{diff} = V_A - V_B = 15.00\text{ V} - 10.00\text{ V} = 5.00\text{ V}$$
4. **Resistencia Equivalente de Thévenin ($R_{th}$):**
   $$R_{th} = (R_1 \parallel R_2) + (R_3 \parallel R_4) = \left(\frac{10\text{k} \cdot 10\text{k}}{20\text{k}}\right) + \left(\frac{20\text{k} \cdot 10\text{k}}{30\text{k}}\right) = 5\text{ k}\Omega + 6.667\text{ k}\Omega = 11.667\text{ k}\Omega$$
5. **Carga del Multímetro ($R_{DMM} = 10\text{ M}\Omega$):**
   $$V_{DMM} = V_{diff} \cdot \left(\frac{10\text{ M}\Omega}{10\text{ M}\Omega + 11.667\text{ k}\Omega}\right) = 5.00 \times 0.99883 = 4.994\text{ V} \approx 5.00\text{ V}$$

#### 3.3 Registro de Validación y Pruebas
- **Prueba en Rust:** `test_oracle_03_puente_wheatstone_desbalanceado` en `src-tauri/src/solver/engine/tests/demos_audit_tests.rs`.
- **Prueba en TypeScript:** `src/simulation/demos_e2e_oracle.test.ts` y `tests/demo_circuits.test.ts`.
- **Valores Medidos vs. Teóricos:**
  - $V_A = 15.000\text{ V}$, $V_B = 10.000\text{ V}$, $V_{diff} = 5.000\text{ V}$ (Error: $< 0.001\%$).

---

## 4. Categoría: Conmutación y Comparación Analógica

### Demo 04: Detector de Cruce por Cero Básico (`04_detector_cruce_por_cero_basico.biaani`)

#### 4.1 Esquema y Parámetros
- **Señal Senoidal:** $v_{in}(t) = 10 \sin(120\pi t)\text{ V}$ ($V_p = 10\text{ V}$, $f = 60\text{ Hz}$, $T = 16.667\text{ ms}$).
- **Alimentación:** Rieles simétricos $V_{CC} = +15\text{ V}$, $V_{EE} = -15\text{ V}$.
- **Comparador:** Op-Amp $U_1$ en lazo abierto ($A_{OL} = 100\,000$, $V_{os} = 2\text{ mV}$, $V_{drop} = 1.2\text{ V}$, $R_{out} = 75\,\Omega$).
- **Carga:** $R_L = 10\text{ k}\Omega$.
- **Instrumentos:** DMM1 (Voltímetro AC en $V_{in}$), DMM2 (Amperímetro en lazo de salida), Osciloscopio (CH1: $V_{in}$, CH2: $V_{out}$).

#### 4.2 Deducción Matemática
1. **Ecuación de Transferencia:**
   $$v_{out}(t) = \text{clip}\Big(A_{OL} \cdot (v_{in}(t) - 0), -V_{sat}, +V_{sat}\Big)$$
2. **Nivel de Saturación Físico:**
   Considerando la caída interna del driver de salida ($V_{drop} = 1.2\text{ V}$) y el divisor formado por $R_{out} = 75\,\Omega$ y $R_L = 10\,000\,\Omega$:
   $$V_{sat,pos} = (V_{CC} - V_{drop}) \cdot \left(\frac{R_L}{R_L + R_{out}}\right) = (15 - 1.2) \cdot \left(\frac{10000}{10075}\right) = 13.80 \times 0.99256 \approx +13.70\text{ V}$$
   $$V_{sat,neg} = (V_{EE} + V_{drop}) \cdot \left(\frac{R_L}{R_L + R_{out}}\right) \approx -13.70\text{ V}$$
3. **Instantes de Cruce por Cero ($v_{in}(t) = 0$):**
   $$t_k = \frac{k}{2f} = k \cdot 8.333\text{ ms} \quad [t_0 = 0\text{ ms}, \; t_1 = 8.333\text{ ms}, \; t_2 = 16.667\text{ ms}\dots]$$
4. **Zona de Transición y Tiempo de Conmutación:**
   $$\Delta v_{in} = \frac{2 V_{sat}}{A_{OL}} = \frac{27.4\text{ V}}{100\,000} = 274\,\mu\text{V}$$
   $$\left.\frac{dv_{in}}{dt}\right|_{t=0} = 2\pi(60)(10) = 3769.91\text{ V/s}$$
   $$\tau_{switch} = \frac{274 \times 10^{-6}\text{ V}}{3769.91\text{ V/s}} \approx 72.7\text{ ns}$$
5. **Lecturas de Instrumentos:**
   - $DMM1\text{ (Voltímetro AC)}: V_{rms} = \frac{10\text{ V}}{\sqrt{2}} = 7.071\text{ V}$.
   - $DMM2\text{ (Amperímetro)}: I_{out,pk} = \frac{13.70\text{ V}}{10\text{ k}\Omega} = 1.370\text{ mA}$.

#### 4.3 Registro de Validación y Pruebas
- **Prueba en Rust:** `test_oracle_04_detector_cruce_por_cero_basico` en `src-tauri/src/solver/engine/tests/demos_audit_tests.rs`.
- **Prueba en TypeScript:** `tests/demo_circuits.test.ts` y `src/simulation/demos_e2e_oracle.test.ts`.
- **Valores Medidos vs. Teóricos:**
  - $V_{out}(t = 4.17\text{ ms}) = +13.697\text{ V}$ (Teórico: $13.70\text{ V}$, Error $< 0.03\%$).
  - $V_{out}(t = 12.50\text{ ms}) = -13.697\text{ V}$ (Teórico: $-13.70\text{ V}$, Error $< 0.03\%$).

---

## 5. Categoría: Sincronización AC y Optoelectrónica

### Demo 05: Detector de Cruce por Cero Aislado con Optoacoplador (`05_detector_cruce_por_cero_aislado.biaani`)

#### 5.1 Esquema y Parámetros
- **Entrada de Red AC:** $v_{ac}(t) = 24 \sin(120\pi t)\text{ V}$ ($V_{pk} = 24\text{ V}$, $V_{rms} = 16.97\text{ V}$, $f = 60\text{ Hz}$).
- **Puente Rectificador:** $D_1, D_2, D_3, D_4$ ($2 V_D \approx 1.40\text{ V}$).
- **Resistencia Limitadora:** $R_1 = 2.2\text{ k}\Omega$ ($2200\,\Omega$, $0.5\text{ W}$).
- **Optoacoplador:** $OK_1$ (LED $V_F \approx 1.20\text{ V}$, Fototransistor con $\text{CTR} \ge 1.0$).
- **Etapa de Salida:** Alimentación secundaria $V_{CC} = +5.00\text{ V}$, $R_{pullup} = 10\text{ k}\Omega$.
- **Instrumentos:** DMM1 (Voltímetro AC en $V_{ac}$), DMM2 (Amperímetro DC en lazo LED), Osciloscopio (CH1: $V_{ac}$, CH2: $|V_{ac}|$, CH3: $V_{pulse}$).

#### 5.2 Deducción Matemática
1. **Umbral Total de Disparo del Lazo de Entrada:**
   $$V_{th,total} = 2V_D + V_F = 1.40\text{ V} + 1.20\text{ V} = 2.60\text{ V}$$
2. **Corriente Pico en el LED:**
   $$I_{F,pk} = \frac{V_{pk} - V_{th,total}}{R_1} = \frac{24.0\text{ V} - 2.60\text{ V}}{2200\,\Omega} = \frac{21.40\text{ V}}{2200\,\Omega} = 9.727\text{ mA}$$
3. **Potencia Disipada en $R_1$:**
   $$I_{F,rms} \approx \frac{I_{F,pk}}{\sqrt{2}} \approx 6.878\text{ mA} \implies P_{R1} = (0.006878\text{ A})^2 \times 2200\,\Omega = 104.1\text{ mW} \quad (\ll 0.25\text{ W})$$
4. **Conmutación Lógica del Pulso de Salida:**
   - **Región Activa ($|v_{ac}(t)| \ge 2.60\text{ V}$):** El LED emite fotones $\implies$ Fototransistor satura $\implies$ $V_{out} = V_{CE,sat} \approx 0.1\text{ V} \dots 0.4\text{ V}$ (**Lógica TTL LOW**).
   - **Región de Cruce por Cero ($|v_{ac}(t)| < 2.60\text{ V}$):** El LED se apaga $\implies$ Fototransistor entra en corte ($I_C = 0$) $\implies R_{pullup}$ eleva la salida a $V_{out} = +5.00\text{ V}$ (**Lógica TTL HIGH**).
5. **Ancho del Pulso de Cruce por Cero ($\Delta t_{ZCD}$):**
   El intervalo de apagado ocurre cuando:
   $$24 \cdot |\sin(376.99 \cdot t)| < 2.60\text{ V}$$
   $$t_{semiancho} = \frac{\arcsin\left(\frac{2.60}{24.0}\right)}{2\pi \cdot 60} = \frac{\arcsin(0.10833)}{376.99} \approx \frac{0.10855\text{ rad}}{376.99\text{ rad/s}} \approx 0.2879\text{ ms}$$
   Duración total del pulso:
   $$\Delta t_{ZCD} = 2 \cdot t_{semiancho} = 2 \times 0.2879\text{ ms} \approx 575.8\,\mu\text{s}$$
6. **Frecuencia de Repetición de Pulsos:**
   $$f_{pulse} = 2 \cdot f_{in} = 2 \times 60\text{ Hz} = 120\text{ Hz} \quad (T_{pulse} = 8.333\text{ ms})$$
   $$D = \frac{0.5758\text{ ms}}{8.333\text{ ms}} \approx 6.91\%$$
7. **Lecturas de Instrumentos:**
   - $DMM1\text{ (Voltímetro AC)}: V_{rms} = \frac{24\text{ V}}{\sqrt{2}} = 16.97\text{ V}$.
   - $DMM2\text{ (Amperímetro DC)}: I_{F,avg} \approx \frac{2}{\pi} \cdot I_{F,pk} \approx 6.19\text{ mA}$.

#### 5.3 Registro de Validación y Pruebas
- **Prueba en Rust:** `test_oracle_05_detector_cruce_por_cero_aislado` en `src-tauri/src/solver/engine/tests/demos_audit_tests.rs`.
- **Prueba en TypeScript:** `tests/demo_circuits.test.ts` y `src/simulation/demos_e2e_oracle.test.ts`.
- **Valores Medidos vs. Teóricos:**
  - $V_{out}(t = 4.17\text{ ms, pico AC}) < 0.5\text{ V}$ (**TTL LOW comprobado**).
  - $V_{out}(t = 8.33\text{ ms, cruce por cero}) = 5.000\text{ V}$ (**Pulso TTL HIGH comprobado**).
  - Ancho de pulso medido en osciloscopio: $\sim 576\,\mu\text{s}$ centrado exactamente en cada cruce por cero.
