use super::models::DeviceModel;
use std::collections::HashMap;

pub(super) struct DeviceLayout {
    pub(super) pin_count: usize,
    pub(super) is_gate: bool,
    pub(super) is_subcircuit: bool,
}

pub(super) fn resolve_device_layout(
    first_char: char,
    tokens: &[String],
    line: &str,
    models: &HashMap<String, DeviceModel>,
) -> DeviceLayout {
    let (pin_count, is_gate, is_subcircuit) = match first_char {
        'r' | 'c' | 'l' | 'd' | 'v' | 'i' | 'b' | 'f' | 'h' => (2, false, false),
        'q' | 'j' | 'm' => (3, false, false),
        'e' | 'g' => (4, false, false),
        'o' => match models.get(tokens.last().expect("device line has an identifier")) {
            Some(model) if model.model_type == "opto" => (4, false, false),
            Some(_) => (5, false, false),
            None => (if tokens.len() >= 7 { 5 } else { 4 }, false, false),
        },
        's' => match models.get(tokens.last().expect("device line has an identifier")) {
            Some(model) if model.model_type == "scr" => (3, false, true),
            Some(_) => (2, false, false),
            None => (3, false, false),
        },
        't' => match models.get(tokens.last().expect("device line has an identifier")) {
            Some(model) if model.model_type == "triac" => (3, false, true),
            Some(_) => (2, false, false),
            None => (3, false, false),
        },
        'y' => match models.get(tokens.last().expect("device line has an identifier")) {
            Some(model) => (model.va_ports.as_ref().map_or(3, Vec::len), false, false),
            None => (3, false, false),
        },
        'x' => (0, false, true),
        'u' | 'a' => {
            let line_lower = line.to_lowercase();
            if line_lower.contains("not_gate") {
                (2, true, false)
            } else if ["and_gate", "or_gate", "nand_gate", "nor_gate", "xor_gate"]
                .iter()
                .any(|gate| line_lower.contains(gate))
            {
                (3, true, false)
            } else {
                (5, false, false)
            }
        }
        _ => (5, false, false),
    };

    DeviceLayout {
        pin_count,
        is_gate,
        is_subcircuit,
    }
}

pub(super) fn resolve_pin_count(
    layout: &DeviceLayout,
    first_char: char,
    tokens: &[String],
    models: &HashMap<String, DeviceModel>,
) -> usize {
    if layout.is_gate {
        return layout.pin_count;
    }

    if first_char == 'o' {
        return match models.get(tokens.last().expect("device line has an identifier")) {
            Some(model) if model.model_type == "opto" => 4,
            Some(_) => 5,
            None if tokens.len() >= 7 => 5,
            None => 4,
        };
    }

    if matches!(first_char, 'u' | 'a') && tokens.len() >= 7 {
        5
    } else {
        layout.pin_count
    }
}

pub(super) fn classify_component(
    first_char: char,
    value_or_model: &str,
    tokens: &[String],
    is_gate: bool,
    models: &HashMap<String, DeviceModel>,
) -> String {
    if is_gate {
        return value_or_model.to_string();
    }

    match first_char {
        'r' => "resistor".to_string(),
        'c' => "capacitor".to_string(),
        'l' => "inductor".to_string(),
        'd' => match models.get(value_or_model) {
            Some(model) if model.model_type == "led" => "led".to_string(),
            _ => "diode".to_string(),
        },
        'q' => models
            .get(value_or_model)
            .map_or_else(|| "npn".to_string(), |model| model.model_type.clone()),
        'j' => models
            .get(value_or_model)
            .map_or_else(|| "njf".to_string(), |model| model.model_type.clone()),
        'm' => models
            .get(value_or_model)
            .map_or_else(|| "nmos".to_string(), |model| model.model_type.clone()),
        'y' => "verilog_a".to_string(),
        'v' => "vsource".to_string(),
        'i' => "isource".to_string(),
        'b' => {
            let expression = tokens[3..].join(" ");
            if expression.trim().to_lowercase().starts_with("i=") {
                "bcurrent".to_string()
            } else {
                "bvoltage".to_string()
            }
        }
        'e' => "vcvs".to_string(),
        'g' => "vccs".to_string(),
        'f' => "cccs".to_string(),
        'h' => "ccvs".to_string(),
        'o' => match models.get(value_or_model) {
            Some(model) if model.model_type == "opto" => "opto".to_string(),
            Some(_) => "opamp".to_string(),
            None if tokens.len() == 6 => "opto".to_string(),
            None => "opamp".to_string(),
        },
        's' => match models.get(value_or_model) {
            Some(model) if model.model_type == "scr" => "scr".to_string(),
            Some(_) => "resistor".to_string(),
            None => "scr".to_string(),
        },
        't' => match models.get(value_or_model) {
            Some(model) if model.model_type == "triac" => "triac".to_string(),
            Some(_) => "resistor".to_string(),
            None => "triac".to_string(),
        },
        _ => "opamp".to_string(),
    }
}
