import re

file_path = "src-tauri/src/solver.rs"

with open(file_path, "r", encoding="utf-8") as f:
    code = f.read()

replacements = []

# 1. Macro stamp_conductance at line 1253-1259
macro_1_old = """                macro_rules! stamp_conductance {
                    ($r:expr, $c:expr, $g:expr) => {
                        if $r > 0 && $c > 0 {
                            matrix_a.add_element($r - 1, $c - 1, $g);
                        }
                    };
                }"""

macro_1_new = """                macro_rules! stamp_conductance {
                    ($r:expr, $c:expr, $g:expr) => {
                        {
                            let r_val = $r;
                            let c_val = $c;
                            if r_val > 0 && c_val > 0 {
                                matrix_a.add_element(r_val - 1, c_val - 1, $g);
                            }
                        }
                    };
                }"""
replacements.append((macro_1_old, macro_1_new))

# 2. Macro stamp_conductance at line 1345-1351
macro_2_old = """                macro_rules! stamp_conductance {
                    ($r:expr, $c:expr, $g:expr) => {
                        if $r > 0 && $c > 0 {
                            matrix_a.add_element($r - 1, $c - 1, $g);
                        }
                    };
                }"""

# Since macro_2_old is identical to macro_1_old, a single global replace might replace both,
# but we will do a specific check or replace all occurrences since they are both identical and need the same fix.
# We will use string.replace which handles all occurrences.

# 3. Duplicate checks in BJT model evaluation (lines 1585-1586)
dup_1_old = """                if node_drain > 0 && node_drain > 0 { matrix_a.add_element(node_drain - 1, node_drain - 1, gds_final); }
                if node_source > 0 && node_source > 0 { matrix_a.add_element(node_source - 1, node_source - 1, gds_final); }"""
dup_1_new = """                if node_drain > 0 { matrix_a.add_element(node_drain - 1, node_drain - 1, gds_final); }
                if node_source > 0 { matrix_a.add_element(node_source - 1, node_source - 1, gds_final); }"""
replacements.append((dup_1_old, dup_1_new))

# 4. Duplicate checks in gate diode (lines 1610-1611)
dup_2_old = """                if node_gate > 0 && node_gate > 0 { matrix_a.add_element(node_gate - 1, node_gate - 1, gg_gs); }
                if node_source > 0 && node_source > 0 { matrix_a.add_element(node_source - 1, node_source - 1, gg_gs); }"""
dup_2_new = """                if node_gate > 0 { matrix_a.add_element(node_gate - 1, node_gate - 1, gg_gs); }
                if node_source > 0 { matrix_a.add_element(node_source - 1, node_source - 1, gg_gs); }"""
replacements.append((dup_2_old, dup_2_new))

# 5. Duplicate checks in gate-drain diode (lines 1622-1623)
dup_3_old = """                if node_gate > 0 && node_gate > 0 { matrix_a.add_element(node_gate - 1, node_gate - 1, gg_gd); }
                if node_drain > 0 && node_drain > 0 { matrix_a.add_element(node_drain - 1, node_drain - 1, gg_gd); }"""
dup_3_new = """                if node_gate > 0 { matrix_a.add_element(node_gate - 1, node_gate - 1, gg_gd); }
                if node_drain > 0 { matrix_a.add_element(node_drain - 1, node_drain - 1, gg_gd); }"""
replacements.append((dup_3_old, dup_3_new))

# 6. Duplicate checks in Arduino/ESP32 pin (lines 1904-1905)
dup_4_old = """                    if pin_gnd > 0 && pin_gnd > 0 {
                        matrix_a.add_element(pin_gnd - 1, pin_gnd - 1, -g_transfer);
                    }"""
dup_4_new = """                    if pin_gnd > 0 {
                        matrix_a.add_element(pin_gnd - 1, pin_gnd - 1, -g_transfer);
                    }"""
replacements.append((dup_4_old, dup_4_new))

# Apply all replacements
new_code = code
for old, new in replacements:
    if old in new_code:
        new_code = new_code.replace(old, new)
        print(f"Successfully replaced: {old.splitlines()[0]}...")
    else:
        print(f"Warning: could not find target text for replacement:\n{old}\n")

# Make sure we also replace all instances of the macro if any are left
if macro_1_old in new_code:
    new_code = new_code.replace(macro_1_old, macro_1_new)
    print("Replaced additional macro instance.")

# 7. Now let's fix the identical BJT branches in solver.rs

# Let's target the AC solver block first (originally lines 5578-5628)
ac_old = """                "npn" | "pnp" => {
                    let is_npn = comp.comp_type == "npn";
                    let node_base = comp.pins[0].parse::<usize>().unwrap();
                    let node_collector = comp.pins[1].parse::<usize>().unwrap();
                    let node_emitter = comp.pins[2].parse::<usize>().unwrap();

                    let (gbe_val, gbc_val) = *bjt_parameters.get(&comp.id).unwrap_or(&(1e-9, 1e-9));
                    let gbe = Complex::new(gbe_val, 0.0);
                    let gbc = Complex::new(gbc_val, 0.0);

                    let beta_f = if comp.value <= 1.0 { 100.0 } else { comp.value };
                    let beta_r = 1.0;
                    let alpha_f = Complex::new(beta_f / (beta_f + 1.0), 0.0);
                    let alpha_r = Complex::new(beta_r / (beta_r + 1.0), 0.0);

                    let g_be_b = gbe / Complex::new(beta_f + 1.0, 0.0);
                    let g_bc_b = gbc / Complex::new(beta_r + 1.0, 0.0);

                    if is_npn {
                        stamp_conductance(&mut matrix_a, node_base, node_base, g_be_b + g_bc_b);
                        stamp_conductance(&mut matrix_a, node_base, node_emitter, -g_be_b);
                        stamp_conductance(&mut matrix_a, node_base, node_collector, -g_bc_b);

                        if node_collector > 0 {
                            if node_base > 0 { matrix_a.add_element(node_collector - 1, node_base - 1, alpha_f * gbe - gbc); }
                            if node_emitter > 0 { matrix_a.add_element(node_collector - 1, node_emitter - 1, -alpha_f * gbe); }
                            matrix_a.add_element(node_collector - 1, node_collector - 1, gbc);
                        }

                        if node_emitter > 0 {
                            if node_base > 0 { matrix_a.add_element(node_emitter - 1, node_base - 1, -(gbe - alpha_r * gbc)); }
                            matrix_a.add_element(node_emitter - 1, node_emitter - 1, gbe);
                            if node_collector > 0 { matrix_a.add_element(node_emitter - 1, node_collector - 1, -alpha_r * gbc); }
                        }
                    } else {
                        stamp_conductance(&mut matrix_a, node_base, node_base, g_be_b + g_bc_b);
                        stamp_conductance(&mut matrix_a, node_base, node_emitter, -g_be_b);
                        stamp_conductance(&mut matrix_a, node_base, node_collector, -g_bc_b);

                        if node_collector > 0 {
                            if node_base > 0 { matrix_a.add_element(node_collector - 1, node_base - 1, alpha_f * gbe - gbc); }
                            if node_emitter > 0 { matrix_a.add_element(node_collector - 1, node_emitter - 1, -alpha_f * gbe); }
                            matrix_a.add_element(node_collector - 1, node_collector - 1, gbc);
                        }

                        if node_emitter > 0 {
                            if node_base > 0 { matrix_a.add_element(node_emitter - 1, node_base - 1, -(gbe - alpha_r * gbc)); }
                            matrix_a.add_element(node_emitter - 1, node_emitter - 1, gbe);
                            if node_collector > 0 { matrix_a.add_element(node_emitter - 1, node_collector - 1, -alpha_r * gbc); }
                        }
                    }
                }"""

ac_new = """                "npn" | "pnp" => {
                    let node_base = comp.pins[0].parse::<usize>().unwrap();
                    let node_collector = comp.pins[1].parse::<usize>().unwrap();
                    let node_emitter = comp.pins[2].parse::<usize>().unwrap();

                    let (gbe_val, gbc_val) = *bjt_parameters.get(&comp.id).unwrap_or(&(1e-9, 1e-9));
                    let gbe = Complex::new(gbe_val, 0.0);
                    let gbc = Complex::new(gbc_val, 0.0);

                    let beta_f = if comp.value <= 1.0 { 100.0 } else { comp.value };
                    let beta_r = 1.0;
                    let alpha_f = Complex::new(beta_f / (beta_f + 1.0), 0.0);
                    let alpha_r = Complex::new(beta_r / (beta_r + 1.0), 0.0);

                    let g_be_b = gbe / Complex::new(beta_f + 1.0, 0.0);
                    let g_bc_b = gbc / Complex::new(beta_r + 1.0, 0.0);

                    stamp_conductance(&mut matrix_a, node_base, node_base, g_be_b + g_bc_b);
                    stamp_conductance(&mut matrix_a, node_base, node_emitter, -g_be_b);
                    stamp_conductance(&mut matrix_a, node_base, node_collector, -g_bc_b);

                    if node_collector > 0 {
                        if node_base > 0 { matrix_a.add_element(node_collector - 1, node_base - 1, alpha_f * gbe - gbc); }
                        if node_emitter > 0 { matrix_a.add_element(node_collector - 1, node_emitter - 1, -alpha_f * gbe); }
                        matrix_a.add_element(node_collector - 1, node_collector - 1, gbc);
                    }

                    if node_emitter > 0 {
                        if node_base > 0 { matrix_a.add_element(node_emitter - 1, node_base - 1, -(gbe - alpha_r * gbc)); }
                        matrix_a.add_element(node_emitter - 1, node_emitter - 1, gbe);
                        if node_collector > 0 { matrix_a.add_element(node_emitter - 1, node_collector - 1, -alpha_r * gbc); }
                    }
                }"""

if ac_old in new_code:
    new_code = new_code.replace(ac_old, ac_new)
    print("Successfully replaced AC BJT redundant blocks.")
else:
    print("Warning: could not find AC BJT redundant blocks.")


# Target the transient Jacobian BJT block (originally lines 7492-7524)
trans_old = """            if is_npn {
                stamp_conductance(node_base, node_base, g_be_b + g_bc_b);
                stamp_conductance(node_base, node_emitter, -g_be_b);
                stamp_conductance(node_base, node_collector, -g_bc_b);

                if node_collector > 0 {
                    if node_base > 0 { j_matrix[(node_collector - 1, node_base - 1)] += alpha_f * gbe - gbc; }
                    if node_emitter > 0 { j_matrix[(node_collector - 1, node_emitter - 1)] -= alpha_f * gbe; }
                    j_matrix[(node_collector - 1, node_collector - 1)] += gbc;
                }

                if node_emitter > 0 {
                    if node_base > 0 { j_matrix[(node_emitter - 1, node_base - 1)] -= gbe - alpha_r * gbc; }
                    j_matrix[(node_emitter - 1, node_emitter - 1)] += gbe;
                    if node_collector > 0 { j_matrix[(node_emitter - 1, node_collector - 1)] -= alpha_r * gbc; }
                }
            } else {
                stamp_conductance(node_base, node_base, g_be_b + g_bc_b);
                stamp_conductance(node_base, node_emitter, -g_be_b);
                stamp_conductance(node_base, node_collector, -g_bc_b);

                if node_collector > 0 {
                    if node_base > 0 { j_matrix[(node_collector - 1, node_base - 1)] += alpha_f * gbe - gbc; }
                    if node_emitter > 0 { j_matrix[(node_collector - 1, node_emitter - 1)] -= alpha_f * gbe; }
                    j_matrix[(node_collector - 1, node_collector - 1)] += gbc;
                }

                if node_emitter > 0 {
                    if node_base > 0 { j_matrix[(node_emitter - 1, node_base - 1)] -= gbe - alpha_r * gbc; }
                    j_matrix[(node_emitter - 1, node_emitter - 1)] += gbe;
                    if node_collector > 0 { j_matrix[(node_emitter - 1, node_collector - 1)] -= alpha_r * gbc; }
                }
            }"""

trans_new = """            stamp_conductance(node_base, node_base, g_be_b + g_bc_b);
            stamp_conductance(node_base, node_emitter, -g_be_b);
            stamp_conductance(node_base, node_collector, -g_bc_b);

            if node_collector > 0 {
                if node_base > 0 { j_matrix[(node_collector - 1, node_base - 1)] += alpha_f * gbe - gbc; }
                if node_emitter > 0 { j_matrix[(node_collector - 1, node_emitter - 1)] -= alpha_f * gbe; }
                j_matrix[(node_collector - 1, node_collector - 1)] += gbc;
            }

            if node_emitter > 0 {
                if node_base > 0 { j_matrix[(node_emitter - 1, node_base - 1)] -= gbe - alpha_r * gbc; }
                j_matrix[(node_emitter - 1, node_emitter - 1)] += gbe;
                if node_collector > 0 { j_matrix[(node_emitter - 1, node_collector - 1)] -= alpha_r * gbc; }
            }"""

if trans_old in new_code:
    new_code = new_code.replace(trans_old, trans_new)
    print("Successfully replaced transient Jacobian BJT redundant blocks.")
else:
    print("Warning: could not find transient Jacobian BJT redundant blocks.")


with open(file_path, "w", encoding="utf-8") as f:
    f.write(new_code)

print("Saved modifications to solver.rs")
