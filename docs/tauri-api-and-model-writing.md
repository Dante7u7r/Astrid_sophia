# Arquitectura del Solver, API Tauri e Integración de Modelos SPICE

Este documento proporciona la especificación formal de la API IPC de Tauri (Backend Rust $\leftrightarrow$ Frontend TypeScript) y la guía paso a paso para la formulación e incorporación de nuevos modelos de componentes analógicos, no lineales y electrotérmicos en Biaani (Astryd Sophia).

---

## 1. Arquitectura General del Solver

El backend en Rust (`src-tauri/`) implementa un motor MNA (*Modified Nodal Analysis*) de alto rendimiento optimizado con álgebra lineal SIMD (`faer`) y algoritmos adaptativos para análisis en régimen permanente y dinámico.

```
[ Frontend (TypeScript/Canvas 2D) ]
             |
             | IPC (Tauri v2 Commands / Streams)
             v
[ src-tauri/src/lib.rs ] (Validación & Dispatcher)
             |
             +---> [ parser/ ] (Expansión de Subcircuitos y Modelos SPICE)
             |
             +---> [ topology/ ] (ERC, DSU de Nodos, Comprobación Topológica)
             |
             +---> [ solver/engine/ ]
                     |---> dc/ (Newton-Raphson, Homotopía de Fuente y Gmin)
                     |---> transient/ (LTE adaptativo Euler/Trap/BDF2-Gear6, Memory Pooling)
                     |---> ac/ (Barrido multifrecuencia complejo NxN con faer)
                     |---> advanced/ (PSS, STB/Bode, Sensibilidad, Optimización, Monte Carlo)
                     +---> devices/ (Modelos compactos con Dual3 Automatic Differentiation)
```

---

## 2. Especificación de la API IPC de Tauri

Todas las funciones son invocables desde TypeScript mediante `invoke("nombre_comando", { ...payload })` o suscripción a eventos de canal.

### 2.1 Análisis de Circuitos y Simulación

| Comando Tauri | Tipo | Parámetros Principales | Retorno | Descripción |
| :--- | :--- | :--- | :--- | :--- |
| `run_dc_simulation` | Async | `netlist`, `tolerance?`, `max_iterations?` | `SimulationResult` | Calcula el punto de operación en continua (DC OP) resolviendo KCL con Newton-Raphson amortiguado y homotopía. |
| `run_transient_simulation` | Async | `netlist`, `settings`, `tolerance?`, `max_iterations?` | `Vec<TimeStepResult>` | Simulación en el dominio del tiempo con control adaptativo de paso (LTE) y orden variable. |
| `run_transient_simulation_packed`| Async | `netlist`, `settings`, `tolerance?`, `max_iterations?` | `PackedTransientResult` | Versión serializada contigua para trazado rápido en canvas sin overhead de deserialización JSON. |
| `run_ac_sweep` | Async | `netlist`, `settings` (fstart, fstop, points, scale) | `AcSweepResult` | Barrido en frecuencia en pequeña señal linealizado alrededor del punto de operación DC. |
| `run_dc_sweep` | Async | `netlist`, `settings` (source_id, start, stop, step) | `DcSweepResult` | Curvas características DC barriendo fuentes de tensión/corriente o parámetros de dispositivo. |
| `run_pss_simulation` | Async | `netlist`, `settings` (period, harmonics, max_iterations) | `Vec<TimeStepResult>` | Análisis de estado estacionario periódico (*Periodic Steady State*) para osciladores y convertidores conmutados. |
| `run_stability_analysis` | Async | `netlist` | `PoleZeroResult` | Cálculo de polos y ceros del sistema en lazo abierto/cerrado, margen de fase y margen de ganancia. |
| `run_noise_sweep` | Async | `netlist`, `settings` | `NoiseSweepResult` | Densidad espectral de ruido referida a la entrada/salida (ruido térmico Johnson, disparo y Flicker $1/f$). |
| `run_sensitivity_analysis`| Async | `netlist` | `SensitivityResult` | Sensibilidad DC de nodos de salida respecto a cada componente $\partial V_o / \partial R_i$ usando método adjunto. |
| `run_monte_carlo_transient`| Async | `netlist`, `transient_settings`, `mc_settings` | `Vec<Vec<TimeStepResult>>` | Análisis estadístico de tolerancias y dispersión de parámetros de fabricación. |
| `run_fft_analysis` | Async | `time_steps`, `node_name`, `fundamental_freq` | `FftResult` | Transformada Rápida de Fourier y distorsión armónica total (THD). |
| `run_imd_analysis` | Async | `time_steps`, `node_name`, `f1`, `f2` | `ImdResult` | Análisis de distorsión por intermodulación de dos tonos (TOI / IP3). |
| `evaluate_measures` | Async | `time_steps`, `directives` | `MeasureResult` | Evaluación de directivas `.measure` (tiempos de subida/bajada, retardo de propagación, integrales). |
| `solve_dc_thermal` | Async | `netlist`, `temp_k` | `SimulationResult` | Punto de operación considerando acoplamiento electrotérmico y auto-calentamiento. |
| `run_circuit_optimization` | Async | `netlist`, `params`, `targets`, `settings` | `OptimizationResult` | Ajuste automatizado de parámetros de circuito para cumplir metas de diseño mediante descenso de gradiente. |

### 2.2 Control Interactivo y Co-simulación en Tiempo Real

| Comando Tauri | Tipo | Parámetros | Descripción |
| :--- | :--- | :--- | :--- |
| `start_interactive_transient_stream` | Async/Stream | `window`, `netlist`, `settings`, `stream_options` | Inicia la simulación transitoria continua emitiendo chunks de datos por evento Tauri `transient-data-chunk`. |
| `inject_live_mutation` | Sync | `mutation` (component_id, field, value) | Modifica en caliente potenciómetros, interruptores o amplitudes sin reiniciar la simulación. |
| `pause_interactive_transient` | Sync | `run_id?` | Congela la integración temporal preservando los estados de almacenamiento de energía. |
| `resume_interactive_transient`| Sync | `run_id?` | Reanuda la integración temporal. |
| `step_interactive_transient` | Sync | `run_id?`, `steps?` | Ejecuta un número exacto de timesteps (paso a paso interactivo). |
| `stop_interactive_transient` | Sync | `run_id?` | Cancela y termina la sesión activa de simulación transitoria. |
| `set_interactive_simulation_speed` | Sync | `speed` | Ajusta la velocidad de reproducción frente al tiempo real. |

### 2.3 Utilidades y Telemetría

| Comando Tauri | Tipo | Parámetros | Descripción |
| :--- | :--- | :--- | :--- |
| `parse_spice_netlist` | Async | `netlist_str` | Convierte texto SPICE estándar a la estructura nativa `CircuitNetlist`. |
| `expand_transmission_line` | Async | `params` (Z0, delay, length, segments) | Expande líneas de transmisión en cascadas RLCG equivalentes. |
| `get_performance_telemetry` | Sync | Ninguno | Obtiene métricas del sistema (uso de CPU, consumo de memoria del proceso, hilos). |
| `save_circuit_file` | Async | `content` | Despliega el diálogo nativo del sistema para guardar esquemáticos. |
| `save_circuit_to_path` | Async | `path`, `content` | Guarda de forma atómica el esquemático en una ruta previamente aprobada. |

---

## 3. Guía de Implementación de Nuevos Modelos (Model Writing Guide)

Para incorporar un nuevo modelo de componente en Biaani, se debe seguir la metodología de estampación MNA estandarizada.

### 3.1 Anatomía de un Componente en MNA

Un componente interactúa con el sistema matricial MNA general:
$$\mathbf{G} \cdot \mathbf{v} + \mathbf{C} \cdot \frac{d\mathbf{v}}{dt} + \mathbf{B} \cdot \mathbf{i} = \mathbf{z}$$

1. **Conductancias y Fuentes Lineales:** Se estampan directamente en $\mathbf{G}$ y $\mathbf{z}$.
2. **Componentes Reactivos ($C$, $L$):** En transitorio se transforman en sus modelos acompañantes discretos (*Companion Models*) de conductancia efectiva $G_{eq}$ y fuente de memoria histórica $I_{eq}$.
3. **Componentes No Lineales ($f(v)$):** En cada iteración de Newton-Raphson, se linealizan usando series de Taylor de primer orden:
   $$I(v^{(k+1)}) \approx I(v^{(k)}) + g_d \cdot (v^{(k+1)} - v^{(k)})$$
   donde $g_d = \frac{\partial I}{\partial v}\Big|_{v^{(k)}}$.

---

### 3.2 Pasos para Añadir un Nuevo Dispositivo

#### Paso 1: Registro en `types.rs` y Parser SPICE
Definir los campos del componente en `src-tauri/src/solver/types.rs` dentro del struct `ComponentData`:
```rust
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ComponentData {
    pub id: String,
    pub comp_type: String, // ej. "tunnel_diode", "varactor", "memristor"
    pub pins: Vec<String>,
    pub value: f64,
    pub model_params: Option<HashMap<String, f64>>,
    // ...
}
```
Añadir el soporte de sintaxis en `src-tauri/src/parser/`.

#### Paso 2: Modelo Matemático con Diferenciación Automática (`Dual3`)
Implementar la física del componente en `src-tauri/src/solver/engine/devices/mi_dispositivo.rs`. Utilizar `crate::dual3::Dual3` para obtener automáticamente la corriente y sus derivadas analíticas exactas ($g_m, g_{ds}, g_{bs}$):

```rust
use crate::dual3::Dual3;

pub struct DeviceResult {
    pub current: f64,
    pub conductance: f64,
}

pub fn evaluate_device(v: f64, is: f64, vt: f64) -> DeviceResult {
    // Definir variable independiente con derivada unidad
    let v_dual = Dual3::var(v);
    
    // Evaluar ecuación constitutiva no lineal
    let i_dual = is * ((v_dual / vt).exp() - 1.0);
    
    DeviceResult {
        current: i_dual.val,
        conductance: i_dual.d1, // Primera derivada analítica exacta
    }
}
```

#### Paso 3: Estampación DC / Newton-Raphson
En `src-tauri/src/solver/engine/dc/newton/stamps/`:
```rust
pub fn stamp_my_device(
    comp: &ComponentData,
    v_actual: f64,
    matrix_a: &mut DMatrix<f64>,
    vector_z: &mut DVector<f64>,
    n: usize,
) {
    let n_pos = comp.pins[0].parse::<usize>().unwrap_or(0);
    let n_neg = comp.pins[1].parse::<usize>().unwrap_or(0);
    
    let res = evaluate_device(v_actual, ...);
    let gd = res.conductance;
    let ieq = res.current - gd * v_actual;

    // Estampación de conductancia dinámica gd
    if n_pos > 0 {
        matrix_a[(n_pos - 1, n_pos - 1)] += gd;
        vector_z[n_pos - 1] -= ieq;
    }
    if n_neg > 0 {
        matrix_a[(n_neg - 1, n_neg - 1)] += gd;
        vector_z[n_neg - 1] += ieq;
    }
    if n_pos > 0 && n_neg > 0 {
        matrix_a[(n_pos - 1, n_neg - 1)] -= gd;
        matrix_a[(n_neg - 1, n_pos - 1)] -= gd;
    }
}
```

#### Paso 4: Estampación en Transitorio (Transient Companions)
En `src-tauri/src/solver/engine/transient_companions.rs`:
1. Para elementos capacitivos internos $Q(V)$, calcular la carga $Q$ y la capacitancia dinámica $C(V) = \frac{dQ}{dV}$.
2. Aplicar el método de integración activo (Euler / Trapezoidal / BDF2):
   - **Euler:** $G_{eq} = \frac{C}{dt}$, $I_{eq} = G_{eq} \cdot V_{prev}$
   - **Trapezoidal:** $G_{eq} = \frac{2C}{dt}$, $I_{eq} = G_{eq} \cdot V_{prev} + I_{prev}$
   - **BDF2:** $G_{eq} = \alpha_0 \cdot C$, $I_{eq} = -\sum \alpha_k \cdot Q_{prev,k}$

#### Paso 5: Linealización en Pequeña Señal (Barrido AC)
En `src-tauri/src/solver/engine/ac/`:
- Estampar en la matriz compleja $\mathbf{A}_{AC}(\omega)$:
  - Parte real: $g_d$
  - Parte imaginaria: $\omega \cdot C_{eq}$

#### Paso 6: Verificación y Tests Unitarios
Crear el archivo de pruebas en `src-tauri/src/solver/engine/tests/` validando:
1. Simetría y pasividad del modelo.
2. Continuidad $C^1$ y $C^2$ sin saltos abruptos de derivada (evitar divergencias en Newton).
3. Prueba de correlación frente a solución analítica cerrada o netlist canónico de ngspice.
