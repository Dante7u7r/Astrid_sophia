use std::mem;
use std::sync::Mutex;
use std::time::Instant;
use serde::Serialize;

#[repr(C)]
#[derive(Debug, Copy, Clone)]
pub struct FILETIME {
    pub dw_low_date_time: u32,
    pub dw_high_date_time: u32,
}

#[repr(C)]
#[derive(Debug, Copy, Clone)]
pub struct PROCESS_MEMORY_COUNTERS {
    pub cb: u32,
    pub page_fault_count: u32,
    pub peak_working_set_size: usize,
    pub working_set_size: usize, // RAM física real (RSS)
    pub quota_peak_paged_pool_usage: usize,
    pub quota_paged_pool_usage: usize,
    pub quota_peak_non_paged_pool_usage: usize,
    pub quota_non_paged_pool_usage: usize,
    pub pagefile_usage: usize,
    pub peak_pagefile_usage: usize,
}

#[repr(C)]
#[derive(Debug, Copy, Clone)]
pub struct SYSTEM_INFO {
    pub w_processor_architecture: u16,
    pub w_reserved: u16,
    pub dw_page_size: u32,
    pub lp_minimum_application_address: *mut std::ffi::c_void,
    pub lp_maximum_application_address: *mut std::ffi::c_void,
    pub dw_active_processor_mask: usize,
    pub dw_number_of_processors: u32, // Número de procesadores lógicos
    pub dw_processor_type: u32,
    pub dw_allocation_granularity: u32,
    pub w_processor_level: u16,
    pub w_processor_revision: u16,
}

extern "system" {
    pub fn GetCurrentProcess() -> *mut std::ffi::c_void;
    pub fn GetProcessMemoryInfo(
        process: *mut std::ffi::c_void,
        ppmc: *mut PROCESS_MEMORY_COUNTERS,
        cb: u32,
    ) -> i32;
    pub fn GetProcessTimes(
        h_process: *mut std::ffi::c_void,
        lp_creation_time: *mut FILETIME,
        lp_exit_time: *mut FILETIME,
        lp_kernel_time: *mut FILETIME,
        lp_user_time: *mut FILETIME,
    ) -> i32;
    pub fn GetSystemInfo(lp_system_info: *mut SYSTEM_INFO);
}

fn filetime_to_u64(ft: FILETIME) -> u64 {
    ((ft.dw_high_date_time as u64) << 32) | (ft.dw_low_date_time as u64)
}

struct CpuSample {
    timestamp: Instant,
    cpu_time_ticks: u64,
}

// Mutex de inicialización estática nativa y pura de Rust. No requiere lazy_static.
static LAST_CPU_SAMPLE: Mutex<Option<CpuSample>> = Mutex::new(None);

// Caché para el número de procesadores lógicos del sistema. No requiere num_cpus.
static NUM_CPUS: std::sync::OnceLock<f64> = std::sync::OnceLock::new();

fn get_num_cpus() -> f64 {
    *NUM_CPUS.get_or_init(|| {
        unsafe {
            let mut info: SYSTEM_INFO = mem::zeroed();
            GetSystemInfo(&mut info);
            if info.dw_number_of_processors > 0 {
                info.dw_number_of_processors as f64
            } else {
                1.0
            }
        }
    })
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TelemetryData {
    pub ram_bytes: usize,
    pub ram_formatted: String,
    pub cpu_percent: f64,
    pub os: String,
}

pub fn get_system_telemetry() -> TelemetryData {
    // 1. Obtener uso de RAM real (Working Set Size)
    let mut ram_bytes = 0;
    unsafe {
        let process = GetCurrentProcess();
        let mut counters: PROCESS_MEMORY_COUNTERS = mem::zeroed();
        counters.cb = mem::size_of::<PROCESS_MEMORY_COUNTERS>() as u32;
        if GetProcessMemoryInfo(process, &mut counters, counters.cb) != 0 {
            ram_bytes = counters.working_set_size;
        }
    }

    // Formatear uso de RAM a MB de manera legible
    let ram_formatted = if ram_bytes == 0 {
        "N/D".to_string()
    } else {
        let mb = (ram_bytes as f64) / (1024.0 * 1024.0);
        format!("{:.2} MB", mb)
    };

    // 2. Calcular uso de CPU acumulado de la aplicación
    let mut current_ticks: u64 = 0;
    unsafe {
        let process = GetCurrentProcess();
        let mut creation = mem::zeroed();
        let mut exit = mem::zeroed();
        let mut kernel = mem::zeroed();
        let mut user = mem::zeroed();
        if GetProcessTimes(process, &mut creation, &mut exit, &mut kernel, &mut user) != 0 {
            current_ticks = filetime_to_u64(kernel) + filetime_to_u64(user);
        }
    }

    let now = Instant::now();
    let mut cpu_percent = 0.0;

    let mut lock = LAST_CPU_SAMPLE.lock().unwrap();
    if let Some(ref prev) = *lock {
        let duration = now.duration_since(prev.timestamp).as_secs_f64();
        if duration > 0.001 {
            // FILETIME está en intervalos de 100 nanosegundos (1e-7 segundos)
            let diff_ticks = current_ticks.saturating_sub(prev.cpu_time_ticks);
            let diff_seconds = (diff_ticks as f64) * 1e-7;
            
            // Dividir por la cantidad de procesadores lógicos para normalizar a la escala 0-100%
            let num_cpus = get_num_cpus();
            cpu_percent = (diff_seconds / duration) * 100.0 / num_cpus;
            
            // Acotar porcentaje
            if cpu_percent > 100.0 {
                cpu_percent = 100.0;
            } else if cpu_percent < 0.0 {
                cpu_percent = 0.0;
            }
        }
    }

    // Actualizar última muestra tomada
    *lock = Some(CpuSample {
        timestamp: now,
        cpu_time_ticks: current_ticks,
    });

    TelemetryData {
        ram_bytes,
        ram_formatted,
        cpu_percent,
        os: "Windows (Nativo)".to_string(),
    }
}
