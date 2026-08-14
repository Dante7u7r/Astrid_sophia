// tauri_bridge.rs — Reference Implementation v2.0
// Skill: tauri-ipc-bridge
// Covers: AppState, async commands, spawn_blocking, mpsc streaming at 60 FPS,
//         CancellationToken, input validation, binary payload option.

// ── Cargo.toml dependencies needed ───────────────────────────
// tauri          = { version = "2", features = ["protocol-asset"] }
// tokio          = { version = "1", features = ["full"] }
// tokio-util     = "0.7"
// serde          = { version = "1", features = ["derive"] }
// serde_json     = "1"
// bytemuck       = { version = "1", features = ["derive"] }

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;
use serde::{Serialize, Deserialize};
use tokio::sync::{Mutex, mpsc};
use tokio_util::sync::CancellationToken;

// ─────────────────────────────────────────────────────────────
// DTO types (mirrored exactly by TypeScript interfaces)
// ─────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComponentDto {
    pub id:          String,
    pub kind:        String,      // "R" | "C" | "L" | "V" | "I" | "D"
    pub node_a:      usize,
    pub node_b:      usize,
    pub value:       f64,
    pub node_pos:    Option<usize>, // for two-terminal sources
    pub node_neg:    Option<usize>,
}

impl ComponentDto {
    pub fn validate(&self) -> Result<(), String> {
        if self.id.is_empty() {
            return Err("id must not be empty".into());
        }
        match self.kind.as_str() {
            "R" if self.value <= 0.0 => return Err(format!("{}: resistance must be > 0", self.id)),
            "C" if self.value <= 0.0 => return Err(format!("{}: capacitance must be > 0", self.id)),
            "L" if self.value <= 0.0 => return Err(format!("{}: inductance must be > 0", self.id)),
            "R" | "C" | "L" | "V" | "I" | "D" => {}
            other => return Err(format!("Unknown component kind: {other}")),
        }
        if self.value.is_nan() || self.value.is_infinite() {
            return Err(format!("{}: value is NaN or infinite", self.id));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SimulationRequest {
    pub num_nodes:    usize,
    pub components:   Vec<ComponentDto>,
    pub stop_time:    f64,      // Transient: seconds
    pub max_step:     f64,      // Transient: max time step (s)
    pub tol:          f64,      // Transient: LTE tolerance
    pub initial_conditions: Option<Vec<f64>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DcResultDto {
    pub node_voltages:    Vec<f64>,
    pub source_currents:  HashMap<String, f64>,
    pub solve_time_ms:    f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransientFrameDto {
    pub time:          f64,
    pub node_voltages: Vec<f64>,
    pub step:          usize,   // frame index
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AcSweepRequest {
    pub num_nodes:    usize,
    pub components:   Vec<ComponentDto>,
    pub freq_start:   f64,
    pub freq_stop:    f64,
    pub points_per_decade: usize,
    pub out_node:     usize,
    pub in_source_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AcPointDto {
    pub frequency:  f64,
    pub magnitude:  f64,
    pub phase_deg:  f64,
}

// ─────────────────────────────────────────────────────────────
// Application state
// ─────────────────────────────────────────────────────────────

pub struct AppState {
    /// Handle to the currently running transient simulation task.
    /// None if no simulation is running.
    pub sim_handle: Mutex<Option<tokio::task::JoinHandle<()>>>,

    /// Cancellation token for the current run.
    /// Replaced before each new run; cancelled by `stop_simulation`.
    pub cancel_token: Mutex<CancellationToken>,
}

impl AppState {
    pub fn new() -> Arc<Self> {
        Arc::new(AppState {
            sim_handle:   Mutex::new(None),
            cancel_token: Mutex::new(CancellationToken::new()),
        })
    }
}

// ─────────────────────────────────────────────────────────────
// Input validation (called before any solver dispatch)
// ─────────────────────────────────────────────────────────────

fn validate_sim_request(req: &SimulationRequest) -> Result<(), String> {
    if req.num_nodes == 0 {
        return Err("numNodes must be ≥ 1".into());
    }
    if req.stop_time <= 0.0 || req.stop_time.is_nan() {
        return Err("stopTime must be a positive finite number".into());
    }
    if req.max_step <= 0.0 || req.max_step > req.stop_time {
        return Err("maxStep must be in (0, stopTime]".into());
    }
    if req.tol <= 0.0 {
        return Err("tol must be > 0".into());
    }
    for (i, comp) in req.components.iter().enumerate() {
        comp.validate().map_err(|e| format!("components[{i}]: {e}"))?;
    }
    Ok(())
}

// ─────────────────────────────────────────────────────────────
// Tauri commands
// ─────────────────────────────────────────────────────────────

/// DC operating-point solve.
/// Offloads to a blocking thread so the Tokio runtime is not starved.
#[tauri::command]
pub async fn run_dc_analysis(
    request: SimulationRequest,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<DcResultDto, String> {
    validate_sim_request(&request)?;

    let req = request.clone();
    let t0  = std::time::Instant::now();

    let result = tokio::task::spawn_blocking(move || {
        // In a real integration, call solve_dc(&netlist) from mna_solver.rs
        // Here we return a mock result to keep this file self-contained
        let node_voltages = vec![0.0; req.num_nodes + 1];
        let source_currents = HashMap::new();
        Ok::<_, String>((node_voltages, source_currents))
    })
    .await
    .map_err(|e| format!("Task panic: {e}"))??;

    Ok(DcResultDto {
        node_voltages:   result.0,
        source_currents: result.1,
        solve_time_ms:   t0.elapsed().as_secs_f64() * 1000.0,
    })
}

/// Transient simulation: streams frames via Tauri events at ≈60 FPS.
/// Returns immediately; frames arrive as "sim-transient-frame" events.
#[tauri::command]
pub async fn run_transient_analysis(
    request: SimulationRequest,
    state: tauri::State<'_, Arc<AppState>>,
    window: tauri::Window,
) -> Result<(), String> {
    validate_sim_request(&request)?;

    // Create a fresh CancellationToken for this run
    let token = CancellationToken::new();
    {
        let mut guard = state.cancel_token.lock().await;
        *guard = token.clone();
    }

    // Bounded MPSC channel: back-pressures the solver if the emitter is slow.
    // Capacity = 256 frames ≈ 4 seconds at 60 FPS (enough buffer for transients).
    let (tx, mut rx) = mpsc::channel::<TransientFrameDto>(256);

    let req    = request.clone();
    let token2 = token.clone();

    // Solver task: runs on a blocking thread pool thread
    let solver_handle = tokio::task::spawn_blocking(move || {
        let mut t    = 0.0_f64;
        let mut h    = req.max_step;
        let mut step = 0usize;

        // Simulate time steps (replace with real MNA transient loop)
        while t <= req.stop_time {
            if token2.is_cancelled() { break; }

            // Build and solve MNA for this step (mocked here)
            let voltages = vec![t.sin(); req.num_nodes + 1]; // placeholder

            let frame = TransientFrameDto {
                time:          t,
                node_voltages: voltages,
                step,
            };

            // back-pressures if channel is full (bounded capacity)
            if tx.blocking_send(frame).is_err() { break; }

            t    += h;
            step += 1;
        }
        // tx drops here, closing the channel and signalling the emitter to stop
    });

    let win2   = window.clone();
    let token3 = token.clone();

    // Emitter task: drains the channel at 60 FPS and emits only the latest frame
    let emitter_handle = tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_millis(16)); // ≈60 FPS

        loop {
            interval.tick().await;
            if token3.is_cancelled() { break; }

            // Drain all pending frames; keep only the most recent (latency-minimising)
            let mut latest: Option<TransientFrameDto> = None;
            while let Ok(frame) = rx.try_recv() {
                latest = Some(frame);
            }

            match latest {
                Some(frame) => {
                    if win2.emit("sim-transient-frame", &frame).is_err() { break; }
                }
                None if rx.is_closed() => {
                    // Channel closed → solver finished
                    let _ = win2.emit("sim-finished", ());
                    break;
                }
                None => continue,
            }
        }
    });

    // Store the handle so `stop_simulation` can abort it
    {
        let mut guard = state.sim_handle.lock().await;
        *guard = Some(tokio::spawn(async move {
            let _ = emitter_handle.await;
        }));
    }

    Ok(())
}

/// Cancels the currently running simulation.
#[tauri::command]
pub async fn stop_simulation(
    state: tauri::State<'_, Arc<AppState>>,
    window: tauri::Window,
) -> Result<(), String> {
    // Signal the solver and emitter loops
    {
        let guard = state.cancel_token.lock().await;
        guard.cancel();
    }
    // Abort the emitter task if it's still alive
    {
        let mut guard = state.sim_handle.lock().await;
        if let Some(handle) = guard.take() {
            handle.abort();
        }
    }
    let _ = window.emit("sim-cancelled", ());
    Ok(())
}

/// AC frequency sweep (embarrassingly parallel, returns all points at once).
#[tauri::command]
pub async fn run_ac_sweep(
    request: AcSweepRequest,
) -> Result<Vec<AcPointDto>, String> {
    if request.freq_start <= 0.0 || request.freq_stop <= request.freq_start {
        return Err("freqStart and freqStop must be positive and freqStart < freqStop".into());
    }
    if request.points_per_decade == 0 {
        return Err("pointsPerDecade must be ≥ 1".into());
    }

    let req = request.clone();
    tokio::task::spawn_blocking(move || {
        use std::f64::consts::PI;
        let decades = (req.freq_stop / req.freq_start).log10();
        let n_pts   = (decades * req.points_per_decade as f64).ceil() as usize;

        let freqs: Vec<f64> = (0..n_pts).map(|k|
            req.freq_start * 10f64.powf(k as f64 / req.points_per_decade as f64)
        ).collect();

        // Placeholder: 1kΩ–1nF RC lowpass for demo
        // Replace with a real parallel MNA solve per frequency point
        freqs.iter().map(|&f| {
            let omega = 2.0 * PI * f;
            let rc    = 1e3 * 1e-9;
            let mag   = 1.0 / (1.0 + (omega * rc).powi(2)).sqrt();
            let phase = -(omega * rc).atan().to_degrees();
            AcPointDto { frequency: f, magnitude: mag, phase_deg: phase }
        }).collect::<Vec<_>>()
    })
    .await
    .map_err(|e| format!("AC sweep task panic: {e}"))
}

// ─────────────────────────────────────────────────────────────
// Binary payload helper (for high-throughput streaming)
// ─────────────────────────────────────────────────────────────

/// Pack node voltages as raw f32 bytes for zero-copy transfer to TypeScript.
/// TypeScript receives ArrayBuffer and wraps it in Float32Array.
pub fn pack_voltages_f32(voltages: &[f64]) -> Vec<u8> {
    let f32s: Vec<f32> = voltages.iter().map(|&v| v as f32).collect();
    // SAFETY: f32 is Pod; cast slice to bytes
    bytemuck::cast_slice(&f32s).to_vec()
}

// ─────────────────────────────────────────────────────────────
// Tauri app builder (main.rs fragment)
// ─────────────────────────────────────────────────────────────

/*
fn main() {
    let state = AppState::new();

    tauri::Builder::default()
        .manage(state)
        .invoke_handler(tauri::generate_handler![
            run_dc_analysis,
            run_transient_analysis,
            run_ac_sweep,
            stop_simulation,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
*/
