use crate::solver::SparseMatrix;
use crate::sparse_csc::{SparseMatrixCSC, SymbolicLU, NumericLUWorkspace};
use nalgebra::{DVector, DMatrix};
use rayon::prelude::*;
use std::collections::{HashMap, HashSet, VecDeque};

#[derive(Clone, Debug)]
pub struct ParallelBlock {
    pub size: usize,
    pub original_nodes: Vec<usize>,     // Mapeo local_idx -> original_node
    pub orig_to_local: HashMap<usize, usize>, // Mapeo original_node -> local_idx
    pub symbolic: SymbolicLU,
    pub workspace: NumericLUWorkspace,
    pub csc_template: SparseMatrixCSC,
    pub b_cols_active: Vec<usize>,      // Índices de columnas del borde (locales del borde) que tienen elementos en B_i
    // Elementos estructurales para actualización ultra-rápida:
    // (r_local, c_local, r_orig, c_orig)
    pub a_mappings: Vec<(usize, usize, usize, usize)>,
    // (r_local, c_edge, r_orig, c_orig)
    pub b_mappings: Vec<(usize, usize, usize, usize)>,
    // (r_edge, c_local, r_orig, c_orig)
    pub c_mappings: Vec<(usize, usize, usize, usize)>,
}

#[derive(Clone, Debug)]
pub struct SchurParallelSolver {
    pub size: usize,
    pub is_monolithic: bool,            // Si es true, el circuito no es particionable y usa resolvedor secuencial
    pub blocks: Vec<ParallelBlock>,
    pub edge_nodes: Vec<usize>,         // Mapeo edge_idx -> original_node
    pub orig_to_edge: HashMap<usize, usize>, // Mapeo original_node -> edge_idx
    pub permutation: Vec<usize>,        // original -> BBDF
    pub inv_permutation: Vec<usize>,    // BBDF -> original
    // Mapeo para actualizar la matriz del borde D:
    // (r_edge, c_edge, r_orig, c_orig)
    pub d_mappings: Vec<(usize, usize, usize, usize)>,
}

impl SchurParallelSolver {
    /// Analiza estructuralmente la matriz MNA y extrae los bloques locales independientes y el borde global.
    /// Si no se pueden identificar al menos 2 bloques significativos, marca la estructura como monolítica.
    pub fn analyze(matrix: &SparseMatrix, threshold_ratio: f64) -> Self {
        let n = matrix.size;

        // 1. Identificar nodos globales candidatos (de muy alta conectividad, ej: VDD, GND, buses)
        let mut degrees: Vec<(usize, usize)> = (0..n)
            .map(|i| {
                let deg = matrix.rows[i].len();
                (i, deg)
            })
            .collect();

        // Ordenar de forma descendente por grado estructural
        degrees.sort_by(|a, b| b.1.cmp(&a.1));

        // Seleccionar los nodos de mayor grado como candidatos de acoplamiento global (10%-15% del circuito)
        let num_edge_candidates = ((n as f64) * threshold_ratio).round() as usize;
        let num_edge_candidates = num_edge_candidates.clamp(1, n / 4);

        let mut is_edge = vec![false; n];
        let mut edge_nodes = Vec::new();

        // En MNA, el nodo 0 suele tener mucha conectividad (referencia GND activa en el netlist).
        // Los enviamos al borde directamente para desligar el circuito.
        for i in 0..num_edge_candidates {
            let node = degrees[i].0;
            is_edge[node] = true;
            edge_nodes.push(node);
        }

        // 2. Encontrar Componentes Conexas Locales (Bloques Independientes)
        let mut visited = vec![false; n];
        let mut raw_blocks = Vec::new();

        for start_node in 0..n {
            if is_edge[start_node] || visited[start_node] {
                continue;
            }

            let mut block = Vec::new();
            let mut queue = VecDeque::new();
            queue.push_back(start_node);
            visited[start_node] = true;

            while let Some(u) = queue.pop_front() {
                block.push(u);

                // Vecinos en la matriz de adyacencia estructural
                for &v in matrix.rows[u].keys() {
                    if !is_edge[v] && !visited[v] {
                        visited[v] = true;
                        queue.push_back(v);
                    }
                }
            }

            if !block.is_empty() {
                raw_blocks.push(block);
            }
        }

        // Si tenemos menos de 2 bloques locales válidos, el circuito es monolítico.
        if raw_blocks.len() < 2 || n < 40 {
            return Self {
                size: n,
                is_monolithic: true,
                blocks: Vec::new(),
                edge_nodes: Vec::new(),
                orig_to_edge: HashMap::new(),
                permutation: (0..n).collect(),
                inv_permutation: (0..n).collect(),
                d_mappings: Vec::new(),
            };
        }

        // Consolidar mapeos de borde
        let mut orig_to_edge = HashMap::new();
        for (idx, &node) in edge_nodes.iter().enumerate() {
            orig_to_edge.insert(node, idx);
        }

        let mut blocks = Vec::new();
        let mut permutation = vec![0; n];
        let mut inv_permutation = vec![0; n];
        let mut current_perm_idx = 0;

        // 3. Procesar y construir los ParallelBlocks con sus mapeos estructurales estáticos
        for raw_block in raw_blocks {
            let block_size = raw_block.len();
            let mut original_nodes = raw_block.clone();
            original_nodes.sort(); // Ordenar para predictibilidad

            let mut orig_to_local = HashMap::new();
            for (local_idx, &node) in original_nodes.iter().enumerate() {
                orig_to_local.insert(node, local_idx);
            }

            // Asignar permutaciones BBDF
            for &node in &original_nodes {
                permutation[node] = current_perm_idx;
                inv_permutation[current_perm_idx] = node;
                current_perm_idx += 1;
            }

            // Mapeos de elementos estructurales para la matriz A_i local
            let mut a_mappings = Vec::new();
            let mut local_struct_matrix = SparseMatrix::new(block_size);

            for &r_orig in &original_nodes {
                let r_local = orig_to_local[&r_orig];
                for &c_orig in matrix.rows[r_orig].keys() {
                    if let Some(&c_local) = orig_to_local.get(&c_orig) {
                        a_mappings.push((r_local, c_local, r_orig, c_orig));
                        local_struct_matrix.add_element(r_local, c_local, 1.0);
                    }
                }
            }

            // Mapear acoplamientos del bloque con el borde
            let mut b_mappings = Vec::new();
            let mut c_mappings = Vec::new();
            let mut b_cols_active_set = HashSet::new();

            for &r_orig in &original_nodes {
                let r_local = orig_to_local[&r_orig];
                for &c_orig in matrix.rows[r_orig].keys() {
                    if let Some(&c_edge) = orig_to_edge.get(&c_orig) {
                        b_mappings.push((r_local, c_edge, r_orig, c_orig));
                        b_cols_active_set.insert(c_edge);
                    }
                }
            }

            for &r_orig in &edge_nodes {
                let r_edge = orig_to_edge[&r_orig];
                for &c_orig in matrix.rows[r_orig].keys() {
                    if let Some(&c_local) = orig_to_local.get(&c_orig) {
                        c_mappings.push((r_edge, c_local, r_orig, c_orig));
                    }
                }
            }

            let mut b_cols_active: Vec<usize> = b_cols_active_set.into_iter().collect();
            b_cols_active.sort();

            // Análisis simbólico local
            let symbolic = SymbolicLU::analyze(&local_struct_matrix);
            let workspace = NumericLUWorkspace::new(&symbolic);
            let csc_template = SparseMatrixCSC::from_sparse(&local_struct_matrix);

            blocks.push(ParallelBlock {
                size: block_size,
                original_nodes,
                orig_to_local,
                symbolic,
                workspace,
                csc_template,
                b_cols_active,
                a_mappings,
                b_mappings,
                c_mappings,
            });
        }

        // Asignar permutaciones finales para los nodos del borde
        for &node in &edge_nodes {
            permutation[node] = current_perm_idx;
            inv_permutation[current_perm_idx] = node;
            current_perm_idx += 1;
        }

        // Mapeo estructural de la matriz del borde D
        let mut d_mappings = Vec::new();
        for &r_orig in &edge_nodes {
            let r_edge = orig_to_edge[&r_orig];
            for &c_orig in matrix.rows[r_orig].keys() {
                if let Some(&c_edge) = orig_to_edge.get(&c_orig) {
                    d_mappings.push((r_edge, c_edge, r_orig, c_orig));
                }
            }
        }

        Self {
            size: n,
            is_monolithic: false,
            blocks,
            edge_nodes,
            orig_to_edge,
            permutation,
            inv_permutation,
            d_mappings,
        }
    }

    /// Resuelve el sistema lineal A * x = z en paralelo explotando la estructura de bloques de Schur (BBDF).
    pub fn solve(&mut self, matrix: &SparseMatrix, z: &DVector<f64>) -> Result<DVector<f64>, String> {
        if self.is_monolithic {
            return Err("El resolvedor paralelo no puede operar en un circuito monolítico. Usa el resolvedor secuencial.".to_string());
        }

        let n_edge = self.edge_nodes.len();

        // 1. Ensamblar e inicializar los valores de la matriz del borde D y el RHS z_c
        let mut d_matrix = DMatrix::<f64>::zeros(n_edge, n_edge);
        for &(r_edge, c_edge, r_orig, c_orig) in &self.d_mappings {
            d_matrix[(r_edge, c_edge)] = *matrix.rows[r_orig].get(&c_orig).unwrap_or(&0.0);
        }

        let mut z_c = DVector::<f64>::zeros(n_edge);
        for (r_edge, &r_orig) in self.edge_nodes.iter().enumerate() {
            z_c[r_edge] = z[r_orig];
        }

        // Almacenamos temporalmente los complementos de Schur locales y las proyecciones locales de RHS
        // Para poder procesarlos en paralelo, envolvemos la lógica de cada bloque.
        // Usamos rayon para procesar los bloques en paralelo al 100%.
        let block_results: Vec<Result<(DMatrix<f64>, DVector<f64>, SparseMatrixCSC, NumericLUWorkspace), String>> = self.blocks
            .par_iter()
            .map(|block| {
                let mut csc_matrix = block.csc_template.clone();
                
                // Actualizar los valores numéricos locales de A_i
                let mut a_local = SparseMatrix::new(block.size);
                for &(r_local, c_local, r_orig, c_orig) in &block.a_mappings {
                    let val = *matrix.rows[r_orig].get(&c_orig).unwrap_or(&0.0);
                    a_local.add_element(r_local, c_local, val);
                }
                csc_matrix.update_from_sparse(&a_local);

                // Factorización LU local
                let mut workspace = block.workspace.clone();
                csc_matrix.left_looking_factorize(&block.symbolic, &mut workspace)
                    .map_err(|e| format!("Error en subbloque MNA: {}", e))?;

                // Resolver el vector local intermedio: w_i = A_i^-1 * z_i
                let mut z_i = DVector::<f64>::zeros(block.size);
                for (r_local, &r_orig) in block.original_nodes.iter().enumerate() {
                    z_i[r_local] = z[r_orig];
                }

                let w_i = block.symbolic.solve(&workspace, &z_i)
                    .ok_or_else(|| "Subbloque local singular durante la sustitución".to_string())?;

                // Proyectar contribución local al RHS del borde: v_ci = C_i * w_i
                let mut v_ci = DVector::<f64>::zeros(n_edge);
                for &(r_edge, c_local, _, _) in &block.c_mappings {
                    v_ci[r_edge] += w_i[c_local] * matrix.rows[self.edge_nodes[r_edge]].get(&block.original_nodes[c_local]).unwrap_or(&0.0);
                }

                // Calcular el complemento de Schur local: S_i = C_i * A_i^-1 * B_i
                // Solo resolvemos para las columnas activas en B_i
                let mut s_i = DMatrix::<f64>::zeros(n_edge, n_edge);
                
                // Construir columnas activas de B_i y resolverlas
                for &c_edge in &block.b_cols_active {
                    let mut b_col = DVector::<f64>::zeros(block.size);
                    for &(r_local, ce, r_orig, c_orig) in &block.b_mappings {
                        if ce == c_edge {
                            b_col[r_local] = *matrix.rows[r_orig].get(&c_orig).unwrap_or(&0.0);
                        }
                    }

                    // Resolver A_i * y_col = b_col
                    let y_col = block.symbolic.solve(&workspace, &b_col)
                        .ok_or_else(|| "Subbloque singular al calcular columna Schur".to_string())?;

                    // Multiplicar por C_i y acumular en S_i[:, c_edge]
                    for &(r_edge, c_local, _, _) in &block.c_mappings {
                        s_i[(r_edge, c_edge)] += y_col[c_local] * matrix.rows[self.edge_nodes[r_edge]].get(&block.original_nodes[c_local]).unwrap_or(&0.0);
                    }
                }

                Ok((s_i, v_ci, csc_matrix, workspace))
            })
            .collect();

        // 2. Acumular los resultados de los bloques locales en la matriz del borde D y el RHS z_c
        let mut s_total = d_matrix;
        let mut z_c_star = z_c;

        for (idx, res) in block_results.into_iter().enumerate() {
            let (s_i, v_ci, csc_matrix, workspace) = res?;
            
            // Actualizar el estado de la matriz y el workspace en nuestra estructura de bloques para la sustitución posterior
            self.blocks[idx].csc_template = csc_matrix;
            self.blocks[idx].workspace = workspace;

            s_total -= s_i;
            z_c_star -= v_ci;
        }

        // 3. Resolver el sistema del borde: S * x_c = z_c*
        let x_c = match crate::gpu_solver::solve_schur_on_gpu(&s_total, &z_c_star) {
            Some(x) => x,
            None => {
                let lu_decomp = s_total.lu();
                lu_decomp.solve(&z_c_star)
                    .ok_or_else(|| "Matriz del borde singular en el complemento de Schur. Agrega GND.".to_string())?
            }
        };

        // 4. Resolver en paralelo las soluciones locales finales para cada bloque:
        // x_i = A_i^-1 * (z_i - B_i * x_c)
        let block_solutions: Vec<Result<DVector<f64>, String>> = self.blocks
            .par_iter()
            .map(|block| {
                let mut z_i = DVector::<f64>::zeros(block.size);
                for (r_local, &r_orig) in block.original_nodes.iter().enumerate() {
                    z_i[r_local] = z[r_orig];
                }

                // Restar contribución del borde: B_i * x_c
                for &(r_local, c_edge, r_orig, _) in &block.b_mappings {
                    let val = *matrix.rows[r_orig].get(&self.edge_nodes[c_edge]).unwrap_or(&0.0);
                    z_i[r_local] -= val * x_c[c_edge];
                }

                // Resolver A_i * x_i = z_i_modified
                let x_i = block.symbolic.solve(&block.workspace, &z_i)
                    .ok_or_else(|| "Subbloque local singular en la sustitución final".to_string())?;

                Ok(x_i)
            })
            .collect();

        // 5. Ensamblar la solución final y reconstruir el vector en su orden original
        let mut x_final = DVector::<f64>::zeros(self.size);

        // Mapear variables del borde
        for (r_edge, &r_orig) in self.edge_nodes.iter().enumerate() {
            x_final[r_orig] = x_c[r_edge];
        }

        // Mapear variables locales de bloques
        for (idx, sol_res) in block_solutions.into_iter().enumerate() {
            let x_i = sol_res?;
            let block = &self.blocks[idx];
            for (r_local, &r_orig) in block.original_nodes.iter().enumerate() {
                x_final[r_orig] = x_i[r_local];
            }
        }

        Ok(x_final)
    }
}
