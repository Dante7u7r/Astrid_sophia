#[allow(unused_imports)]
use super::devices::*;
#[allow(unused_imports)]
use super::expressions::*;
#[allow(unused_imports)]
use super::subcircuits::*;

// Mapea sufijos de SPICE a multiplicadores decimales
pub fn parse_spice_value(s: &str) -> Result<f64, String> {
    let clean = s.trim().to_lowercase();
    if clean.is_empty() {
        return Err("Valor de SPICE vacío".to_string());
    }

    // Encontrar el primer caracter no numérico (excluyendo signo, punto y e/e- para notación científica)
    let mut num_end = clean.len();
    let chars: Vec<char> = clean.chars().collect();

    for (i, &c) in chars.iter().enumerate() {
        if c.is_alphabetic() {
            // Verificar si es parte de notación científica (ej: 1e-3)
            if c == 'e'
                && i + 1 < chars.len()
                && (chars[i + 1].is_numeric() || chars[i + 1] == '-' || chars[i + 1] == '+')
            {
                continue;
            }
            num_end = i;
            break;
        }
    }

    let num_str = &clean[..num_end];
    let mut val = num_str
        .parse::<f64>()
        .map_err(|e| format!("No se pudo parsear número '{}': {}", num_str, e))?;

    let suffix_str = &clean[num_end..];
    if !suffix_str.is_empty() {
        if suffix_str.starts_with("meg") {
            val *= 1e6;
        } else if suffix_str.starts_with("mil") {
            val *= 25.4e-6; // 1 mil en metros (típico en PCB, pero en SPICE a veces es 1e-3, usemos 25.4e-6 o 1e-3. ngspice mapea mil a 25.4e-6)
        } else {
            match suffix_str.chars().next().unwrap() {
                't' => val *= 1e12,
                'g' => val *= 1e9,
                'k' => val *= 1e3,
                'm' => val *= 1e-3, // milis
                'u' => val *= 1e-6,
                'n' => val *= 1e-9,
                'p' => val *= 1e-12,
                'f' => val *= 1e-15,
                _ => {} // Otros caracteres son ignorados por SPICE (ej: 10kOhm -> 10k)
            }
        }
    }

    Ok(val)
}

// Analiza los parámetros de una función como sine(0 5 10k) o pulse(0 5 10k 0.5)
pub fn parse_waveform(wave_str: &str) -> Option<(String, Vec<f64>)> {
    let clean = wave_str.trim();
    let open_idx = clean.find('(')?;
    let close_idx = clean.find(')')?;
    if close_idx <= open_idx {
        return None;
    }

    let wave_type = clean[..open_idx].trim().to_lowercase();
    let params_str = &clean[open_idx + 1..close_idx];

    let mut params = Vec::new();
    // Separar por espacios o comas
    for token in params_str.split([' ', ',', '\t']) {
        let t = token.trim();
        if !t.is_empty() {
            if let Ok(val) = parse_spice_value(t) {
                params.push(val);
            }
        }
    }

    Some((wave_type, params))
}
