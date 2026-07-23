use crate::solver::matrix::*;
use crate::solver::types::*;
use nalgebra::{DMatrix, DVector};

#[allow(unused_imports)]
use super::ac::*;
#[allow(unused_imports)]
use super::advanced::*;
#[allow(unused_imports)]
use super::dc::*;
#[allow(unused_imports)]
use super::devices::*;
use super::simulation_types::{TimeStepResult, TransientSettings};
#[allow(unused_imports)]
use super::transient::*;

#[cfg(test)]
mod core_tests {
    use super::*;
    use num_complex::Complex;
    use std::collections::HashMap;

    mod mixed_signal {
        include!("tests/mixed_signal.rs");
    }
    mod sparse {
        include!("tests/sparse.rs");
    }

    mod numerical_methods {
        include!("tests/numerical_methods.rs");
    }

    mod circuit_features {
        include!("tests/circuit_features.rs");
    }

    mod dc_basic {
        include!("tests/dc_basic.rs");
    }
    mod diode {
        include!("tests/diode.rs");
    }

    mod transient {
        include!("tests/transient.rs");
    }

    mod ac_noise {
        include!("tests/ac_noise.rs");
    }

    mod analysis_modes {
        include!("tests/analysis_modes.rs");
    }

    mod device_models {
        include!("tests/device_models.rs");
    }

    mod thermal {
        include!("tests/thermal.rs");
    }

    mod behavioral_sources {
        include!("tests/behavioral_sources.rs");
    }
}
