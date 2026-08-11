use super::schema::{
    FeedbackEventDataV1, FeedbackEventV1, FeedbackPrivacyClass, FEEDBACK_EVENT_CATALOG,
    FEEDBACK_SCHEMA_VERSION,
};
use std::collections::HashSet;

const SESSION_STARTED: &str = r#"{
  "schemaVersion": 1,
  "eventId": "event-1",
  "occurredAtUnixMs": 1785460000000,
  "sessionId": "session-1",
  "appVersion": "0.1.0",
  "privacyClass": "operational",
  "kind": "session.started",
  "payload": {
    "os": "Windows",
    "locale": "es-MX"
  }
}"#;

#[test]
fn generated_catalog_has_unique_event_kinds() {
    assert_eq!(FEEDBACK_SCHEMA_VERSION, 1);
    assert_eq!(FEEDBACK_EVENT_CATALOG.len(), 18);

    let unique = FEEDBACK_EVENT_CATALOG
        .iter()
        .map(|(kind, _)| *kind)
        .collect::<HashSet<_>>();
    assert_eq!(unique.len(), FEEDBACK_EVENT_CATALOG.len());
}

#[test]
fn event_round_trip_preserves_envelope_and_payload() {
    let event: FeedbackEventV1 = serde_json::from_str(SESSION_STARTED).unwrap();
    assert_eq!(event.event.kind(), "session.started");
    assert_eq!(event.privacy_class, FeedbackPrivacyClass::Operational);
    assert!(event.validate_envelope().is_ok());

    match &event.event {
        FeedbackEventDataV1::SessionStarted(payload) => {
            assert_eq!(payload.os, "Windows");
            assert_eq!(payload.locale.as_deref(), Some("es-MX"));
        }
        other => panic!("unexpected event variant: {other:?}"),
    }

    let encoded = serde_json::to_string(&event).unwrap();
    let decoded: FeedbackEventV1 = serde_json::from_str(&encoded).unwrap();
    assert_eq!(decoded, event);
}

#[test]
fn envelope_rejects_privacy_class_mismatch() {
    let mut event: FeedbackEventV1 = serde_json::from_str(SESSION_STARTED).unwrap();
    event.privacy_class = FeedbackPrivacyClass::CircuitDerived;

    assert_eq!(
        event.validate_envelope(),
        Err("privacyClass does not match event kind"),
    );
}
