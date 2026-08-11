# Skill: realtime-cosimulation-runtime

## Descripción
Coordinación asíncrona no bloqueante para simulación interactiva en tiempo real. Gestión de hilos de ejecución dedicados en Rust para el transitorio analógico, emisión de telemetría controlada por presupuesto de fotogramas (Frame Budget / 16ms), e interrupción por eventos de usuario en sincronía de paso de bloqueo (Lock-Step) con emuladores de microcontroladores.

---

## 1. Bucle de Simulación Libre (Thread Dedicado)

### Principio: No bloquear el hilo de Tauri

El hilo principal de Tauri gestiona la ventana, el IPC y los eventos del sistema operativo. Bloquear este hilo congela la UI. La simulación analógica debe correr en un **hilo completamente independiente**.

### Arquitectura de Hilos

```
┌─────────────────────────────────────────────────────────────┐
│  Hilo Principal Tauri  (tokio runtime)                       │
│    ├── Comandos IPC (invoke)                                 │
│    ├── Event emitter (emit)                                  │
│    └── UI WebView bridge                                     │
└──────────────────┬──────────────────────────────────────────┘
                   │  MPSC channels (no bloqueantes)
                   │
┌──────────────────▼──────────────────────────────────────────┐
│  Hilo de Simulación  (thread nativo o spawn_blocking)        │
│    ├── Integrador transitorio (Euler, Trapezoidal, etc.)     │
│    ├── Solver MNA (LU factorización en cada paso)            │
│    └── Empaquetador de telemetría                            │
└─────────────────────────────────────────────────────────────┘
```

### Elección: `thread::spawn` vs `tokio::task::spawn_blocking`

| Criterio                         | `thread::spawn`        | `spawn_blocking`          |
|----------------------------------|------------------------|---------------------------|
| Acceso a runtime tokio           | Requiere `Handle`      | Nativo                    |
| Trabajo CPU-intensivo continuo   | ✅ Ideal               | ✅ Ideal                  |
| Duración del trabajo             | Indefinida (loop)      | Indeterminada pero finita |
| Cancelación                      | Canal AtomicBool       | Token de cancelación      |

**Recomendación para Astryd Sophia**: usar `thread::spawn` con un `Arc<AtomicBool>` para control de cancelación, ya que el bucle transitorio nunca termina por sí solo.

```rust
// Lanzamiento desde un comando Tauri
#[tauri::command]
async fn start_simulation(state: State<'_, SimState>) -> Result<(), String> {
    let cancel = Arc::clone(&state.cancel_flag);
    let control_rx = state.control_tx.subscribe();
    let telemetry_tx = state.telemetry_tx.clone();

    std::thread::spawn(move || {
        simulation_loop(cancel, control_rx, telemetry_tx);
    });
    Ok(())
}
```

---

## 2. Sincronización Digital-Analógica (Lock-Step)

### Problema
El emulador MCU (TypeScript) avanza en ciclos de reloj discretos (ej. 1µs/ciclo para 1MHz). El solver analógico avanza en pasos de integración variables. Para co-simulación correcta, deben avanzar **en coordinación estricta**.

### Algoritmo Lock-Step

```
VARIABLES:
  t_analog  : tiempo actual del solver analógico
  t_digital : tiempo actual del emulador MCU
  Δt_lock   : granularidad de sincronización (ej. 1µs)

BUCLE PRINCIPAL:
  loop:
    // 1. Avanzar analógico hasta el próximo punto de sync
    while t_analog < t_digital + Δt_lock:
        step_analog(solver, Δt_internal)
        t_analog += Δt_internal

    // 2. Leer salidas analógicas → inyectar en el MCU
    let analog_outputs = read_pin_voltages(&solver)
    mcu_emulator.set_adc_inputs(analog_outputs)

    // 3. Avanzar MCU un ciclo de lock
    mcu_emulator.step(Δt_lock)
    t_digital += Δt_lock

    // 4. Leer salidas MCU → inyectar en el analógico
    let digital_outputs = mcu_emulator.read_gpio()
    solver.update_controlled_sources(digital_outputs)

    // 5. Verificar señal de cancelación
    if cancel_flag.load(Ordering::Relaxed) { break }
```

### Paso de Integración Adaptativo

Para eficiencia, el paso interno del analógico no es fijo:

```
Δt_internal = min(Δt_max, Δt_lock / steps_per_lock)
              con Δt_max ≤ 1 / (10 * f_max_signal)

Donde f_max_signal es la frecuencia más alta en el circuito
(estimada de los valores LC presentes en la netlist).
```

### Canal de Sincronización MCU ↔ Analógico

```rust
struct LockStepChannel {
    // Analógico → Digital
    analog_to_digital: watch::Sender<Vec<(String, f64)>>,  // pinId → voltaje

    // Digital → Analógico
    digital_to_analog: watch::Sender<Vec<(String, bool)>>,  // pinId → nivel GPIO
}
```

El canal `watch` (último valor siempre disponible) es preferible a `mpsc` porque el emulador MCU siempre necesita el estado analógico **más reciente**, no la cola histórica.

---

## 3. Telemetría de Alta Velocidad (60 FPS / Budget 16ms)

### Presupuesto de Fotograma

El solver puede correr a 100.000+ pasos/segundo. La UI solo necesita 60 actualizaciones/segundo. Emitir cada paso destruiría el rendimiento.

```
Budget = 16.667ms  (= 1000ms / 60fps)

Estrategia:
  ├── Solver corre libre a máxima velocidad
  ├── Temporizador periódico cada 16ms
  └── Cuando el timer dispara:
        snapshot = solver.snapshot_voltages()
        emit_to_frontend(serialize_telemetry(snapshot))
```

### Serialización Binaria Eficiente

En lugar de JSON (costoso para enviar 500+ nodos a 60fps), usar un paquete binario compacto:

```
TelemetryPacket (binario, little-endian):
  [u64] sim_time_ns        (8 bytes)  — tiempo simulado en nanosegundos
  [u16] node_count         (2 bytes)  — número de nodos en este paquete
  Repetir node_count veces:
    [u8]  node_id_len      (1 byte)   — longitud del nombre
    [...]  node_id_bytes              — nombre del nodo (UTF-8)
    [f32] voltage          (4 bytes)  — voltaje en V

Total mínimo (10 nodos, id promedio 4 chars): ≈ 60 bytes por frame
vs JSON equivalente: ≈ 600 bytes por frame → 10x más eficiente
```

### Deserialización en TypeScript (Frontend)

```typescript
function parseTelemetryPacket(buf: ArrayBuffer): TelemetryFrame {
  const view  = new DataView(buf);
  let offset  = 0;

  const simTimeNs  = view.getBigUint64(offset, true); offset += 8;
  const nodeCount  = view.getUint16(offset, true);    offset += 2;

  const nodes: Record<string, number> = {};
  for (let i = 0; i < nodeCount; i++) {
    const nameLen = view.getUint8(offset); offset += 1;
    const nameBytes = new Uint8Array(buf, offset, nameLen);
    const name  = new TextDecoder().decode(nameBytes); offset += nameLen;
    const volt  = view.getFloat32(offset, true);        offset += 4;
    nodes[name] = volt;
  }
  return { simTimeNs: Number(simTimeNs), nodes };
}
```

---

## 4. Mutaciones en Caliente (Hot Mutation)

### Problema
El usuario abre un switch desde la UI mientras la simulación corre. El solver está en mitad de una factorización LU. Modificar la netlist directamente corrompería la matriz.

### Canal de Control MPSC

```rust
enum ControlMessage {
    SetComponentValue { id: String, value: f64 },
    ToggleSwitch      { id: String, state: bool },
    PauseSimulation,
    ResumeSimulation,
    StopSimulation,
    UpdateNetlist     { netlist: NetlistJson },
}
```

### Protocolo de Mutación Segura

```
Frontend                   Canal MPSC                  Hilo Solver
    │                          │                            │
    │──── ToggleSwitch ────────►│                            │
    │                          │                            │
    │                          │  [Al inicio del próximo paso]
    │                          │◄─── drain_control_channel ─│
    │                          │                            │
    │                          │                            │ pause LU
    │                          │                            │ apply mutation
    │                          │                            │ rebuild matrix (solo filas afectadas)
    │                          │                            │ resume LU
    │                          │                            │
```

**Invariante**: `drain_control_channel()` se llama **entre pasos de integración**, nunca en mitad de uno. Esto garantiza consistencia sin mutex.

### Implementación del Drain

```rust
// Al inicio de cada paso de integración:
fn drain_control_channel(
    rx:     &mut mpsc::Receiver<ControlMessage>,
    solver: &mut MnaSolver,
) {
    while let Ok(msg) = rx.try_recv() {  // try_recv: no bloqueante
        match msg {
            ControlMessage::ToggleSwitch { id, state } => {
                solver.set_switch(&id, state);
                solver.rebuild_stamp(&id);  // solo recalcular filas del switch
            }
            ControlMessage::SetComponentValue { id, value } => {
                solver.update_component_value(&id, value);
                solver.rebuild_stamp(&id);
            }
            ControlMessage::StopSimulation => {
                solver.request_stop();
            }
            _ => {}
        }
    }
}
```

---

## Resumen de Canales

| Canal                      | Tipo Rust          | Dirección            | Propósito                        |
|----------------------------|--------------------|----------------------|----------------------------------|
| Control events             | `mpsc::channel`    | Tauri → Solver       | Mutaciones, pause, stop          |
| Telemetría voltajes        | `watch::channel`   | Solver → Timer       | Estado analógico más reciente    |
| Señal lock-step MCU        | `watch::channel`   | MCU TS → Solver      | GPIO digital → fuentes analógicas|
| Señal lock-step analógico  | `watch::channel`   | Solver → MCU TS      | Voltajes ADC para el MCU         |
| Cancelación                | `Arc<AtomicBool>`  | Tauri → Solver       | Kill switch global               |

---

## Archivos de Referencia

- `examples/runtime_orchestrator.rs` — Bucle asíncrono completo: hilo solver, drain MPSC, timer telemetría, lock-step MCU
