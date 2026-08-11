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

const MAX_MONTE_CARLO_RUNS: usize = 256;
const MAX_MONTE_CARLO_SAMPLES: usize = 2_000_000;

impl MonteCarloSettings {
    pub fn validate(&self, transient_settings: &TransientSettings) -> Result<(), String> {
        transient_settings.validate()?;
        if self.runs == 0 || self.runs > MAX_MONTE_CARLO_RUNS {
            return Err(format!(
                "Monte Carlo requiere entre 1 y {MAX_MONTE_CARLO_RUNS} corridas."
            ));
        }
        let samples_per_run = (transient_settings.t_max / transient_settings.dt).ceil() as usize;
        let total_samples = self.runs.saturating_mul(samples_per_run);
        if total_samples > MAX_MONTE_CARLO_SAMPLES {
            return Err(format!(
                "Monte Carlo excede el limite combinado de {MAX_MONTE_CARLO_SAMPLES} muestras."
            ));
        }
        Ok(())
    }
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
    mc_settings.validate(transient_settings)?;
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

#[cfg(test)]
mod validation_tests {
    use super::*;

    #[test]
    fn rejects_zero_runs_and_excessive_combined_samples() {
        let transient = TransientSettings {
            dt: 1e-3,
            t_max: 1.0,
            fixed_step: None,
            integration_method: None,
        };
        assert!(MonteCarloSettings {
            runs: 0,
            seed: None,
        }
        .validate(&transient)
        .is_err());

        let dense_transient = TransientSettings {
            dt: 1e-5,
            t_max: 1.0,
            fixed_step: None,
            integration_method: None,
        };
        assert!(MonteCarloSettings {
            runs: 256,
            seed: None,
        }
        .validate(&dense_transient)
        .is_err());
    }
}
