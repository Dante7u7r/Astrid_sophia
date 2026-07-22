use crate::solver::types::ComponentData;
use serde::{Deserialize, Serialize};

// ==================================================================================
// FASE 24: Macromodelo de Líneas de Transmisión RLCG Segmentadas
// ==================================================================================
// Segmenta una línea de transmisión ideal o dispersiva con pérdidas en N secciones
// pasivas equivalentes en cascada Pi (inductores L, capacitores C, resistencias R
// y conductancias de fuga G) para integridad de señal en RF.

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TransmissionLineParams {
    pub id: String,
    pub pin_in: String,    // Nodo de entrada
    pub pin_out: String,   // Nodo de salida
    pub gnd: String,       // Nodo de referencia (tierra)
    pub z0: f64,           // Impedancia característica (Ω)
    pub td: f64,           // Retardo de propagación (s)
    pub r_total: f64,      // Resistencia serie total de la línea (Ω), 0 para ideal
    pub g_total: f64,      // Conductancia de fuga total (S), 0 para ideal
    pub n_segments: usize, // Número de segmentos de la cascada Pi
}

/// Expande una línea de transmisión en N segmentos pasivos equivalentes en cascada Pi.
/// Cada segmento genera: L_seg en serie, C_seg/2 a cada extremo en paralelo, R_seg en serie,
/// y G_seg/2 a cada extremo. Se crean nodos internos virtuales `TL{id}.n{i}`.
///
/// Parámetros por segmento:
///   L_seg = Z0 * Td / N
///   C_seg = Td / (Z0 * N)
///   R_seg = R_total / N
///   G_seg = G_total / N
pub fn expand_transmission_line(params: &TransmissionLineParams) -> Vec<ComponentData> {
    let n = params.n_segments.max(1);
    let l_seg = params.z0 * params.td / n as f64;
    let c_seg = params.td / (params.z0 * n as f64);
    let r_seg = params.r_total / n as f64;
    let g_seg = params.g_total / n as f64;

    let mut components = Vec::new();
    let prefix = format!("TL{}", params.id);

    for i in 0..n {
        // Nodo de entrada del segmento
        let node_left = if i == 0 {
            params.pin_in.clone()
        } else {
            format!("{}.n{}", prefix, i)
        };

        // Nodo de salida del segmento
        let node_right = if i == n - 1 {
            params.pin_out.clone()
        } else {
            format!("{}.n{}", prefix, i + 1)
        };

        // Nodo intermedio entre R y L dentro del segmento
        let node_mid = format!("{}.m{}", prefix, i);

        // R_seg en serie (nodo_left → node_mid)
        if r_seg > 1e-15 {
            components.push(ComponentData {
                id: format!("{}.R{}", prefix, i),
                comp_type: "resistor".to_string(),
                value: r_seg,
                pins: vec![node_left.clone(), node_mid.clone()],
                ..Default::default()
            });
        }

        // L_seg en serie (node_mid → node_right) o (node_left → node_right) si no hay R
        let l_left = if r_seg > 1e-15 {
            node_mid.clone()
        } else {
            node_left.clone()
        };
        components.push(ComponentData {
            id: format!("{}.L{}", prefix, i),
            comp_type: "inductor".to_string(),
            value: l_seg,
            pins: vec![l_left, node_right.clone()],
            ..Default::default()
        });

        // C_seg/2 al lado izquierdo (node_left → gnd)
        components.push(ComponentData {
            id: format!("{}.CL{}", prefix, i),
            comp_type: "capacitor".to_string(),
            value: c_seg / 2.0,
            pins: vec![node_left.clone(), params.gnd.clone()],
            ..Default::default()
        });

        // C_seg/2 al lado derecho (node_right → gnd)
        components.push(ComponentData {
            id: format!("{}.CR{}", prefix, i),
            comp_type: "capacitor".to_string(),
            value: c_seg / 2.0,
            pins: vec![node_right.clone(), params.gnd.clone()],
            ..Default::default()
        });

        // G_seg/2 al lado izquierdo (conductancia de fuga) modelada como resistor grande
        if g_seg > 1e-15 {
            let r_shunt = 2.0 / g_seg; // R = 1/G, dividido por 2 porque tenemos G/2 a cada lado
            components.push(ComponentData {
                id: format!("{}.GL{}", prefix, i),
                comp_type: "resistor".to_string(),
                value: r_shunt,
                pins: vec![node_left.clone(), params.gnd.clone()],
                ..Default::default()
            });
            components.push(ComponentData {
                id: format!("{}.GR{}", prefix, i),
                comp_type: "resistor".to_string(),
                value: r_shunt,
                pins: vec![node_right.clone(), params.gnd.clone()],
                ..Default::default()
            });
        }
    }

    components
}
