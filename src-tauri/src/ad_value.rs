use std::collections::HashMap;

// ==========================================================================
// MOTOR DE DIFERENCIACIÓN AUTOMÁTICA (AD) EN MODO FORWARD PARA B-SOURCES
// ==========================================================================
// Implementa el tipo AdValue que transporta el valor numérico junto con
// su gradiente disperso (derivadas parciales con respecto a voltajes de
// nodo MNA, indexadas por el índice numérico del nodo).
//
// Teorema de la Regla de la Cadena (Chain Rule):
//   Si y = f(g(x)), entonces dy/dx = df/dg * dg/dx
//
// Para operaciones binarias z = f(x, y):
//   dz/dv_i = ∂f/∂x * dx/dv_i + ∂f/∂y * dy/dv_i
//
// El gradiente se almacena como HashMap<usize, f64> donde la clave es
// el índice del nodo MNA (1-indexado, 0 = GND no se incluye) y el valor
// es la derivada parcial ∂expresión/∂V_nodo.
// ==========================================================================

#[derive(Debug, Clone)]
pub struct AdValue {
    /// Valor numérico de la expresión
    pub value: f64,
    /// Gradiente disperso: mapea índice de nodo MNA → derivada parcial
    /// Ejemplo: para V(1)*V(2) con V(1)=5.0, V(2)=3.0,
    ///   grad = {1: 3.0, 2: 5.0}  (regla del producto)
    pub grad: HashMap<usize, f64>,
}

impl AdValue {
    /// Crea una constante: gradiente vacío (derivada cero respecto a todo)
    #[inline(always)]
    pub fn constant(value: f64) -> Self {
        AdValue {
            value,
            grad: HashMap::new(),
        }
    }

    /// Crea un valor con gradiente no nulo: derecha = value, d/dx = 1.0
    /// para el nodo especificado. Se usa para representar V(nodo) como
    /// variable independiente en el AD.
    #[inline(always)]
    pub fn new_with_grad(value: f64, node_idx: usize) -> Self {
        let mut grad = HashMap::new();
        grad.insert(node_idx, 1.0);
        AdValue { value, grad }
    }

    // ---------------------------------------------------------------
    // OPERACIONES ARITMÉTICAS CON REGLA DE LA CADENA
    // ---------------------------------------------------------------

    /// Suma: z = a + b
    /// dz/dv_i = da/dv_i + db/dv_i
    #[inline(always)]
    pub fn add(a: &AdValue, b: &AdValue) -> AdValue {
        let mut grad = a.grad.clone();
        for (&k, &v) in &b.grad {
            *grad.entry(k).or_insert(0.0) += v;
        }
        AdValue {
            value: a.value + b.value,
            grad,
        }
    }

    /// Resta: z = a - b
    /// dz/dv_i = da/dv_i - db/dv_i
    #[inline(always)]
    pub fn sub(a: &AdValue, b: &AdValue) -> AdValue {
        let mut grad = a.grad.clone();
        for (&k, &v) in &b.grad {
            *grad.entry(k).or_insert(0.0) -= v;
        }
        AdValue {
            value: a.value - b.value,
            grad,
        }
    }

    /// Multiplicación: z = a * b
    /// dz/dv_i = b * da/dv_i + a * db/dv_i  (Regla del Producto de Leibniz)
    #[inline(always)]
    pub fn mul(a: &AdValue, b: &AdValue) -> AdValue {
        let mut grad = HashMap::new();
        // Término: b * da/dv_i
        if b.value != 0.0 {
            for (&k, &dv) in &a.grad {
                grad.insert(k, b.value * dv);
            }
        } else {
            // Si b = 0, el término b * da/dv_i se anula
            // pero aún necesitamos propagar las claves para suma posterior
            for (&k, _) in &a.grad {
                grad.insert(k, 0.0);
            }
        }
        // Término: a * db/dv_i
        if a.value != 0.0 {
            for (&k, &v) in &b.grad {
                *grad.entry(k).or_insert(0.0) += a.value * v;
            }
        }
        AdValue {
            value: a.value * b.value,
            grad,
        }
    }

    /// División: z = a / b
    /// dz/dv_i = (da/dv_i - z * db/dv_i) / b
    /// Protección: si |b| < 1e-150, saturar grad a 0
    #[inline(always)]
    pub fn div(a: &AdValue, b: &AdValue) -> AdValue {
        let val = if b.value.abs() < 1e-150 {
            0.0
        } else {
            a.value / b.value
        };
        let mut grad = HashMap::new();
        if b.value.abs() >= 1e-150 {
            let inv_b = 1.0 / b.value;
            // da/dv_i / b
            for (&k, &v) in &a.grad {
                grad.insert(k, v * inv_b);
            }
            // - val * db/dv_i / b
            if val != 0.0 {
                for (&k, &v) in &b.grad {
                    *grad.entry(k).or_insert(0.0) -= val * v * inv_b;
                }
            }
        }
        AdValue { value: val, grad }
    }

    /// Negación: z = -a
    /// dz/dv_i = -da/dv_i
    #[inline(always)]
    pub fn neg(a: &AdValue) -> AdValue {
        let mut grad = HashMap::with_capacity(a.grad.len());
        for (&k, &v) in &a.grad {
            grad.insert(k, -v);
        }
        AdValue {
            value: -a.value,
            grad,
        }
    }

    /// Potencia con exponente constante: z = a^exp
    /// dz/dv_i = exp * a^(exp-1) * da/dv_i
    #[inline(always)]
    pub fn pow(a: &AdValue, exp: f64) -> AdValue {
        let val = a.value.powf(exp);
        let mut grad = HashMap::new();
        if exp != 0.0 && !a.grad.is_empty() {
            let factor = exp * a.value.powf(exp - 1.0);
            if factor.is_finite() {
                for (&k, &v) in &a.grad {
                    grad.insert(k, factor * v);
                }
            }
        }
        AdValue { value: val, grad }
    }

    // ---------------------------------------------------------------
    // FUNCIONES TRASCENDENTALES CON DERIVADAS ANALÍTICAS
    // ---------------------------------------------------------------

    /// Exponencial: z = exp(a)
    /// dz/dv_i = exp(a) * da/dv_i = z * da/dv_i
    #[inline(always)]
    pub fn exp(a: &AdValue) -> AdValue {
        let val = a.value.exp().min(1e30);
        let mut grad = HashMap::new();
        if val != 0.0 && !a.grad.is_empty() {
            for (&k, &v) in &a.grad {
                grad.insert(k, val * v);
            }
        }
        AdValue { value: val, grad }
    }

    /// Logaritmo natural: z = ln(a)
    /// dz/dv_i = (1/a) * da/dv_i
    /// Protección: si a <= 0, saturar ln a -1e30 y grad a 0
    #[inline(always)]
    pub fn ln(a: &AdValue) -> AdValue {
        let (val, safe) = if a.value > 0.0 {
            (a.value.ln(), true)
        } else {
            (-1e30, false)
        };
        let mut grad = HashMap::new();
        if safe && !a.grad.is_empty() {
            let inv_a = 1.0 / a.value;
            for (&k, &v) in &a.grad {
                grad.insert(k, inv_a * v);
            }
        }
        AdValue { value: val, grad }
    }

    /// Seno: z = sin(a)
    /// dz/dv_i = cos(a) * da/dv_i
    #[inline(always)]
    pub fn sin(a: &AdValue) -> AdValue {
        let val = a.value.sin();
        let mut grad = HashMap::new();
        if !a.grad.is_empty() {
            let cos_a = a.value.cos();
            if cos_a != 0.0 {
                for (&k, &v) in &a.grad {
                    grad.insert(k, cos_a * v);
                }
            }
        }
        AdValue { value: val, grad }
    }

    /// Coseno: z = cos(a)
    /// dz/dv_i = -sin(a) * da/dv_i
    #[inline(always)]
    pub fn cos(a: &AdValue) -> AdValue {
        let val = a.value.cos();
        let mut grad = HashMap::new();
        if !a.grad.is_empty() {
            let neg_sin_a = -a.value.sin();
            if neg_sin_a != 0.0 {
                for (&k, &v) in &a.grad {
                    grad.insert(k, neg_sin_a * v);
                }
            }
        }
        AdValue { value: val, grad }
    }

    /// Tangente: z = tan(a)
    /// dz/dv_i = sec^2(a) * da/dv_i = (1 + tan^2(a)) * da/dv_i
    #[inline(always)]
    pub fn tan(a: &AdValue) -> AdValue {
        let tan_a = a.value.tan();
        let val = tan_a;
        let mut grad = HashMap::new();
        if !a.grad.is_empty() {
            let factor = 1.0 + tan_a * tan_a;
            if factor.is_finite() {
                for (&k, &v) in &a.grad {
                    grad.insert(k, factor * v);
                }
            }
        }
        AdValue { value: val, grad }
    }

    /// Raíz cuadrada: z = sqrt(a)
    /// dz/dv_i = (0.5 / sqrt(a)) * da/dv_i
    /// Protección: si a < 0, saturar sqrt a 0 y grad a 0
    #[inline(always)]
    pub fn sqrt(a: &AdValue) -> AdValue {
        let (val, safe) = if a.value >= 0.0 {
            (a.value.sqrt(), a.value > 0.0)
        } else {
            (0.0, false)
        };
        let mut grad = HashMap::new();
        if safe && !a.grad.is_empty() {
            let factor = 0.5 / val;
            for (&k, &v) in &a.grad {
                grad.insert(k, factor * v);
            }
        }
        AdValue { value: val, grad }
    }

    /// Valor absoluto: z = |a|
    /// dz/dv_i = sign(a) * da/dv_i
    /// En a=0, la derivada no existe; se toma sign(0) = 1.0
    #[inline(always)]
    pub fn abs(a: &AdValue) -> AdValue {
        let val = a.value.abs();
        let mut grad = HashMap::new();
        if !a.grad.is_empty() {
            let sign = if a.value >= 0.0 { 1.0 } else { -1.0 };
            for (&k, &v) in &a.grad {
                grad.insert(k, sign * v);
            }
        }
        AdValue { value: val, grad }
    }

    /// Máximo: z = max(a, b)
    /// dz/dv_i = da/dv_i si a >= b, else db/dv_i
    /// Nota: la derivada en a=b es discontinua; tomamos la rama izquierda
    #[inline(always)]
    pub fn max(a: &AdValue, b: &AdValue) -> AdValue {
        if a.value >= b.value {
            a.clone()
        } else {
            b.clone()
        }
    }

    /// Mínimo: z = min(a, b)
    /// dz/dv_i = da/dv_i si a <= b, else db/dv_i
    #[inline(always)]
    pub fn min(a: &AdValue, b: &AdValue) -> AdValue {
        if a.value <= b.value {
            a.clone()
        } else {
            b.clone()
        }
    }
}

// ==========================================================================
// PRUEBAS UNITARIAS
// ==========================================================================

#[cfg(test)]
mod tests {
    use super::*;

    /// Helper: crea un AdValue con el valor dado y un gradiente de prueba
    /// {1: 1.0} simulando V(1)
    fn v1(val: f64) -> AdValue {
        AdValue::new_with_grad(val, 1)
    }

    /// Helper: crea un AdValue con el valor dado y un gradiente de prueba
    /// {2: 1.0} simulando V(2)
    fn v2(val: f64) -> AdValue {
        AdValue::new_with_grad(val, 2)
    }

    #[test]
    fn test_ad_constant_grad_vacio() {
        let c = AdValue::constant(42.0);
        assert!((c.value - 42.0).abs() < 1e-15);
        assert!(c.grad.is_empty());
    }

    #[test]
    fn test_ad_voltage_ref_grad_unitario() {
        let v = v1(5.0);
        assert!((v.value - 5.0).abs() < 1e-15);
        assert_eq!(v.grad.get(&1), Some(&1.0));
    }

    #[test]
    fn test_ad_sum_grad_acumula() {
        let a = v1(5.0);
        let b = v2(3.0);
        let r = AdValue::add(&a, &b);
        assert!((r.value - 8.0).abs() < 1e-15);
        assert_eq!(r.grad.get(&1), Some(&1.0));
        assert_eq!(r.grad.get(&2), Some(&1.0));
    }

    #[test]
    fn test_ad_sub_grad_resta() {
        let a = v1(5.0);
        let b = v2(3.0);
        let r = AdValue::sub(&a, &b);
        assert!((r.value - 2.0).abs() < 1e-15);
        assert_eq!(r.grad.get(&1), Some(&1.0));
        assert_eq!(r.grad.get(&2), Some(&-1.0));
    }

    #[test]
    fn test_ad_mul_regla_del_producto() {
        // f = V(1) * V(2), con V(1)=5, V(2)=3
        // ∂f/∂V1 = V2 = 3, ∂f/∂V2 = V1 = 5
        let a = v1(5.0);
        let b = v2(3.0);
        let r = AdValue::mul(&a, &b);
        assert!((r.value - 15.0).abs() < 1e-15);
        assert_eq!(r.grad.get(&1), Some(&3.0));  // ∂/∂V1 = V2
        assert_eq!(r.grad.get(&2), Some(&5.0));  // ∂/∂V2 = V1
    }

    #[test]
    fn test_ad_pow_regla_de_la_potencia() {
        // f = V(1)^3, con V(1)=2
        // ∂f/∂V1 = 3 * V(1)^2 = 12
        let a = v1(2.0);
        let r = AdValue::pow(&a, 3.0);
        assert!((r.value - 8.0).abs() < 1e-15);
        assert!((r.grad.get(&1).unwrap() - 12.0).abs() < 1e-12);
    }

    #[test]
    fn test_ad_exp_regla_de_la_cadena() {
        // f = exp(V(1)), con V(1)=1
        // ∂f/∂V1 = exp(1) = e ≈ 2.71828
        let a = v1(1.0);
        let r = AdValue::exp(&a);
        assert!((r.value - std::f64::consts::E).abs() < 1e-12);
        assert!((r.grad.get(&1).unwrap() - std::f64::consts::E).abs() < 1e-12);
    }

    #[test]
    fn test_ad_exp_chain_regla_de_la_cadena_anidada() {
        // f = exp(V(1)^2), con V(1)=2
        // df/dV1 = exp(4) * 2 * 2 = 4 * exp(4)
        // Valor: exp(4) ≈ 54.598
        let a = v1(2.0);
        let inner = AdValue::pow(&a, 2.0);
        let r = AdValue::exp(&inner);
        let expected_val = (4.0f64).exp();
        let expected_grad = 4.0 * expected_val; // 2*V(1)*exp(V(1)^2)
        assert!((r.value - expected_val).abs() < 1e-10);
        assert!((r.grad.get(&1).unwrap() - expected_grad).abs() < 1e-8);
    }

    #[test]
    fn test_ad_ln_proteccion_dominio() {
        let a = AdValue::constant(-5.0);
        let r = AdValue::ln(&a);
        assert!(r.value < 0.0); // saturado a -1e30
        assert!(r.grad.is_empty());

        let b = AdValue::constant(2.0);
        let r2 = AdValue::ln(&b);
        assert!((r2.value - 2.0f64.ln()).abs() < 1e-15);
    }

    #[test]
    fn test_ad_div_proteccion_cero() {
        let a = v1(10.0);
        let b = AdValue::constant(0.0);
        let r = AdValue::div(&a, &b);
        assert!((r.value - 0.0).abs() < 1e-15); // saturado a 0
        assert!(r.grad.is_empty() || r.grad.values().all(|&v| v.abs() < 1e-15));
    }

    #[test]
    fn test_ad_sin_cos_identidad_trigonometrica() {
        // sin^2(x) + cos^2(x) = 1
        let x = v1(1.0);
        let sin_x = AdValue::sin(&x);
        let cos_x = AdValue::cos(&x);
        let sin2 = AdValue::mul(&sin_x, &sin_x);
        let cos2 = AdValue::mul(&cos_x, &cos_x);
        let r = AdValue::add(&sin2, &cos2);
        assert!((r.value - 1.0).abs() < 1e-14);

        // La derivada de sin^2+cos^2 debe ser 0
        // d/dx = 2*sin*cos + 2*cos*(-sin) = 0
        assert!(r.grad.get(&1).map(|&v| v.abs() < 1e-12).unwrap_or(true));
    }

    #[test]
    fn test_ad_max_min_selecciona_rama() {
        let a = v1(5.0);
        let b = v2(3.0);
        let rmax = AdValue::max(&a, &b);
        assert!((rmax.value - 5.0).abs() < 1e-15);
        assert_eq!(rmax.grad.get(&1), Some(&1.0)); // hereda grad de V(1)
        assert!(rmax.grad.get(&2).is_none() || *rmax.grad.get(&2).unwrap() == 0.0);

        let rmin = AdValue::min(&a, &b);
        assert!((rmin.value - 3.0).abs() < 1e-15);
        assert_eq!(rmin.grad.get(&2), Some(&1.0)); // hereda grad de V(2)
    }

    /// Prueba de verificación: gradiente AD vs diferencias finitas
    /// para f = sin(V(1)) * V(2) en V(1)=0.5, V(2)=2.0
    #[test]
    fn test_ad_vs_numeric_finite_difference() {
        let v1_val = 0.5;
        let v2_val = 2.0;
        let a = v1(v1_val);
        let b = v2(v2_val);
        let sin_a = AdValue::sin(&a);
        let r = AdValue::mul(&sin_a, &b);

        // Valor analítico: sin(0.5)*2.0 ≈ 0.95885
        let expected_val = v1_val.sin() * v2_val;
        assert!((r.value - expected_val).abs() < 1e-12);

        // ∂f/∂V1 = cos(V1) * V2 = cos(0.5) * 2.0 ≈ 1.75516
        let df_dv1_ad = *r.grad.get(&1).unwrap_or(&0.0);
        let df_dv1_fd = {
            let h = 1e-8;
            let f_plus = ((v1_val + h).sin()) * v2_val;
            let f_minus = ((v1_val - h).sin()) * v2_val;
            (f_plus - f_minus) / (2.0 * h)
        };
        assert!((df_dv1_ad - df_dv1_fd).abs() < 1e-6,
            "∂f/∂V1 AD={} FD={} diff={}", df_dv1_ad, df_dv1_fd, (df_dv1_ad - df_dv1_fd).abs());

        // ∂f/∂V2 = sin(V1) = sin(0.5) ≈ 0.47942
        let df_dv2_ad = *r.grad.get(&2).unwrap_or(&0.0);
        let df_dv2_fd = {
            let h = 1e-8;
            let f_plus = (v1_val.sin()) * (v2_val + h);
            let f_minus = (v1_val.sin()) * (v2_val - h);
            (f_plus - f_minus) / (2.0 * h)
        };
        assert!((df_dv2_ad - df_dv2_fd).abs() < 1e-6,
            "∂f/∂V2 AD={} FD={} diff={}", df_dv2_ad, df_dv2_fd, (df_dv2_ad - df_dv2_fd).abs());
    }

    /// Prueba de estrés: expresión anidada profunda con regla de la cadena
    /// f = ln(exp(V(1)) + 1)  → df/dV1 = exp(V(1))/(exp(V(1))+1)
    /// En V(1)=0: df/dV1 = e^0/(e^0+1) = 1/2 = 0.5
    #[test]
    fn test_ad_deep_chain_log_sigmoid() {
        let x = v1(0.0);
        let exp_x = AdValue::exp(&x);
        let one = AdValue::constant(1.0);
        let sum = AdValue::add(&exp_x, &one);
        let r = AdValue::ln(&sum);

        // log(exp(0)+1) = log(2) ≈ 0.6931
        assert!((r.value - 2.0f64.ln()).abs() < 1e-14);

        // df/dV1 = 1/(1+1) * 1 = 0.5
        let df_dv = *r.grad.get(&1).unwrap_or(&0.0);
        assert!((df_dv - 0.5).abs() < 1e-12);
    }
}
