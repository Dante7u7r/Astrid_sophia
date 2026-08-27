use biaani_lib::solver::{
    solve_ac_sweep, solve_dc_circuit, solve_transient_circuit, AcSweepSettings, CircuitNetlist,
    ComponentData, TransientSettings,
};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};
use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

const RUNS_PER_FAMILY: usize = 100;
const REQUIRED_RUNS: usize = 500;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CampaignRecord {
    run_id: String,
    session_id: String,
    sequence: usize,
    family: String,
    analysis: String,
    parameters: BTreeMap<String, f64>,
    actual: f64,
    expected: f64,
    absolute_error: f64,
    allowed_error: f64,
    passed: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FamilySummary {
    family: String,
    analysis: String,
    executions: usize,
    passed: usize,
    maximum_absolute_error: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CampaignReport {
    schema_version: u32,
    campaign_id: String,
    generated_at_unix_seconds: u64,
    solver_version: String,
    dataset_sha256: String,
    execution_count: usize,
    unique_parameter_sets: usize,
    session_count: usize,
    family_count: usize,
    analysis_modes: Vec<String>,
    passed: bool,
    passed_executions: usize,
    failed_executions: usize,
    elapsed_milliseconds: u128,
    families: Vec<FamilySummary>,
    records: Vec<CampaignRecord>,
    limitations: Vec<String>,
}

fn component(
    id: &str,
    comp_type: &str,
    value: f64,
    positive: &str,
    negative: &str,
) -> ComponentData {
    ComponentData {
        id: id.to_string(),
        comp_type: comp_type.to_string(),
        value,
        pins: vec![positive.to_string(), negative.to_string()],
        ..Default::default()
    }
}

fn netlist(components: Vec<ComponentData>) -> CircuitNetlist {
    CircuitNetlist {
        components,
        ..Default::default()
    }
}

fn parameter(scale: f64, index: usize, multiplier: f64) -> f64 {
    let decade = (index % 10) as i32 - 5;
    let step = 1.0 + ((index / 10) as f64) * multiplier;
    scale * 10_f64.powi(decade) * step
}

fn record(
    sequence: usize,
    family: &str,
    analysis: &str,
    parameters: BTreeMap<String, f64>,
    actual: f64,
    expected: f64,
    allowed_error: f64,
) -> CampaignRecord {
    CampaignRecord {
        run_id: format!("campaign-run-{sequence:04}"),
        session_id: format!("campaign-session-{:02}", sequence / 25),
        sequence,
        family: family.to_string(),
        analysis: analysis.to_string(),
        parameters,
        actual,
        expected,
        absolute_error: (actual - expected).abs(),
        allowed_error,
        passed: actual.is_finite() && (actual - expected).abs() <= allowed_error,
    }
}

fn run_campaign() -> Result<Vec<CampaignRecord>, String> {
    let mut records = Vec::with_capacity(REQUIRED_RUNS);

    for index in 0..RUNS_PER_FAMILY {
        let vin = 1.0 + (index % 17) as f64 * 0.7;
        let r1 = parameter(1_000.0, index, 0.07);
        let r2 = parameter(2_200.0, 99 - index, 0.05);
        let circuit = netlist(vec![
            component("V1", "vsource", vin, "1", "0"),
            component("R1", "resistor", r1, "1", "2"),
            component("R2", "resistor", r2, "2", "0"),
        ]);
        let actual = *solve_dc_circuit(&circuit)?
            .node_voltages
            .get("2")
            .ok_or("Falta nodo 2")?;
        let expected = vin * r2 / (r1 + r2);
        records.push(record(
            records.len(),
            "dc-resistive-divider",
            "DC",
            BTreeMap::from([("vin".into(), vin), ("r1".into(), r1), ("r2".into(), r2)]),
            actual,
            expected,
            expected.abs() * 1e-9 + 1e-12,
        ));
    }

    for index in 0..RUNS_PER_FAMILY {
        let vin = 2.0 + (index % 13) as f64 * 0.8;
        let r1 = parameter(820.0, index, 0.03);
        let r2 = parameter(1_500.0, 99 - index, 0.04);
        let r3 = parameter(2_700.0, (index * 3) % 100, 0.02);
        let r4 = parameter(3_900.0, (index * 7) % 100, 0.025);
        let rb = parameter(5_600.0, (index * 9) % 100, 0.015);
        let circuit = netlist(vec![
            component("V1", "vsource", vin, "1", "0"),
            component("R1", "resistor", r1, "1", "2"),
            component("R2", "resistor", r2, "2", "0"),
            component("R3", "resistor", r3, "1", "3"),
            component("R4", "resistor", r4, "3", "0"),
            component("RB", "resistor", rb, "2", "3"),
        ]);
        let actual = *solve_dc_circuit(&circuit)?
            .node_voltages
            .get("2")
            .ok_or("Falta nodo 2")?;
        let (g1, g2, g3, g4, gb) = (1.0 / r1, 1.0 / r2, 1.0 / r3, 1.0 / r4, 1.0 / rb);
        let (a11, a12, a21, a22) = (g1 + g2 + gb, -gb, -gb, g3 + g4 + gb);
        let determinant = a11 * a22 - a12 * a21;
        let expected = (g1 * vin * a22 - a12 * g3 * vin) / determinant;
        records.push(record(
            records.len(),
            "dc-loaded-bridge",
            "DC",
            BTreeMap::from([
                ("vin".into(), vin),
                ("r1".into(), r1),
                ("r2".into(), r2),
                ("r3".into(), r3),
                ("r4".into(), r4),
                ("rb".into(), rb),
            ]),
            actual,
            expected,
            expected.abs() * 2e-9 + 1e-12,
        ));
    }

    for index in 0..RUNS_PER_FAMILY {
        let resistance = parameter(1_000.0, index, 0.025);
        let capacitance = parameter(1e-6, 99 - index, 0.02);
        let frequency = 1.0 / (2.0 * std::f64::consts::PI * resistance * capacitance);
        let circuit = netlist(vec![
            component("V1", "vsource", 1.0, "1", "0"),
            component("R1", "resistor", resistance, "1", "2"),
            component("C1", "capacitor", capacitance, "2", "0"),
        ]);
        let result = solve_ac_sweep(
            &circuit,
            &AcSweepSettings {
                f_start: frequency,
                f_end: frequency,
                points_per_decade: 1,
                op_guess: None,
            },
        )?;
        let actual = result
            .node_amplitudes
            .get("2")
            .and_then(|values| values.first())
            .copied()
            .ok_or("Falta amplitud AC")?;
        let expected = -10.0 * 2.0_f64.log10();
        records.push(record(
            records.len(),
            "ac-rc-cutoff",
            "AC",
            BTreeMap::from([
                ("resistance".into(), resistance),
                ("capacitance".into(), capacitance),
                ("frequency".into(), frequency),
            ]),
            actual,
            expected,
            2e-6,
        ));
    }

    for index in 0..RUNS_PER_FAMILY {
        let resistance = parameter(100.0, index, 0.02);
        let inductance = parameter(0.1, 99 - index, 0.018);
        let frequency = resistance / (2.0 * std::f64::consts::PI * inductance);
        let circuit = netlist(vec![
            component("V1", "vsource", 1.0, "1", "0"),
            component("L1", "inductor", inductance, "1", "2"),
            component("R1", "resistor", resistance, "2", "0"),
        ]);
        let result = solve_ac_sweep(
            &circuit,
            &AcSweepSettings {
                f_start: frequency,
                f_end: frequency,
                points_per_decade: 1,
                op_guess: None,
            },
        )?;
        let actual = result
            .node_phases
            .get("2")
            .and_then(|values| values.first())
            .copied()
            .ok_or("Falta fase AC")?;
        records.push(record(
            records.len(),
            "ac-rl-cutoff",
            "AC",
            BTreeMap::from([
                ("resistance".into(), resistance),
                ("inductance".into(), inductance),
                ("frequency".into(), frequency),
            ]),
            actual,
            -45.0,
            2e-5,
        ));
    }

    for index in 0..RUNS_PER_FAMILY {
        let vin = 1.0 + (index % 19) as f64 * 0.3;
        let resistance = parameter(1_000.0, index, 0.015);
        let capacitance = parameter(1e-6, 99 - index, 0.012);
        let tau = resistance * capacitance;
        let circuit = netlist(vec![
            component("V1", "vsource", vin, "1", "0"),
            component("R1", "resistor", resistance, "1", "2"),
            component("C1", "capacitor", capacitance, "2", "0"),
            ComponentData {
                id: "ic1".to_string(),
                comp_type: "ic_directive".to_string(),
                pins: vec!["2".to_string()],
                value: 0.0,
                ..Default::default()
            },
        ]);
        let result = solve_transient_circuit(
            &circuit,
            &TransientSettings {
                dt: tau / 100.0,
                t_max: tau,
                fixed_step: Some(true),
                integration_method: Some("trap".to_string()),
            },
        )?;
        let actual = result
            .iter()
            .min_by(|left, right| (left.time - tau).abs().total_cmp(&(right.time - tau).abs()))
            .and_then(|step| step.node_voltages.get("2"))
            .copied()
            .ok_or("Falta voltaje transitorio")?;
        let expected = vin * (1.0 - (-1.0_f64).exp());
        records.push(record(
            records.len(),
            "transient-rc-tau",
            "TRAN",
            BTreeMap::from([
                ("vin".into(), vin),
                ("resistance".into(), resistance),
                ("capacitance".into(), capacitance),
                ("tau".into(), tau),
            ]),
            actual,
            expected,
            expected.abs() * 1e-3 + 1e-9,
        ));
    }
    Ok(records)
}

fn report_paths() -> (PathBuf, PathBuf) {
    let root = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("validation")
        .join("reports");
    (
        root.join("phase5-campaign.json"),
        root.join("phase5-campaign.md"),
    )
}

fn main() -> Result<(), String> {
    let started = Instant::now();
    let records = run_campaign()?;
    let serialized_dataset = serde_json::to_vec(&records).map_err(|error| error.to_string())?;
    let dataset_sha256 = format!("{:x}", Sha256::digest(&serialized_dataset));
    let families: BTreeSet<_> = records.iter().map(|record| record.family.clone()).collect();
    let sessions: BTreeSet<_> = records
        .iter()
        .map(|record| record.session_id.clone())
        .collect();
    let analyses: BTreeSet<_> = records
        .iter()
        .map(|record| record.analysis.clone())
        .collect();
    let unique_parameters: BTreeSet<_> = records
        .iter()
        .map(|record| serde_json::to_string(&record.parameters).unwrap_or_default())
        .collect();
    let passed_executions = records.iter().filter(|record| record.passed).count();
    let family_summaries = families
        .iter()
        .map(|family| {
            let matching: Vec<_> = records
                .iter()
                .filter(|record| &record.family == family)
                .collect();
            FamilySummary {
                family: family.clone(),
                analysis: matching
                    .first()
                    .map(|record| record.analysis.clone())
                    .unwrap_or_default(),
                executions: matching.len(),
                passed: matching.iter().filter(|record| record.passed).count(),
                maximum_absolute_error: matching
                    .iter()
                    .map(|record| record.absolute_error)
                    .fold(0.0, f64::max),
            }
        })
        .collect::<Vec<_>>();
    let passed = records.len() == REQUIRED_RUNS
        && unique_parameters.len() == REQUIRED_RUNS
        && sessions.len() >= 20
        && families.len() >= 5
        && analyses.len() >= 3
        && passed_executions == records.len();
    let report = CampaignReport {
        schema_version: 1,
        campaign_id: "phase5-local-solver-diversity-v1".to_string(),
        generated_at_unix_seconds: SystemTime::now().duration_since(UNIX_EPOCH).map_err(|error| error.to_string())?.as_secs(),
        solver_version: env!("CARGO_PKG_VERSION").to_string(),
        dataset_sha256,
        execution_count: records.len(),
        unique_parameter_sets: unique_parameters.len(),
        session_count: sessions.len(),
        family_count: families.len(),
        analysis_modes: analyses.into_iter().collect(),
        passed,
        passed_executions,
        failed_executions: records.len() - passed_executions,
        elapsed_milliseconds: started.elapsed().as_millis(),
        families: family_summaries,
        records,
        limitations: vec![
            "Campaña automatizada local; no representa decisiones ni aceptación de usuarios reales.".to_string(),
            "Cinco familias paramétricas no cubren todo el espacio de circuitos, modelos o hardware.".to_string(),
            "Las sesiones de campaña son lotes cronológicos reproducibles, no sesiones futuras de campo.".to_string(),
        ],
    };
    let (json_path, markdown_path) = report_paths();
    fs::create_dir_all(json_path.parent().ok_or("Ruta de reporte inválida")?)
        .map_err(|error| error.to_string())?;
    fs::write(
        &json_path,
        serde_json::to_vec_pretty(&report).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;
    let mut markdown = format!(
        "# Campaña local de diversidad — Fase 5\n\nResultado: **{}** — {}/{} ejecuciones dentro de tolerancia.\n\n- Dataset SHA-256: `{}`\n- Parámetros únicos: {}\n- Sesiones cronológicas: {}\n- Familias: {}\n- Modos de análisis: {}\n- Tiempo: {} ms\n\n| Familia | Análisis | Ejecuciones | Aprobadas | Error absoluto máximo |\n|---|---:|---:|---:|---:|\n",
        if report.passed { "PASS" } else { "FAIL" }, report.passed_executions, report.execution_count,
        report.dataset_sha256, report.unique_parameter_sets, report.session_count, report.family_count,
        report.analysis_modes.join(", "), report.elapsed_milliseconds,
    );
    for family in &report.families {
        markdown.push_str(&format!(
            "| {} | {} | {} | {} | {:.6e} |\n",
            family.family,
            family.analysis,
            family.executions,
            family.passed,
            family.maximum_absolute_error
        ));
    }
    markdown.push_str("\n## Límites\n\n");
    for limitation in &report.limitations {
        markdown.push_str(&format!("- {limitation}\n"));
    }
    fs::write(&markdown_path, markdown).map_err(|error| error.to_string())?;
    println!(
        "{}: {}/{}; sha256={}",
        if report.passed { "PASS" } else { "FAIL" },
        report.passed_executions,
        report.execution_count,
        report.dataset_sha256
    );
    if report.passed {
        Ok(())
    } else {
        Err("La campaña no superó sus gates".to_string())
    }
}
