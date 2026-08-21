use crate::solver::types::CircuitNetlist;
use rayon::iter::{IntoParallelIterator, ParallelIterator};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

use super::super::simulation_types::{TimeStepResult, TransientSettings};
use super::super::transient::solve_transient_circuit;

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct YieldSpec {
    pub node: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub min_voltage: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_voltage: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_time: Option<f64>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MonteCarloYieldReport {
    pub total_runs: usize,
    pub passed_runs: usize,
    pub yield_percentage: f64,
    pub mean_value: f64,
    pub std_dev: f64,
    pub min_observed: f64,
    pub max_observed: f64,
}

#[derive(Serialize, Deserialize, Debug, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct MonteCarloSettings {
    pub runs: usize,
    pub seed: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lot_correlation: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub matching_correlation: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub yield_spec: Option<YieldSpec>,
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
        if let Some(rho_lot) = self.lot_correlation {
            if !rho_lot.is_finite() || !(0.0..=1.0).contains(&rho_lot) {
                return Err(
                    "El coeficiente de correlación lot_correlation debe estar entre 0.0 y 1.0."
                        .to_string(),
                );
            }
        }
        if let Some(rho_match) = self.matching_correlation {
            if !rho_match.is_finite() || !(0.0..=1.0).contains(&rho_match) {
                return Err("El coeficiente de correlación matching_correlation debe estar entre 0.0 y 1.0.".to_string());
            }
        }
        Ok(())
    }
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MonteCarloResult {
    pub run_results: Vec<Vec<TimeStepResult>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub yield_report: Option<MonteCarloYieldReport>,
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

pub fn evaluate_monte_carlo_yield(
    run_results: &[Vec<TimeStepResult>],
    spec: &YieldSpec,
) -> MonteCarloYieldReport {
    let total_runs = run_results.len();
    if total_runs == 0 {
        return MonteCarloYieldReport {
            total_runs: 0,
            passed_runs: 0,
            yield_percentage: 0.0,
            mean_value: 0.0,
            std_dev: 0.0,
            min_observed: 0.0,
            max_observed: 0.0,
        };
    }

    let mut observed_values = Vec::with_capacity(total_runs);
    let mut passed_count = 0;

    for run in run_results {
        if run.is_empty() {
            continue;
        }

        // Buscar el punto temporal más cercano al target_time, o usar el último punto en régimen permanente
        let target_step = if let Some(t_target) = spec.target_time {
            run.iter()
                .min_by(|a, b| {
                    (a.time - t_target)
                        .abs()
                        .total_cmp(&(b.time - t_target).abs())
                })
                .unwrap_or(run.last().unwrap())
        } else {
            run.last().unwrap()
        };

        let val = *target_step.node_voltages.get(&spec.node).unwrap_or(&0.0);
        observed_values.push(val);

        let meets_min = spec.min_voltage.is_none_or(|v_min| val >= v_min);
        let meets_max = spec.max_voltage.is_none_or(|v_max| val <= v_max);

        if meets_min && meets_max {
            passed_count += 1;
        }
    }

    let n = observed_values.len() as f64;
    let mean = if n > 0.0 {
        observed_values.iter().sum::<f64>() / n
    } else {
        0.0
    };

    let variance = if n > 1.0 {
        observed_values
            .iter()
            .map(|v| (v - mean).powi(2))
            .sum::<f64>()
            / (n - 1.0)
    } else {
        0.0
    };
    let std_dev = variance.sqrt();

    let min_observed = observed_values
        .iter()
        .copied()
        .fold(f64::INFINITY, f64::min);
    let max_observed = observed_values
        .iter()
        .copied()
        .fold(f64::NEG_INFINITY, f64::max);

    let yield_percentage = if total_runs > 0 {
        (passed_count as f64 / total_runs as f64) * 100.0
    } else {
        0.0
    };

    MonteCarloYieldReport {
        total_runs,
        passed_runs: passed_count,
        yield_percentage,
        mean_value: mean,
        std_dev,
        min_observed: if min_observed.is_finite() {
            min_observed
        } else {
            0.0
        },
        max_observed: if max_observed.is_finite() {
            max_observed
        } else {
            0.0
        },
    }
}

pub fn solve_monte_carlo_transient(
    netlist: &CircuitNetlist,
    transient_settings: &TransientSettings,
    mc_settings: &MonteCarloSettings,
) -> Result<Vec<Vec<TimeStepResult>>, String> {
    mc_settings.validate(transient_settings)?;
    let rng_seed_base = mc_settings.seed.unwrap_or(123456789);

    // Identificar de manera reproducible todos los lotes y matching groups
    let mut lot_ids = BTreeSet::new();
    let mut match_groups = BTreeSet::new();

    for comp in &netlist.components {
        let lot_key = comp
            .lot_id
            .clone()
            .unwrap_or_else(|| comp.comp_type.clone());
        lot_ids.insert(lot_key);

        if let Some(ref group) = comp.matching_group {
            match_groups.insert(group.clone());
        }
    }

    (0..mc_settings.runs)
        .into_par_iter()
        .map(|run_idx| {
            // Cada hilo tiene su propia semilla única derivada de la semilla base
            let mut run_seed = rng_seed_base.wrapping_add(run_idx as u64 * 72057594037927931);
            if run_seed == 0 {
                run_seed = 123456789;
            }

            // 1. Muestrear variables globales de lote Z_lot para cada familia o lote
            let mut lot_variates: BTreeMap<String, f64> = BTreeMap::new();
            for lot in &lot_ids {
                lot_variates.insert(lot.clone(), box_muller_standard(&mut run_seed));
            }

            // 2. Muestrear variables de matching de pellet Z_match para cada matching group
            let mut match_variates: BTreeMap<String, f64> = BTreeMap::new();
            for group in &match_groups {
                match_variates.insert(group.clone(), box_muller_standard(&mut run_seed));
            }

            // 3. Clonar y variar el netlist con la correlación jerárquica
            let mut varied_netlist = netlist.clone();
            for comp in &mut varied_netlist.components {
                if let Some(tol) = comp.tolerance {
                    if tol > 0.0 {
                        let lot_key = comp
                            .lot_id
                            .clone()
                            .unwrap_or_else(|| comp.comp_type.clone());
                        let z_lot = *lot_variates.get(&lot_key).unwrap_or(&0.0);

                        let rho_lot = comp
                            .lot_correlation
                            .or(mc_settings.lot_correlation)
                            .unwrap_or(0.0)
                            .clamp(0.0, 0.9999);

                        let z_total = if let Some(ref group) = comp.matching_group {
                            let z_match = *match_variates.get(group).unwrap_or(&0.0);
                            let rho_match = mc_settings
                                .matching_correlation
                                .unwrap_or(0.95)
                                .clamp(0.0, 0.9999);

                            let w_lot = rho_lot;
                            let w_match = rho_match * (1.0 - rho_lot);
                            let w_indep = (1.0 - rho_match) * (1.0 - rho_lot);

                            let z_indep = box_muller_standard(&mut run_seed);
                            w_lot.sqrt() * z_lot
                                + w_match.sqrt() * z_match
                                + w_indep.sqrt() * z_indep
                        } else {
                            let w_lot = rho_lot;
                            let w_indep = 1.0 - rho_lot;
                            let z_indep = box_muller_standard(&mut run_seed);
                            w_lot.sqrt() * z_lot + w_indep.sqrt() * z_indep
                        };

                        let std_dev = (comp.value * tol) / 3.0;
                        let delta = z_total * std_dev;
                        comp.value = (comp.value + delta).max(1e-15);
                    }
                }
            }

            // Resolver simulación transitoria para esta muestra variada
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
            lot_correlation: None,
            matching_correlation: None,
            yield_spec: None,
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
            lot_correlation: None,
            matching_correlation: None,
            yield_spec: None,
        }
        .validate(&dense_transient)
        .is_err());
    }
}
