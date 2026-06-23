use nalgebra::{DMatrix, DVector};
use wgpu::util::DeviceExt;
use std::sync::OnceLock;

static GPU_RESOURCES: OnceLock<Option<GpuResources>> = OnceLock::new();

struct GpuResources {
    device: wgpu::Device,
    queue: wgpu::Queue,
    pipeline: wgpu::ComputePipeline,
}

#[repr(C)]
#[derive(Copy, Clone, Debug, bytemuck::Pod, bytemuck::Zeroable)]
struct DoubleSingle {
    high: f32,
    low: f32,
}

impl DoubleSingle {
    fn from_f64(val: f64) -> Self {
        let high = val as f32;
        let low = (val - high as f64) as f32;
        Self { high, low }
    }

    fn to_f64(self) -> f64 {
        self.high as f64 + self.low as f64
    }
}

const SHADER_SOURCE: &str = r#"
@group(0) @binding(0) var<storage, read_write> matrix_data: array<vec2<f32>>;

struct SizeInfo {
    n: u32,
    dummy: u32,
}
@group(0) @binding(1) var<storage, read> size_info: SizeInfo;

fn black_box_f32(val: f32, dummy: u32) -> f32 {
    return bitcast<f32>(bitcast<u32>(val) + dummy);
}

fn two_sum(a: f32, b: f32, dummy: u32) -> vec2<f32> {
    let s = a + b;
    let s_bb = black_box_f32(s, dummy);
    let v = s_bb - a;
    let v_bb = black_box_f32(v, dummy);
    let s_minus_v = s_bb - v_bb;
    let s_minus_v_bb = black_box_f32(s_minus_v, dummy);
    let err = (a - s_minus_v_bb) + (b - v_bb);
    return vec2<f32>(s, err);
}

fn ds_add(a: vec2<f32>, b: vec2<f32>, dummy: u32) -> vec2<f32> {
    let s = two_sum(a.x, b.x, dummy);
    let t = two_sum(a.y, b.y, dummy);
    let s_y = s.y + (t.x + t.y);
    return two_sum(s.x, s_y, dummy);
}

fn ds_sub(a: vec2<f32>, b: vec2<f32>, dummy: u32) -> vec2<f32> {
    return ds_add(a, vec2<f32>(-b.x, -b.y), dummy);
}

fn bit_split(a: f32, dummy: u32) -> vec2<f32> {
    let a_hi = bitcast<f32>(bitcast<u32>(a) & 0xFFFFF000u);
    let a_lo = a - a_hi;
    let a_lo_bb = black_box_f32(a_lo, dummy);
    return vec2<f32>(a_hi, a_lo_bb);
}

fn two_prod(a: f32, b: f32, dummy: u32) -> vec2<f32> {
    let p = a * b;
    let a_split = bit_split(a, dummy);
    let b_split = bit_split(b, dummy);
    let p_bb = black_box_f32(p, dummy);
    
    let term1 = a_split.x * b_split.x;
    let term1_bb = black_box_f32(term1, dummy);
    let diff = term1_bb - p_bb;
    let diff_bb = black_box_f32(diff, dummy);
    
    let term2 = a_split.x * b_split.y;
    let term2_bb = black_box_f32(term2, dummy);
    let term3 = a_split.y * b_split.x;
    let term3_bb = black_box_f32(term3, dummy);
    let term4 = a_split.y * b_split.y;
    let term4_bb = black_box_f32(term4, dummy);
    
    let err = ((diff_bb + term2_bb) + term3_bb) + term4_bb;
    return vec2<f32>(p, err);
}

fn ds_mul(a: vec2<f32>, b: vec2<f32>, dummy: u32) -> vec2<f32> {
    let p = two_prod(a.x, b.x, dummy);
    let term1 = a.x * b.y;
    let term2 = a.y * b.x;
    let err = p.y + (term1 + term2);
    return two_sum(p.x, err, dummy);
}

fn ds_div(a: vec2<f32>, b: vec2<f32>, dummy: u32) -> vec2<f32> {
    let q0 = a.x / b.x;
    let q0_b = ds_mul(b, vec2<f32>(q0, 0.0), dummy);
    let r = ds_sub(a, q0_b, dummy);
    let q1 = (r.x + r.y) / b.x;
    return two_sum(q0, q1, dummy);
}

@compute @workgroup_size(256)
fn main(@builtin(local_invocation_id) local_id: vec3<u32>) {
    let n = size_info[0];
    let tid = local_id.x;
    let dummy = size_info[1];
    
    for (var k: u32 = 0u; k < n; k = k + 1u) {
        let pivot_idx = k * (n + 1u) + k;
        let pivot_val = matrix_data[pivot_idx];
        
        if (abs(pivot_val.x) < 1e-12) {
            return;
        }
        
        if (tid < n + 1u) {
            let idx = k * (n + 1u) + tid;
            matrix_data[idx] = ds_div(matrix_data[idx], pivot_val, dummy);
        }
        
        workgroupBarrier();
        
        if (tid < n && tid != k) {
            let factor_idx = tid * (n + 1u) + k;
            let factor = matrix_data[factor_idx];
            
            for (var j: u32 = k; j < n + 1u; j = j + 1u) {
                let target_idx = tid * (n + 1u) + j;
                let pivot_row_idx = k * (n + 1u) + j;
                let product = ds_mul(factor, matrix_data[pivot_row_idx], dummy);
                matrix_data[target_idx] = ds_sub(matrix_data[target_idx], product, dummy);
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
    if !(16..=256).contains(&n) {
        return None;
    }

    let resources_opt = GPU_RESOURCES.get_or_init(init_gpu);
    let resources = resources_opt.as_ref()?;

    let mut flat_data = vec![DoubleSingle { high: 0.0, low: 0.0 }; n * (n + 1)];
    for r in 0..n {
        for c in 0..n {
            flat_data[r * (n + 1) + c] = DoubleSingle::from_f64(s_matrix[(r, c)]);
        }
        flat_data[r * (n + 1) + n] = DoubleSingle::from_f64(z[r]);
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
        size: (flat_data.len() * std::mem::size_of::<DoubleSingle>()) as u64,
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

    encoder.copy_buffer_to_buffer(
        &matrix_buffer,
        0,
        &readback_buffer,
        0,
        (flat_data.len() * std::mem::size_of::<DoubleSingle>()) as u64,
    );
    resources.queue.submit(Some(encoder.finish()));

    let buffer_slice = readback_buffer.slice(..);
    let (sender, receiver) = std::sync::mpsc::channel();
    buffer_slice.map_async(wgpu::MapMode::Read, move |v| {
        sender.send(v).unwrap();
    });

    resources.device.poll(wgpu::Maintain::Wait);

    if receiver.recv().ok()?.is_ok() {
        let data = buffer_slice.get_mapped_range();
        let result_ds: &[DoubleSingle] = bytemuck::cast_slice(&data);
        
        let mut solution = DVector::<f64>::zeros(n);
        for r in 0..n {
            let sol_val = result_ds[r * (n + 1) + n].to_f64();
            if sol_val.is_nan() || sol_val.is_infinite() {
                return None;
            }
            solution[r] = sol_val;
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

        // Para el test reducimos temporalmente el umbral de activación de tamaño a 3
        let n = s.nrows();
        let resources_opt = GPU_RESOURCES.get_or_init(init_gpu);
        if let Some(resources) = resources_opt.as_ref() {
            let mut flat_data = vec![DoubleSingle { high: 0.0, low: 0.0 }; n * (n + 1)];
            for r in 0..n {
                for c in 0..n {
                    flat_data[r * (n + 1) + c] = DoubleSingle::from_f64(s[(r, c)]);
                }
                flat_data[r * (n + 1) + n] = DoubleSingle::from_f64(z[r]);
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
                size: (flat_data.len() * std::mem::size_of::<DoubleSingle>()) as u64,
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

            encoder.copy_buffer_to_buffer(
                &matrix_buffer,
                0,
                &readback_buffer,
                0,
                (flat_data.len() * std::mem::size_of::<DoubleSingle>()) as u64,
            );
            resources.queue.submit(Some(encoder.finish()));

            let buffer_slice = readback_buffer.slice(..);
            let (sender, receiver) = std::sync::mpsc::channel();
            buffer_slice.map_async(wgpu::MapMode::Read, move |v| {
                sender.send(v).unwrap();
            });

            resources.device.poll(wgpu::Maintain::Wait);

            if receiver.recv().ok().unwrap().is_ok() {
                let data = buffer_slice.get_mapped_range();
                let result_ds: &[DoubleSingle] = bytemuck::cast_slice(&data);
                for r in 0..n {
                    for c in 0..=n {
                        let idx = r * (n + 1) + c;
                        let ds = result_ds[idx];
                        println!("Matrix[{}, {}] (idx {}): high: {:e}, low: {:e}", r, c, idx, ds.high, ds.low);
                    }
                }
                let cpu_sol = s.lu().solve(&z).expect("CPU solve failed");
                for i in 0..3 {
                    let gpu_ds = result_ds[i * (n + 1) + n];
                    let gpu_val = gpu_ds.to_f64();
                    assert!(
                        (gpu_val - cpu_sol[i]).abs() < 1e-12,
                        "Mismatch at index {}: gpu={}, cpu={}", i, gpu_val, cpu_sol[i]
                    );
                }
                drop(data);
                readback_buffer.unmap();
            } else {
                panic!("GPU Mapping failed");
            }
        } else {
            println!("Test omitido: no se detectó hardware GPU compatible.");
        }
    }
}
