# Biaani (Astrid Sophia)

**Simulador interactivo de circuitos electrónicos — Motor MNA en Rust + lienzo vectorial reactivo (TypeScript).**

Biaani combina Análisis Nodal Modificado (MNA) de grado SPICE, un editor esquemático de escritorio de alto rendimiento impulsado por Tauri v2 y una completa suite de instrumentos virtuales, modelos semiconductores avanzados y co-simulación mixta.

---

## ⚡ Capacidades del Motor de Simulación (Rust Solver)

### MNA Solver Analítico de Alta Precisión

| Característica | Implementación |
|---|---|
| **Estructura de Matrices** | Híbrido Denso / Disperso (CSC) con eliminación supernodal y reordenamiento Markowitz |
| **Iteración No Lineal** | Newton-Raphson amortiguado con *backtracking line search* y residuo KCL estricto |
| **Integración Transitoria** | Backward Euler + Trapezoidal (TRAP) de 2.º orden + Gear (BDF) de orden variable con paso adaptativo LTE |
| **Análisis AC** | Barrido en pequeña señal con Jacobiano de admitancia compleja |
| **Punto de Operación DC** | Estimación inicial automática + Pseudo-Transient Analysis (PTA) + Homotopía Arc-length |
| **Sensibilidad Paramétrica** | $\partial V/\partial R$, $\partial V/\partial C$, $\partial V/\partial \text{param}$ con cálculo de límites en peor caso (*worst-case*) |
| **Simulación Electrotérmica** | Acoplamiento dinámico de autocalentamiento con redes térmicas RC y disipadores |
| **Optimización de Circuitos** | Motor Nelder-Mead y descenso de gradiente para ajuste de puntos de operación, tiempos de establecimiento y ganancias |
| **Periodic Steady-State (PSS)** | Algoritmo de Shooting Method para estados periódicos estacionarios |
| **Análisis de Estabilidad** | Extracción reducida de polos/ceros mediante iteración de Arnoldi/Krylov |

---

## 🔌 Catálogo de Modelos Físicos y Dispositivos

- **Componentes Pasivos:** Resistores, Capacitores (con ESR/EPR), Inductores (con saturación no lineal de núcleo e histéresis), Transformadores con acoplamiento mutuo, Líneas de transmisión RLCG en cascada $\pi$.
- **Semiconductores Estándar:** Diodos (Shockley con capacitancias de juntura/difusión), Zener, LEDs, Varicap, BJTs NPN/PNP (Ebers-Moll + Early + Miller), JFETs (Shockley cuadrático), MOSFETs (Level 1 + subumbral + BSIM3/4 experimental).
- **Electrónica de Potencia & WBG:**
  - **IGBTs:** Modelos físicos Punch-Through (PT) y Non-Punch-Through (NPT) con modulación de conductividad.
  - **Wide-Bandgap (WBG):** MOSFETs de Carburo de Silicio (SiC) y HEMTs de Nitruro de Galio (GaN) con $Q_{rr} \approx 0$ y conducción bidireccional en 2DEG.
  - **Tiristores & Control:** SCR, TRIAC, DIAC con control de ángulo de disparo y recuperación.
- **Circuitos Integrados & Analógicos:** Amplificadores Operacionales (macromodelos con slew-rate, offset y saturación tanh), Comparadores, Temporizadores 555, Reguladores lineales y conmutados, Optoacopladores (CTR y aislamiento galvánico).
- **Lógica Digital:** Compuertas estándar (AND, OR, NOT, NAND, NOR, XOR, XNOR) con retardos de propagación configurables, buffers Tri-State, flip-flops (D, JK, T, SR), contadores y registros de desplazamiento.
- **Electromecánicos & Actuadores:** Relés interactivos (bobina inductiva y armadura mecánica), Lámparas térmicas de filamento, Zumbadores piezoeléctricos con síntesis de audio en tiempo real.

---

## 🎛️ Suite de Instrumentos Virtuales

Biaani integra un conjunto de instrumentos interactivos en tiempo real con temas configurables (*Classic*, *Modern Dark*, *Cyberpunk*, *High Contrast*):

| Instrumento | Funcionalidad |
|---|---|
| **Osciloscopio Dual** | 2 canales independientes con disparo por flanco (Edge Trigger), medición de cursores ($\Delta t, \Delta V, 1/\Delta t$), FFT en vivo y base de tiempo desde nanosegundos hasta segundos. |
| **Analizador de Bode** | Barrido en frecuencia de ganancia ($\text{dB}$) y fase ($^\circ$) con detección automática de frecuencia de corte (-3dB). |
| **Trazador de Curvas (Curve Tracer)** | Visualización interactiva de curvas características $I$-$V$ para diodos, BJTs ($I_C$ vs $V_{CE}$) y MOSFETs ($I_D$ vs $V_{DS}$). |
| **Analizador Lógico** | Muestreador digital multicanal para decodificación de protocolos y buses digitales. |
| **Analizador Espectral FFT** | Transformada rápida de Fourier con ventanas (Hanning, Hamming, Blackman) y cálculo de THD, SNR y SFDR. |
| **Diagrama de Ojo (Eye Diagram)** | Evaluación de integridad de señal, jitter, apertura de ojo y márgenes de ruido en líneas de datos. |
| **Generador de Señales** | Señales senoidales, cuadradas, triangulares, rampa, pulso arbitrario y modulación FM/AM. |
| **Optimizador de Circuitos** | Ajuste automático de valores de componentes para cumplir especificaciones de diseño. |
| **Inspector Simbólico MNA** | Visualización de la formulación matricial $[G][v] = [I]$ y ecuaciones nodales del circuito. |
| **Inspector de Subcircuitos** | Exploración y depuración jerárquica de macromodelos SPICE. |

---

## 💻 Co-Simulación Mixed-Signal & Microcontroladores

Biaani ofrece infraestructura de co-simulación sincronizada entre el motor analógico MNA y entornos embebidos:

- **Arquitecturas Compatibles:**
  - **AVR (ATmega328P):** Compatibilidad con binarios de Arduino Uno, periféricos GPIO, timers y ADC.
  - **8051 (Standard Core):** Emulación de registros, timers y puertos I/O.
  - **PIC (PIC16F84A / PIC16F877A):** Ejecución de instrucciones y control de puertos.
  - **ESP32:** Runtime funcional con visor de código y simulación de pines analógicos/digitales.
- **Puente Digital-Analógico:** Conversión bidireccional de estados lógicos (0, 1, X, Z) a equivalentes Thevenin/Norton en el paso transitorio.

---

## 🏗️ Arquitectura Modular

```
Astrid_sophia/
├── src/                          # Frontend TypeScript (Vite + Canvas 2D)
│   ├── app/                      # Controladores de ciclo de vida, persistencia y crash reporting
│   ├── canvas/                   # Motor vectorial, renderers de componentes, árbol espacial R-Tree
│   ├── components/               # Descriptores de componentes y catálogo electrónico
│   ├── feedback/                 # Telemetría de diagnóstico y puente MCP
│   ├── guide/                    # Sistema de onboarding y guías interactivas paso a paso
│   ├── intelligence/             # Asesor de diseño, síntesis de circuitos y análisis de estrés
│   ├── lsp/                      # Language Server SPICE con autocompletado y validación de sintaxis
│   ├── persistence/              # Serializador/deserializador de archivos .biaani / .astryd
│   ├── simulation/               # Co-simulación, dispatcher MNA, solvers locales y runtimes MCU
│   ├── ui/                       # Instrumentos virtuales, paneles acoplables y modales
│   └── styles.css / themes.css   # Sistema de diseño dark-mode y temas de instrumentos
├── src-tauri/src/                # Backend Rust (Tauri v2 + MNA Solver)
│   ├── solver/                   # Núcleo MNA: solvers DC/AC/TRAP/Gear, optimizador, electrotérmica
│   ├── parser/                   # Parser de netlists SPICE (.subckt, .model, .param, .lib)
│   ├── sparse_csc.rs             # Álgebra lineal dispersa, factorización LU y GMRES
│   ├── dual3.rs                  # Diferenciación automática con números duales de 3.er orden
│   └── lib.rs                    # Exportación de comandos IPC de Tauri
```

---

## 🧪 Calidad, Verificación y Testing

El proyecto se rige por metodologías de ingeniería basadas en evidencia (*evidence-first*):

- **Suite Frontend (Vitest):** **1099 tests pasando en 205 suites** de pruebas unitarias y de integración.
- **Suite Backend (Rust):** **289 tests de integración y métodos numéricos** aprobados al 100%.
- **Electrical Rule Check (ERC):** Verificación topológica previa a la simulación (nodos flotantes, tierras ausentes, fuentes en corto o en conflicto).
- **Parseo Universal de Magnitudes:** Soporte completo de notación ingenieril (`10k`, `4.7u`, `100n`, `1M`, `100r`, `10pF`) en español e inglés.

---

## 🚀 Comandos y Guía de Desarrollo

### Requisitos
- **Node.js:** v18+ y npm
- **Rust:** edición 2021 (rustc + cargo)

### Comandos Frontend & Desktop
```bash
# Instalar dependencias
npm install

# Servidor de desarrollo Vite (puerto 1420)
npm run dev

# Ejecutar suite completa de tests de frontend (1099 tests)
npm test

# Ejecutar tests en modo observador (TDD)
npm run test:watch

# Validar tipos y compilar bundle de producción
npm run build

# Ejecutar aplicación de escritorio en modo desarrollo con Tauri
npm run tauri dev

# Compilar instalador ejecutable de escritorio (Release)
npm run empaquetar
```

### Comandos Backend Rust (desde `src-tauri/`)
```bash
# Verificación de tipos rápida
cargo check

# Linter estricto sin advertencias
cargo clippy -- -D warnings

# Ejecutar suite de pruebas de Rust (289 tests)
cargo test
```

---

## 📄 Licencia

Software bajo licencia del autor. Consulta [`LICENSE`](LICENSE) para más detalles.
