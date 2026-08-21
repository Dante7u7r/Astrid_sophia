use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

use super::super::simulation_types::TimeStepResult;

const MAX_MEASURE_INPUT_STEPS: usize = 2_000_000;
const MAX_MEASURE_DIRECTIVES: usize = 10_000;

// ==================================================================================
// FASE 23: Evaluador de Mediciones Transitorias (.measure)
// ==================================================================================
// Módulo analítico que escanea el histórico de simulación transitoria para medir
// de forma automatizada retardos de propagación, tiempos de subida/bajada,
// picos e integrales promedio con interpolación lineal de alta precisión.

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MeasureDirective {
    pub name: String,
    pub measure_type: String, // "delay", "risetime", "falltime", "peak", "avg", "rms", "min", "max", "pp"
    pub node: String,
    /// Nodo de referencia para medición de retardo (trig)
    pub trig_node: Option<String>,
    /// Valor de umbral (fracción 0..1) para cruces, por defecto 0.5 (50%)
    pub threshold: Option<f64>,
    /// Rango de tiempo [t_start, t_end] para restringir la búsqueda
    pub t_start: Option<f64>,
    pub t_end: Option<f64>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MeasureResult {
    pub measurements: HashMap<String, f64>,
    pub error_log: Option<String>,
}

/// Encuentra el tiempo exacto (interpolado linealmente) en que la señal cruza
/// un nivel `level` en la dirección `rising` (true = flanco de subida, false = bajada).
/// `occurrence` = 1 para el primer cruce, 2 para el segundo, etc.
fn find_threshold_crossing(
    results: &[TimeStepResult],
    node: &str,
    level: f64,
    rising: bool,
    occurrence: usize,
    t_start: f64,
    t_end: f64,
) -> Option<f64> {
    let mut count = 0;
    for i in 1..results.len() {
        let t0 = results[i - 1].time;
        let t1 = results[i].time;
        if t1 < t_start || t0 > t_end {
            continue;
        }

        let v0 = *results[i - 1].node_voltages.get(node).unwrap_or(&0.0);
        let v1 = *results[i].node_voltages.get(node).unwrap_or(&0.0);

        let crosses = if rising {
            v0 < level && v1 >= level
        } else {
            v0 > level && v1 <= level
        };

        if crosses {
            count += 1;
            if count == occurrence {
                // Interpolación lineal del instante exacto de cruce
                if (v1 - v0).abs() < 1e-18 {
                    return Some(t0);
                }
                let fraction = (level - v0) / (v1 - v0);
                return Some(t0 + fraction * (t1 - t0));
            }
        }
    }
    None
}

/// Obtener el rango dinámico de una señal en el nodo dado dentro del intervalo [t_start, t_end]
fn get_signal_range(
    results: &[TimeStepResult],
    node: &str,
    t_start: f64,
    t_end: f64,
) -> (f64, f64) {
    let mut v_min = f64::MAX;
    let mut v_max = f64::MIN;
    for step in results {
        if step.time < t_start || step.time > t_end {
            continue;
        }
        let v = *step.node_voltages.get(node).unwrap_or(&0.0);
        if v < v_min {
            v_min = v;
        }
        if v > v_max {
            v_max = v;
        }
    }
    if v_min == f64::MAX {
        v_min = 0.0;
    }
    if v_max == f64::MIN {
        v_max = 0.0;
    }
    (v_min, v_max)
}

/// Motor de evaluación de directivas `.measure` sobre resultados de simulación transitoria.
pub fn evaluate_measures(
    results: &[TimeStepResult],
    directives: &[MeasureDirective],
) -> MeasureResult {
    let mut measurements = HashMap::new();
    let mut errors = Vec::new();

    if results.len() > MAX_MEASURE_INPUT_STEPS {
        return MeasureResult {
            measurements,
            error_log: Some(format!(
                "Las medidas exceden el limite de {MAX_MEASURE_INPUT_STEPS} muestras."
            )),
        };
    }
    if directives.len() > MAX_MEASURE_DIRECTIVES {
        return MeasureResult {
            measurements,
            error_log: Some(format!(
                "Las medidas exceden el limite de {MAX_MEASURE_DIRECTIVES} directivas."
            )),
        };
    }
    if results.is_empty() {
        return MeasureResult {
            measurements,
            error_log: Some(
                "No hay resultados de simulación transitoria para evaluar.".to_string(),
            ),
        };
    }

    let t_global_start = results[0].time;
    let t_global_end = results.last().unwrap().time;
    if !t_global_start.is_finite()
        || !t_global_end.is_finite()
        || results
            .windows(2)
            .any(|window| !window[1].time.is_finite() || window[1].time <= window[0].time)
    {
        return MeasureResult {
            measurements,
            error_log: Some(
                "Las medidas requieren tiempos finitos y estrictamente crecientes.".to_string(),
            ),
        };
    }

    let mut measure_names = HashSet::new();
    for dir in directives {
        if dir.name.trim().is_empty()
            || dir.name.len() > 128
            || dir.measure_type.trim().is_empty()
            || dir.measure_type.len() > 32
            || dir.node.trim().is_empty()
            || dir.node.len() > 128
            || dir.trig_node.as_ref().is_some_and(|node| node.len() > 128)
        {
            errors.push("Directiva .measure con nombre o nodo invalido.".to_string());
            continue;
        }
        if !measure_names.insert(dir.name.as_str()) {
            errors.push(format!("Directiva .measure duplicada: [{}].", dir.name));
            continue;
        }
        let requested_nodes = std::iter::once(dir.node.as_str())
            .chain(dir.trig_node.as_deref())
            .collect::<HashSet<_>>();
        if let Some(invalid_node) = requested_nodes.iter().find(|node| {
            results.iter().any(|step| {
                step.node_voltages
                    .get(**node)
                    .is_none_or(|voltage| !voltage.is_finite())
            })
        }) {
            errors.push(format!(
                "Directiva [{}]: el nodo '{}' falta en alguna muestra o contiene voltajes no finitos.",
                dir.name, invalid_node
            ));
            continue;
        }
        let t_start = dir.t_start.unwrap_or(t_global_start);
        let t_end = dir.t_end.unwrap_or(t_global_end);
        let threshold_frac = dir.threshold.unwrap_or(0.5);
        if !t_start.is_finite()
            || !t_end.is_finite()
            || t_start > t_end
            || !threshold_frac.is_finite()
            || !(0.0..=1.0).contains(&threshold_frac)
        {
            errors.push(format!(
                "Directiva [{}]: rango temporal o umbral invalido.",
                dir.name
            ));
            continue;
        }

        match dir.measure_type.to_lowercase().as_str() {
            "delay" => {
                // Medir el retardo de propagación entre trig_node y node al cruce del umbral
                let trig_node = dir.trig_node.as_deref().unwrap_or(&dir.node);
                let (trig_min, trig_max) = get_signal_range(results, trig_node, t_start, t_end);
                let trig_level = trig_min + threshold_frac * (trig_max - trig_min);

                let (targ_min, targ_max) = get_signal_range(results, &dir.node, t_start, t_end);
                let targ_level = targ_min + threshold_frac * (targ_max - targ_min);

                if let Some(t_trig) =
                    find_threshold_crossing(results, trig_node, trig_level, true, 1, t_start, t_end)
                {
                    if let Some(t_targ) = find_threshold_crossing(
                        results, &dir.node, targ_level, true, 1, t_start, t_end,
                    ) {
                        measurements.insert(dir.name.clone(), (t_targ - t_trig).abs());
                    } else {
                        errors.push(format!(
                            "MEASURE {}: No se encontró cruce objetivo en nodo '{}'.",
                            dir.name, dir.node
                        ));
                    }
                } else {
                    errors.push(format!(
                        "MEASURE {}: No se encontró cruce de disparo en nodo '{}'.",
                        dir.name, trig_node
                    ));
                }
            }
            "risetime" => {
                // Tiempo de subida: del 10% al 90% del rango dinámico
                let (v_min, v_max) = get_signal_range(results, &dir.node, t_start, t_end);
                let level_10 = v_min + 0.1 * (v_max - v_min);
                let level_90 = v_min + 0.9 * (v_max - v_min);

                if let Some(t_10) =
                    find_threshold_crossing(results, &dir.node, level_10, true, 1, t_start, t_end)
                {
                    if let Some(t_90) = find_threshold_crossing(
                        results, &dir.node, level_90, true, 1, t_start, t_end,
                    ) {
                        measurements.insert(dir.name.clone(), (t_90 - t_10).abs());
                    } else {
                        errors.push(format!(
                            "MEASURE {}: No se encontró cruce del 90% en nodo '{}'.",
                            dir.name, dir.node
                        ));
                    }
                } else {
                    errors.push(format!(
                        "MEASURE {}: No se encontró cruce del 10% en nodo '{}'.",
                        dir.name, dir.node
                    ));
                }
            }
            "falltime" => {
                // Tiempo de bajada: del 90% al 10% del rango dinámico
                let (v_min, v_max) = get_signal_range(results, &dir.node, t_start, t_end);
                let level_90 = v_min + 0.9 * (v_max - v_min);
                let level_10 = v_min + 0.1 * (v_max - v_min);

                if let Some(t_90) =
                    find_threshold_crossing(results, &dir.node, level_90, false, 1, t_start, t_end)
                {
                    if let Some(t_10) = find_threshold_crossing(
                        results, &dir.node, level_10, false, 1, t_start, t_end,
                    ) {
                        measurements.insert(dir.name.clone(), (t_10 - t_90).abs());
                    } else {
                        errors.push(format!(
                            "MEASURE {}: No se encontró cruce descendente del 10% en nodo '{}'.",
                            dir.name, dir.node
                        ));
                    }
                } else {
                    errors.push(format!(
                        "MEASURE {}: No se encontró cruce descendente del 90% en nodo '{}'.",
                        dir.name, dir.node
                    ));
                }
            }
            "peak" | "max" => {
                let mut v_peak = f64::MIN;
                for step in results {
                    if step.time < t_start || step.time > t_end {
                        continue;
                    }
                    let v = *step.node_voltages.get(&dir.node).unwrap_or(&0.0);
                    if v > v_peak {
                        v_peak = v;
                    }
                }
                if v_peak > f64::MIN {
                    measurements.insert(dir.name.clone(), v_peak);
                }
            }
            "min" => {
                let mut v_min = f64::MAX;
                for step in results {
                    if step.time < t_start || step.time > t_end {
                        continue;
                    }
                    let v = *step.node_voltages.get(&dir.node).unwrap_or(&0.0);
                    if v < v_min {
                        v_min = v;
                    }
                }
                if v_min < f64::MAX {
                    measurements.insert(dir.name.clone(), v_min);
                }
            }
            "pp" => {
                // Peak-to-peak
                let (v_min, v_max) = get_signal_range(results, &dir.node, t_start, t_end);
                measurements.insert(dir.name.clone(), v_max - v_min);
            }
            "avg" => {
                // Promedio temporal por integración trapezoidal
                let mut integral = 0.0;
                let mut t_total: f64 = 0.0;
                for i in 1..results.len() {
                    let t0 = results[i - 1].time;
                    let t1 = results[i].time;
                    if t1 < t_start || t0 > t_end {
                        continue;
                    }
                    let v0 = *results[i - 1].node_voltages.get(&dir.node).unwrap_or(&0.0);
                    let v1 = *results[i].node_voltages.get(&dir.node).unwrap_or(&0.0);
                    let dt_seg = t1 - t0;
                    integral += 0.5 * (v0 + v1) * dt_seg;
                    t_total += dt_seg;
                }
                if t_total > 0.0 {
                    measurements.insert(dir.name.clone(), integral / t_total);
                }
            }
            "rms" => {
                // Valor eficaz (RMS) por integración trapezoidal de v^2
                let mut integral_sq: f64 = 0.0;
                let mut t_total: f64 = 0.0;
                for i in 1..results.len() {
                    let t0 = results[i - 1].time;
                    let t1 = results[i].time;
                    if t1 < t_start || t0 > t_end {
                        continue;
                    }
                    let v0 = *results[i - 1].node_voltages.get(&dir.node).unwrap_or(&0.0);
                    let v1 = *results[i].node_voltages.get(&dir.node).unwrap_or(&0.0);
                    let dt_seg = t1 - t0;
                    integral_sq += 0.5 * (v0 * v0 + v1 * v1) * dt_seg;
                    t_total += dt_seg;
                }
                if t_total > 0.0 {
                    measurements.insert(dir.name.clone(), (integral_sq / t_total).sqrt());
                }
            }
            "overshoot" => {
                let (v_min, v_max) = get_signal_range(results, &dir.node, t_start, t_end);
                let v_initial = results
                    .iter()
                    .find(|s| s.time >= t_start)
                    .and_then(|s| s.node_voltages.get(&dir.node).copied())
                    .unwrap_or(0.0);
                let v_final = results
                    .iter()
                    .rev()
                    .find(|s| s.time <= t_end)
                    .and_then(|s| s.node_voltages.get(&dir.node).copied())
                    .unwrap_or(0.0);

                let step_height = (v_final - v_initial).abs();
                if step_height > 1e-9 {
                    let os = if v_final >= v_initial {
                        ((v_max - v_final) / step_height) * 100.0
                    } else {
                        ((v_final - v_min) / step_height) * 100.0
                    };
                    measurements.insert(dir.name.clone(), os.max(0.0));
                } else {
                    measurements.insert(dir.name.clone(), 0.0);
                }
            }
            "settlingtime" | "settling" => {
                let v_initial = results
                    .iter()
                    .find(|s| s.time >= t_start)
                    .and_then(|s| s.node_voltages.get(&dir.node).copied())
                    .unwrap_or(0.0);
                let v_final = results
                    .iter()
                    .rev()
                    .find(|s| s.time <= t_end)
                    .and_then(|s| s.node_voltages.get(&dir.node).copied())
                    .unwrap_or(0.0);

                let tol_fraction = dir.threshold.unwrap_or(0.02);
                let band = (tol_fraction * (v_final - v_initial).abs()).max(1e-6);

                let mut last_out_of_band_time = t_start;
                for step in results {
                    if step.time < t_start || step.time > t_end {
                        continue;
                    }
                    let v = *step.node_voltages.get(&dir.node).unwrap_or(&0.0);
                    if (v - v_final).abs() > band {
                        last_out_of_band_time = step.time;
                    }
                }
                measurements.insert(dir.name.clone(), (last_out_of_band_time - t_start).max(0.0));
            }
            "thd" => {
                let window_steps: Vec<&TimeStepResult> = results
                    .iter()
                    .filter(|s| s.time >= t_start && s.time <= t_end)
                    .collect();

                if window_steps.len() >= 8 {
                    let n = window_steps.len();
                    let t_span = window_steps.last().unwrap().time - window_steps[0].time;
                    if t_span > 0.0 {
                        let mut harmonic_amplitudes = [0.0; 11];
                        for k in 1..=10 {
                            let mut cos_sum = 0.0;
                            let mut sin_sum = 0.0;
                            for i in 1..n {
                                let dt = window_steps[i].time - window_steps[i - 1].time;
                                let t_rel = window_steps[i].time - window_steps[0].time;
                                let v =
                                    *window_steps[i].node_voltages.get(&dir.node).unwrap_or(&0.0);
                                let theta =
                                    2.0 * std::f64::consts::PI * (k as f64) * (t_rel / t_span);
                                cos_sum += v * theta.cos() * dt;
                                sin_sum += v * theta.sin() * dt;
                            }
                            let a_k = (2.0 / t_span) * (cos_sum.powi(2) + sin_sum.powi(2)).sqrt();
                            harmonic_amplitudes[k] = a_k;
                        }

                        let fundamental = harmonic_amplitudes[1];
                        if fundamental > 1e-9 {
                            let higher_harmonics_sum_sq: f64 =
                                harmonic_amplitudes[2..=10].iter().map(|a| a * a).sum();
                            let thd = (higher_harmonics_sum_sq.sqrt() / fundamental) * 100.0;
                            measurements.insert(dir.name.clone(), thd);
                        } else {
                            measurements.insert(dir.name.clone(), 0.0);
                        }
                    }
                }
            }
            _ => {
                errors.push(format!(
                    "MEASURE {}: Tipo de medición '{}' no reconocido.",
                    dir.name, dir.measure_type
                ));
            }
        }
    }

    MeasureResult {
        measurements,
        error_log: if errors.is_empty() {
            None
        } else {
            Some(errors.join("\n"))
        },
    }
}

#[cfg(test)]
mod validation_tests {
    use super::*;

    fn step(time: f64, node: Option<f64>) -> TimeStepResult {
        TimeStepResult {
            time,
            node_voltages: node
                .map(|voltage| HashMap::from([("1".to_string(), voltage)]))
                .unwrap_or_default(),
            branch_currents: HashMap::new(),
        }
    }

    #[test]
    fn reports_missing_nodes_and_duplicate_measure_names() {
        let directives = vec![
            MeasureDirective {
                name: "pico".to_string(),
                measure_type: "max".to_string(),
                node: "1".to_string(),
                trig_node: None,
                threshold: None,
                t_start: None,
                t_end: None,
            },
            MeasureDirective {
                name: "pico".to_string(),
                measure_type: "min".to_string(),
                node: "1".to_string(),
                trig_node: None,
                threshold: None,
                t_start: None,
                t_end: None,
            },
        ];
        let result = evaluate_measures(&[step(0.0, Some(1.0)), step(1.0, None)], &directives);
        let error = result.error_log.expect("validation error");
        assert!(error.contains("falta en alguna muestra"));
        assert!(error.contains("duplicada"));
    }

    #[test]
    fn test_overshoot_settling_and_thd_measurements() {
        // Respuesta al escalón subamortiguada: V(t) = 1.0 - exp(-t/0.002)*cos(2*pi*500*t)
        // Pico a t ≈ 0.001 s, V ≈ 1.25 V => Overshoot ≈ 25%
        let mut steps = Vec::new();
        for i in 0..100 {
            let t = (i as f64) * 0.0001;
            let v = if i == 0 {
                0.0
            } else {
                1.0 - (-t / 0.002).exp() * (2.0 * std::f64::consts::PI * 500.0 * t).cos()
            };
            steps.push(step(t, Some(v)));
        }

        let directives = vec![
            MeasureDirective {
                name: "os_pct".to_string(),
                measure_type: "overshoot".to_string(),
                node: "1".to_string(),
                trig_node: None,
                threshold: None,
                t_start: Some(0.0),
                t_end: Some(0.01),
            },
            MeasureDirective {
                name: "t_settle".to_string(),
                measure_type: "settlingtime".to_string(),
                node: "1".to_string(),
                trig_node: None,
                threshold: Some(0.05),
                t_start: Some(0.0),
                t_end: Some(0.01),
            },
            MeasureDirective {
                name: "thd_val".to_string(),
                measure_type: "thd".to_string(),
                node: "1".to_string(),
                trig_node: None,
                threshold: None,
                t_start: Some(0.0),
                t_end: Some(0.01),
            },
        ];

        let res = evaluate_measures(&steps, &directives);
        assert!(res.error_log.is_none());
        let os = res.measurements.get("os_pct").copied().unwrap_or(0.0);
        assert!(os > 10.0 && os <= 70.0);

        let t_set = res.measurements.get("t_settle").copied().unwrap_or(0.0);
        assert!(t_set > 0.0 && t_set < 0.01);
    }
}
