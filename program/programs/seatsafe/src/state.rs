use anchor_lang::prelude::*;

use crate::constants::MAX_SEAT_LEN;

/// Global settings. PDA ["config"].
#[account]
#[derive(InitSpace)]
pub struct Config {
    pub admin: Pubkey,
    /// Only signer allowed to split a disputed escrow.
    pub arbiter: Pubkey,
    /// Owner of the treasury USDC token account (its ATA receives fees).
    pub treasury: Pubkey,
    pub usdc_mint: Pubkey,
    /// Platform fee in basis points (300 = 3%).
    pub fee_bps: u16,
    /// How long a dispute stays open before anyone can trigger the timeout payout.
    pub dispute_window_secs: i64,
    pub bump: u8,
}

/// An artist's event. PDA ["event", organizer, event_id (u64 LE)].
#[account]
#[derive(InitSpace)]
pub struct Event {
    pub organizer: Pubkey,
    pub event_id: u64,
    /// Face price in USDC base units (6 decimals).
    pub price: u64,
    pub supply: u32,
    pub sold: u32,
    /// Max resale price in USDC base units.
    pub resale_cap: u64,
    pub royalty_bps: u16,
    pub starts_at: i64,
    pub bump: u8,
}

/// One per Tier 1 ticket. PDA ["ticket", ticket_mint].
#[account]
#[derive(InitSpace)]
pub struct TicketRecord {
    pub event: Pubkey,
    pub mint: Pubkey,
    #[max_len(MAX_SEAT_LEN)]
    pub seat: String,
    pub original_buyer: Pubkey,
    pub bump: u8,
}

/// Tier 1 resale listing. PDA ["listing", ticket_mint]. The ticket sits in the
/// listing vault (this PDA's Token-2022 ATA for the ticket mint).
#[account]
#[derive(InitSpace)]
pub struct Listing {
    pub seller: Pubkey,
    pub ticket_mint: Pubkey,
    pub event: Pubkey,
    pub price: u64,
    pub created_at: i64,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace, Debug)]
pub enum EscrowState {
    Listed,
    Funded,
    Sent,
    Completed,
    Refunded,
    Cancelled,
    Disputed,
    Resolved,
}

/// Tier 2 escrow for an outside ticket. PDA ["escrow", seller, order_id (u64 LE)].
/// USDC (bond, then price) sits in this PDA's USDC ATA.
#[account]
#[derive(InitSpace)]
pub struct EscrowOrder {
    pub seller: Pubkey,
    pub buyer: Option<Pubkey>,
    pub order_id: u64,
    pub price: u64,
    pub bond: u64,
    pub state: EscrowState,
    pub ship_deadline: i64,
    pub confirm_deadline: i64,
    pub ship_window_secs: i64,
    pub confirm_window_secs: i64,
    pub dispute_deadline: i64,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace, Debug)]
pub enum StandingOrderState {
    Open,
    Filled,
    Closed,
}

/// Agent standing order. PDA ["standing", owner, order_id (u64 LE)].
/// Budget (max_price * quantity USDC) sits in this PDA's USDC ATA.
#[account]
#[derive(InitSpace)]
pub struct StandingOrder {
    pub owner: Pubkey,
    pub order_id: u64,
    pub event: Pubkey,
    pub max_price: u64,
    pub quantity: u32,
    pub filled: u32,
    pub deadline: i64,
    pub state: StandingOrderState,
    pub bump: u8,
}
