use super::schema::{FeedbackEventV1, FeedbackPrivacyClass, FEEDBACK_SCHEMA_VERSION};
use rusqlite::{params, Connection, TransactionBehavior};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, Receiver, SyncSender, TrySendError};
use std::sync::{Arc, LazyLock, Mutex};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

pub const MAX_EVENT_BYTES: usize = 64 * 1024;
pub const MAX_BATCH_EVENTS: usize = 100;
pub const MAX_BATCH_BYTES: usize = 1024 * 1024;
pub const MAX_STORE_BYTES: u64 = 250 * 1024 * 1024;
const ACTOR_QUEUE_CAPACITY: usize = 64;
const RESPONSE_TIMEOUT: Duration = Duration::from_secs(10);
const CURRENT_DATABASE_VERSION: i64 = 1;
const MIN_SAFE_SQLITE_VERSION: i32 = 3_051_003;
const DEFAULT_QUERY_LIMIT: u32 = 100;
const MAX_QUERY_LIMIT: u32 = 500;
const MAX_EXPORT_LIMIT: u32 = 10_000;
const DAY_MS: u64 = 86_400_000;

static EVENT_SCHEMA: LazyLock<Result<jsonschema::Validator, String>> = LazyLock::new(|| {
    let schema: Value = serde_json::from_str(include_str!(
        "../../../feedback/contracts/feedback-event.v1.schema.json"
    ))
    .map_err(|error| format!("El JSON Schema de feedback no es valido: {error}"))?;
    jsonschema::validator_for(&schema)
        .map_err(|error| format!("No se pudo compilar el JSON Schema de feedback: {error}"))
});

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum FeedbackConsentMode {
    Disabled,
    Local,
    ShareOnExport,
}

impl FeedbackConsentMode {
    fn as_str(self) -> &'static str {
        match self {
            Self::Disabled => "disabled",
            Self::Local => "local",
            Self::ShareOnExport => "share-on-export",
        }
    }

    fn from_database(value: &str) -> Result<Self, String> {
        match value {
            "disabled" => Ok(Self::Disabled),
            "local" => Ok(Self::Local),
            "share-on-export" => Ok(Self::ShareOnExport),
            _ => Err("El modo de consentimiento almacenado no es valido.".to_string()),
        }
    }

    fn persists_events(self) -> bool {
        !matches!(self, Self::Disabled)
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FeedbackBatchInput {
    pub events: Vec<Value>,
    #[serde(default)]
    pub user_content_confirmed: bool,
}

#[derive(Clone, Debug)]
struct ValidatedEvent {
    event: FeedbackEventV1,
    json: String,
    bytes: usize,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FeedbackBatchReceipt {
    pub accepted: usize,
    pub duplicates: usize,
    pub persisted_at_unix_ms: u64,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FeedbackQuery {
    pub session_id: Option<String>,
    pub kind: Option<String>,
    pub before_unix_ms: Option<u64>,
    pub after_unix_ms: Option<u64>,
    pub limit: Option<u32>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FeedbackEventPage {
    pub events: Vec<Value>,
    pub has_more: bool,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FeedbackStoreStatus {
    pub consent_mode: FeedbackConsentMode,
    pub event_count: u64,
    pub logical_bytes: u64,
    pub database_schema_version: u16,
    pub event_schema_version: u16,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FeedbackDeleteRequest {
    pub scope: FeedbackDeleteScope,
    pub session_id: Option<String>,
}

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum FeedbackDeleteScope {
    All,
    Expired,
    Session,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FeedbackDeleteReceipt {
    pub rows_deleted: u64,
    pub attachments_deleted: u64,
}

enum StoreRequest {
    Insert {
        events: Vec<ValidatedEvent>,
        reply: mpsc::Sender<Result<FeedbackBatchReceipt, String>>,
    },
    SetConsent {
        mode: FeedbackConsentMode,
        reply: mpsc::Sender<Result<FeedbackStoreStatus, String>>,
    },
    Status {
        reply: mpsc::Sender<Result<FeedbackStoreStatus, String>>,
    },
    Query {
        query: FeedbackQuery,
        export: bool,
        reply: mpsc::Sender<Result<FeedbackEventPage, String>>,
    },
    Delete {
        request: FeedbackDeleteRequest,
        reply: mpsc::Sender<Result<FeedbackDeleteReceipt, String>>,
    },
    Flush {
        reply: mpsc::Sender<Result<(), String>>,
    },
    Shutdown {
        reply: mpsc::Sender<Result<(), String>>,
    },
}

struct FeedbackStateInner {
    sender: SyncSender<StoreRequest>,
    worker: Mutex<Option<thread::JoinHandle<()>>>,
}

impl Drop for FeedbackStateInner {
    fn drop(&mut self) {
        let (reply, response) = mpsc::channel();
        if self.sender.send(StoreRequest::Shutdown { reply }).is_ok() {
            let _ = response.recv_timeout(RESPONSE_TIMEOUT);
        }
        if let Ok(worker) = self.worker.get_mut() {
            if let Some(handle) = worker.take() {
                let _ = handle.join();
            }
        }
    }
}

#[derive(Clone)]
pub struct FeedbackState {
    inner: Arc<FeedbackStateInner>,
}

impl FeedbackState {
    pub fn start(root: PathBuf) -> Result<Self, String> {
        fs::create_dir_all(&root)
            .map_err(|error| format!("No se pudo crear el directorio de feedback: {error}"))?;
        let database_path = root.join("feedback.sqlite3");
        let (sender, receiver) = mpsc::sync_channel(ACTOR_QUEUE_CAPACITY);
        let (ready_tx, ready_rx) = mpsc::channel();

        let worker = thread::Builder::new()
            .name("astryd-feedback-store".to_string())
            .spawn(move || {
                let initialized = open_database(&database_path);
                match initialized {
                    Ok(connection) => {
                        let _ = ready_tx.send(Ok(()));
                        run_store_actor(connection, database_path, receiver);
                    }
                    Err(error) => {
                        let _ = ready_tx.send(Err(error));
                    }
                }
            })
            .map_err(|error| format!("No se pudo iniciar el almacen de feedback: {error}"))?;

        ready_rx
            .recv_timeout(RESPONSE_TIMEOUT)
            .map_err(|_| "El almacen de feedback no respondio durante el inicio.".to_string())??;
        Ok(Self {
            inner: Arc::new(FeedbackStateInner {
                sender,
                worker: Mutex::new(Some(worker)),
            }),
        })
    }

    fn dispatch(&self, request: StoreRequest) -> Result<(), String> {
        self.inner
            .sender
            .try_send(request)
            .map_err(|error| match error {
                TrySendError::Full(_) => {
                    "El almacen de feedback esta ocupado; el lote no fue aceptado.".to_string()
                }
                TrySendError::Disconnected(_) => {
                    "El almacen de feedback no esta disponible.".to_string()
                }
            })
    }

    fn insert_blocking(&self, events: Vec<ValidatedEvent>) -> Result<FeedbackBatchReceipt, String> {
        let (reply, response) = mpsc::channel();
        self.dispatch(StoreRequest::Insert { events, reply })?;
        receive_response(response)
    }

    fn set_consent_blocking(
        &self,
        mode: FeedbackConsentMode,
    ) -> Result<FeedbackStoreStatus, String> {
        let (reply, response) = mpsc::channel();
        self.dispatch(StoreRequest::SetConsent { mode, reply })?;
        receive_response(response)
    }

    fn status_blocking(&self) -> Result<FeedbackStoreStatus, String> {
        let (reply, response) = mpsc::channel();
        self.dispatch(StoreRequest::Status { reply })?;
        receive_response(response)
    }

    fn query_blocking(
        &self,
        query: FeedbackQuery,
        export: bool,
    ) -> Result<FeedbackEventPage, String> {
        let (reply, response) = mpsc::channel();
        self.dispatch(StoreRequest::Query {
            query,
            export,
            reply,
        })?;
        receive_response(response)
    }

    fn delete_blocking(
        &self,
        request: FeedbackDeleteRequest,
    ) -> Result<FeedbackDeleteReceipt, String> {
        let (reply, response) = mpsc::channel();
        self.dispatch(StoreRequest::Delete { request, reply })?;
        receive_response(response)
    }

    fn flush_blocking(&self) -> Result<(), String> {
        let (reply, response) = mpsc::channel();
        self.dispatch(StoreRequest::Flush { reply })?;
        receive_response(response)
    }
}

fn receive_response<T>(receiver: mpsc::Receiver<Result<T, String>>) -> Result<T, String> {
    receiver
        .recv_timeout(RESPONSE_TIMEOUT)
        .map_err(|_| "El almacen de feedback no respondio a tiempo.".to_string())?
}

fn validate_batch(input: FeedbackBatchInput) -> Result<Vec<ValidatedEvent>, String> {
    if input.events.len() > MAX_BATCH_EVENTS {
        return Err(format!(
            "El lote excede el limite de {MAX_BATCH_EVENTS} eventos."
        ));
    }

    let validator = EVENT_SCHEMA.as_ref().map_err(|error| error.to_string())?;
    let mut total_bytes = 0usize;
    let mut validated = Vec::with_capacity(input.events.len());

    for (index, value) in input.events.into_iter().enumerate() {
        let encoded = serde_json::to_vec(&value)
            .map_err(|error| format!("No se pudo serializar el evento {index}: {error}"))?;
        let event_bytes = encoded.len();
        if event_bytes > MAX_EVENT_BYTES {
            return Err(format!(
                "El evento {index} excede el limite de {MAX_EVENT_BYTES} bytes."
            ));
        }
        total_bytes = total_bytes
            .checked_add(event_bytes)
            .ok_or_else(|| "El tamano del lote produjo un desbordamiento.".to_string())?;
        if total_bytes > MAX_BATCH_BYTES {
            return Err(format!(
                "El lote excede el limite de {MAX_BATCH_BYTES} bytes."
            ));
        }

        if let Err(error) = validator.validate(&value) {
            return Err(format!("El evento {index} no cumple el esquema: {error}"));
        }

        let event: FeedbackEventV1 = serde_json::from_value(value)
            .map_err(|error| format!("El evento {index} no se pudo interpretar: {error}"))?;
        event
            .validate_envelope()
            .map_err(|error| format!("El evento {index} no es valido: {error}"))?;
        if event.privacy_class == FeedbackPrivacyClass::UserContent && !input.user_content_confirmed
        {
            return Err(
                "El lote contiene contenido del usuario sin confirmacion explicita.".to_string(),
            );
        }

        let json = String::from_utf8(encoded)
            .map_err(|_| "El evento serializado no es UTF-8 valido.".to_string())?;
        validated.push(ValidatedEvent {
            event,
            json,
            bytes: event_bytes,
        });
    }

    Ok(validated)
}

fn open_database(path: &Path) -> Result<Connection, String> {
    if rusqlite::version_number() < MIN_SAFE_SQLITE_VERSION {
        return Err(format!(
            "SQLite {} no cumple la version minima segura 3.51.3 para WAL.",
            rusqlite::version()
        ));
    }
    let mut connection = Connection::open(path)
        .map_err(|error| format!("No se pudo abrir SQLite para feedback: {error}"))?;
    connection
        .busy_timeout(Duration::from_secs(5))
        .map_err(|error| format!("No se pudo configurar SQLite: {error}"))?;
    connection
        .execute_batch(
            "PRAGMA journal_mode = WAL;
             PRAGMA synchronous = NORMAL;
             PRAGMA foreign_keys = ON;
             PRAGMA temp_store = MEMORY;",
        )
        .map_err(|error| format!("No se pudieron configurar las garantias de SQLite: {error}"))?;
    migrate_database(&mut connection)?;
    Ok(connection)
}

fn migrate_database(connection: &mut Connection) -> Result<(), String> {
    let version: i64 = connection
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .map_err(|error| format!("No se pudo leer la version de SQLite: {error}"))?;
    if version > CURRENT_DATABASE_VERSION {
        return Err(format!(
            "La base de feedback usa la version {version}, pero esta aplicacion solo admite hasta {CURRENT_DATABASE_VERSION}."
        ));
    }
    if version == CURRENT_DATABASE_VERSION {
        return Ok(());
    }

    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| format!("No se pudo iniciar la migracion de feedback: {error}"))?;
    if version == 0 {
        transaction
            .execute_batch(
                "CREATE TABLE feedback_settings (
                    id INTEGER PRIMARY KEY CHECK (id = 1),
                    consent_mode TEXT NOT NULL
                        CHECK (consent_mode IN ('disabled', 'local', 'share-on-export')),
                    updated_at_unix_ms INTEGER NOT NULL
                 );
                 INSERT INTO feedback_settings (id, consent_mode, updated_at_unix_ms)
                 VALUES (1, 'disabled', 0);

                 CREATE TABLE feedback_events (
                    event_id TEXT PRIMARY KEY,
                    schema_version INTEGER NOT NULL,
                    occurred_at_unix_ms INTEGER NOT NULL,
                    persisted_at_unix_ms INTEGER NOT NULL,
                    session_id TEXT NOT NULL,
                    run_id TEXT,
                    app_version TEXT NOT NULL,
                    git_revision TEXT,
                    privacy_class TEXT NOT NULL
                        CHECK (privacy_class IN ('operational', 'circuit-derived', 'user-content')),
                    kind TEXT NOT NULL,
                    event_json TEXT NOT NULL,
                    serialized_bytes INTEGER NOT NULL CHECK (serialized_bytes >= 0)
                 );
                 CREATE INDEX feedback_events_occurred_idx
                    ON feedback_events (occurred_at_unix_ms DESC);
                 CREATE INDEX feedback_events_session_idx
                    ON feedback_events (session_id, occurred_at_unix_ms DESC);
                 CREATE INDEX feedback_events_kind_idx
                    ON feedback_events (kind, occurred_at_unix_ms DESC);
                 PRAGMA user_version = 1;",
            )
            .map_err(|error| format!("Fallo la migracion inicial de feedback: {error}"))?;
    }
    transaction
        .commit()
        .map_err(|error| format!("No se pudo confirmar la migracion de feedback: {error}"))
}

fn run_store_actor(
    mut connection: Connection,
    database_path: PathBuf,
    receiver: Receiver<StoreRequest>,
) {
    while let Ok(request) = receiver.recv() {
        match request {
            StoreRequest::Insert { events, reply } => {
                let _ = reply.send(insert_events(&mut connection, &events));
            }
            StoreRequest::SetConsent { mode, reply } => {
                let result =
                    set_consent(&connection, mode).and_then(|_| read_store_status(&connection));
                let _ = reply.send(result);
            }
            StoreRequest::Status { reply } => {
                let _ = reply.send(read_store_status(&connection));
            }
            StoreRequest::Query {
                query,
                export,
                reply,
            } => {
                let _ = reply.send(query_events(&connection, query, export));
            }
            StoreRequest::Delete { request, reply } => {
                let result = if matches!(request.scope, FeedbackDeleteScope::All) {
                    delete_all_and_reopen(&mut connection, &database_path)
                } else {
                    delete_selected(&mut connection, request)
                };
                let _ = reply.send(result);
            }
            StoreRequest::Flush { reply } => {
                let result = checkpoint(&connection);
                let _ = reply.send(result);
            }
            StoreRequest::Shutdown { reply } => {
                let result = checkpoint(&connection);
                let _ = reply.send(result);
                break;
            }
        }
    }
}

fn checkpoint(connection: &Connection) -> Result<(), String> {
    connection
        .execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")
        .map_err(|error| format!("No se pudo vaciar el almacen de feedback: {error}"))
}

fn set_consent(connection: &Connection, mode: FeedbackConsentMode) -> Result<(), String> {
    let updated_at = to_sql_integer(now_unix_ms())?;
    connection
        .execute(
            "UPDATE feedback_settings
             SET consent_mode = ?1, updated_at_unix_ms = ?2
             WHERE id = 1",
            params![mode.as_str(), updated_at],
        )
        .map_err(|error| format!("No se pudo guardar el consentimiento: {error}"))?;
    Ok(())
}

fn read_consent(connection: &Connection) -> Result<FeedbackConsentMode, String> {
    let mode: String = connection
        .query_row(
            "SELECT consent_mode FROM feedback_settings WHERE id = 1",
            [],
            |row| row.get(0),
        )
        .map_err(|error| format!("No se pudo leer el consentimiento: {error}"))?;
    FeedbackConsentMode::from_database(&mode)
}

fn insert_events(
    connection: &mut Connection,
    events: &[ValidatedEvent],
) -> Result<FeedbackBatchReceipt, String> {
    let consent = read_consent(connection)?;
    if !consent.persists_events() {
        return Err("La persistencia de feedback esta desactivada.".to_string());
    }

    let persisted_at = now_unix_ms();
    let persisted_at_sql = to_sql_integer(persisted_at)?;
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| format!("No se pudo iniciar el lote de feedback: {error}"))?;
    delete_expired_rows(&transaction, persisted_at)?;

    let mut accepted = 0usize;
    for item in events {
        let event = &item.event;
        let occurred_at = to_sql_integer(event.occurred_at_unix_ms)?;
        let serialized_bytes = i64::try_from(item.bytes)
            .map_err(|_| "El tamano del evento excede el rango de SQLite.".to_string())?;
        let changed = transaction
            .execute(
                "INSERT OR IGNORE INTO feedback_events (
                    event_id, schema_version, occurred_at_unix_ms, persisted_at_unix_ms,
                    session_id, run_id, app_version, git_revision, privacy_class, kind,
                    event_json, serialized_bytes
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
                params![
                    event.event_id,
                    event.schema_version,
                    occurred_at,
                    persisted_at_sql,
                    event.session_id,
                    event.run_id,
                    event.app_version,
                    event.git_revision,
                    privacy_class_name(event.privacy_class),
                    event.event.kind(),
                    item.json,
                    serialized_bytes,
                ],
            )
            .map_err(|error| format!("No se pudo insertar el evento de feedback: {error}"))?;
        accepted += changed;
    }

    enforce_store_quota(&transaction)?;
    transaction
        .commit()
        .map_err(|error| format!("No se pudo confirmar el lote de feedback: {error}"))?;
    Ok(FeedbackBatchReceipt {
        accepted,
        duplicates: events.len().saturating_sub(accepted),
        persisted_at_unix_ms: persisted_at,
    })
}

fn delete_expired_rows(
    transaction: &rusqlite::Transaction<'_>,
    now_ms: u64,
) -> Result<u64, String> {
    let operational_cutoff = now_ms.saturating_sub(90 * DAY_MS);
    let user_cutoff = now_ms.saturating_sub(180 * DAY_MS);
    let operational_cutoff = to_sql_integer(operational_cutoff)?;
    let user_cutoff = to_sql_integer(user_cutoff)?;
    transaction
        .execute(
            "DELETE FROM feedback_events
             WHERE (privacy_class = 'user-content' AND persisted_at_unix_ms < ?1)
                OR (privacy_class != 'user-content' AND persisted_at_unix_ms < ?2)",
            params![user_cutoff, operational_cutoff],
        )
        .map(|count| count as u64)
        .map_err(|error| format!("No se pudieron eliminar eventos vencidos: {error}"))
}

fn enforce_store_quota(transaction: &rusqlite::Transaction<'_>) -> Result<(), String> {
    let mut bytes = logical_bytes(transaction)?;
    if bytes <= MAX_STORE_BYTES {
        return Ok(());
    }

    while bytes > MAX_STORE_BYTES {
        let deleted = transaction
            .execute(
                "DELETE FROM feedback_events
                 WHERE event_id IN (
                    SELECT event_id FROM feedback_events
                    WHERE kind = 'performance.sampled'
                    ORDER BY persisted_at_unix_ms ASC
                    LIMIT 256
                 )",
                [],
            )
            .map_err(|error| format!("No se pudo aplicar la cuota de feedback: {error}"))?;
        if deleted == 0 {
            break;
        }
        bytes = logical_bytes(transaction)?;
    }
    while bytes > MAX_STORE_BYTES {
        let deleted = transaction
            .execute(
                "DELETE FROM feedback_events
                 WHERE event_id IN (
                    SELECT event_id FROM feedback_events
                    WHERE kind IN ('circuit.summary_created', 'solver.convergence_summary')
                    ORDER BY persisted_at_unix_ms ASC
                    LIMIT 256
                 )",
                [],
            )
            .map_err(|error| format!("No se pudo rotar feedback reconstruible: {error}"))?;
        if deleted == 0 {
            break;
        }
        bytes = logical_bytes(transaction)?;
    }
    if bytes > MAX_STORE_BYTES {
        return Err(
            "La cuota local de feedback esta llena y contiene datos no descartables.".to_string(),
        );
    }
    Ok(())
}

fn logical_bytes(connection: &Connection) -> Result<u64, String> {
    let bytes: i64 = connection
        .query_row(
            "SELECT COALESCE(SUM(serialized_bytes), 0) FROM feedback_events",
            [],
            |row| row.get(0),
        )
        .map_err(|error| format!("No se pudo calcular la cuota de feedback: {error}"))?;
    u64::try_from(bytes).map_err(|_| "La cuota de feedback almacenada no es valida.".to_string())
}

fn read_store_status(connection: &Connection) -> Result<FeedbackStoreStatus, String> {
    let (event_count, bytes): (i64, i64) = connection
        .query_row(
            "SELECT COUNT(*), COALESCE(SUM(serialized_bytes), 0) FROM feedback_events",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|error| format!("No se pudo consultar el estado de feedback: {error}"))?;
    Ok(FeedbackStoreStatus {
        consent_mode: read_consent(connection)?,
        event_count: u64::try_from(event_count)
            .map_err(|_| "El conteo de feedback almacenado no es valido.".to_string())?,
        logical_bytes: u64::try_from(bytes)
            .map_err(|_| "La cuota de feedback almacenada no es valida.".to_string())?,
        database_schema_version: CURRENT_DATABASE_VERSION as u16,
        event_schema_version: FEEDBACK_SCHEMA_VERSION,
    })
}

fn query_events(
    connection: &Connection,
    query: FeedbackQuery,
    export: bool,
) -> Result<FeedbackEventPage, String> {
    validate_query(&query)?;
    let maximum = if export {
        MAX_EXPORT_LIMIT
    } else {
        MAX_QUERY_LIMIT
    };
    let limit = query.limit.unwrap_or(DEFAULT_QUERY_LIMIT).min(maximum);
    let fetch_limit = i64::from(limit) + 1;
    let before = query.before_unix_ms.map(to_sql_integer).transpose()?;
    let after = query.after_unix_ms.map(to_sql_integer).transpose()?;

    let mut statement = connection
        .prepare(
            "SELECT event_json FROM feedback_events
             WHERE (?1 IS NULL OR session_id = ?1)
               AND (?2 IS NULL OR kind = ?2)
               AND (?3 IS NULL OR occurred_at_unix_ms < ?3)
               AND (?4 IS NULL OR occurred_at_unix_ms > ?4)
             ORDER BY occurred_at_unix_ms DESC, persisted_at_unix_ms DESC
             LIMIT ?5",
        )
        .map_err(|error| format!("No se pudo preparar la consulta de feedback: {error}"))?;
    let rows = statement
        .query_map(
            params![query.session_id, query.kind, before, after, fetch_limit],
            |row| row.get::<_, String>(0),
        )
        .map_err(|error| format!("No se pudo consultar feedback: {error}"))?;

    let mut events = Vec::with_capacity(fetch_limit as usize);
    for row in rows {
        let json = row.map_err(|error| format!("No se pudo leer feedback: {error}"))?;
        events.push(
            serde_json::from_str(&json)
                .map_err(|error| format!("Un evento almacenado esta corrupto: {error}"))?,
        );
    }
    let has_more = events.len() > limit as usize;
    events.truncate(limit as usize);
    Ok(FeedbackEventPage { events, has_more })
}

fn validate_query(query: &FeedbackQuery) -> Result<(), String> {
    if query
        .session_id
        .as_ref()
        .is_some_and(|value| value.is_empty() || value.len() > 128)
    {
        return Err("El filtro sessionId no es valido.".to_string());
    }
    if query
        .kind
        .as_ref()
        .is_some_and(|value| value.is_empty() || value.len() > 64)
    {
        return Err("El filtro kind no es valido.".to_string());
    }
    if query.limit == Some(0) {
        return Err("El limite de consulta debe ser mayor que cero.".to_string());
    }
    Ok(())
}

fn delete_selected(
    connection: &mut Connection,
    request: FeedbackDeleteRequest,
) -> Result<FeedbackDeleteReceipt, String> {
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| format!("No se pudo iniciar el borrado de feedback: {error}"))?;
    let deleted = match request.scope {
        FeedbackDeleteScope::Expired => delete_expired_rows(&transaction, now_unix_ms())?,
        FeedbackDeleteScope::Session => {
            let session_id = request
                .session_id
                .filter(|value| !value.is_empty() && value.len() <= 128)
                .ok_or_else(|| "El borrado por sesion requiere un sessionId valido.".to_string())?;
            transaction
                .execute(
                    "DELETE FROM feedback_events WHERE session_id = ?1",
                    [session_id],
                )
                .map(|count| count as u64)
                .map_err(|error| format!("No se pudo borrar la sesion: {error}"))?
        }
        FeedbackDeleteScope::All => unreachable!("delete all is handled by the actor"),
    };
    transaction
        .commit()
        .map_err(|error| format!("No se pudo confirmar el borrado de feedback: {error}"))?;
    Ok(FeedbackDeleteReceipt {
        rows_deleted: deleted,
        attachments_deleted: 0,
    })
}

fn delete_all_and_reopen(
    connection: &mut Connection,
    database_path: &Path,
) -> Result<FeedbackDeleteReceipt, String> {
    let rows_deleted: i64 = connection
        .query_row("SELECT COUNT(*) FROM feedback_events", [], |row| row.get(0))
        .map_err(|error| format!("No se pudo contar el feedback a borrar: {error}"))?;
    checkpoint(connection)?;

    let placeholder = Connection::open_in_memory()
        .map_err(|error| format!("No se pudo preparar el borrado total: {error}"))?;
    let old_connection = std::mem::replace(connection, placeholder);
    drop(old_connection);

    for path in database_files(database_path) {
        if path.exists() {
            if let Err(error) = fs::remove_file(&path) {
                *connection = open_database(database_path)?;
                return Err(format!("No se pudo borrar {}: {error}", path.display()));
            }
        }
    }
    *connection = open_database(database_path)?;

    let attachments = database_path
        .parent()
        .ok_or_else(|| "La ruta del almacen de feedback no es valida.".to_string())?
        .join("attachments");
    let attachments_deleted = count_files(&attachments)?;
    if attachments.exists() {
        fs::remove_dir_all(&attachments)
            .map_err(|error| format!("No se pudieron borrar los adjuntos: {error}"))?;
    }

    Ok(FeedbackDeleteReceipt {
        rows_deleted: u64::try_from(rows_deleted)
            .map_err(|_| "El conteo de feedback borrado no es valido.".to_string())?,
        attachments_deleted,
    })
}

fn database_files(database_path: &Path) -> [PathBuf; 3] {
    [
        database_path.to_path_buf(),
        PathBuf::from(format!("{}-wal", database_path.display())),
        PathBuf::from(format!("{}-shm", database_path.display())),
    ]
}

fn count_files(root: &Path) -> Result<u64, String> {
    if !root.exists() {
        return Ok(0);
    }
    let mut count = 0u64;
    for entry in fs::read_dir(root)
        .map_err(|error| format!("No se pudo revisar el directorio de adjuntos: {error}"))?
    {
        let entry = entry.map_err(|error| format!("No se pudo revisar un adjunto: {error}"))?;
        if entry
            .file_type()
            .map_err(|error| format!("No se pudo revisar un adjunto: {error}"))?
            .is_file()
        {
            count += 1;
        }
    }
    Ok(count)
}

fn privacy_class_name(value: FeedbackPrivacyClass) -> &'static str {
    match value {
        FeedbackPrivacyClass::Operational => "operational",
        FeedbackPrivacyClass::CircuitDerived => "circuit-derived",
        FeedbackPrivacyClass::UserContent => "user-content",
    }
}

fn to_sql_integer(value: u64) -> Result<i64, String> {
    i64::try_from(value).map_err(|_| "La marca de tiempo excede el rango admitido.".to_string())
}

fn now_unix_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .try_into()
        .unwrap_or(u64::MAX)
}

async fn run_blocking<T, F>(operation: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(operation)
        .await
        .map_err(|error| format!("Fallo la tarea del almacen de feedback: {error}"))?
}

#[tauri::command]
pub async fn ingest_feedback_batch(
    state: tauri::State<'_, FeedbackState>,
    batch: FeedbackBatchInput,
) -> Result<FeedbackBatchReceipt, String> {
    let events = validate_batch(batch)?;
    let state = state.inner().clone();
    run_blocking(move || state.insert_blocking(events)).await
}

#[tauri::command]
pub async fn set_feedback_consent(
    state: tauri::State<'_, FeedbackState>,
    mode: FeedbackConsentMode,
) -> Result<FeedbackStoreStatus, String> {
    let state = state.inner().clone();
    run_blocking(move || state.set_consent_blocking(mode)).await
}

#[tauri::command]
pub async fn get_feedback_status(
    state: tauri::State<'_, FeedbackState>,
) -> Result<FeedbackStoreStatus, String> {
    let state = state.inner().clone();
    run_blocking(move || state.status_blocking()).await
}

#[tauri::command]
pub async fn query_feedback_events(
    state: tauri::State<'_, FeedbackState>,
    query: FeedbackQuery,
) -> Result<FeedbackEventPage, String> {
    let state = state.inner().clone();
    run_blocking(move || state.query_blocking(query, false)).await
}

#[tauri::command]
pub async fn export_feedback_events(
    state: tauri::State<'_, FeedbackState>,
    query: FeedbackQuery,
) -> Result<FeedbackEventPage, String> {
    let state = state.inner().clone();
    run_blocking(move || state.query_blocking(query, true)).await
}

#[tauri::command]
pub async fn delete_feedback_data(
    state: tauri::State<'_, FeedbackState>,
    request: FeedbackDeleteRequest,
) -> Result<FeedbackDeleteReceipt, String> {
    let state = state.inner().clone();
    run_blocking(move || state.delete_blocking(request)).await
}

#[tauri::command]
pub async fn flush_feedback_store(state: tauri::State<'_, FeedbackState>) -> Result<(), String> {
    let state = state.inner().clone();
    run_blocking(move || state.flush_blocking()).await
}

#[cfg(test)]
mod store_tests {
    use super::*;
    use serde_json::json;
    use std::sync::atomic::{AtomicU64, Ordering};

    static TEST_ID: AtomicU64 = AtomicU64::new(0);

    fn temp_root(name: &str) -> PathBuf {
        let serial = TEST_ID.fetch_add(1, Ordering::Relaxed);
        std::env::temp_dir().join(format!(
            "astryd-feedback-{name}-{}-{serial}",
            std::process::id()
        ))
    }

    fn session_started(event_id: &str) -> Value {
        json!({
            "schemaVersion": 1,
            "eventId": event_id,
            "occurredAtUnixMs": 1_785_460_000_000_u64,
            "sessionId": "session-1",
            "appVersion": "0.1.0",
            "privacyClass": "operational",
            "kind": "session.started",
            "payload": {
                "os": "Windows",
                "locale": "es-MX"
            }
        })
    }

    fn circuit_summary(event_id: &str, histogram_entries: usize, key_padding: usize) -> Value {
        let histogram = (0..histogram_entries)
            .map(|index| {
                (
                    format!("device-{index}-{}", "x".repeat(key_padding)),
                    json!(1),
                )
            })
            .collect::<serde_json::Map<_, _>>();
        json!({
            "schemaVersion": 1,
            "eventId": event_id,
            "occurredAtUnixMs": 1_785_460_000_000_u64,
            "sessionId": "session-1",
            "appVersion": "0.1.0",
            "privacyClass": "circuit-derived",
            "kind": "circuit.summary_created",
            "payload": {
                "topologyFingerprint": "sha256:fixture",
                "componentCount": histogram_entries,
                "nodeCount": 1,
                "wireCount": 0,
                "nonlinearDeviceCount": 0,
                "reactiveDeviceCount": 0,
                "componentHistogram": histogram,
                "containsFirmware": false
            }
        })
    }

    fn validated(event_id: &str) -> Vec<ValidatedEvent> {
        validate_batch(FeedbackBatchInput {
            events: vec![session_started(event_id)],
            user_content_confirmed: false,
        })
        .unwrap()
    }

    #[test]
    fn disabled_store_rejects_events_and_local_mode_is_idempotent() {
        let root = temp_root("consent");
        let state = FeedbackState::start(root.clone()).unwrap();
        assert_eq!(
            state.insert_blocking(validated("event-1")).unwrap_err(),
            "La persistencia de feedback esta desactivada."
        );

        state
            .set_consent_blocking(FeedbackConsentMode::Local)
            .unwrap();
        let first = state.insert_blocking(validated("event-1")).unwrap();
        let duplicate = state.insert_blocking(validated("event-1")).unwrap();
        assert_eq!(first.accepted, 1);
        assert_eq!(duplicate.duplicates, 1);
        assert_eq!(state.status_blocking().unwrap().event_count, 1);

        drop(state);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn schema_and_batch_quotas_reject_the_entire_batch() {
        let mut invalid = session_started("invalid");
        invalid["payload"]["unknown"] = json!(true);
        assert!(validate_batch(FeedbackBatchInput {
            events: vec![invalid],
            user_content_confirmed: false,
        })
        .unwrap_err()
        .contains("no cumple el esquema"));

        let oversized = vec![session_started("same"); MAX_BATCH_EVENTS + 1];
        assert!(validate_batch(FeedbackBatchInput {
            events: oversized,
            user_content_confirmed: false,
        })
        .unwrap_err()
        .contains("excede el limite"));

        let oversized_event = circuit_summary("too-large", 64, 1_100);
        assert!(serde_json::to_vec(&oversized_event).unwrap().len() > MAX_EVENT_BYTES);
        assert!(validate_batch(FeedbackBatchInput {
            events: vec![oversized_event],
            user_content_confirmed: false,
        })
        .unwrap_err()
        .contains("evento 0 excede"));

        let medium_event = circuit_summary("medium", 64, 200);
        let medium_bytes = serde_json::to_vec(&medium_event).unwrap().len();
        assert!(medium_bytes < MAX_EVENT_BYTES);
        assert!(medium_bytes * 100 > MAX_BATCH_BYTES);
        assert!(validate_batch(FeedbackBatchInput {
            events: vec![medium_event; 100],
            user_content_confirmed: false,
        })
        .unwrap_err()
        .contains("lote excede"));
    }

    #[test]
    fn query_delete_and_reopen_preserve_consistency() {
        let root = temp_root("lifecycle");
        let state = FeedbackState::start(root.clone()).unwrap();
        state
            .set_consent_blocking(FeedbackConsentMode::Local)
            .unwrap();
        state.insert_blocking(validated("event-1")).unwrap();

        let page = state
            .query_blocking(FeedbackQuery::default(), false)
            .unwrap();
        assert_eq!(page.events.len(), 1);
        assert!(!page.has_more);

        let receipt = state
            .delete_blocking(FeedbackDeleteRequest {
                scope: FeedbackDeleteScope::All,
                session_id: None,
            })
            .unwrap();
        assert_eq!(receipt.rows_deleted, 1);
        let status = state.status_blocking().unwrap();
        assert_eq!(status.event_count, 0);
        assert_eq!(status.consent_mode, FeedbackConsentMode::Disabled);

        drop(state);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn sqlite_rolls_back_an_interrupted_transaction() {
        let root = temp_root("recovery");
        fs::create_dir_all(&root).unwrap();
        let path = root.join("feedback.sqlite3");
        let mut connection = open_database(&path).unwrap();
        set_consent(&connection, FeedbackConsentMode::Local).unwrap();
        insert_events(&mut connection, &validated("committed")).unwrap();

        {
            let transaction = connection
                .transaction_with_behavior(TransactionBehavior::Immediate)
                .unwrap();
            transaction
                .execute(
                    "INSERT INTO feedback_events (
                        event_id, schema_version, occurred_at_unix_ms, persisted_at_unix_ms,
                        session_id, app_version, privacy_class, kind, event_json, serialized_bytes
                    ) VALUES ('interrupted', 1, 1, 1, 's', '0.1.0', 'operational',
                              'session.started', '{}', 2)",
                    [],
                )
                .unwrap();
        }
        drop(connection);

        let reopened = open_database(&path).unwrap();
        let count: i64 = reopened
            .query_row("SELECT COUNT(*) FROM feedback_events", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 1);
        drop(reopened);
        fs::remove_dir_all(root).unwrap();
    }
}
