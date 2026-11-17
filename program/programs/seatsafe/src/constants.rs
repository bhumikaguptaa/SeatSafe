use anchor_lang::prelude::*;

// PDA seeds
#[constant]
pub const CONFIG_SEED: &[u8] = b"config";
#[constant]
pub const EVENT_SEED: &[u8] = b"event";
#[constant]
pub const TICKET_SEED: &[u8] = b"ticket";
#[constant]
pub const TICKET_MINT_SEED: &[u8] = b"ticket_mint";
#[constant]
pub const TICKET_AUTHORITY_SEED: &[u8] = b"ticket_authority";
#[constant]
pub const LISTING_SEED: &[u8] = b"listing";
#[constant]
pub const ESCROW_SEED: &[u8] = b"escrow";
#[constant]
pub const STANDING_SEED: &[u8] = b"standing";

/// 10_000 basis points = 100%.
#[constant]
pub const BPS_DENOMINATOR: u16 = 10_000;
/// royalty_bps + fee_bps may not exceed 50%.
#[constant]
pub const MAX_ROYALTY_PLUS_FEE_BPS: u16 = 5_000;
/// Max bytes in a ticket's seat label.
pub const MAX_SEAT_LEN: usize = 32;
