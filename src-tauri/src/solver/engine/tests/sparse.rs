use super::*;

    #[test]
    fn test_sparse_lu_real_solver() {
        let matrix =
            DMatrix::from_row_slice(3, 3, &[2.0, -1.0, 0.0, -1.0, 2.0, -1.0, 0.0, -1.0, 2.0]);
        let b = DVector::from_row_slice(&[1.0, 0.0, 1.0]);
        let decomp_dense = matrix.clone().lu();
        let expected_x = decomp_dense.solve(&b).unwrap();
        let x = solve_sparse(&matrix, &b).unwrap();
        for i in 0..3 {
            assert!(
                (x[i] - expected_x[i]).abs() < 1e-12,
                "x[{}] = {} debería ser {}",
                i,
                x[i],
                expected_x[i]
            );
        }
    }

    #[test]
    fn test_sparse_lu_complex_solver() {
        let matrix = DMatrix::from_row_slice(
            3,
            3,
            &[
                Complex::new(2.0, 1.0),
                Complex::new(-1.0, 0.0),
                Complex::new(0.0, 0.0),
                Complex::new(-1.0, 0.0),
                Complex::new(2.0, -1.0),
                Complex::new(-1.0, 0.0),
                Complex::new(0.0, 0.0),
                Complex::new(-1.0, 0.0),
                Complex::new(2.0, 2.0),
            ],
        );
        let b = DVector::from_row_slice(&[
            Complex::new(1.0, 0.0),
            Complex::new(0.0, 0.0),
            Complex::new(1.0, 0.0),
        ]);
        let decomp_dense = matrix.clone().lu();
        let expected_x = decomp_dense.solve(&b).unwrap();
        let x = solve_complex_sparse(&matrix, &b).unwrap();
        for i in 0..3 {
            assert!(
                (x[i] - expected_x[i]).norm() < 1e-12,
                "x[{}] = {:?} debería ser {:?}",
                i,
                x[i],
                expected_x[i]
            );
        }
    }

