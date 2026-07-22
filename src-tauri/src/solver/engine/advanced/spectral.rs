use num_complex::Complex;
use serde::{Deserialize, Serialize};

use super::super::simulation_types::TimeStepResult;

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FftResult {
    pub frequencies: Vec<f64>,
    pub magnitudes_db: Vec<f64>,
    pub thd: f64,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ImdResult {
    pub fundamental_power_dbv: f64,
    pub im2_power_dbv: f64,
    pub im3_power_dbv: f64,
    pub imd_ratio_percent: f64,
    pub ip3_out_dbv: f64,
    pub frequencies: Vec<f64>,
    pub magnitudes_db: Vec<f64>,
}

pub fn find_peak_magnitude(frequencies: &[f64], magnitudes: &[f64], target_freq: f64) -> f64 {
    let mut best_bin = 0;
    let mut min_diff = f64::MAX;
    for (i, &f) in frequencies.iter().enumerate() {
        let diff = (f - target_freq).abs();
        if diff < min_diff {
            min_diff = diff;
            best_bin = i;
        }
    }

    let mut max_mag = magnitudes[best_bin];
    let start = best_bin.saturating_sub(3);
    let end = (best_bin + 3).min(frequencies.len() - 1);
    for i in start..=end {
        if magnitudes[i] > max_mag {
            max_mag = magnitudes[i];
        }
    }
    max_mag
}

pub fn calculate_imd_analysis(
    time_steps: &[TimeStepResult],
    node_name: &str,
    f1: f64,
    f2: f64,
) -> Result<ImdResult, String> {
    if time_steps.len() < 2 {
        return Err(
            "No hay suficientes pasos de tiempo para análisis de intermodulación.".to_string(),
        );
    }

    let t_max = time_steps.last().unwrap().time;
    let n_points = 2048; // Potencia de 2
    let dt_uniform = t_max / (n_points - 1) as f64;

    // 1. Remuestrear la señal de forma uniforme con Ventana de Hann para reducir la fuga espectral
    let mut v_samples = vec![Complex::new(0.0, 0.0); n_points];
    for i in 0..n_points {
        let t_target = i as f64 * dt_uniform;
        let v_val = interpolate_node_voltage(time_steps, node_name, t_target);

        // Ventana de Hann: 0.5 * (1.0 - cos(2 * PI * i / (N - 1)))
        let hann =
            0.5 * (1.0 - (2.0 * std::f64::consts::PI * i as f64 / (n_points - 1) as f64).cos());
        v_samples[i] = Complex::new(v_val * hann, 0.0);
    }

    // 2. Correr FFT
    fft_radix2(&mut v_samples);

    // 3. Extraer densidades espectrales del espectro unilateral
    let fs = 1.0 / dt_uniform;
    let half_n = n_points / 2;
    let mut frequencies = Vec::with_capacity(half_n);
    let mut magnitudes = Vec::with_capacity(half_n);
    let mut magnitudes_db = Vec::with_capacity(half_n);

    // Con ventana de Hann, multiplicamos por 2 para restaurar la amplitud del pico senoidal
    for k in 0..half_n {
        let freq = k as f64 * fs / n_points as f64;
        frequencies.push(freq);

        let raw_mag = v_samples[k].norm();
        let mag = if k == 0 {
            2.0 * raw_mag / n_points as f64
        } else {
            4.0 * raw_mag / n_points as f64
        };
        magnitudes.push(mag);

        let db = 20.0 * mag.max(1e-9).log10();
        magnitudes_db.push(db);
    }

    // 4. Medir componentes fundamentales
    let mag_f1 = find_peak_magnitude(&frequencies, &magnitudes, f1);
    let mag_f2 = find_peak_magnitude(&frequencies, &magnitudes, f2);

    let a_fund: f64 = 0.5 * (mag_f1 + mag_f2);
    let fund_power_dbv = 20.0 * a_fund.max(1e-9).log10();

    // 5. Medir productos IM2
    let mag_im2_diff = find_peak_magnitude(&frequencies, &magnitudes, (f1 - f2).abs());
    let mag_im2_sum = find_peak_magnitude(&frequencies, &magnitudes, f1 + f2);
    let a_im2: f64 = 0.5 * (mag_im2_diff + mag_im2_sum);
    let im2_power_dbv = 20.0 * a_im2.max(1e-9).log10();

    // 6. Medir productos IM3
    let mag_im3_lower = find_peak_magnitude(&frequencies, &magnitudes, (2.0 * f1 - f2).abs());
    let mag_im3_upper = find_peak_magnitude(&frequencies, &magnitudes, (2.0 * f2 - f1).abs());
    let a_im3: f64 = 0.5 * (mag_im3_lower + mag_im3_upper);
    let im3_power_dbv = 20.0 * a_im3.max(1e-9).log10();

    // 7. Calcular tasa de IMD en porcentaje
    let total_im_sq = (mag_im2_diff * mag_im2_diff)
        + (mag_im2_sum * mag_im2_sum)
        + (mag_im3_lower * mag_im3_lower)
        + (mag_im3_upper * mag_im3_upper);
    let imd_ratio_percent = if a_fund > 1e-6 {
        (total_im_sq.sqrt() / a_fund) * 100.0
    } else {
        0.0
    };

    // 8. Extrapolar IP3 de salida
    let ip3_out_dbv = fund_power_dbv + (fund_power_dbv - im3_power_dbv) / 2.0;

    Ok(ImdResult {
        fundamental_power_dbv: fund_power_dbv,
        im2_power_dbv,
        im3_power_dbv,
        imd_ratio_percent,
        ip3_out_dbv,
        frequencies,
        magnitudes_db,
    })
}

// Remuestreo por interpolación lineal para redes temporales no uniformes del paso adaptativo
fn interpolate_node_voltage(results: &[TimeStepResult], node_name: &str, t_target: f64) -> f64 {
    if results.is_empty() {
        return 0.0;
    }
    if t_target <= results[0].time {
        return *results[0].node_voltages.get(node_name).unwrap_or(&0.0);
    }
    if t_target >= results.last().unwrap().time {
        return *results
            .last()
            .unwrap()
            .node_voltages
            .get(node_name)
            .unwrap_or(&0.0);
    }

    // Búsqueda binaria para encontrar el intervalo [low, high]
    let mut low = 0;
    let mut high = results.len() - 1;
    while low + 1 < high {
        let mid = (low + high) / 2;
        if results[mid].time <= t_target {
            low = mid;
        } else {
            high = mid;
        }
    }

    let t0 = results[low].time;
    let t1 = results[high].time;
    let v0 = *results[low].node_voltages.get(node_name).unwrap_or(&0.0);
    let v1 = *results[high].node_voltages.get(node_name).unwrap_or(&0.0);

    if (t1 - t0).abs() < 1e-15 {
        v0
    } else {
        let fraction = (t_target - t0) / (t1 - t0);
        v0 + fraction * (v1 - v0)
    }
}

// Transformada Rápida de Fourier Cooley-Tukey Radix-2 en Rust puro
fn fft_radix2(a: &mut [Complex<f64>]) {
    let n = a.len();
    if n <= 1 {
        return;
    }

    let mut even = vec![Complex::new(0.0, 0.0); n / 2];
    let mut odd = vec![Complex::new(0.0, 0.0); n / 2];
    for i in 0..n / 2 {
        even[i] = a[2 * i];
        odd[i] = a[2 * i + 1];
    }

    fft_radix2(&mut even);
    fft_radix2(&mut odd);

    for k in 0..n / 2 {
        let angle = -2.0 * std::f64::consts::PI * (k as f64) / (n as f64);
        let t = Complex::from_polar(1.0, angle) * odd[k];
        a[k] = even[k] + t;
        a[k + n / 2] = even[k] - t;
    }
}

// Core analítico de cálculo FFT y THD
pub fn calculate_fft_and_thd(
    time_steps: &[TimeStepResult],
    node_name: &str,
    fundamental_freq: f64,
) -> Result<FftResult, String> {
    if time_steps.len() < 2 {
        return Err("No hay suficientes pasos de tiempo para análisis FFT.".to_string());
    }

    let t_max = time_steps.last().unwrap().time;
    let n_points = 2048; // Potencia de 2
    let dt_uniform = t_max / (n_points - 1) as f64;

    // 1. Remuestrear la señal de forma uniforme
    let mut v_samples = vec![Complex::new(0.0, 0.0); n_points];
    for i in 0..n_points {
        let t_target = i as f64 * dt_uniform;
        let v_val = interpolate_node_voltage(time_steps, node_name, t_target);
        v_samples[i] = Complex::new(v_val, 0.0);
    }

    // 2. Correr FFT
    fft_radix2(&mut v_samples);

    // 3. Extraer densidades espectrales del espectro unilateral (hasta Nyquist)
    let fs = 1.0 / dt_uniform;
    let half_n = n_points / 2;
    let mut frequencies = Vec::with_capacity(half_n);
    let mut magnitudes = Vec::with_capacity(half_n);
    let mut magnitudes_db = Vec::with_capacity(half_n);

    for k in 0..half_n {
        let freq = k as f64 * fs / n_points as f64;
        frequencies.push(freq);

        let raw_mag = v_samples[k].norm();
        let mag = if k == 0 {
            raw_mag / n_points as f64
        } else {
            2.0 * raw_mag / n_points as f64
        };
        magnitudes.push(mag);

        let db = 20.0 * mag.max(1e-9).log10();
        magnitudes_db.push(db);
    }

    // 4. Calcular THD espectral de precisión
    let mut fund_bin = 0;
    let mut min_diff = f64::MAX;
    for (i, &f) in frequencies.iter().enumerate() {
        let diff = (f - fundamental_freq).abs();
        if diff < min_diff {
            min_diff = diff;
            fund_bin = i;
        }
    }

    let mut max_fund_mag = magnitudes[fund_bin];
    let start_fund = fund_bin.saturating_sub(3);
    let end_fund = (fund_bin + 3).min(half_n - 1);
    for i in start_fund..=end_fund {
        if magnitudes[i] > max_fund_mag {
            max_fund_mag = magnitudes[i];
        }
    }

    let a1 = max_fund_mag;
    let mut sum_harmonics_sq = 0.0;

    if a1 > 1e-6 {
        for h in 2..=8 {
            let target_harmonic_freq = h as f64 * fundamental_freq;
            if target_harmonic_freq > fs / 2.0 {
                break;
            }

            let mut harm_bin = 0;
            let mut min_harm_diff = f64::MAX;
            for (i, &f) in frequencies.iter().enumerate() {
                let diff = (f - target_harmonic_freq).abs();
                if diff < min_harm_diff {
                    min_harm_diff = diff;
                    harm_bin = i;
                }
            }

            let mut peak_harm_mag = magnitudes[harm_bin];
            let start_harm = harm_bin.saturating_sub(3);
            let end_harm = (harm_bin + 3).min(half_n - 1);
            for i in start_harm..=end_harm {
                if magnitudes[i] > peak_harm_mag {
                    peak_harm_mag = magnitudes[i];
                }
            }

            sum_harmonics_sq += peak_harm_mag * peak_harm_mag;
        }
    }

    let thd = if a1 > 1e-6 {
        (sum_harmonics_sq.sqrt() / a1) * 100.0
    } else {
        0.0
    };

    Ok(FftResult {
        frequencies,
        magnitudes_db,
        thd,
    })
}
