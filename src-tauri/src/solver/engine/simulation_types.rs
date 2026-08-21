use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TransientSettings {
    pub dt: f64,
    pub t_max: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fixed_step: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub integration_method: Option<String>,
}

impl TransientSettings {
    pub fn validate(&self) -> Result<(), String> {
        if !self.dt.is_finite() || self.dt <= 0.0 {
            return Err("El paso temporal dt debe ser finito y mayor que cero.".to_string());
        }
        if !self.t_max.is_finite() || self.t_max < 0.0 {
            return Err("La duración transitoria tMax debe ser finita y no negativa.".to_string());
        }

        let estimated_steps = self.t_max / self.dt;
        if !estimated_steps.is_finite() || estimated_steps > 2_000_000.0 {
            return Err(
                "La simulación transitoria excede el límite de 2 000 000 de pasos solicitados."
                    .to_string(),
            );
        }

        if let Some(method) = self.integration_method.as_deref() {
            if !matches!(
                method,
                "auto" | "euler" | "BE" | "gear2" | "trap" | "trapezoidal"
            ) {
                return Err(format!(
                    "Método de integración no compatible: {method}. Use auto, euler, BE, gear2, trap o trapezoidal."
                ));
            }
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Copy)]
pub struct SolverNumericalSettings {
    pub tolerance: f64,
    pub max_iterations: usize,
}

impl Default for SolverNumericalSettings {
    fn default() -> Self {
        Self {
            tolerance: 1e-6,
            max_iterations: 100,
        }
    }
}

impl SolverNumericalSettings {
    pub fn validate(&self) -> Result<(), String> {
        if !self.tolerance.is_finite() || self.tolerance <= 0.0 || self.tolerance > 1.0 {
            return Err(
                "La tolerancia de convergencia debe ser finita, mayor que cero y menor o igual que 1."
                    .to_string(),
            );
        }
        if self.max_iterations == 0 || self.max_iterations > 10_000 {
            return Err("El máximo de iteraciones debe estar entre 1 y 10 000.".to_string());
        }
        Ok(())
    }
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TimeStepResult {
    pub time: f64,
    pub node_voltages: HashMap<String, f64>,
    pub branch_currents: HashMap<String, f64>,
}

#[cfg(test)]
mod validation_tests {
    use super::*;

    #[test]
    fn transient_settings_reject_non_positive_or_unbounded_steps() {
        let invalid_dt = TransientSettings {
            dt: 0.0,
            t_max: 1.0,
            fixed_step: None,
            integration_method: None,
        };
        assert!(invalid_dt.validate().is_err());

        let excessive_steps = TransientSettings {
            dt: 1e-9,
            t_max: 1.0,
            fixed_step: Some(true),
            integration_method: None,
        };
        assert!(excessive_steps.validate().is_err());
    }

    #[test]
    fn numerical_settings_reject_invalid_limits() {
        assert!(SolverNumericalSettings {
            tolerance: f64::NAN,
            max_iterations: 100,
        }
        .validate()
        .is_err());
        assert!(SolverNumericalSettings {
            tolerance: 1e-6,
            max_iterations: 0,
        }
        .validate()
        .is_err());
    }
}
