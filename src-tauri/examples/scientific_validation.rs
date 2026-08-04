use astryd_sophia_lib::solver::{
    run_stability_analysis, solve_ac_sweep, solve_dc_circuit_with_numerical_settings,
    solve_dc_sweep, solve_pss, solve_transient_circuit_with_numerical_settings, AcSweepResult,
    AcSweepSettings, CircuitNetlist, DcSweepResult, DcSweepSettings, PssSettings, SimulationResult,
    SolverNumericalSettings, TimeStepResult, TransientSettings,
};
use num_complex::Complex64;
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fmt::Write as _;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

const SCHEMA_VERSION: u32 = 1;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SuiteManifest {
    schema_version: u32,
    suite_id: String,
    title: String,
    cases: Vec<String>,
    reports: ReportPaths,
}

#[derive(Deserialize)]
struct ReportPaths {
    json: String,
    markdown: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ValidationCase {
    schema_version: u32,
    id: String,
    title: String,
    rationale: String,
    analysis: AnalysisSpec,
    netlist: CircuitNetlist,
    observations: Vec<ObservationSpec>,
    reference: String,
    #[serde(default)]
    external_reference: Option<ExternalReferenceSpec>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExternalReferenceSpec {
    engine: String,
    fixture: String,
}

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
enum AnalysisSpec {
    Dc {
        tolerance: f64,
        #[serde(rename = "maxIterations")]
        max_iterations: usize,
    },
    DcSweep {
        #[serde(rename = "sourceId")]
        source_id: String,
        #[serde(rename = "vStart")]
        v_start: f64,
        #[serde(rename = "vEnd")]
        v_end: f64,
        #[serde(rename = "vStep")]
        v_step: f64,
    },
    Ac {
        #[serde(rename = "fStart")]
        f_start: f64,
        #[serde(rename = "fEnd")]
        f_end: f64,
        #[serde(rename = "pointsPerDecade")]
        points_per_decade: usize,
    },
    Transient {
        dt: f64,
        #[serde(rename = "tMax")]
        t_max: f64,
        #[serde(rename = "fixedStep")]
        fixed_step: bool,
        #[serde(rename = "integrationMethod")]
        integration_method: String,
        tolerance: f64,
        #[serde(rename = "maxIterations")]
        max_iterations: usize,
    },
    Pss {
        period: f64,
        #[serde(rename = "maxShootingIters")]
        max_shooting_iters: usize,
        #[serde(rename = "shootingTolerance")]
        shooting_tolerance: f64,
    },
    Stability,
}

impl AnalysisSpec {
    fn name(&self) -> &'static str {
        match self {
            Self::Dc { .. } => "DC",
            Self::DcSweep { .. } => "DC SWEEP",
            Self::Ac { .. } => "AC",
            Self::Transient { .. } => "TRAN",
            Self::Pss { .. } => "PSS",
            Self::Stability => "STABILITY",
        }
    }
}

#[derive(Deserialize)]
#[serde(tag = "quantity", rename_all = "snake_case")]
enum ObservationSpec {
    NodeVoltage {
        id: String,
        node: String,
    },
    DcKclResidual {
        id: String,
        node: String,
    },
    DcSweepNodeVoltage {
        id: String,
        node: String,
        #[serde(rename = "sourceValue")]
        source_value: f64,
    },
    DcSweepBranchCurrent {
        id: String,
        source: String,
        #[serde(rename = "sourceValue")]
        source_value: f64,
    },
    NodeAmplitudeDb {
        id: String,
        node: String,
        #[serde(rename = "frequencyHz")]
        frequency_hz: f64,
    },
    NodePhaseDegrees {
        id: String,
        node: String,
        #[serde(rename = "frequencyHz")]
        frequency_hz: f64,
    },
    AcKclResidual {
        id: String,
        node: String,
        #[serde(rename = "frequencyHz")]
        frequency_hz: f64,
    },
    TransientNodeVoltage {
        id: String,
        node: String,
        #[serde(rename = "timeSeconds")]
        time_seconds: f64,
    },
    TransientBranchCurrent {
        id: String,
        source: String,
        #[serde(rename = "timeSeconds")]
        time_seconds: f64,
    },
    TransientKclResidual {
        id: String,
        node: String,
        #[serde(rename = "timeSeconds")]
        time_seconds: f64,
    },
    PssNodePeakToPeak {
        id: String,
        node: String,
    },
    PoleReal {
        id: String,
        index: usize,
    },
    ZeroReal {
        id: String,
        index: usize,
    },
    StabilityFlag {
        id: String,
    },
}

impl ObservationSpec {
    fn id(&self) -> &str {
        match self {
            Self::NodeVoltage { id, .. }
            | Self::DcKclResidual { id, .. }
            | Self::DcSweepNodeVoltage { id, .. }
            | Self::DcSweepBranchCurrent { id, .. }
            | Self::NodeAmplitudeDb { id, .. }
            | Self::NodePhaseDegrees { id, .. }
            | Self::AcKclResidual { id, .. }
            | Self::TransientNodeVoltage { id, .. }
            | Self::TransientBranchCurrent { id, .. }
            | Self::TransientKclResidual { id, .. }
            | Self::PssNodePeakToPeak { id, .. }
            | Self::PoleReal { id, .. }
            | Self::ZeroReal { id, .. }
            | Self::StabilityFlag { id, .. } => id,
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReferenceDocument {
    schema_version: u32,
    case_id: String,
    method: String,
    source: String,
    observations: Vec<ReferenceObservation>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReferenceObservation {
    id: String,
    expected: f64,
    absolute_tolerance: f64,
    relative_tolerance: f64,
    units: String,
    expression: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ValidationReport {
    schema_version: u32,
    suite_id: String,
    title: String,
    generated_at_unix_seconds: u64,
    solver_version: String,
    git_head: String,
    git_worktree: String,
    platform: String,
    external_reference_status: ExternalReferenceStatus,
    passed: bool,
    passed_cases: usize,
    failed_cases: usize,
    passed_observations: usize,
    failed_observations: usize,
    cases: Vec<CaseReport>,
    limitations: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ExternalReferenceStatus {
    ngspice: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CaseReport {
    id: String,
    title: String,
    analysis: String,
    rationale: String,
    reference_method: String,
    reference_source: String,
    passed: bool,
    error: Option<String>,
    observations: Vec<ObservationReport>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ObservationReport {
    id: String,
    actual: f64,
    expected: f64,
    absolute_error: f64,
    relative_error: Option<f64>,
    allowed_error: f64,
    units: String,
    expression: String,
    coordinate: Option<ObservationCoordinate>,
    passed: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ObservationCoordinate {
    name: String,
    requested: f64,
    sampled: f64,
    units: String,
}

struct ActualObservation {
    id: String,
    value: f64,
    coordinate: Option<ObservationCoordinate>,
}

fn main() {
    if let Err(error) = run() {
        eprintln!("Error de infraestructura de validación: {error}");
        std::process::exit(2);
    }
}

fn run() -> Result<(), String> {
    let manifest_arg = std::env::args()
        .nth(1)
        .unwrap_or_else(|| "validation/manifest.json".to_string());
    let manifest_path = PathBuf::from(manifest_arg);
    let manifest: SuiteManifest = load_json(&manifest_path)?;
    validate_schema(manifest.schema_version, &manifest_path)?;
    if manifest.cases.is_empty() {
        return Err("El manifiesto no contiene casos.".to_string());
    }

    let manifest_dir = manifest_path.parent().unwrap_or_else(|| Path::new("."));
    let mut seen_case_ids = HashSet::new();
    let mut case_reports = Vec::new();

    for case_relative_path in &manifest.cases {
        let case_path = manifest_dir.join(case_relative_path);
        let case: ValidationCase = load_json(&case_path)?;
        validate_schema(case.schema_version, &case_path)?;
        if !seen_case_ids.insert(case.id.clone()) {
            return Err(format!("ID de caso duplicado: {}", case.id));
        }
        validate_unique_observation_ids(&case)?;

        let reference_path = case_path
            .parent()
            .unwrap_or(manifest_dir)
            .join(&case.reference);
        let reference: ReferenceDocument = load_json(&reference_path)?;
        validate_schema(reference.schema_version, &reference_path)?;
        if reference.case_id != case.id {
            return Err(format!(
                "La referencia {} declara caseId={} pero el caso es {}.",
                reference_path.display(),
                reference.case_id,
                case.id
            ));
        }

        let case_report = evaluate_case(
            &case,
            &reference,
            case_path.parent().unwrap_or(manifest_dir),
        );
        println!(
            "[{}] {} — {}",
            if case_report.passed { "PASS" } else { "FAIL" },
            case.id,
            case.title
        );
        if let Some(error) = &case_report.error {
            println!("       {error}");
        }
        case_reports.push(case_report);
    }

    let passed_cases = case_reports.iter().filter(|case| case.passed).count();
    let failed_cases = case_reports.len() - passed_cases;
    let passed_observations = case_reports
        .iter()
        .flat_map(|case| &case.observations)
        .filter(|observation| observation.passed)
        .count();
    let failed_observations = case_reports
        .iter()
        .flat_map(|case| &case.observations)
        .filter(|observation| !observation.passed)
        .count();
    let report = ValidationReport {
        schema_version: SCHEMA_VERSION,
        suite_id: manifest.suite_id,
        title: manifest.title,
        generated_at_unix_seconds: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|error| error.to_string())?
            .as_secs(),
        solver_version: env!("CARGO_PKG_VERSION").to_string(),
        git_head: git_head(),
        git_worktree: git_worktree_status(),
        platform: format!("{}-{}", std::env::consts::OS, std::env::consts::ARCH),
        external_reference_status: ExternalReferenceStatus {
            ngspice: ngspice_status(),
        },
        passed: failed_cases == 0,
        passed_cases,
        failed_cases,
        passed_observations,
        failed_observations,
        cases: case_reports,
        limitations: vec![
            "La correlación ngspice cubre únicamente los casos marcados como referencia externa; el resto conserva referencias analíticas cerradas."
                .to_string(),
            "El solver no emite un punto de operación separado en t=0; la primera muestra publicada es la primera solución integrada en t=dt."
                .to_string(),
            "El caso externo de diodo correlaciona un modelo ideal de Shockley configurado de forma equivalente; no valida alta inyección, ruptura, resistencia serie ni un dispositivo físico."
                .to_string(),
            "La matriz principal valida un caso PSS lineal y una extracción reducida de polos/ceros, pero no valida ruido, sensibilidad, estabilidad de lazo ni MCU."
                .to_string(),
            "La caracterización BSIM3 separada cuantifica una discrepancia de corriente frente a ngspice y no certifica el modelo."
                .to_string(),
            "Aprobar la suite sólo demuestra conformidad con los casos, residuos y tolerancias versionados."
                .to_string(),
        ],
    };

    let json_path = manifest_dir.join(&manifest.reports.json);
    let markdown_path = manifest_dir.join(&manifest.reports.markdown);
    write_report_json(&json_path, &report)?;
    write_report_markdown(&markdown_path, &report)?;
    println!("Reporte JSON: {}", json_path.display());
    println!("Reporte Markdown: {}", markdown_path.display());
    println!(
        "Resultado: {}/{} casos aprobados.",
        report.passed_cases,
        report.cases.len()
    );

    if !report.passed {
        std::process::exit(1);
    }
    Ok(())
}

fn evaluate_case(
    case: &ValidationCase,
    reference: &ReferenceDocument,
    case_dir: &Path,
) -> CaseReport {
    let base = |passed, error, observations| CaseReport {
        id: case.id.clone(),
        title: case.title.clone(),
        analysis: case.analysis.name().to_string(),
        rationale: case.rationale.clone(),
        reference_method: reference.method.clone(),
        reference_source: reference.source.clone(),
        passed,
        error,
        observations,
    };

    let actuals = match run_solver(case) {
        Ok(actuals) => actuals,
        Err(error) => return base(false, Some(error), Vec::new()),
    };
    let external_values = match &case.external_reference {
        Some(spec) => match run_external_reference(case, spec, case_dir) {
            Ok(values) => Some(values),
            Err(error) => return base(false, Some(error), Vec::new()),
        },
        None => None,
    };

    let references = match reference_map(reference) {
        Ok(references) => references,
        Err(error) => return base(false, Some(error), Vec::new()),
    };
    if actuals.len() != references.len() {
        return base(
            false,
            Some(format!(
                "El caso produjo {} observaciones y la referencia contiene {}.",
                actuals.len(),
                references.len()
            )),
            Vec::new(),
        );
    }

    let mut reports = Vec::new();
    for actual in actuals {
        let Some(reference_observation) = references.get(actual.id.as_str()) else {
            return base(
                false,
                Some(format!(
                    "Falta la observación {} en el documento de referencia.",
                    actual.id
                )),
                reports,
            );
        };
        let expected = match &external_values {
            Some(values) => match values.get(actual.id.as_str()) {
                Some(value) => *value,
                None => {
                    return base(
                        false,
                        Some(format!(
                            "ngspice no produjo la observación externa {}.",
                            actual.id
                        )),
                        reports,
                    )
                }
            },
            None => reference_observation.expected,
        };
        let (absolute_error, relative_error, allowed_error, passed) = error_metrics_values(
            actual.value,
            expected,
            reference_observation.absolute_tolerance,
            reference_observation.relative_tolerance,
        );
        reports.push(ObservationReport {
            id: actual.id,
            actual: actual.value,
            expected,
            absolute_error,
            relative_error,
            allowed_error,
            units: reference_observation.units.clone(),
            expression: reference_observation.expression.clone(),
            coordinate: actual.coordinate,
            passed,
        });
    }

    base(
        reports.iter().all(|observation| observation.passed),
        None,
        reports,
    )
}

#[cfg(test)]
fn error_metrics(actual: f64, reference: &ReferenceObservation) -> (f64, Option<f64>, f64, bool) {
    error_metrics_values(
        actual,
        reference.expected,
        reference.absolute_tolerance,
        reference.relative_tolerance,
    )
}

fn error_metrics_values(
    actual: f64,
    expected: f64,
    absolute_tolerance: f64,
    relative_tolerance: f64,
) -> (f64, Option<f64>, f64, bool) {
    let absolute_error = (actual - expected).abs();
    let relative_error = if expected.abs() > f64::EPSILON {
        Some(absolute_error / expected.abs())
    } else {
        None
    };
    let allowed_error = absolute_tolerance.max(relative_tolerance * expected.abs());
    let passed = actual.is_finite() && expected.is_finite() && absolute_error <= allowed_error;
    (absolute_error, relative_error, allowed_error, passed)
}

struct NgspiceRaw {
    variables: Vec<String>,
    points: Vec<Vec<Complex64>>,
}

fn run_external_reference(
    case: &ValidationCase,
    spec: &ExternalReferenceSpec,
    case_dir: &Path,
) -> Result<HashMap<String, f64>, String> {
    if spec.engine != "ngspice" {
        return Err(format!(
            "Motor de referencia externa no soportado: {}.",
            spec.engine
        ));
    }
    let executable = find_ngspice_executable().ok_or_else(|| {
        "El caso exige ngspice, pero no se encontró NGSPICE_BIN, ngspice en PATH ni el binario portátil de validation/.tools."
            .to_string()
    })?;
    let fixture = case_dir
        .join(&spec.fixture)
        .canonicalize()
        .map_err(|error| {
            format!(
                "No se pudo resolver el fixture ngspice {}: {error}",
                case_dir.join(&spec.fixture).display()
            )
        })?;
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_nanos();
    let raw_path = std::env::temp_dir().join(format!("astryd-ngspice-{}-{nonce}.raw", case.id));
    let output = Command::new(&executable)
        .arg("-b")
        .arg("-a")
        .arg("-r")
        .arg(&raw_path)
        .arg(&fixture)
        .output()
        .map_err(|error| {
            format!(
                "No se pudo ejecutar ngspice para {}: {error}",
                fixture.display()
            )
        })?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        return Err(format!(
            "ngspice falló para {} ({}): {} {}",
            fixture.display(),
            output.status,
            stdout.trim(),
            stderr.trim()
        ));
    }
    let raw_text = fs::read_to_string(&raw_path)
        .map_err(|error| format!("No se pudo leer {}: {error}", raw_path.display()));
    let _ = fs::remove_file(&raw_path);
    let raw = parse_ngspice_ascii_raw(&raw_text?)?;

    case.observations
        .iter()
        .map(|observation| {
            Ok((
                observation.id().to_string(),
                external_observation_value(observation, &raw)?,
            ))
        })
        .collect()
}

fn external_observation_value(
    observation: &ObservationSpec,
    raw: &NgspiceRaw,
) -> Result<f64, String> {
    match observation {
        ObservationSpec::NodeVoltage { node, .. } => {
            Ok(raw_sample(raw, &format!("v({})", node.to_lowercase()), None)?.re)
        }
        ObservationSpec::DcSweepNodeVoltage {
            node, source_value, ..
        } => Ok(raw_sample(
            raw,
            &format!("v({})", node.to_lowercase()),
            Some(*source_value),
        )?
        .re),
        ObservationSpec::DcSweepBranchCurrent {
            source,
            source_value,
            ..
        } => Ok(raw_sample(
            raw,
            &format!("i({})", source.to_lowercase()),
            Some(*source_value),
        )?
        .re),
        ObservationSpec::NodeAmplitudeDb {
            node, frequency_hz, ..
        } => {
            let magnitude = raw_sample(
                raw,
                &format!("v({})", node.to_lowercase()),
                Some(*frequency_hz),
            )?
            .norm();
            if magnitude <= 0.0 {
                return Err(format!("ngspice produjo amplitud nula en el nodo {node}."));
            }
            Ok(20.0 * magnitude.log10())
        }
        ObservationSpec::NodePhaseDegrees {
            node, frequency_hz, ..
        } => Ok(raw_sample(
            raw,
            &format!("v({})", node.to_lowercase()),
            Some(*frequency_hz),
        )?
        .arg()
        .to_degrees()),
        ObservationSpec::TransientNodeVoltage {
            node, time_seconds, ..
        } => Ok(raw_sample(
            raw,
            &format!("v({})", node.to_lowercase()),
            Some(*time_seconds),
        )?
        .re),
        ObservationSpec::TransientBranchCurrent {
            source,
            time_seconds,
            ..
        } => Ok(raw_sample(
            raw,
            &format!("i({})", source.to_lowercase()),
            Some(*time_seconds),
        )?
        .re),
        ObservationSpec::DcKclResidual { .. }
        | ObservationSpec::AcKclResidual { .. }
        | ObservationSpec::TransientKclResidual { .. }
        | ObservationSpec::PssNodePeakToPeak { .. }
        | ObservationSpec::PoleReal { .. }
        | ObservationSpec::ZeroReal { .. }
        | ObservationSpec::StabilityFlag { .. } => Err(format!(
            "La observación {} es un residuo interno y no puede usarse como magnitud externa de ngspice.",
            observation.id()
        )),
    }
}

fn parse_ngspice_ascii_raw(contents: &str) -> Result<NgspiceRaw, String> {
    let lines: Vec<&str> = contents.lines().collect();
    let variable_count = parse_raw_header_usize(&lines, "No. Variables:")?;
    let point_count = parse_raw_header_usize(&lines, "No. Points:")?;
    let variables_start = lines
        .iter()
        .position(|line| line.trim() == "Variables:")
        .ok_or_else(|| "El raw de ngspice no contiene Variables:.".to_string())?
        + 1;
    let values_start = lines
        .iter()
        .position(|line| line.trim() == "Values:")
        .ok_or_else(|| "El raw de ngspice no contiene Values:.".to_string())?
        + 1;
    if values_start <= variables_start || values_start - variables_start - 1 != variable_count {
        return Err("La tabla de variables del raw de ngspice es inconsistente.".to_string());
    }
    let variables = lines[variables_start..variables_start + variable_count]
        .iter()
        .map(|line| {
            line.split_whitespace()
                .nth(1)
                .map(str::to_lowercase)
                .ok_or_else(|| format!("Variable ngspice inválida: {line}"))
        })
        .collect::<Result<Vec<_>, _>>()?;
    let tokens: Vec<&str> = lines[values_start..]
        .iter()
        .flat_map(|line| line.split_whitespace())
        .collect();
    let expected_tokens = point_count * (variable_count + 1);
    if tokens.len() != expected_tokens {
        return Err(format!(
            "El raw de ngspice contiene {} tokens de datos; se esperaban {}.",
            tokens.len(),
            expected_tokens
        ));
    }
    let mut cursor = 0usize;
    let mut points = Vec::with_capacity(point_count);
    for expected_index in 0..point_count {
        let parsed_index = tokens[cursor]
            .parse::<usize>()
            .map_err(|error| format!("Índice de punto ngspice inválido: {error}"))?;
        if parsed_index != expected_index {
            return Err(format!(
                "El raw de ngspice saltó del punto {expected_index} al {parsed_index}."
            ));
        }
        cursor += 1;
        let mut point = Vec::with_capacity(variable_count);
        for _ in 0..variable_count {
            point.push(parse_raw_complex(tokens[cursor])?);
            cursor += 1;
        }
        points.push(point);
    }
    Ok(NgspiceRaw { variables, points })
}

fn parse_raw_header_usize(lines: &[&str], prefix: &str) -> Result<usize, String> {
    lines
        .iter()
        .find_map(|line| line.trim().strip_prefix(prefix))
        .ok_or_else(|| format!("El raw de ngspice no contiene {prefix}"))?
        .trim()
        .parse::<usize>()
        .map_err(|error| format!("Cabecera {prefix} inválida: {error}"))
}

fn parse_raw_complex(token: &str) -> Result<Complex64, String> {
    if let Some((real, imaginary)) = token.split_once(',') {
        Ok(Complex64::new(
            real.parse::<f64>()
                .map_err(|error| format!("Parte real ngspice inválida: {error}"))?,
            imaginary
                .parse::<f64>()
                .map_err(|error| format!("Parte imaginaria ngspice inválida: {error}"))?,
        ))
    } else {
        Ok(Complex64::new(
            token
                .parse::<f64>()
                .map_err(|error| format!("Valor ngspice inválido: {error}"))?,
            0.0,
        ))
    }
}

fn raw_sample(
    raw: &NgspiceRaw,
    variable: &str,
    coordinate: Option<f64>,
) -> Result<Complex64, String> {
    let variable_index = raw
        .variables
        .iter()
        .position(|candidate| candidate == variable)
        .ok_or_else(|| format!("El raw de ngspice no contiene la variable {variable}."))?;
    let Some(target) = coordinate else {
        return raw
            .points
            .last()
            .map(|point| point[variable_index])
            .ok_or_else(|| "El raw de ngspice no contiene puntos.".to_string());
    };
    if raw.points.is_empty() || raw.variables.is_empty() {
        return Err("El raw de ngspice no contiene una escala.".to_string());
    }
    let axis = |point: &[Complex64]| point[0].re;
    let tolerance = (target.abs() * 1e-10).max(1e-15);
    for point in &raw.points {
        if (axis(point) - target).abs() <= tolerance {
            return Ok(point[variable_index]);
        }
    }
    for pair in raw.points.windows(2) {
        let left = axis(&pair[0]);
        let right = axis(&pair[1]);
        if left <= target && target <= right && right > left {
            let weight = (target - left) / (right - left);
            return Ok(pair[0][variable_index] * (1.0 - weight) + pair[1][variable_index] * weight);
        }
    }
    Err(format!(
        "ngspice no cubre la coordenada {target}; rango disponible [{}, {}].",
        axis(&raw.points[0]),
        axis(raw.points.last().unwrap())
    ))
}

fn find_ngspice_executable() -> Option<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(configured) = std::env::var_os("NGSPICE_BIN") {
        candidates.push(PathBuf::from(configured));
    }
    candidates.push(PathBuf::from("ngspice"));
    if cfg!(windows) {
        candidates.push(PathBuf::from("ngspice_con.exe"));
        candidates.push(PathBuf::from(
            "validation/.tools/Spice64/bin/ngspice_con.exe",
        ));
    }
    candidates.into_iter().find(|candidate| {
        Command::new(candidate)
            .arg("--version")
            .output()
            .is_ok_and(|output| output.status.success())
    })
}

fn ngspice_version(executable: &Path) -> Option<String> {
    let output = Command::new(executable).arg("--version").output().ok()?;
    if !output.status.success() {
        return None;
    }
    let combined = format!(
        "{}\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    combined
        .lines()
        .map(str::trim)
        .find(|line| line.to_lowercase().contains("ngspice-"))
        .map(str::to_string)
}

fn run_solver(case: &ValidationCase) -> Result<Vec<ActualObservation>, String> {
    match &case.analysis {
        AnalysisSpec::Dc {
            tolerance,
            max_iterations,
        } => {
            let result = solve_dc_circuit_with_numerical_settings(
                &case.netlist,
                SolverNumericalSettings {
                    tolerance: *tolerance,
                    max_iterations: *max_iterations,
                },
            )?;
            case.observations
                .iter()
                .map(|observation| match observation {
                    ObservationSpec::NodeVoltage { id, node } => {
                        let value = result.node_voltages.get(node).copied().ok_or_else(|| {
                            format!("El resultado DC no contiene el nodo {node}.")
                        })?;
                        finite_actual(id, value, None)
                    }
                    ObservationSpec::DcKclResidual { id, node } => {
                        finite_actual(id, dc_kcl_residual(&case.netlist, &result, node)?, None)
                    }
                    _ => Err(format!(
                        "La observación {} no es compatible con análisis DC.",
                        observation.id()
                    )),
                })
                .collect()
        }
        AnalysisSpec::DcSweep {
            source_id,
            v_start,
            v_end,
            v_step,
        } => {
            let result = solve_dc_sweep(
                &case.netlist,
                &DcSweepSettings {
                    source_id: source_id.clone(),
                    v_start: *v_start,
                    v_end: *v_end,
                    v_step: *v_step,
                },
            )?;
            case.observations
                .iter()
                .map(|observation| match observation {
                    ObservationSpec::DcSweepNodeVoltage {
                        id,
                        node,
                        source_value,
                    } => {
                        let index = dc_sweep_index(&result, *source_value, *v_step)?;
                        let value = result
                            .node_voltages
                            .get(node)
                            .and_then(|values| values.get(index))
                            .copied()
                            .ok_or_else(|| {
                                format!("El barrido DC no contiene tensión para el nodo {node}.")
                            })?;
                        finite_actual(
                            id,
                            value,
                            Some(ObservationCoordinate {
                                name: "source_value".to_string(),
                                requested: *source_value,
                                sampled: result.sweep_voltages[index],
                                units: "V".to_string(),
                            }),
                        )
                    }
                    ObservationSpec::DcSweepBranchCurrent {
                        id,
                        source,
                        source_value,
                    } => {
                        let index = dc_sweep_index(&result, *source_value, *v_step)?;
                        let value = result
                            .branch_currents
                            .get(source)
                            .and_then(|values| values.get(index))
                            .copied()
                            .ok_or_else(|| {
                                format!(
                                    "El barrido DC no contiene corriente para la fuente {source}."
                                )
                            })?;
                        finite_actual(
                            id,
                            value,
                            Some(ObservationCoordinate {
                                name: "source_value".to_string(),
                                requested: *source_value,
                                sampled: result.sweep_voltages[index],
                                units: "V".to_string(),
                            }),
                        )
                    }
                    _ => Err(format!(
                        "La observación {} no es compatible con barrido DC.",
                        observation.id()
                    )),
                })
                .collect()
        }
        AnalysisSpec::Ac {
            f_start,
            f_end,
            points_per_decade,
        } => {
            let result = solve_ac_sweep(
                &case.netlist,
                &AcSweepSettings {
                    f_start: *f_start,
                    f_end: *f_end,
                    points_per_decade: *points_per_decade,
                    op_guess: None,
                },
            )?;
            case.observations
                .iter()
                .map(|observation| match observation {
                    ObservationSpec::NodeAmplitudeDb {
                        id,
                        node,
                        frequency_hz,
                    } => {
                        let index = nearest_coordinate_index(&result.frequencies, *frequency_hz)?;
                        validate_coordinate(result.frequencies[index], *frequency_hz)?;
                        let value = result
                            .node_amplitudes
                            .get(node)
                            .and_then(|values| values.get(index))
                            .copied()
                            .ok_or_else(|| {
                                format!("El resultado AC no contiene amplitud para el nodo {node}.")
                            })?;
                        finite_actual(
                            id,
                            value,
                            Some(ObservationCoordinate {
                                name: "frequency".to_string(),
                                requested: *frequency_hz,
                                sampled: result.frequencies[index],
                                units: "Hz".to_string(),
                            }),
                        )
                    }
                    ObservationSpec::NodePhaseDegrees {
                        id,
                        node,
                        frequency_hz,
                    } => {
                        let index = nearest_coordinate_index(&result.frequencies, *frequency_hz)?;
                        validate_coordinate(result.frequencies[index], *frequency_hz)?;
                        let value = result
                            .node_phases
                            .get(node)
                            .and_then(|values| values.get(index))
                            .copied()
                            .ok_or_else(|| {
                                format!("El resultado AC no contiene fase para el nodo {node}.")
                            })?;
                        finite_actual(
                            id,
                            value,
                            Some(ObservationCoordinate {
                                name: "frequency".to_string(),
                                requested: *frequency_hz,
                                sampled: result.frequencies[index],
                                units: "Hz".to_string(),
                            }),
                        )
                    }
                    ObservationSpec::AcKclResidual {
                        id,
                        node,
                        frequency_hz,
                    } => {
                        let index = nearest_coordinate_index(&result.frequencies, *frequency_hz)?;
                        validate_coordinate(result.frequencies[index], *frequency_hz)?;
                        finite_actual(
                            id,
                            ac_kcl_residual(
                                &case.netlist,
                                &result,
                                node,
                                index,
                                result.frequencies[index],
                            )?,
                            Some(ObservationCoordinate {
                                name: "frequency".to_string(),
                                requested: *frequency_hz,
                                sampled: result.frequencies[index],
                                units: "Hz".to_string(),
                            }),
                        )
                    }
                    _ => Err(format!(
                        "La observación {} no es compatible con análisis AC.",
                        observation.id()
                    )),
                })
                .collect()
        }
        AnalysisSpec::Transient {
            dt,
            t_max,
            fixed_step,
            integration_method,
            tolerance,
            max_iterations,
        } => {
            let result = solve_transient_circuit_with_numerical_settings(
                &case.netlist,
                &TransientSettings {
                    dt: *dt,
                    t_max: *t_max,
                    fixed_step: Some(*fixed_step),
                    integration_method: Some(integration_method.clone()),
                },
                SolverNumericalSettings {
                    tolerance: *tolerance,
                    max_iterations: *max_iterations,
                },
            )?;
            let times: Vec<f64> = result.iter().map(|step| step.time).collect();
            case.observations
                .iter()
                .map(|observation| match observation {
                    ObservationSpec::TransientNodeVoltage {
                        id,
                        node,
                        time_seconds,
                    } => {
                        let index =
                            transient_sample_index(&result, &times, *time_seconds, *dt)?;
                        let value = result[index]
                            .node_voltages
                            .get(node)
                            .copied()
                            .ok_or_else(|| {
                                format!(
                                    "El resultado transitorio no contiene el nodo {node} en t={} s.",
                                    result[index].time
                                )
                            })?;
                        finite_actual(
                            id,
                            value,
                            Some(ObservationCoordinate {
                                name: "time".to_string(),
                                requested: *time_seconds,
                                sampled: result[index].time,
                                units: "s".to_string(),
                            }),
                        )
                    }
                    ObservationSpec::TransientBranchCurrent {
                        id,
                        source,
                        time_seconds,
                    } => {
                        let index =
                            transient_sample_index(&result, &times, *time_seconds, *dt)?;
                        let value = result[index]
                            .branch_currents
                            .get(source)
                            .copied()
                            .ok_or_else(|| {
                                format!(
                                    "El resultado transitorio no contiene la corriente de {source} en t={} s.",
                                    result[index].time
                                )
                            })?;
                        finite_actual(
                            id,
                            value,
                            Some(ObservationCoordinate {
                                name: "time".to_string(),
                                requested: *time_seconds,
                                sampled: result[index].time,
                                units: "s".to_string(),
                            }),
                        )
                    }
                    ObservationSpec::TransientKclResidual {
                        id,
                        node,
                        time_seconds,
                    } => {
                        let index =
                            transient_sample_index(&result, &times, *time_seconds, *dt)?;
                        finite_actual(
                            id,
                            transient_kcl_residual(&case.netlist, &result, node, index)?,
                            Some(ObservationCoordinate {
                                name: "time".to_string(),
                                requested: *time_seconds,
                                sampled: result[index].time,
                                units: "s".to_string(),
                            }),
                        )
                    }
                    _ => Err(format!(
                        "La observación {} no es compatible con análisis transitorio.",
                        observation.id()
                    )),
                })
                .collect()
        }
        AnalysisSpec::Pss {
            period,
            max_shooting_iters,
            shooting_tolerance,
        } => {
            let result = solve_pss(
                &case.netlist,
                &PssSettings {
                    period: *period,
                    max_shooting_iters: *max_shooting_iters,
                    shooting_tolerance: *shooting_tolerance,
                },
            )?;
            case.observations
                .iter()
                .map(|observation| match observation {
                    ObservationSpec::PssNodePeakToPeak { id, node } => {
                        let values = result
                            .iter()
                            .map(|step| {
                                step.node_voltages.get(node).copied().ok_or_else(|| {
                                    format!("El resultado PSS no contiene el nodo {node}.")
                                })
                            })
                            .collect::<Result<Vec<_>, _>>()?;
                        let minimum = values.iter().copied().fold(f64::INFINITY, f64::min);
                        let maximum = values.iter().copied().fold(f64::NEG_INFINITY, f64::max);
                        finite_actual(id, maximum - minimum, None)
                    }
                    _ => Err(format!(
                        "La observación {} no es compatible con análisis PSS.",
                        observation.id()
                    )),
                })
                .collect()
        }
        AnalysisSpec::Stability => {
            let result = run_stability_analysis(&case.netlist)?;
            case.observations
                .iter()
                .map(|observation| match observation {
                    ObservationSpec::PoleReal { id, index } => {
                        let value = result.poles.get(*index).ok_or_else(|| {
                            format!("El resultado no contiene el polo de índice {index}.")
                        })?;
                        finite_actual(id, value.re, None)
                    }
                    ObservationSpec::ZeroReal { id, index } => {
                        let value = result.zeros.get(*index).ok_or_else(|| {
                            format!("El resultado no contiene el cero de índice {index}.")
                        })?;
                        finite_actual(id, value.re, None)
                    }
                    ObservationSpec::StabilityFlag { id } => {
                        finite_actual(id, if result.is_stable { 1.0 } else { 0.0 }, None)
                    }
                    _ => Err(format!(
                        "La observación {} no es compatible con extracción de polos y ceros.",
                        observation.id()
                    )),
                })
                .collect()
        }
    }
}

fn dc_sweep_index(result: &DcSweepResult, source_value: f64, step: f64) -> Result<usize, String> {
    let index = nearest_coordinate_index(&result.sweep_voltages, source_value)?;
    if (result.sweep_voltages[index] - source_value).abs() > step.abs() * 0.51 + 1e-12 {
        return Err(format!(
            "No existe un punto de barrido suficientemente cercano a {source_value} V."
        ));
    }
    Ok(index)
}

fn transient_sample_index(
    result: &[TimeStepResult],
    times: &[f64],
    time_seconds: f64,
    dt: f64,
) -> Result<usize, String> {
    let index = nearest_coordinate_index(times, time_seconds)?;
    if (result[index].time - time_seconds).abs() > dt * 0.51 {
        return Err(format!(
            "No existe una muestra transitoria suficientemente cercana a t={time_seconds} s."
        ));
    }
    Ok(index)
}

fn dc_kcl_residual(
    netlist: &CircuitNetlist,
    result: &SimulationResult,
    node: &str,
) -> Result<f64, String> {
    let node_voltage = result
        .node_voltages
        .get(node)
        .copied()
        .ok_or_else(|| format!("El resultado DC no contiene el nodo {node}."))?;
    let mut residual = 0.0;
    let mut incident = 0usize;

    for component in &netlist.components {
        let Some((other_node, orientation)) = incident_connection(&component.pins, node) else {
            continue;
        };
        incident += 1;
        match component.comp_type.as_str() {
            "resistor" => {
                if component.value == 0.0 {
                    return Err(format!("{} tiene resistencia cero.", component.id));
                }
                let other_voltage = result
                    .node_voltages
                    .get(other_node)
                    .copied()
                    .ok_or_else(|| format!("Falta el nodo {other_node} en el resultado DC."))?;
                residual += (node_voltage - other_voltage) / component.value;
            }
            "vsource" => {
                let current = result.branch_currents.get(&component.id).ok_or_else(|| {
                    format!("Falta la corriente de {} en el resultado DC.", component.id)
                })?;
                residual += orientation * current;
            }
            "isource" => residual += orientation * component.value,
            "capacitor" => {}
            unsupported => {
                return Err(format!(
                    "El residuo KCL DC no admite {unsupported} incidente en el nodo {node}."
                ));
            }
        }
    }

    if incident == 0 {
        return Err(format!("El nodo {node} no tiene componentes incidentes."));
    }
    Ok(residual.abs())
}

fn ac_kcl_residual(
    netlist: &CircuitNetlist,
    result: &AcSweepResult,
    node: &str,
    index: usize,
    frequency_hz: f64,
) -> Result<f64, String> {
    let node_voltage = ac_node_phasor(result, node, index)?;
    let omega = 2.0 * std::f64::consts::PI * frequency_hz;
    let mut residual = Complex64::new(0.0, 0.0);
    let mut incident = 0usize;

    for component in &netlist.components {
        let Some((other_node, _)) = incident_connection(&component.pins, node) else {
            continue;
        };
        incident += 1;
        let admittance = match component.comp_type.as_str() {
            "resistor" if component.value != 0.0 => Complex64::new(1.0 / component.value, 0.0),
            "capacitor" => Complex64::new(0.0, omega * component.value),
            "inductor" if component.value != 0.0 => {
                Complex64::new(0.0, -1.0 / (omega * component.value))
            }
            unsupported => {
                return Err(format!(
                    "El residuo KCL AC no admite {unsupported} incidente en el nodo {node}."
                ));
            }
        };
        let other_voltage = ac_node_phasor(result, other_node, index)?;
        residual += (node_voltage - other_voltage) * admittance;
    }

    if incident == 0 {
        return Err(format!("El nodo {node} no tiene componentes incidentes."));
    }
    Ok(residual.norm())
}

fn ac_node_phasor(result: &AcSweepResult, node: &str, index: usize) -> Result<Complex64, String> {
    if node == "0" {
        return Ok(Complex64::new(0.0, 0.0));
    }
    let amplitude_db = result
        .node_amplitudes
        .get(node)
        .and_then(|values| values.get(index))
        .copied()
        .ok_or_else(|| format!("Falta amplitud AC para el nodo {node}."))?;
    let phase_degrees = result
        .node_phases
        .get(node)
        .and_then(|values| values.get(index))
        .copied()
        .ok_or_else(|| format!("Falta fase AC para el nodo {node}."))?;
    Ok(Complex64::from_polar(
        10.0f64.powf(amplitude_db / 20.0),
        phase_degrees.to_radians(),
    ))
}

fn transient_kcl_residual(
    netlist: &CircuitNetlist,
    result: &[TimeStepResult],
    node: &str,
    index: usize,
) -> Result<f64, String> {
    if index == 0 {
        return Err("El residuo KCL transitorio requiere una muestra previa.".to_string());
    }
    let current_step = &result[index];
    let previous_step = &result[index - 1];
    let delta_t = current_step.time - previous_step.time;
    if !delta_t.is_finite() || delta_t <= 0.0 {
        return Err("El paso temporal del residuo KCL es inválido.".to_string());
    }
    let node_voltage = current_step
        .node_voltages
        .get(node)
        .copied()
        .ok_or_else(|| format!("Falta el nodo {node} en la muestra transitoria."))?;
    let previous_node_voltage = previous_step
        .node_voltages
        .get(node)
        .copied()
        .ok_or_else(|| format!("Falta el nodo {node} en la muestra transitoria previa."))?;
    let mut residual = 0.0;
    let mut incident = 0usize;

    for component in &netlist.components {
        let Some((other_node, orientation)) = incident_connection(&component.pins, node) else {
            continue;
        };
        incident += 1;
        let other_voltage = current_step
            .node_voltages
            .get(other_node)
            .copied()
            .ok_or_else(|| format!("Falta el nodo {other_node} en la muestra transitoria."))?;
        match component.comp_type.as_str() {
            "resistor" if component.value != 0.0 => {
                residual += (node_voltage - other_voltage) / component.value;
            }
            "capacitor" => {
                let previous_other_voltage = previous_step
                    .node_voltages
                    .get(other_node)
                    .copied()
                    .ok_or_else(|| {
                    format!("Falta el nodo {other_node} en la muestra transitoria previa.")
                })?;
                let voltage_delta = (node_voltage - other_voltage)
                    - (previous_node_voltage - previous_other_voltage);
                residual += component.value * voltage_delta / delta_t;
            }
            "vsource" => {
                let current = current_step
                    .branch_currents
                    .get(&component.id)
                    .ok_or_else(|| {
                        format!(
                            "Falta la corriente de {} en la muestra transitoria.",
                            component.id
                        )
                    })?;
                residual += orientation * current;
            }
            "isource" if component.wave_type.is_none() => {
                residual += orientation * component.value;
            }
            unsupported => {
                return Err(format!(
                    "El residuo KCL transitorio no admite {unsupported} incidente en el nodo {node}."
                ));
            }
        }
    }

    if incident == 0 {
        return Err(format!("El nodo {node} no tiene componentes incidentes."));
    }
    Ok(residual.abs())
}

fn incident_connection<'a>(pins: &'a [String], node: &str) -> Option<(&'a str, f64)> {
    if pins.len() != 2 {
        return None;
    }
    if pins[0] == node {
        Some((pins[1].as_str(), 1.0))
    } else if pins[1] == node {
        Some((pins[0].as_str(), -1.0))
    } else {
        None
    }
}

fn finite_actual(
    id: &str,
    value: f64,
    coordinate: Option<ObservationCoordinate>,
) -> Result<ActualObservation, String> {
    if !value.is_finite() {
        return Err(format!("La observación {id} produjo NaN o infinito."));
    }
    Ok(ActualObservation {
        id: id.to_string(),
        value,
        coordinate,
    })
}

fn nearest_coordinate_index(values: &[f64], target: f64) -> Result<usize, String> {
    values
        .iter()
        .enumerate()
        .min_by(|(_, left), (_, right)| (*left - target).abs().total_cmp(&(*right - target).abs()))
        .map(|(index, _)| index)
        .ok_or_else(|| "El solver no devolvió coordenadas para la observación.".to_string())
}

fn validate_coordinate(sampled: f64, requested: f64) -> Result<(), String> {
    let tolerance = (requested.abs() * 1e-10).max(1e-12);
    if (sampled - requested).abs() > tolerance {
        return Err(format!(
            "La coordenada solicitada {requested} no coincide con la muestra más cercana {sampled}."
        ));
    }
    Ok(())
}

fn reference_map(
    reference: &ReferenceDocument,
) -> Result<HashMap<&str, &ReferenceObservation>, String> {
    let mut map = HashMap::new();
    for observation in &reference.observations {
        if !observation.expected.is_finite()
            || !observation.absolute_tolerance.is_finite()
            || observation.absolute_tolerance < 0.0
            || !observation.relative_tolerance.is_finite()
            || observation.relative_tolerance < 0.0
        {
            return Err(format!(
                "La referencia {} contiene valores o tolerancias inválidas.",
                observation.id
            ));
        }
        if map.insert(observation.id.as_str(), observation).is_some() {
            return Err(format!(
                "ID de observación duplicado en referencia: {}.",
                observation.id
            ));
        }
    }
    Ok(map)
}

fn validate_unique_observation_ids(case: &ValidationCase) -> Result<(), String> {
    if case.observations.is_empty() {
        return Err(format!("El caso {} no contiene observaciones.", case.id));
    }
    let mut ids = HashSet::new();
    for observation in &case.observations {
        if !ids.insert(observation.id()) {
            return Err(format!(
                "ID de observación duplicado en {}: {}.",
                case.id,
                observation.id()
            ));
        }
    }
    Ok(())
}

fn validate_schema(version: u32, path: &Path) -> Result<(), String> {
    if version != SCHEMA_VERSION {
        return Err(format!(
            "{} usa schemaVersion={version}; se requiere {SCHEMA_VERSION}.",
            path.display()
        ));
    }
    Ok(())
}

fn load_json<T: DeserializeOwned>(path: &Path) -> Result<T, String> {
    let contents = fs::read_to_string(path)
        .map_err(|error| format!("No se pudo leer {}: {error}", path.display()))?;
    serde_json::from_str(&contents)
        .map_err(|error| format!("JSON inválido en {}: {error}", path.display()))
}

fn write_report_json(path: &Path, report: &ValidationReport) -> Result<(), String> {
    ensure_parent(path)?;
    let mut json = serde_json::to_string_pretty(report)
        .map_err(|error| format!("No se pudo serializar el reporte: {error}"))?;
    json.push('\n');
    fs::write(path, json)
        .map_err(|error| format!("No se pudo escribir {}: {error}", path.display()))
}

fn write_report_markdown(path: &Path, report: &ValidationReport) -> Result<(), String> {
    ensure_parent(path)?;
    let mut markdown = String::new();
    writeln!(markdown, "# {}", report.title).unwrap();
    writeln!(markdown).unwrap();
    writeln!(
        markdown,
        "Resultado: **{}** — {}/{} casos aprobados.",
        if report.passed { "PASS" } else { "FAIL" },
        report.passed_cases,
        report.cases.len()
    )
    .unwrap();
    writeln!(
        markdown,
        "Observaciones: **{}/{}** dentro de tolerancia.",
        report.passed_observations,
        report.passed_observations + report.failed_observations
    )
    .unwrap();
    writeln!(markdown).unwrap();
    writeln!(markdown, "- Suite: `{}`", report.suite_id).unwrap();
    writeln!(markdown, "- Solver: `{}`", report.solver_version).unwrap();
    writeln!(
        markdown,
        "- Git: `{}` (`{}`)",
        report.git_head, report.git_worktree
    )
    .unwrap();
    writeln!(markdown, "- Plataforma: `{}`", report.platform).unwrap();
    writeln!(
        markdown,
        "- ngspice: `{}`",
        report.external_reference_status.ngspice
    )
    .unwrap();
    writeln!(markdown).unwrap();
    writeln!(
        markdown,
        "| Caso | Análisis | Observación | Actual | Esperado | Error absoluto | Límite | Estado |"
    )
    .unwrap();
    writeln!(markdown, "|---|---:|---|---:|---:|---:|---:|:---:|").unwrap();
    for case in &report.cases {
        if case.observations.is_empty() {
            writeln!(
                markdown,
                "| {} | {} | {} | — | — | — | — | FAIL |",
                escape_markdown(&case.id),
                case.analysis,
                escape_markdown(case.error.as_deref().unwrap_or("sin observaciones"))
            )
            .unwrap();
            continue;
        }
        for observation in &case.observations {
            writeln!(
                markdown,
                "| {} | {} | {} | {:.10e} {} | {:.10e} {} | {:.3e} | {:.3e} | {} |",
                escape_markdown(&case.id),
                case.analysis,
                escape_markdown(&observation.id),
                observation.actual,
                observation.units,
                observation.expected,
                observation.units,
                observation.absolute_error,
                observation.allowed_error,
                if observation.passed { "PASS" } else { "FAIL" }
            )
            .unwrap();
        }
    }
    writeln!(markdown).unwrap();
    writeln!(markdown, "## Referencias y derivaciones").unwrap();
    writeln!(markdown).unwrap();
    for case in &report.cases {
        writeln!(
            markdown,
            "- **{}** — {}: {}",
            escape_markdown(&case.id),
            escape_markdown(&case.reference_method),
            escape_markdown(&case.reference_source)
        )
        .unwrap();
        for observation in &case.observations {
            writeln!(
                markdown,
                "  - `{}`: {}",
                observation.id,
                escape_markdown(&observation.expression)
            )
            .unwrap();
        }
    }
    writeln!(markdown).unwrap();
    writeln!(markdown, "## Limitaciones").unwrap();
    writeln!(markdown).unwrap();
    for limitation in &report.limitations {
        writeln!(markdown, "- {}", escape_markdown(limitation)).unwrap();
    }

    fs::write(path, markdown)
        .map_err(|error| format!("No se pudo escribir {}: {error}", path.display()))
}

fn ensure_parent(path: &Path) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("No se pudo crear {}: {error}", parent.display()))?;
    }
    Ok(())
}

fn escape_markdown(value: &str) -> String {
    value.replace('|', "\\|").replace('\n', " ")
}

fn git_head() -> String {
    Command::new("git")
        .args(["rev-parse", "--short=12", "HEAD"])
        .output()
        .ok()
        .filter(|output| output.status.success())
        .and_then(|output| String::from_utf8(output.stdout).ok())
        .map(|output| output.trim().to_string())
        .filter(|output| !output.is_empty())
        .unwrap_or_else(|| "unknown".to_string())
}

fn git_worktree_status() -> String {
    Command::new("git")
        .args(["status", "--porcelain"])
        .output()
        .ok()
        .filter(|output| output.status.success())
        .map(|output| {
            if output.stdout.is_empty() {
                "clean"
            } else {
                "dirty"
            }
            .to_string()
        })
        .unwrap_or_else(|| "unknown".to_string())
}

fn ngspice_status() -> String {
    find_ngspice_executable()
        .as_deref()
        .and_then(ngspice_version)
        .unwrap_or_else(|| "not_available".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    const RAW_COMPLEX_FIXTURE: &str = "\
Title: test
Plotname: AC Analysis
Flags: complex
No. Variables: 2
No. Points: 2
Variables:
\t0\tfrequency\tfrequency
\t1\tv(2)\tvoltage
Values:
0\t\t1.000000000000000e+02,0.000000000000000e+00
\t5.000000000000000e-01,-5.000000000000000e-01
1\t\t2.000000000000000e+02,0.000000000000000e+00
\t2.500000000000000e-01,-7.500000000000000e-01
";

    #[test]
    fn nearest_coordinate_uses_absolute_distance() {
        assert_eq!(nearest_coordinate_index(&[0.0, 0.5, 1.0], 0.6).unwrap(), 1);
    }

    #[test]
    fn parses_ngspice_ascii_raw_and_interpolates_complex_values() {
        let raw = parse_ngspice_ascii_raw(RAW_COMPLEX_FIXTURE).unwrap();
        assert_eq!(raw.variables, vec!["frequency", "v(2)"]);
        let sample = raw_sample(&raw, "v(2)", Some(150.0)).unwrap();
        assert!((sample.re - 0.375).abs() < 1e-12);
        assert!((sample.im + 0.625).abs() < 1e-12);
    }

    #[test]
    fn rejects_inconsistent_ngspice_point_counts() {
        let invalid = RAW_COMPLEX_FIXTURE.replace("No. Points: 2", "No. Points: 3");
        assert!(parse_ngspice_ascii_raw(&invalid).is_err());
    }

    #[test]
    fn reference_map_rejects_negative_tolerance() {
        let reference = ReferenceDocument {
            schema_version: SCHEMA_VERSION,
            case_id: "case".to_string(),
            method: "closed_form".to_string(),
            source: "test".to_string(),
            observations: vec![ReferenceObservation {
                id: "x".to_string(),
                expected: 1.0,
                absolute_tolerance: -1.0,
                relative_tolerance: 0.0,
                units: "V".to_string(),
                expression: "1".to_string(),
            }],
        };
        assert!(reference_map(&reference).is_err());
    }

    #[test]
    fn error_metric_uses_the_larger_tolerance_budget() {
        let reference = ReferenceObservation {
            id: "x".to_string(),
            expected: 100.0,
            absolute_tolerance: 0.01,
            relative_tolerance: 0.001,
            units: "V".to_string(),
            expression: "100".to_string(),
        };
        let (_, _, allowed, passed) = error_metrics(100.09, &reference);
        assert!((allowed - 0.1).abs() < 1e-12);
        assert!(passed);
    }

    #[test]
    fn ac_node_phasor_reconstructs_db_and_phase() {
        let result = AcSweepResult {
            frequencies: vec![1_000.0],
            node_amplitudes: HashMap::from([
                ("0".to_string(), vec![0.0]),
                ("1".to_string(), vec![-6.020599913279624]),
            ]),
            node_phases: HashMap::from([
                ("0".to_string(), vec![0.0]),
                ("1".to_string(), vec![90.0]),
            ]),
            error_log: None,
        };
        let phasor = ac_node_phasor(&result, "1", 0).unwrap();
        assert!(phasor.re.abs() < 1e-12);
        assert!((phasor.im - 0.5).abs() < 1e-12);
        assert_eq!(
            ac_node_phasor(&result, "0", 0).unwrap(),
            Complex64::new(0.0, 0.0)
        );
    }

    #[test]
    fn incident_connection_preserves_branch_orientation() {
        let pins = vec!["1".to_string(), "2".to_string()];
        assert_eq!(incident_connection(&pins, "1"), Some(("2", 1.0)));
        assert_eq!(incident_connection(&pins, "2"), Some(("1", -1.0)));
        assert_eq!(incident_connection(&pins, "3"), None);
    }
}
