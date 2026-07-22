use crate::solver::types::CircuitNetlist;
use rayon::iter::{IntoParallelIterator, ParallelIterator};
use serde::{Deserialize, Serialize};

use super::super::simulation_types::{TimeStepResult, TransientSettings};
use super::super::transient::solve_transient_circuit;

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MonteCarloSettings {
    pub runs: usize,
    pub seed: Option<u64>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub struct MonteCarloResult {
    pub run_results: Vec<Vec<TimeStepResult>>,
}

// Generador pseudoaleatorio LCG simple determinista
fn lcg_next(seed: &mut u64) -> f64 {
    *seed = seed
        .wrapping_mul(6364136223846793005)
        .wrapping_add(1442695040888963407);
    ((*seed >> 32) as f64) / 4294967295.0
}

// Transformación de Box-Muller para distribución normal estándar N(0, 1)
fn box_muller_standard(seed: &mut u64) -> f64 {
    let mut u1 = lcg_next(seed);
    while u1 < 1e-15 {
        u1 = lcg_next(seed);
    }
    let u2 = lcg_next(seed);
    let r = (-2.0 * u1.ln()).sqrt();
    let theta = 2.0 * std::f64::consts::PI * u2;
    r * theta.cos()
}

pub fn solve_monte_carlo_transient(
    netlist: &CircuitNetlist,
    transient_settings: &TransientSettings,
    mc_settings: &MonteCarloSettings,
) -> Result<Vec<Vec<TimeStepResult>>, String> {
    let rng_seed_base = mc_settings.seed.unwrap_or(123456789);

    (0..mc_settings.runs)
        .into_par_iter()
        .map(|run_idx| {
            // Cada hilo tiene su propia semilla única derivada de la semilla base de forma determinista
            let mut run_seed = rng_seed_base.wrapping_add(run_idx as u64 * 72057594037927931);
            if run_seed == 0 {
                run_seed = 123456789;
            }

            // Clonar netlist original para variarlo
            let mut varied_netlist = netlist.clone();
            for comp in &mut varied_netlist.components {
                if let Some(tol) = comp.tolerance {
                    if tol > 0.0 {
                        // Variación gaussiana usando la regla de 3-sigma (la tolerancia es el límite del 99.7%)
                        let std_dev = (comp.value * tol) / 3.0;
                        let noise = box_muller_standard(&mut run_seed) * std_dev;
                        comp.value = (comp.value + noise).max(1e-15); // evitar valores no físicos negativos o cero
                    }
                }
            }

            // Resolver simulación transitoria para esta muestra
            solve_transient_circuit(&varied_netlist, transient_settings)
        })
        .collect()
}
