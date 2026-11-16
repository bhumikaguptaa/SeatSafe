use anchor_lang::prelude::*;

/// Emitted by `initialize`. B's QuickNode Stream uses it to test event ingestion.
#[event]
pub struct SkeletonPing {
    pub at: i64,
}
