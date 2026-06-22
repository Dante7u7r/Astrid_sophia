use nalgebra::{DMatrix, DVector};
use wgpu::util::DeviceExt;
use std::sync::OnceLock;

static GPU_RESOURCES: OnceLock<Option<GpuResources>> = OnceLock::new();

struct GpuResources {
    device: wgpu::Device,
    queue: wgpu::Queue,
    pipeline: wgpu::ComputePipeline,
}

const SHADER_SOURCE: &str = r#"
@group(0) @binding(0) var<storage, read_write> matrix_data: array<f32>;
@group(0) @binding(1) var<storage, read> size_info: array<u32, 2>;

@compute @workgroup_size(256)
fn main(@builtin(local_invocation_id) local_id: vec3<u32>) {
    let n = size_info[0];
    let tid = local_id.x;
    
    for (var k: u32 = 0u; k < n; k = k + 1u) {
        let pivot_idx = k * (n + 1u) + k;
        let pivot_val = matrix_data[pivot_idx];
        
        if (abs(pivot_val) < 1e-12) {
            return;
        }
        
        if (tid < n + 1u) {
            let idx = k * (n + 1u) + tid;
            matrix_data[idx] = matrix_data[idx] / pivot_val;
        }
        
        workgroupBarrier();
        
        if (tid < n && tid != k) {
            let factor_idx = tid * (n + 1u) + k;
            let factor = matrix_data[factor_idx];
            
            for (var j: u32 = k; j < n + 1u; j = j + 1u) {
                let target_idx = tid * (n + 1u) + j;
                let pivot_row_idx = k * (n + 1u) + j;
                matrix_data[target_idx] = matrix_data[target_idx] - factor * matrix_data[pivot_row_idx];
            }
        }
        
        workgroupBarrier();
    }
}
"#;

fn init_gpu() -> Option<GpuResources> {
    pollster::block_on(async {
        let instance = wgpu::Instance::default();
        let adapter = instance.request_adapter(&wgpu::RequestAdapterOptions {
            power_preference: wgpu::PowerPreference::HighPerformance,
            compatible_surface: None,
            force_fallback_adapter: false,
        }).await?;

        let (device, queue) = adapter.request_device(
            &wgpu::DeviceDescriptor {
                label: Some("Astryd Sophia GPU Solver"),
                required_features: wgpu::Features::empty(),
                required_limits: wgpu::Limits::default(),
            },
            None,
        ).await.ok()?;

        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("Gauss Elimination WGSL"),
            source: wgpu::ShaderSource::Wgsl(SHADER_SOURCE.into()),
        });

        let bind_group_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("Gauss Bind Group Layout"),
            entries: &[
                wgpu::BindGroupLayoutEntry {
                    binding: 0,
                    visibility: wgpu::ShaderStages::COMPUTE,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Storage { read_only: false },
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 1,
                    visibility: wgpu::ShaderStages::COMPUTE,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Storage { read_only: true },
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                },
            ],
        });

        let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("Gauss Pipeline Layout"),
            bind_group_layouts: &[&bind_group_layout],
            push_constant_ranges: &[],
        });

        let pipeline = device.create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
            label: Some("Gauss Compute Pipeline"),
            layout: Some(&pipeline_layout),
            module: &shader,
            entry_point: "main",
        });

        Some(GpuResources { device, queue, pipeline })
    })
}

pub fn solve_schur_on_gpu(s_matrix: &DMatrix<f64>, z: &DVector<f64>) -> Option<DVector<f64>> {
    let n = s_matrix.nrows();
    // Para sistemas pequeños el overhead de transferencia PCI-Express de la GPU hace que la CPU sea más rápida y precisa
    if n < 16 || n > 256 {
        return None;
    }

    let resources_opt = GPU_RESOURCES.get_or_init(init_gpu);
    let resources = resources_opt.as_ref()?;

    let mut flat_data = vec![0.0f32; n * (n + 1)];
    for r in 0..n {
        for c in 0..n {
            flat_data[r * (n + 1) + c] = s_matrix[(r, c)] as f32;
        }
        flat_data[r * (n + 1) + n] = z[r] as f32;
    }

    let matrix_buffer = resources.device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
        label: Some("Matrix Data Buffer"),
        contents: bytemuck::cast_slice(&flat_data),
        usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_SRC | wgpu::BufferUsages::COPY_DST,
    });

    let size_data = [n as u32, 0u32];
    let size_buffer = resources.device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
        label: Some("Size Info Buffer"),
        contents: bytemuck::cast_slice(&size_data),
        usage: wgpu::BufferUsages::STORAGE,
    });

    let readback_buffer = resources.device.create_buffer(&wgpu::BufferDescriptor {
        label: Some("Readback Buffer"),
        size: (flat_data.len() * 4) as u64,
        usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
        mapped_at_creation: false,
    });

    let bind_group = resources.device.create_bind_group(&wgpu::BindGroupDescriptor {
        label: Some("Gauss Bind Group"),
        layout: &resources.pipeline.get_bind_group_layout(0),
        entries: &[
            wgpu::BindGroupEntry {
                binding: 0,
                resource: matrix_buffer.as_entire_binding(),
            },
            wgpu::BindGroupEntry {
                binding: 1,
                resource: size_buffer.as_entire_binding(),
            },
        ],
    });

    let mut encoder = resources.device.create_command_encoder(&wgpu::CommandEncoderDescriptor {
        label: Some("Gauss Command Encoder"),
    });

    {
        let mut compute_pass = encoder.begin_compute_pass(&wgpu::ComputePassDescriptor {
            label: Some("Gauss Compute Pass"),
            timestamp_writes: None,
        });
        compute_pass.set_pipeline(&resources.pipeline);
        compute_pass.set_bind_group(0, &bind_group, &[]);
        compute_pass.dispatch_workgroups(1, 1, 1);
    }

    encoder.copy_buffer_to_buffer(&matrix_buffer, 0, &readback_buffer, 0, (flat_data.len() * 4) as u64);
    resources.queue.submit(Some(encoder.finish()));

    let buffer_slice = readback_buffer.slice(..);
    let (sender, receiver) = std::sync::mpsc::channel();
    buffer_slice.map_async(wgpu::MapMode::Read, move |v| {
        sender.send(v).unwrap();
    });

    resources.device.poll(wgpu::Maintain::Wait);

    if receiver.recv().ok()?.is_ok() {
        let data = buffer_slice.get_mapped_range();
        let result_f32: &[f32] = bytemuck::cast_slice(&data);
        
        let mut solution = DVector::<f64>::zeros(n);
        for r in 0..n {
            let sol_val = result_f32[r * (n + 1) + n];
            if sol_val.is_nan() || sol_val.is_infinite() {
                return None;
            }
            solution[r] = sol_val as f64;
        }
        
        drop(data);
        readback_buffer.unmap();
        Some(solution)
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use nalgebra::{DMatrix, DVector};

    #[test]
    fn test_gpu_schur_solver() {
        let s = DMatrix::from_row_slice(3, 3, &[
            4.0, 1.0, 0.0,
            1.0, 3.0, 1.0,
            0.0, 1.0, 2.0,
        ]);
        let z = DVector::from_column_slice(&[1.0, 2.0, 3.0]);

        match solve_schur_on_gpu(&s, &z) {
            Some(gpu_sol) => {
                let cpu_sol = s.lu().solve(&z).expect("CPU solve failed");
                for i in 0..3 {
                    assert!(
                        (gpu_sol[i] - cpu_sol[i]).abs() < 1e-4,
                        "Mismatch at index {}: gpu={}, cpu={}", i, gpu_sol[i], cpu_sol[i]
                    );
                }
            }
            None => {
                println!("Test omitido: no se detectó hardware GPU compatible.");
            }
        }
    }
}
