#[path = "schema.generated.rs"]
pub mod schema;

pub(crate) mod store;

pub use store::{
    delete_feedback_data, export_feedback_events, flush_feedback_store, get_feedback_status,
    ingest_feedback_batch, query_feedback_events, set_feedback_consent, FeedbackState,
};

#[cfg(test)]
mod tests;
