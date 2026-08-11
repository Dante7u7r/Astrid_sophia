use super::super::*;

#[test]
fn test_fft_sine_thd() {
    let f_fund = 1000.0;
    let t_max = 0.01; // 10 ms (10 ciclos completos de 1kHz)

    // Generar 2048 pasos uniformes de una senoide ideal
    let n_steps = 2048;
    let mut time_steps = Vec::with_capacity(n_steps);
    for i in 0..n_steps {
        let t = (i as f64) * (t_max / (n_steps - 1) as f64);
        let mut node_voltages = HashMap::new();
        // Senoide ideal de amplitud 5V, offset 0V
        let v_val = 5.0 * (2.0 * std::f64::consts::PI * f_fund * t).sin();
        node_voltages.insert("1".to_string(), v_val);

        time_steps.push(TimeStepResult {
            time: t,
            node_voltages,
            branch_currents: HashMap::new(),
        });
    }

    let fft_res = calculate_fft_and_thd(&time_steps, "1", f_fund).unwrap();

    // El espectro de frecuenciaNyquist debe ser de 1024 bins
    assert_eq!(fft_res.frequencies.len(), 1024);

    // Encontrar el bin correspondiente a 1000 Hz en fft_res.frequencies
    let mut fund_bin = 0;
    let mut min_diff = f64::MAX;
    for (idx, &f) in fft_res.frequencies.iter().enumerate() {
        let diff = (f - f_fund).abs();
        if diff < min_diff {
            min_diff = diff;
            fund_bin = idx;
        }
    }

    // La magnitud en dB de la fundamental a 1000Hz debería ser muy alta (aproximadamente 20*log10(5) = 13.97 dBV)
    let db_val = fft_res.magnitudes_db[fund_bin];
    assert!(
        (db_val - 13.97).abs() < 0.5,
        "La fundamental a 1kHz debería rondar los 14dBV (amplitud 5V), obtenido: {}",
        db_val
    );

    // Dado que la onda es una senoide perfectamente pura por diseño,
    // su THD debería ser sumamente baja (virtualmente cero, < 0.2% considerando la fuga espectral discreta de 2048 puntos)
    assert!(
        fft_res.thd < 0.2,
        "THD de senoide ideal debería ser muy cercano a 0%, obtenido: {}%",
        fft_res.thd
    );
}

#[test]
fn test_imd_two_tone_clipper() {
    let f1 = 900.0;
    let f2 = 1000.0;
    let t_max = 0.05; // 50 ms

    // Generar 2048 pasos uniformes de una señal de dos tonos con distorsión cúbica
    let n_steps = 2048;
    let mut time_steps = Vec::with_capacity(n_steps);
    for i in 0..n_steps {
        let t = (i as f64) * (t_max / (n_steps - 1) as f64);
        let mut node_voltages = HashMap::new();

        // Señal fundamental de dos tonos
        let v_fund = (2.0 * std::f64::consts::PI * f1 * t).sin()
            + (2.0 * std::f64::consts::PI * f2 * t).sin();
        // Agregar una distorsión no lineal cúbica que genera IM3
        let v_distorted = v_fund - 0.05 * v_fund.powi(3);

        node_voltages.insert("out".to_string(), v_distorted);

        time_steps.push(TimeStepResult {
            time: t,
            node_voltages,
            branch_currents: HashMap::new(),
        });
    }

    let imd_res = calculate_imd_analysis(&time_steps, "out", f1, f2).unwrap();

    println!(
        "Power Fund: {}, IM3: {}, IMD%: {}, IP3: {}",
        imd_res.fundamental_power_dbv,
        imd_res.im3_power_dbv,
        imd_res.imd_ratio_percent,
        imd_res.ip3_out_dbv
    );

    // Las fundamentales deben detectarse con buena potencia
    assert!(
        imd_res.fundamental_power_dbv > -10.0,
        "La potencia fundamental debería ser medible"
    );
    // El producto IM3 a 2f1 - f2 (800Hz) o 2f2 - f1 (1100Hz) debe ser detectable
    assert!(
        imd_res.im3_power_dbv > -60.0,
        "Los productos IM3 deberían ser detectables en el espectro"
    );
    // La tasa de IMD en porcentaje debe ser positiva y razonable
    assert!(
        imd_res.imd_ratio_percent > 0.1 && imd_res.imd_ratio_percent < 25.0,
        "IMD fuera de rango: {}%",
        imd_res.imd_ratio_percent
    );
    // IP3 extrapolado debe ser estable y mayor que la potencia fundamental
    assert!(
        imd_res.ip3_out_dbv > imd_res.fundamental_power_dbv,
        "IP3 de salida ({}) debe ser mayor que la fundamental ({})",
        imd_res.ip3_out_dbv,
        imd_res.fundamental_power_dbv
    );
}
