mod basic_sources {
    include!("transient/basic_sources.rs");
}

mod integration_methods {
    include!("transient/integration_methods.rs");
}

mod device_transients {
    include!("transient/device_transients.rs");
}

mod adaptive_order {
    include!("transient/adaptive_order.rs");
}

mod waveform_relaxation {
    include!("transient/waveform_relaxation.rs");
}

mod live_overrides {
    include!("transient/live_overrides.rs");
}

mod event_clipping {
    include!("transient/event_clipping.rs");
}
