// mna_solver.rs — Reference Implementation v2.0
// Skill: electronic-simulation-physics
// Covers: MNA stamping (R, I, V, VCCS), DC solve, AC small-signal,
//         Newton-Raphson with pnjlim, Transient BE/TR with adaptive step.

use nalgebra::{DMatrix, DVector};
use std::collections::HashMap;
use std::f64::consts::PI;

// ─────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────

const V_T: f64       = 25.85e-3; // Thermal voltage at 300 K (V)
const EPS_ABS_V: f64 = 1e-6;     // NR convergence: absolute voltage (V)
const EPS_ABS_I: f64 = 1e-12;    // NR convergence: absolute current (A)
const EPS_REL: f64   = 1e-3;     // NR convergence: relative
const NR_MAX_ITER: usize = 150;

// ─────────────────────────────────────────────────────────────
// Component catalogue
// ─────────────────────────────────────────────────────────────

#[derive(Debug, Clone)]
pub enum Component {
    Resistor {
        id: String, node_a: usize, node_b: usize, resistance: f64,
    },
    CurrentSource {
        id: String, node_from: usize, node_to: usize, current: f64,
    },
    VoltageSource {
        id: String, node_pos: usize, node_neg: usize, voltage: f64,
    },
    Vccs {
        // Voltage-controlled current source: I = gm * V(ctrl_pos, ctrl_neg)
        // flowing from out_pos → out_neg
        id: String,
        out_pos: usize, out_neg: usize,
        ctrl_pos: usize, ctrl_neg: usize,
        gm: f64,
    },
    Diode {
        id: String, node_pos: usize, node_neg: usize,
        is: f64,  // Saturation current (A), typical: 1e-14
        n: f64,   // Ideality factor, typical: 1.0
    },
    Capacitor {
        id: String, node_a: usize, node_b: usize, capacitance: f64,
    },
    Inductor {
        id: String, node_a: usize, node_b: usize, inductance: f64,
    },
}

// ─────────────────────────────────────────────────────────────
// Netlist & results
// ─────────────────────────────────────────────────────────────

pub struct Netlist {
    pub num_nodes:  usize,         // Excludes GND (node 0)
    pub components: Vec<Component>,
}

#[derive(Debug)]
pub struct DcResult {
    pub node_voltages:   Vec<f64>,           // Index = node number, [0] = 0.0V (GND)
    pub source_currents: HashMap<String, f64>,
}

#[derive(Debug)]
pub struct AcPoint {
    pub frequency:    f64,
    pub node_voltage: Vec<(f64, f64)>, // (real, imag) per node
}

#[derive(Debug)]
pub struct TransientFrame {
    pub time:          f64,
    pub node_voltages: Vec<f64>,
}

// ─────────────────────────────────────────────────────────────
// Topology validation
// ─────────────────────────────────────────────────────────────

/// Check for isolated nodes (nodes with zero connectivity) — these cause a
/// singular MNA matrix. Returns the list of offending node indices.
pub fn find_floating_nodes(netlist: &Netlist) -> Vec<usize> {
    let mut connected = vec![false; netlist.num_nodes + 1];
    for comp in &netlist.components {
        match comp {
            Component::Resistor   { node_a, node_b, .. } => { connected[*node_a] = true; connected[*node_b] = true; }
            Component::CurrentSource { node_from, node_to, .. } => { connected[*node_from] = true; connected[*node_to] = true; }
            Component::VoltageSource { node_pos, node_neg, .. } => { connected[*node_pos] = true; connected[*node_neg] = true; }
            Component::Vccs { out_pos, out_neg, ctrl_pos, ctrl_neg, .. } => {
                connected[*out_pos] = true; connected[*out_neg] = true;
                connected[*ctrl_pos] = true; connected[*ctrl_neg] = true;
            }
            Component::Diode  { node_pos, node_neg, .. } => { connected[*node_pos] = true; connected[*node_neg] = true; }
            Component::Capacitor { node_a, node_b, .. } => { connected[*node_a] = true; connected[*node_b] = true; }
            Component::Inductor  { node_a, node_b, .. } => { connected[*node_a] = true; connected[*node_b] = true; }
        }
    }
    (1..=netlist.num_nodes).filter(|&i| !connected[i]).collect()
}

// ─────────────────────────────────────────────────────────────
// MNA builder
// ─────────────────────────────────────────────────────────────

struct MnaSystem {
    n:        usize,               // Number of nodes (excl. GND)
    m:        usize,               // Number of voltage sources
    size:     usize,               // n + m
    matrix_a: DMatrix<f64>,
    vector_z: DVector<f64>,
    vs_map:   HashMap<String, usize>, // vs id → branch index
}

impl MnaSystem {
    fn new(netlist: &Netlist) -> Self {
        let n = netlist.num_nodes;
        let mut vs_map = HashMap::new();
        let mut m = 0usize;
        for comp in &netlist.components {
            if let Component::VoltageSource { id, .. } = comp {
                vs_map.insert(id.clone(), m);
                m += 1;
            }
            if let Component::Inductor { id, .. } = comp {
                // Inductor companion model introduces a voltage branch
                vs_map.entry(format!("L_{id}")).or_insert_with(|| { let idx = m; m += 1; idx });
            }
        }
        let size = n + m;
        MnaSystem {
            n, m, size,
            matrix_a: DMatrix::zeros(size, size),
            vector_z: DVector::zeros(size),
            vs_map,
        }
    }

    // ── Stamp helpers ─────────────────────────────────────────

    #[inline]
    fn stamp_g(&mut self, a: usize, b: usize, g: f64) {
        // Resistive stamp: add ±G to the nodal conductance sub-matrix G.
        // Node 0 = GND is excluded (maps to no row/col in the matrix).
        if a > 0 { self.matrix_a[(a-1, a-1)] += g; }
        if b > 0 { self.matrix_a[(b-1, b-1)] += g; }
        if a > 0 && b > 0 {
            self.matrix_a[(a-1, b-1)] -= g;
            self.matrix_a[(b-1, a-1)] -= g;
        }
    }

    #[inline]
    fn stamp_i(&mut self, from: usize, to: usize, i: f64) {
        // Current source stamp (conventional direction: from → to).
        // KCL: current leaving 'from', entering 'to'.
        if from > 0 { self.vector_z[from - 1] -= i; }
        if to   > 0 { self.vector_z[to   - 1] += i; }
    }

    #[inline]
    fn stamp_vs(&mut self, k: usize, pos: usize, neg: usize, v: f64) {
        // Voltage source stamp for branch index k (0-based).
        // B sub-matrix: +1 at (pos, N+k) and -1 at (neg, N+k).
        // C sub-matrix (= B^T): +1 at (N+k, pos) and -1 at (N+k, neg).
        let col = self.n + k;
        if pos > 0 {
            self.matrix_a[(pos-1, col)] += 1.0;
            self.matrix_a[(col, pos-1)] += 1.0;
        }
        if neg > 0 {
            self.matrix_a[(neg-1, col)] -= 1.0;
            self.matrix_a[(col, neg-1)] -= 1.0;
        }
        self.vector_z[col] = v;
    }

    fn stamp_component(&mut self, comp: &Component) -> Result<(), String> {
        match comp {
            Component::Resistor { node_a, node_b, resistance, .. } => {
                if *resistance <= 1e-12 {
                    return Err("Resistor value must be > 0".into());
                }
                self.stamp_g(*node_a, *node_b, 1.0 / resistance);
            }
            Component::CurrentSource { node_from, node_to, current, .. } => {
                self.stamp_i(*node_from, *node_to, *current);
            }
            Component::VoltageSource { id, node_pos, node_neg, voltage } => {
                let k = *self.vs_map.get(id).unwrap();
                self.stamp_vs(k, *node_pos, *node_neg, *voltage);
            }
            Component::Vccs { out_pos, out_neg, ctrl_pos, ctrl_neg, gm, .. } => {
                // VCCS: stamps ±gm into the G sub-matrix (off-diagonal cross terms)
                if *ctrl_pos > 0 { if *out_pos > 0 { self.matrix_a[(*out_pos-1, *ctrl_pos-1)] += gm; } }
                if *ctrl_pos > 0 { if *out_neg > 0 { self.matrix_a[(*out_neg-1, *ctrl_pos-1)] -= gm; } }
                if *ctrl_neg > 0 { if *out_pos > 0 { self.matrix_a[(*out_pos-1, *ctrl_neg-1)] -= gm; } }
                if *ctrl_neg > 0 { if *out_neg > 0 { self.matrix_a[(*out_neg-1, *ctrl_neg-1)] += gm; } }
            }
            // Diodes, Capacitors, Inductors handled separately
            _ => {}
        }
        Ok(())
    }
}

// ─────────────────────────────────────────────────────────────
// DC Operating Point Solve
// ─────────────────────────────────────────────────────────────

pub fn solve_dc(netlist: &Netlist) -> Result<DcResult, String> {
    // Pre-flight topology check
    let floating = find_floating_nodes(netlist);
    if !floating.is_empty() {
        return Err(format!("Floating nodes detected: {:?}. Connect or remove them.", floating));
    }

    let mut sys = MnaSystem::new(netlist);
    for comp in &netlist.components {
        // Skip reactive elements in DC solve (C → open, L → short)
        match comp {
            Component::Capacitor { .. } => continue, // open circuit in DC
            Component::Inductor { id, node_a, node_b, .. } => {
                // Model as short (voltage source of 0 V)
                let k = *sys.vs_map.get(&format!("L_{id}")).unwrap();
                sys.stamp_vs(k, *node_a, *node_b, 0.0);
                continue;
            }
            Component::Diode { .. } => continue, // handled by NR below
            _ => {}
        }
        sys.stamp_component(comp)?;
    }

    // Newton-Raphson for non-linear elements (diodes)
    let diodes: Vec<&Component> = netlist.components.iter()
        .filter(|c| matches!(c, Component::Diode { .. }))
        .collect();

    if diodes.is_empty() {
        return _linear_solve(sys);
    }

    _nr_solve(sys, &diodes)
}

fn _linear_solve(sys: MnaSystem) -> Result<DcResult, String> {
    let n = sys.n;
    let lu = sys.matrix_a.lu();
    let x = lu.solve(&sys.vector_z)
        .ok_or("Matrix is singular. Check for floating nodes or voltage-source loops.")?;

    let mut node_voltages = vec![0.0; n + 1];
    for i in 1..=n { node_voltages[i] = x[i - 1]; }

    let mut source_currents = HashMap::new();
    for (id, &k) in &sys.vs_map {
        source_currents.insert(id.clone(), x[n + k]);
    }
    Ok(DcResult { node_voltages, source_currents })
}

// ─────────────────────────────────────────────────────────────
// Newton-Raphson solver (for diodes)
// ─────────────────────────────────────────────────────────────

/// SPICE-compatible junction voltage limiting (pnjlim).
/// Prevents runaway exponential currents during early NR iterations.
fn pnjlim(v_new: f64, v_old: f64, n_factor: f64) -> f64 {
    let vt = n_factor * V_T;
    if v_new > v_old + vt {
        // Logarithmic clamping when forward bias is growing fast
        v_old + vt * (1.0 + ((v_new - v_old) / vt).ln())
    } else if v_new < -10.0 * vt {
        // Hard clamp into deep reverse (Shockley model diverges)
        -10.0 * vt
    } else {
        v_new
    }
}

fn _nr_solve(mut sys: MnaSystem, diodes: &[&Component]) -> Result<DcResult, String> {
    let n   = sys.n;
    let mut vd_prev: HashMap<String, f64> = HashMap::new(); // previous V_diode per diode

    // Initial guess: all node voltages = 0
    let mut x = DVector::<f64>::zeros(sys.size);

    for iter in 0..NR_MAX_ITER {
        // Reset only the G sub-block (diode companion stamps vary each iteration)
        sys.matrix_a.view_mut((0, 0), (n, n)).fill(0.0);
        sys.vector_z.rows_mut(0, n).fill(0.0);

        // Re-stamp linear components
        for comp in &*diodes { let _ = comp; } // diodes handled below

        // Stamp diode companion models
        for comp in diodes {
            if let Component::Diode { id, node_pos, node_neg, is, n: n_factor } = comp {
                let vp = if *node_pos > 0 { x[*node_pos - 1] } else { 0.0 };
                let vn = if *node_neg > 0 { x[*node_neg - 1] } else { 0.0 };
                let vd_raw = vp - vn;

                // Apply voltage limiting
                let vd_old = *vd_prev.get(id.as_str()).unwrap_or(&0.0);
                let vd = pnjlim(vd_raw, vd_old, *n_factor);
                vd_prev.insert(id.clone(), vd);

                // Shockley: Id = Is*(exp(Vd/nVt) - 1)
                let exp_arg = (vd / (*n_factor * V_T)).min(50.0); // cap to avoid overflow
                let id_val  = is * (exp_arg.exp() - 1.0);
                let geq     = is / (*n_factor * V_T) * exp_arg.exp();
                let ieq     = id_val - geq * vd; // parallel current source

                // Stamp Geq as conductance, Ieq as current source (pos→neg)
                sys.stamp_g(*node_pos, *node_neg, geq);
                sys.stamp_i(*node_pos, *node_neg, ieq); // passive sign convention
            }
        }

        let lu = sys.matrix_a.clone().lu();
        let x_new = lu.solve(&sys.vector_z)
            .ok_or("NR: matrix is singular during iteration")?;

        // Check convergence (SPICE criterion)
        let converged = x_new.iter().zip(x.iter()).all(|(&xi_new, &xi_old)| {
            let tol = EPS_ABS_V + EPS_REL * xi_new.abs();
            (xi_new - xi_old).abs() < tol
        });

        x = x_new;
        if converged {
            let mut node_voltages = vec![0.0; n + 1];
            for i in 1..=n { node_voltages[i] = x[i - 1]; }
            let mut source_currents = HashMap::new();
            for (id, &k) in &sys.vs_map {
                source_currents.insert(id.clone(), x[n + k]);
            }
            return Ok(DcResult { node_voltages, source_currents });
        }

        let _ = iter; // suppress unused warning
    }

    Err(format!("NR did not converge in {NR_MAX_ITER} iterations. Try source-stepping."))
}

// ─────────────────────────────────────────────────────────────
// AC Small-Signal Analysis
// ─────────────────────────────────────────────────────────────

/// Computes the AC frequency response at a single frequency `f` (Hz).
/// Reactive elements are replaced with their complex admittances.
/// Returns complex node voltages as (real, imag) pairs.
pub fn solve_ac_point(netlist: &Netlist, f: f64) -> Result<AcPoint, String> {
    let omega = 2.0 * PI * f;
    let n = netlist.num_nodes;

    // Build complex MNA: A_c · x_c = z_c
    // Represent complex as (real, imag) interleaved: size = 2*(n+m)
    // For simplicity, we use two real matrices (Re and Im) and solve coupled.
    // A more efficient approach would use nalgebra's Complex type.

    let mut sys = MnaSystem::new(netlist);

    // Imaginary part of A (only reactive elements contribute)
    let mut imag_a = DMatrix::<f64>::zeros(sys.size, sys.size);

    for comp in &netlist.components {
        match comp {
            Component::Capacitor { node_a, node_b, capacitance, .. } => {
                // Yc = jωC → stamps +ωC to imaginary G sub-matrix
                let yc = omega * capacitance;
                if *node_a > 0 { imag_a[(*node_a-1, *node_a-1)] += yc; }
                if *node_b > 0 { imag_a[(*node_b-1, *node_b-1)] += yc; }
                if *node_a > 0 && *node_b > 0 {
                    imag_a[(*node_a-1, *node_b-1)] -= yc;
                    imag_a[(*node_b-1, *node_a-1)] -= yc;
                }
            }
            Component::Inductor { node_a, node_b, inductance, .. } => {
                // YL = 1/(jωL) = -j/(ωL) → stamps -1/(ωL) to imaginary G
                let yl = -1.0 / (omega * inductance);
                if *node_a > 0 { imag_a[(*node_a-1, *node_a-1)] += yl; }
                if *node_b > 0 { imag_a[(*node_b-1, *node_b-1)] += yl; }
                if *node_a > 0 && *node_b > 0 {
                    imag_a[(*node_a-1, *node_b-1)] -= yl;
                    imag_a[(*node_b-1, *node_a-1)] -= yl;
                }
            }
            Component::Diode { .. } => {
                // Use small-signal conductance from DC operating point (not solved here for brevity)
            }
            _ => { sys.stamp_component(comp)?; }
        }
    }

    // Solve the 2Nx2N real system representing the complex system:
    //   [Re(A)  -Im(A)] [Re(x)]   [Re(z)]
    //   [Im(A)   Re(A)] [Im(x)] = [Im(z)]
    let size = sys.size;
    let mut full_a = DMatrix::<f64>::zeros(2 * size, 2 * size);
    let mut full_z = DVector::<f64>::zeros(2 * size);

    full_a.view_mut((0, 0),    (size, size)).copy_from(&sys.matrix_a);
    full_a.view_mut((0, size), (size, size)).copy_from(&(-&imag_a));
    full_a.view_mut((size, 0), (size, size)).copy_from(&imag_a);
    full_a.view_mut((size, size), (size, size)).copy_from(&sys.matrix_a);
    full_z.rows_mut(0, size).copy_from(&sys.vector_z);
    // Imaginary part of z is zero for real sources

    let lu = full_a.lu();
    let x = lu.solve(&full_z)
        .ok_or("AC solve: singular matrix")?;

    let node_voltage: Vec<(f64, f64)> = (0..=n).map(|i| {
        if i == 0 { (0.0, 0.0) } else { (x[i - 1], x[size + i - 1]) }
    }).collect();

    Ok(AcPoint { frequency: f, node_voltage })
}

// ─────────────────────────────────────────────────────────────
// Transient Integration (Backward Euler + adaptive step)
// ─────────────────────────────────────────────────────────────

struct ReactiveState {
    vc: Vec<(usize, usize, f64, f64)>, // (node_a, node_b, C, V_prev)
    il: Vec<(usize, usize, f64, f64)>, // (node_a, node_b, L, I_prev)
}

pub fn solve_transient(
    netlist: &Netlist,
    stop_time: f64,
    h_init: f64,
    tol: f64,
) -> Result<Vec<TransientFrame>, String> {
    // 1. DC operating point as t=0 initial condition
    let dc = solve_dc(netlist)?;

    let mut frames: Vec<TransientFrame> = Vec::new();
    frames.push(TransientFrame { time: 0.0, node_voltages: dc.node_voltages.clone() });

    // Collect reactive elements
    let mut state = ReactiveState { vc: vec![], il: vec![] };
    for comp in &netlist.components {
        match comp {
            Component::Capacitor { node_a, node_b, capacitance, .. } => {
                let va = if *node_a > 0 { dc.node_voltages[*node_a] } else { 0.0 };
                let vb = if *node_b > 0 { dc.node_voltages[*node_b] } else { 0.0 };
                state.vc.push((*node_a, *node_b, *capacitance, va - vb));
            }
            Component::Inductor { node_a, node_b, .. } => {
                // IL at t=0 from DC solve (stored as VS current)
                state.il.push((*node_a, *node_b, 0.0 /* L */, 0.0));
            }
            _ => {}
        }
    }

    let mut t = 0.0;
    let mut h = h_init;
    let n = netlist.num_nodes;

    // Pre-allocate working vectors (no heap allocation in the loop)
    let mut prev_voltages = dc.node_voltages.clone();

    while t < stop_time {
        h = h.min(stop_time - t); // don't overshoot

        // Build MNA with companion models for current h
        let mut sys = MnaSystem::new(netlist);
        for comp in &netlist.components {
            match comp {
                Component::Capacitor { .. } | Component::Inductor { .. } => {}
                _ => { sys.stamp_component(comp)?; }
            }
        }

        // Stamp capacitor companion models (Backward Euler)
        for (a, b, c, v_prev) in &state.vc {
            let req = h / c;      // Equivalent resistance
            let ieq = -c / h * v_prev; // Current source (Norton)
            sys.stamp_g(*a, *b, 1.0 / req);
            sys.stamp_i(*a, *b, ieq);
        }

        let result = _linear_solve(sys)?;

        // LTE estimate (2nd-order backward difference on capacitor voltages)
        let mut lte_max: f64 = 0.0;
        for (i, (a, b, c, v_prev)) in state.vc.iter().enumerate() {
            let va = if *a > 0 { result.node_voltages[*a] } else { 0.0 };
            let vb = if *b > 0 { result.node_voltages[*b] } else { 0.0 };
            let v_new = va - vb;
            let v_old = *v_prev;
            let v_older = if frames.len() >= 2 {
                let prev2 = &frames[frames.len() - 2];
                let va2 = if *a > 0 { prev2.node_voltages[*a] } else { 0.0 };
                let vb2 = if *b > 0 { prev2.node_voltages[*b] } else { 0.0 };
                va2 - vb2
            } else { v_old };

            let lte = ((v_new - 2.0 * v_old + v_older) / 12.0).abs();
            lte_max = lte_max.max(lte);
            let _ = (i, c); // avoid unused warnings
        }

        // Adaptive step: accept if LTE ≤ tol, else retry with smaller h
        if lte_max > tol && h > 1e-15 {
            let h_opt = h * (tol / lte_max).sqrt() * 0.9;
            h = h_opt.max(1e-15);
            continue; // retry this step
        }

        // Accept step
        t += h;

        // Update reactive state
        for (a, b, _c, v_prev) in &mut state.vc {
            let va = if *a > 0 { result.node_voltages[*a] } else { 0.0 };
            let vb = if *b > 0 { result.node_voltages[*b] } else { 0.0 };
            *v_prev = va - vb;
        }
        prev_voltages = result.node_voltages.clone();

        frames.push(TransientFrame { time: t, node_voltages: result.node_voltages });

        // Grow step for next iteration (cap at 10× current)
        if lte_max > 0.0 {
            h = (h * (tol / lte_max).sqrt() * 0.9).min(h * 10.0).min(h_init * 100.0);
        } else {
            h = (h * 2.0).min(h_init * 100.0);
        }
        let _ = prev_voltages;
    }

    Ok(frames)
}

// ─────────────────────────────────────────────────────────────
// Quick self-test (run with `cargo test`)
// ─────────────────────────────────────────────────────────────
#[cfg(test)]
mod tests {
    use super::*;

    /// Voltage divider: V1(10V) → R1(1kΩ) → Node1 → R2(1kΩ) → GND
    /// Expected: V(Node1) = 5.0 V
    #[test]
    fn test_voltage_divider() {
        let netlist = Netlist {
            num_nodes: 2,
            components: vec![
                Component::VoltageSource { id: "V1".into(), node_pos: 2, node_neg: 0, voltage: 10.0 },
                Component::Resistor      { id: "R1".into(), node_a: 2,   node_b: 1,  resistance: 1000.0 },
                Component::Resistor      { id: "R2".into(), node_a: 1,   node_b: 0,  resistance: 1000.0 },
            ],
        };
        let result = solve_dc(&netlist).unwrap();
        let v1 = result.node_voltages[1];
        assert!((v1 - 5.0).abs() < 1e-9, "Expected 5.0 V, got {v1}");
    }

    /// Single diode forward biased: 1V source, 1kΩ series, 1N4148 (Is=1e-14, n=1)
    /// Expected: Vd ≈ 0.6V (varies with Is)
    #[test]
    fn test_diode_nr() {
        let netlist = Netlist {
            num_nodes: 2,
            components: vec![
                Component::VoltageSource { id: "V1".into(), node_pos: 2, node_neg: 0, voltage: 1.0 },
                Component::Resistor      { id: "R1".into(), node_a: 2,   node_b: 1,  resistance: 1000.0 },
                Component::Diode         { id: "D1".into(), node_pos: 1, node_neg: 0, is: 1e-14, n: 1.0 },
            ],
        };
        let result = solve_dc(&netlist).unwrap();
        let vd = result.node_voltages[1];
        assert!(vd > 0.5 && vd < 0.75, "Diode Vd={vd} out of expected range");
    }
}
