use std::ops::{Add, Div, Mul, Neg, Sub};

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Dual3 {
    pub val: f64,
    pub deriv: [f64; 3],
}

impl Dual3 {
    pub fn new(val: f64, index: usize) -> Self {
        let mut deriv = [0.0; 3];
        if index < 3 {
            deriv[index] = 1.0;
        }
        Dual3 { val, deriv }
    }

    pub fn constant(val: f64) -> Self {
        Dual3 {
            val,
            deriv: [0.0; 3],
        }
    }

    pub fn exp(self) -> Self {
        let val = self.val.exp();
        let deriv = [
            self.deriv[0] * val,
            self.deriv[1] * val,
            self.deriv[2] * val,
        ];
        Dual3 { val, deriv }
    }

    pub fn ln(self) -> Self {
        let val = self.val.ln();
        let denom = if self.val.abs() < 1e-30 {
            1e-30
        } else {
            self.val
        };
        let deriv = [
            self.deriv[0] / denom,
            self.deriv[1] / denom,
            self.deriv[2] / denom,
        ];
        Dual3 { val, deriv }
    }

    pub fn sqrt(self) -> Self {
        let val = self.val.sqrt();
        let denom = if val.abs() < 1e-30 { 1e-30 } else { 2.0 * val };
        let deriv = [
            self.deriv[0] / denom,
            self.deriv[1] / denom,
            self.deriv[2] / denom,
        ];
        Dual3 { val, deriv }
    }

    pub fn powf(self, n: f64) -> Self {
        let val = self.val.powf(n);
        let factor = if self.val.abs() < 1e-30 && n < 1.0 {
            0.0
        } else {
            n * self.val.powf(n - 1.0)
        };
        let deriv = [
            self.deriv[0] * factor,
            self.deriv[1] * factor,
            self.deriv[2] * factor,
        ];
        Dual3 { val, deriv }
    }

    pub fn tanh(self) -> Self {
        let val = self.val.tanh();
        let factor = 1.0 - val * val;
        let deriv = [
            self.deriv[0] * factor,
            self.deriv[1] * factor,
            self.deriv[2] * factor,
        ];
        Dual3 { val, deriv }
    }
}

// Sobrecarga de Add para Dual3 + Dual3
impl Add<Dual3> for Dual3 {
    type Output = Dual3;
    fn add(self, other: Dual3) -> Dual3 {
        Dual3 {
            val: self.val + other.val,
            deriv: [
                self.deriv[0] + other.deriv[0],
                self.deriv[1] + other.deriv[1],
                self.deriv[2] + other.deriv[2],
            ],
        }
    }
}

// Sobrecarga de Add para Dual3 + f64
impl Add<f64> for Dual3 {
    type Output = Dual3;
    fn add(self, other: f64) -> Dual3 {
        self + Dual3::constant(other)
    }
}

// Sobrecarga de Add para f64 + Dual3
impl Add<Dual3> for f64 {
    type Output = Dual3;
    fn add(self, other: Dual3) -> Dual3 {
        Dual3::constant(self) + other
    }
}

// Sobrecarga de Sub para Dual3 - Dual3
impl Sub<Dual3> for Dual3 {
    type Output = Dual3;
    fn sub(self, other: Dual3) -> Dual3 {
        Dual3 {
            val: self.val - other.val,
            deriv: [
                self.deriv[0] - other.deriv[0],
                self.deriv[1] - other.deriv[1],
                self.deriv[2] - other.deriv[2],
            ],
        }
    }
}

// Sobrecarga de Sub para Dual3 - f64
impl Sub<f64> for Dual3 {
    type Output = Dual3;
    fn sub(self, other: f64) -> Dual3 {
        self - Dual3::constant(other)
    }
}

// Sobrecarga de Sub para f64 - Dual3
impl Sub<Dual3> for f64 {
    type Output = Dual3;
    fn sub(self, other: Dual3) -> Dual3 {
        Dual3::constant(self) - other
    }
}

// Sobrecarga de Mul para Dual3 * Dual3
impl Mul<Dual3> for Dual3 {
    type Output = Dual3;
    fn mul(self, other: Dual3) -> Dual3 {
        Dual3 {
            val: self.val * other.val,
            deriv: [
                self.val * other.deriv[0] + other.val * self.deriv[0],
                self.val * other.deriv[1] + other.val * self.deriv[1],
                self.val * other.deriv[2] + other.val * self.deriv[2],
            ],
        }
    }
}

// Sobrecarga de Mul para Dual3 * f64
impl Mul<f64> for Dual3 {
    type Output = Dual3;
    fn mul(self, other: f64) -> Dual3 {
        self * Dual3::constant(other)
    }
}

// Sobrecarga de Mul para f64 * Dual3
impl Mul<Dual3> for f64 {
    type Output = Dual3;
    fn mul(self, other: Dual3) -> Dual3 {
        Dual3::constant(self) * other
    }
}

// Sobrecarga de Div para Dual3 / Dual3
impl Div<Dual3> for Dual3 {
    type Output = Dual3;
    fn div(self, other: Dual3) -> Dual3 {
        let other_val_sq = if other.val.abs() < 1e-30 {
            1e-30
        } else {
            other.val * other.val
        };
        let denom = if other.val.abs() < 1e-30 {
            1e-30
        } else {
            other.val
        };
        Dual3 {
            val: self.val / denom,
            deriv: [
                (other.val * self.deriv[0] - self.val * other.deriv[0]) / other_val_sq,
                (other.val * self.deriv[1] - self.val * other.deriv[1]) / other_val_sq,
                (other.val * self.deriv[2] - self.val * other.deriv[2]) / other_val_sq,
            ],
        }
    }
}

// Sobrecarga de Div para Dual3 / f64
impl Div<f64> for Dual3 {
    type Output = Dual3;
    fn div(self, other: f64) -> Dual3 {
        self / Dual3::constant(other)
    }
}

// Sobrecarga de Div para f64 / Dual3
impl Div<Dual3> for f64 {
    type Output = Dual3;
    fn div(self, other: Dual3) -> Dual3 {
        Dual3::constant(self) / other
    }
}

// Sobrecarga de Neg para -Dual3
impl Neg for Dual3 {
    type Output = Dual3;
    fn neg(self) -> Dual3 {
        Dual3 {
            val: -self.val,
            deriv: [-self.deriv[0], -self.deriv[1], -self.deriv[2]],
        }
    }
}
