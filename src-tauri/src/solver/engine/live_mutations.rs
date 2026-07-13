pub(crate) fn take_live_mutations(
    pending: &mut Vec<crate::ComponentMutation>,
    live_run_id: Option<u64>,
) -> Vec<crate::ComponentMutation> {
    let mut applicable = Vec::new();
    pending.retain(|mutation| {
        if live_run_id.is_none_or(|run_id| mutation.run_id == run_id) {
            applicable.push(mutation.clone());
            false
        } else {
            true
        }
    });
    applicable
}

#[cfg(test)]
mod tests {
    use super::take_live_mutations;

    fn mutation(run_id: u64, value: f64) -> crate::ComponentMutation {
        crate::ComponentMutation {
            component_id: "R1".to_string(),
            field: "value".to_string(),
            value,
            run_id,
        }
    }

    #[test]
    fn live_mutations_are_consumed_only_by_their_run() {
        let mut pending = vec![mutation(10, 100.0), mutation(11, 220.0)];

        let current = take_live_mutations(&mut pending, Some(11));

        assert_eq!(current.len(), 1);
        assert_eq!(current[0].value, 220.0);
        assert_eq!(pending.len(), 1);
        assert_eq!(pending[0].run_id, 10);
    }
}
