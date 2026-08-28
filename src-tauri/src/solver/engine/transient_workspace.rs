//! Transient Workspace & Memory Pooling — Buffers pre-asignados y reutilizables para el bucle transitorio.
//!
//! Elimina asignaciones en el heap (`malloc`/`free`) por paso y por iteración de Newton-Raphson:
//! 1. Matrices MNA densas pre-dimensionadas (`matrix_a_step`, `matrix_a_iter`, `vector_z_step`, `vector_z_iter`).
//! 2. Buffers contiguos para vectores de voltajes pasados (`prev_v`, `prev_prev_v`).
//! 3. Reutilización in-situ de buckets de HashMap para respaldos de estado reactivo (`clone_from`).
//! 4. Cache AST transitorio reutilizable con `.clear()`.

use nalgebra::{DMatrix, DVector};
use std::collections::HashMap;

use crate::solver::engine::advanced::thermal_network::MultiNodeThermalModel;
use crate::solver::ExprAST;

/// Estructura de respaldo de estados reactivos, térmicos y digitales con memoria preasignada.
#[derive(Default)]
pub(crate) struct TransientBackupState {
    pub cap_states: HashMap<String, f64>,
    pub ind_states: HashMap<String, f64>,
    pub cap_states_prev: HashMap<String, f64>,
    pub ind_states_prev: HashMap<String, f64>,
    pub cap_history: Vec<HashMap<String, f64>>,
    pub ind_history: Vec<HashMap<String, f64>>,
    pub switch_states: HashMap<String, bool>,
    pub mcu_tchip: HashMap<String, f64>,
    pub mcu_vsample: HashMap<String, f64>,
    pub mcu_vdaceff: HashMap<String, f64>,
    pub device_tjunc: HashMap<String, f64>,
    pub thermal_models: HashMap<String, MultiNodeThermalModel>,
    pub ms_scheduler: crate::solver::matrix::MixedSignalScheduler,
}

impl TransientBackupState {
    pub fn new() -> Self {
        Self::default()
    }

    /// Guarda el estado actual en el buffer de respaldo reutilizando la capacidad asignada.
    pub fn save(
        &mut self,
        cap_states: &HashMap<String, f64>,
        ind_states: &HashMap<String, f64>,
        cap_states_prev: &HashMap<String, f64>,
        ind_states_prev: &HashMap<String, f64>,
        cap_history: &[HashMap<String, f64>],
        ind_history: &[HashMap<String, f64>],
        switch_states: &HashMap<String, bool>,
        mcu_tchip: &HashMap<String, f64>,
        mcu_vsample: &HashMap<String, f64>,
        mcu_vdaceff: &HashMap<String, f64>,
        device_tjunc: &HashMap<String, f64>,
        thermal_models: &HashMap<String, MultiNodeThermalModel>,
        ms_scheduler: &crate::solver::matrix::MixedSignalScheduler,
    ) {
        self.cap_states.clone_from(cap_states);
        self.ind_states.clone_from(ind_states);
        self.cap_states_prev.clone_from(cap_states_prev);
        self.ind_states_prev.clone_from(ind_states_prev);
        self.cap_history.clone_from(&cap_history.to_vec());
        self.ind_history.clone_from(&ind_history.to_vec());
        self.switch_states.clone_from(switch_states);
        self.mcu_tchip.clone_from(mcu_tchip);
        self.mcu_vsample.clone_from(mcu_vsample);
        self.mcu_vdaceff.clone_from(mcu_vdaceff);
        self.device_tjunc.clone_from(device_tjunc);
        self.thermal_models.clone_from(thermal_models);
        self.ms_scheduler.clone_from(ms_scheduler);
    }

    /// Restaura los estados guardados hacia las variables de simulación activas.
    pub fn restore(
        &self,
        cap_states: &mut HashMap<String, f64>,
        ind_states: &mut HashMap<String, f64>,
        cap_states_prev: &mut HashMap<String, f64>,
        ind_states_prev: &mut HashMap<String, f64>,
        cap_history: &mut Vec<HashMap<String, f64>>,
        ind_history: &mut Vec<HashMap<String, f64>>,
        switch_states: &mut HashMap<String, bool>,
        mcu_tchip: &mut HashMap<String, f64>,
        mcu_vsample: &mut HashMap<String, f64>,
        mcu_vdaceff: &mut HashMap<String, f64>,
        device_tjunc: &mut HashMap<String, f64>,
        thermal_models: &mut HashMap<String, MultiNodeThermalModel>,
        ms_scheduler: &mut crate::solver::matrix::MixedSignalScheduler,
    ) {
        cap_states.clone_from(&self.cap_states);
        ind_states.clone_from(&self.ind_states);
        cap_states_prev.clone_from(&self.cap_states_prev);
        ind_states_prev.clone_from(&self.ind_states_prev);
        cap_history.clone_from(&self.cap_history);
        ind_history.clone_from(&self.ind_history);
        switch_states.clone_from(&self.switch_states);
        mcu_tchip.clone_from(&self.mcu_tchip);
        mcu_vsample.clone_from(&self.mcu_vsample);
        mcu_vdaceff.clone_from(&self.mcu_vdaceff);
        device_tjunc.clone_from(&self.device_tjunc);
        thermal_models.clone_from(&self.thermal_models);
        ms_scheduler.clone_from(&self.ms_scheduler);
    }
}

use crate::solver::linear_backend::FaerFactorizedReal;

/// Estructura de cache de bypass para diodos y uniones PN (explotación de latencia local).
#[derive(Clone, Debug, Default)]
#[allow(dead_code)]
pub struct DiodeBypassState {
    pub last_vd: f64,
    pub id: f64,
    pub geq: f64,
    pub ieq: f64,
}

/// Estructura de cache de bypass para transistores bipolares BJT.
#[derive(Clone, Debug, Default)]
#[allow(dead_code)]
pub struct BjtBypassState {
    pub last_vbe: f64,
    pub last_vbc: f64,
    pub gbe: f64,
    pub gbc: f64,
    pub ieq_be: f64,
    pub ieq_bc: f64,
    pub ide: f64,
    pub idc: f64,
}

/// Estructura de cache de bypass para transistores de efecto de campo (MOS/FET/IGBT).
#[derive(Clone, Debug, Default)]
#[allow(dead_code)]
pub struct MosBypassState {
    pub last_vgs: f64,
    pub last_vds: f64,
    pub last_vbs: f64,
    pub ids: f64,
    pub gm: f64,
    pub gds: f64,
    pub igs: f64,
    pub gg: f64,
    pub ieq: f64,
    pub ieq_g: f64,
    pub c_gs: f64,
    pub c_gd: f64,
    pub c_ds: f64,
}

/// Firma de parámetros de paso e integración reactiva para validación exacta de cache LU.
#[derive(Clone, Copy, PartialEq, Eq, Debug, Default)]
pub struct LinearCompanionSignature {
    pub dt_bits: u64,
    pub trap_active: bool,
    pub gear2_active: bool,
    pub bdf_order: usize,
    pub bdf_alpha0_bits: u64,
    pub gear_a_bits: u64,
}

/// Workspace de simulación transitoria que aloja todas las matrices y buffers de trabajo.
pub(crate) struct TransientWorkspace {
    pub n: usize,
    pub matrix_a_step: DMatrix<f64>,
    pub vector_z_step: DVector<f64>,
    pub matrix_a_iter: DMatrix<f64>,
    pub vector_z_iter: DVector<f64>,
    pub solution_iter: DVector<f64>,
    pub prev_v: Vec<f64>,
    pub prev_prev_v: Vec<f64>,
    pub ast_cache_t: HashMap<String, ExprAST>,
    pub backup: TransientBackupState,
    // Optimizaciones de Alto Rendimiento Zero-Degradation:
    pub cached_linear_factorization: Option<FaerFactorizedReal>,
    pub cached_signature: LinearCompanionSignature,
    pub diode_bypass: HashMap<String, DiodeBypassState>,
    pub bjt_bypass: HashMap<String, BjtBypassState>,
    pub mos_bypass: HashMap<String, MosBypassState>,
}

impl TransientWorkspace {
    /// Inicializa el workspace dimensionando todos los buffers según el tamaño del sistema MNA.
    pub fn new(size: usize, n: usize) -> Self {
        Self {
            n,
            matrix_a_step: DMatrix::<f64>::zeros(size, size),
            vector_z_step: DVector::<f64>::zeros(size),
            matrix_a_iter: DMatrix::<f64>::zeros(size, size),
            vector_z_iter: DVector::<f64>::zeros(size),
            solution_iter: DVector::<f64>::zeros(size),
            prev_v: vec![0.0; n + 1],
            prev_prev_v: vec![0.0; n + 1],
            ast_cache_t: HashMap::with_capacity(32),
            backup: TransientBackupState::new(),
            cached_linear_factorization: None,
            cached_signature: LinearCompanionSignature::default(),
            diode_bypass: HashMap::with_capacity(16),
            bjt_bypass: HashMap::with_capacity(16),
            mos_bypass: HashMap::with_capacity(16),
        }
    }

    /// Invalida la factorización lineal en cache (forzando refactorización en el próximo paso).
    #[inline(always)]
    pub fn invalidate_linear_factorization(&mut self) {
        self.cached_linear_factorization = None;
        self.cached_signature = LinearCompanionSignature::default();
    }

    /// Prepara el paso copiando la matriz lineal base a la matriz de paso sin realocar memoria.
    #[inline(always)]
    pub fn prepare_step_matrix(&mut self, matrix_a_linear: &DMatrix<f64>, vector_z_linear: &DVector<f64>) {
        self.matrix_a_step.copy_from(matrix_a_linear);
        self.vector_z_step.copy_from(vector_z_linear);
    }

    /// Prepara la iteración no lineal copiando el estado del paso a la matriz de iteración.
    #[inline(always)]
    pub fn prepare_iter_matrix(&mut self) {
        self.matrix_a_iter.copy_from(&self.matrix_a_step);
        self.vector_z_iter.copy_from(&self.vector_z_step);
    }

    /// Inicializa los vectores de voltajes previos a partir de la solución actual.
    pub fn init_prev_voltages(&mut self, current_solution: &DVector<f64>) {
        self.solution_iter.copy_from(current_solution);
        self.prev_v[0] = 0.0;
        for i in 1..=self.n {
            self.prev_v[i] = self.solution_iter[i - 1];
        }
        self.prev_prev_v.copy_from_slice(&self.prev_v);
    }
}
