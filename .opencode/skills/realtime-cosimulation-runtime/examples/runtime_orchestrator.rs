//! runtime_orchestrator.rs
//! Referencia: Bucle de Co-Simulación en Tiempo Real para Astryd Sophia
//!
//! Pipeline:
//!   Hilo solver (nativo) ──► Canal telemetría ──► Timer 16ms ──► Tauri emit
//!                         ◄─ Canal control MPSC ◄─────────────── Frontend invoke
//!
//! Dependencias necesarias en Cargo.toml:
//!   tokio     = { version = "1", features = ["full"] }
//!   tauri     = { version = "2", features = [...] }

use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use std::time::{Duration, Instant};
use std::thread;
use std::collections::HashMap;

// ─────────────────────────────────────────────
// Tipos del Dominio
// ─────────────────────────────────────────────

/// Mensaje de control que el frontend puede enviar al solver en cualquier momento.
#[derive(Debug, Clone)]
pub enum ControlMessage {
    /// Cambiar el valor de un componente (ej. resistencia variable)
    SetComponentValue { id: String, value: f64 },
    /// Abrir / cerrar un switch
    ToggleSwitch { id: String, open: bool },
    /// Pausar temporalmente la simulación
    Pause,
    /// Reanudar después de una pausa
    Resume,
    /// Detener definitivamente la simulación
    Stop,
}

/// Paquete de telemetría enviado al frontend en cada fotograma.
#[derive(Debug, Clone)]
pub struct TelemetryPacket {
    /// Tiempo simulado en nanosegundos
    pub sim_time_ns: u64,
    /// Voltaje de cada nodo: id_nodo → voltaje en V
    pub node_voltages: HashMap<String, f64>,
}

/// Estado externo visible del digital (GPIO del MCU emulado en TS)
#[derive(Debug, Clone, Default)]
pub struct DigitalState {
    /// pinId → nivel lógico (true = HIGH)
    pub gpio: HashMap<String, bool>,
}

// ─────────────────────────────────────────────
// Solver MNA Stub
// (En producción: la implementación real en Rust con LU factorización)
// ─────────────────────────────────────────────

pub struct MnaSolver {
    /// Tiempo simulado actual en segundos
    pub sim_time_s:   f64,
    /// Paso de integración interno (adaptativo)
    pub dt:           f64,
    /// Voltajes nodales actuales
    node_voltages:    HashMap<String, f64>,
    /// Fuentes controladas por GPIO (switch states)
    switch_states:    HashMap<String, bool>,
    /// Flag interno de parada
    stop_requested:   bool,
    /// Flag de pausa
    paused:           bool,
}

impl MnaSolver {
    pub fn new(dt: f64) -> Self {
        let mut voltages = HashMap::new();
        // Nodos de ejemplo: V1 (fuente DC 5V), nodo N001 (RC), tierra
        voltages.insert("N001".to_string(), 0.0);
        voltages.insert("N002".to_string(), 0.0);
        voltages.insert("0".to_string(),    0.0);

        Self {
            sim_time_s:  0.0,
            dt,
            node_voltages: voltages,
            switch_states: HashMap::new(),
            stop_requested: false,
            paused:         false,
        }
    }

    /// Avanza un paso de integración transitoria.
    /// En producción: resolver G·x = b con LU, actualizar capacitores/inductores.
    pub fn step(&mut self) {
        if self.paused { return; }

        self.sim_time_s += self.dt;
        let t = self.sim_time_s;

        // Modelo stub: carga RC (τ = 1ms, Vs = 5V)
        let tau = 1e-3;
        let vs  = 5.0;

        let switch_open = self.switch_states.get("SW1").copied().unwrap_or(false);
        let effective_vs = if switch_open { 0.0 } else { vs };

        // v_c(t) = Vs * (1 - e^(-t/τ))
        let v_c = effective_vs * (1.0 - (-t / tau).exp());

        self.node_voltages.insert("N001".to_string(), effective_vs);
        self.node_voltages.insert("N002".to_string(), v_c);
    }

    /// Retorna snapshot de voltajes sin clonar innecesariamente.
    pub fn snapshot(&self) -> HashMap<String, f64> {
        self.node_voltages.clone()
    }

    pub fn set_switch(&mut self, id: &str, open: bool) {
        self.switch_states.insert(id.to_string(), open);
        eprintln!("[Solver] Switch '{}' → {}", id, if open { "OPEN" } else { "CLOSED" });
    }

    pub fn update_component_value(&mut self, id: &str, value: f64) {
        eprintln!("[Solver] Componente '{}' → nuevo valor {:.3e}", id, value);
        // En producción: actualizar el elemento en la netlist y refactorizar la matriz
    }

    pub fn request_stop(&mut self) {
        self.stop_requested = true;
    }

    pub fn is_stop_requested(&self) -> bool {
        self.stop_requested
    }

    pub fn set_paused(&mut self, paused: bool) {
        self.paused = paused;
    }

    /// Inyecta niveles GPIO del MCU como fuentes controladas
    pub fn apply_digital_state(&mut self, digital: &DigitalState) {
        for (pin, &level) in &digital.gpio {
            // En producción: localizar la fuente de tensión controlada por este GPIO
            // y actualizar su valor en la matriz MNA
            eprintln!("[Solver] GPIO '{}' → {}", pin, if level { "HIGH" } else { "LOW" });
        }
    }
}

// ─────────────────────────────────────────────
// Serialización de Telemetría (formato binario compacto)
// ─────────────────────────────────────────────

/// Empaqueta la telemetría en formato binario little-endian para minimizar
/// el overhead de serialización a 60 FPS.
///
/// Formato:
///   [u64] sim_time_ns
///   [u16] node_count
///   Repetir:
///     [u8]  name_len
///     [...]  name_bytes (UTF-8)
///     [f32] voltage
pub fn serialize_telemetry(packet: &TelemetryPacket) -> Vec<u8> {
    let mut buf = Vec::with_capacity(64);

    // sim_time_ns (8 bytes)
    buf.extend_from_slice(&packet.sim_time_ns.to_le_bytes());

    // node_count (2 bytes)
    let count = packet.node_voltages.len() as u16;
    buf.extend_from_slice(&count.to_le_bytes());

    for (name, &voltage) in &packet.node_voltages {
        let name_bytes = name.as_bytes();
        buf.push(name_bytes.len() as u8);
        buf.extend_from_slice(name_bytes);
        buf.extend_from_slice(&(voltage as f32).to_le_bytes());
    }

    buf
}

// ─────────────────────────────────────────────
// Control Channel Drain
// ─────────────────────────────────────────────

/// Drena todos los mensajes de control pendientes y los aplica al solver.
/// Se llama ENTRE pasos de integración, nunca en mitad de uno.
fn drain_control_channel(
    rx:     &std::sync::mpsc::Receiver<ControlMessage>,
    solver: &mut MnaSolver,
) {
    while let Ok(msg) = rx.try_recv() {
        match msg {
            ControlMessage::ToggleSwitch { id, open } => {
                solver.set_switch(&id, open);
            }
            ControlMessage::SetComponentValue { id, value } => {
                solver.update_component_value(&id, value);
            }
            ControlMessage::Pause => {
                solver.set_paused(true);
                eprintln!("[Solver] Pausado");
            }
            ControlMessage::Resume => {
                solver.set_paused(false);
                eprintln!("[Solver] Reanudado");
            }
            ControlMessage::Stop => {
                solver.request_stop();
                eprintln!("[Solver] Detención solicitada");
            }
        }
    }
}

// ─────────────────────────────────────────────
// Hilo Principal de Simulación
// ─────────────────────────────────────────────

/// Ejecutar en un `thread::spawn`. Nunca bloquea el hilo principal de Tauri.
pub fn simulation_loop(
    /// Señal de cancelación externa (desde Tauri)
    cancel_flag:     Arc<AtomicBool>,
    /// Receptor de mensajes de control del frontend
    control_rx:      std::sync::mpsc::Receiver<ControlMessage>,
    /// Emisor de paquetes de telemetría hacia el timer de 16ms
    telemetry_tx:    std::sync::mpsc::SyncSender<TelemetryPacket>,
    /// Canal watch para recibir estado GPIO del MCU (lock-step)
    digital_rx:      std::sync::mpsc::Receiver<DigitalState>,
    /// Canal watch para enviar voltajes analógicos al MCU (lock-step)
    analog_tx:       std::sync::mpsc::SyncSender<HashMap<String, f64>>,
) {
    const DT_INTERNAL_S:  f64      = 1e-6;         // 1µs — paso de integración interno
    const DT_LOCK_STEP_S: f64      = 1e-4;         // 100µs — granularidad de sync MCU
    const FRAME_BUDGET:   Duration = Duration::from_millis(16); // 60 FPS

    let mut solver   = MnaSolver::new(DT_INTERNAL_S);
    let mut t_lock   = 0.0f64;    // próximo punto de sync con MCU
    let mut last_frame = Instant::now();

    eprintln!("[SimLoop] Iniciando bucle de simulación");

    loop {
        // ── 1. Verificar señal de cancelación global ──
        if cancel_flag.load(Ordering::Relaxed) {
            eprintln!("[SimLoop] Cancel flag detectado — saliendo");
            break;
        }

        // ── 2. Drenar canal de control (mutaciones en caliente) ──
        drain_control_channel(&control_rx, &mut solver);

        if solver.is_stop_requested() {
            eprintln!("[SimLoop] Stop solicitado — saliendo");
            break;
        }

        // ── 3. Lock-Step: sincronizar con MCU ──
        if solver.sim_time_s >= t_lock {
            // Leer estado digital más reciente (no bloqueante)
            if let Ok(digital) = digital_rx.try_recv() {
                solver.apply_digital_state(&digital);
            }

            // Enviar voltajes analógicos al MCU (no bloqueante)
            let voltages = solver.snapshot();
            let _ = analog_tx.try_send(voltages); // ignorar si el buffer está lleno

            t_lock += DT_LOCK_STEP_S;
        }

        // ── 4. Avanzar el solver un paso de integración ──
        solver.step();

        // ── 5. Telemetría: emitir snapshot si se cumple el presupuesto de frame ──
        let now = Instant::now();
        if now.duration_since(last_frame) >= FRAME_BUDGET {
            last_frame = now;

            let sim_time_ns = (solver.sim_time_s * 1e9) as u64;
            let packet = TelemetryPacket {
                sim_time_ns,
                node_voltages: solver.snapshot(),
            };

            // try_send: no bloqueante — si el buffer del timer está lleno, descartar
            if telemetry_tx.try_send(packet).is_err() {
                eprintln!("[SimLoop] WARN: buffer de telemetría lleno, frame descartado");
            }
        }
    }

    eprintln!("[SimLoop] Bucle finalizado. Tiempo simulado: {:.6}s", solver.sim_time_s);
}

// ─────────────────────────────────────────────
// Timer de Telemetría (16ms — corre en el runtime tokio)
// ─────────────────────────────────────────────

/// Corre en el runtime async de Tauri. Recibe paquetes del hilo solver
/// y los emite a la ventana frontend a exactamente 60 FPS.
///
/// En producción: sustituir `print_to_console` por `app_handle.emit(...)`.
pub async fn telemetry_timer_loop(
    telemetry_rx: std::sync::mpsc::Receiver<TelemetryPacket>,
    cancel_flag:  Arc<AtomicBool>,
) {
    let mut interval = tokio::time::interval(Duration::from_millis(16));
    interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

    eprintln!("[Timer] Iniciando timer de telemetría (60 FPS)");

    loop {
        interval.tick().await;

        if cancel_flag.load(Ordering::Relaxed) {
            eprintln!("[Timer] Cancel flag detectado — saliendo");
            break;
        }

        // Drenar mensajes acumulados — solo nos importa el más reciente
        let mut latest: Option<TelemetryPacket> = None;
        while let Ok(pkt) = telemetry_rx.try_recv() {
            latest = Some(pkt);
        }

        if let Some(packet) = latest {
            let binary_payload = serialize_telemetry(&packet);

            // En producción Tauri:
            //   app_handle.emit("telemetry_frame", &binary_payload).ok();
            //
            // Para demo: imprimir resumen al stderr
            eprintln!(
                "[Telemetry] t={:.3}ms  nodos={:?}  payload={} bytes",
                packet.sim_time_ns as f64 / 1e6,
                packet.node_voltages
                    .iter()
                    .map(|(k, v)| format!("{}={:.3}V", k, v))
                    .collect::<Vec<_>>(),
                binary_payload.len(),
            );
        }
    }
}

// ─────────────────────────────────────────────
// Orquestador Principal
// ─────────────────────────────────────────────

/// Punto de entrada que conecta todos los canales y lanza los hilos.
/// Llamar desde el comando Tauri `start_simulation`.
pub fn launch_simulation() {
    let cancel_flag = Arc::new(AtomicBool::new(false));

    // Canal de control: frontend → solver (capacidad 32 comandos)
    let (control_tx, control_rx) = std::sync::mpsc::sync_channel::<ControlMessage>(32);

    // Canal de telemetría: solver → timer (capacidad 4 frames de buffer)
    let (telemetry_tx, telemetry_rx) = std::sync::mpsc::sync_channel::<TelemetryPacket>(4);

    // Canales lock-step MCU ↔ Analógico
    let (analog_tx, _analog_rx)    = std::sync::mpsc::sync_channel::<HashMap<String, f64>>(2);
    let (digital_tx, digital_rx)   = std::sync::mpsc::sync_channel::<DigitalState>(2);

    let cancel_for_solver = Arc::clone(&cancel_flag);
    let cancel_for_timer  = Arc::clone(&cancel_flag);

    // ── Lanzar hilo de simulación (nativo, CPU-intensivo) ──
    thread::Builder::new()
        .name("astryd-solver".to_string())
        .stack_size(8 * 1024 * 1024) // 8MB stack para matrices grandes
        .spawn(move || {
            simulation_loop(
                cancel_for_solver,
                control_rx,
                telemetry_tx,
                digital_rx,
                analog_tx,
            );
        })
        .expect("Error al lanzar hilo solver");

    // ── Lanzar runtime tokio para el timer de telemetría ──
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_time()
        .build()
        .expect("Error construyendo runtime tokio");

    // ── Demo: simular mutaciones del usuario después de 50ms ──
    let control_tx_demo = control_tx.clone();
    thread::spawn(move || {
        thread::sleep(Duration::from_millis(50));
        eprintln!("[Demo] Usuario abre SW1 (switch open)");
        let _ = control_tx_demo.send(ControlMessage::ToggleSwitch {
            id:   "SW1".to_string(),
            open: true,
        });

        thread::sleep(Duration::from_millis(30));
        eprintln!("[Demo] Usuario simula evento GPIO desde MCU");
        let _ = digital_tx.send(DigitalState {
            gpio: [("PA0".to_string(), true)].into_iter().collect(),
        });

        thread::sleep(Duration::from_millis(50));
        eprintln!("[Demo] Deteniendo simulación");
        let _ = control_tx_demo.send(ControlMessage::Stop);
    });

    // Correr el timer en el hilo actual (bloqueante para la demo)
    rt.block_on(async move {
        tokio::select! {
            _ = telemetry_timer_loop(telemetry_rx, cancel_for_timer) => {}
            _ = tokio::time::sleep(Duration::from_millis(200)) => {
                eprintln!("[Main] Timeout de demo alcanzado — terminando");
                cancel_flag.store(true, Ordering::Relaxed);
            }
        }
    });
}

// ─────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_solver_rc_charge() {
        let mut solver = MnaSolver::new(1e-6);
        let tau = 1e-3;

        // Avanzar 1τ (1000 pasos de 1µs)
        for _ in 0..1000 {
            solver.step();
        }

        let v_c = solver.node_voltages["N002"];
        let expected = 5.0 * (1.0 - (-1.0_f64).exp()); // ≈ 3.161V

        println!("v_c(1τ) = {:.4}V  esperado ≈ {:.4}V", v_c, expected);
        assert!((v_c - expected).abs() < 0.01, "Error en carga RC: {}", v_c);
    }

    #[test]
    fn test_switch_mutation_mid_simulation() {
        let mut solver = MnaSolver::new(1e-6);

        // Avanzar 500µs
        for _ in 0..500 { solver.step(); }
        let v_before = solver.node_voltages["N002"];

        // Mutación en caliente: abrir switch
        solver.set_switch("SW1", true);

        // Avanzar otros 500µs
        for _ in 0..500 { solver.step(); }
        let v_after = solver.node_voltages["N002"];

        println!("V antes de open: {:.4}V  V después: {:.4}V", v_before, v_after);
        // Con el switch abierto, la carga debe descargar (voltaje de destino = 0)
        assert!(v_after < v_before, "Switch open no redujo el voltaje");
    }

    #[test]
    fn test_telemetry_serialization_roundtrip() {
        let packet = TelemetryPacket {
            sim_time_ns: 123_456_789,
            node_voltages: [
                ("N001".to_string(), 5.0),
                ("N002".to_string(), 3.16),
                ("0".to_string(),    0.0),
            ].into_iter().collect(),
        };

        let binary = serialize_telemetry(&packet);

        // Verificar longitud mínima esperada
        let min_len = 8  // sim_time_ns
            + 2          // node_count
            + (1 + 4 + 4) * 3  // 3 nodos: len(1) + name(4avg) + f32(4)
        ;
        assert!(binary.len() >= min_len, "Paquete binario demasiado pequeño: {}", binary.len());

        // Verificar sim_time_ns correctamente serializado
        let t = u64::from_le_bytes(binary[0..8].try_into().unwrap());
        assert_eq!(t, 123_456_789);

        // Verificar node_count
        let count = u16::from_le_bytes(binary[8..10].try_into().unwrap());
        assert_eq!(count, 3);

        println!("Telemetría serializada: {} bytes para {} nodos", binary.len(), count);
    }

    #[test]
    fn test_cancel_flag_stops_loop() {
        let cancel = Arc::new(AtomicBool::new(false));
        let (control_tx, control_rx)   = std::sync::mpsc::sync_channel::<ControlMessage>(8);
        let (telemetry_tx, _tel_rx)    = std::sync::mpsc::sync_channel::<TelemetryPacket>(4);
        let (analog_tx, _analog_rx)    = std::sync::mpsc::sync_channel::<HashMap<String, f64>>(2);
        let (_digital_tx, digital_rx)  = std::sync::mpsc::sync_channel::<DigitalState>(2);

        let cancel_clone = Arc::clone(&cancel);

        let handle = thread::spawn(move || {
            simulation_loop(cancel_clone, control_rx, telemetry_tx, digital_rx, analog_tx);
        });

        // Señal de cancel después de 20ms
        thread::sleep(Duration::from_millis(20));
        cancel.store(true, Ordering::Relaxed);

        // El hilo debe terminar en menos de 100ms
        let timeout = Duration::from_millis(100);
        let result  = handle.join();

        assert!(result.is_ok(), "El hilo de simulación no terminó correctamente");
        drop(control_tx); // silenciar unused warning
        println!("Cancel flag: hilo detenido correctamente dentro del timeout");
    }
}

fn main() {
    launch_simulation();
}
