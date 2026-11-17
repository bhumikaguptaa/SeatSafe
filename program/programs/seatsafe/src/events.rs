// One event per state change. Every event carries `at` (unix seconds).
// Amounts are USDC base units (6 decimals).
use anchor_lang::prelude::*;

#[event]
pub struct ConfigInitialized {
    pub config: Pubkey,
    pub admin: Pubkey,
    pub arbiter: Pubkey,
    pub treasury: Pubkey,
    pub usdc_mint: Pubkey,
    pub fee_bps: u16,
    pub at: i64,
}

#[event]
pub struct EventCreated {
    pub event: Pubkey,
    pub organizer: Pubkey,
    pub event_id: u64,
    pub price: u64,
    pub supply: u32,
    pub resale_cap: u64,
    pub royalty_bps: u16,
    pub starts_at: i64,
    pub at: i64,
}

#[event]
pub struct TicketMinted {
    pub event: Pubkey,
    pub ticket_mint: Pubkey,
    pub buyer: Pubkey,
    pub seat: String,
    pub price: u64,
    pub organizer_amount: u64,
    pub fee: u64,
    pub sold: u32,
    pub at: i64,
}

#[event]
pub struct ListingCreated {
    pub listing: Pubkey,
    pub ticket_mint: Pubkey,
    pub event: Pubkey,
    pub seller: Pubkey,
    pub price: u64,
    pub at: i64,
}

#[event]
pub struct ListingCancelled {
    pub listing: Pubkey,
    pub ticket_mint: Pubkey,
    pub seller: Pubkey,
    pub at: i64,
}

#[event]
pub struct TicketSwapped {
    pub listing: Pubkey,
    pub ticket_mint: Pubkey,
    pub event: Pubkey,
    pub seller: Pubkey,
    /// Wallet that received the ticket (the standing order owner when filled by an agent).
    pub buyer: Pubkey,
    pub price: u64,
    pub seller_amount: u64,
    pub royalty: u64,
    pub fee: u64,
    pub at: i64,
}

#[event]
pub struct EscrowListed {
    pub escrow: Pubkey,
    pub seller: Pubkey,
    pub order_id: u64,
    pub price: u64,
    pub bond: u64,
    pub ship_window_secs: i64,
    pub confirm_window_secs: i64,
    pub at: i64,
}

#[event]
pub struct OrderFunded {
    pub escrow: Pubkey,
    pub buyer: Pubkey,
    pub seller: Pubkey,
    pub price: u64,
    pub ship_deadline: i64,
    pub at: i64,
}

#[event]
pub struct TicketSent {
    pub escrow: Pubkey,
    pub seller: Pubkey,
    pub buyer: Pubkey,
    pub confirm_deadline: i64,
    pub at: i64,
}

#[event]
pub struct OrderCompleted {
    pub escrow: Pubkey,
    pub buyer: Pubkey,
    pub seller: Pubkey,
    pub seller_amount: u64,
    pub fee: u64,
    pub bond_returned: u64,
    /// true when released by release_expired (buyer never confirmed)
    pub auto: bool,
    pub at: i64,
}

#[event]
pub struct OrderRefunded {
    pub escrow: Pubkey,
    pub buyer: Pubkey,
    pub seller: Pubkey,
    /// price + bond paid to the buyer
    pub amount: u64,
    pub at: i64,
}

#[event]
pub struct EscrowCancelled {
    pub escrow: Pubkey,
    pub seller: Pubkey,
    pub bond_returned: u64,
    pub at: i64,
}

#[event]
pub struct DisputeOpened {
    pub escrow: Pubkey,
    pub opened_by: Pubkey,
    pub dispute_deadline: i64,
    pub at: i64,
}

#[event]
pub struct DisputeResolved {
    pub escrow: Pubkey,
    pub buyer: Pubkey,
    pub seller: Pubkey,
    pub buyer_amount: u64,
    pub seller_amount: u64,
    /// true when settled by dispute_timeout instead of the arbiter
    pub timeout: bool,
    pub at: i64,
}

#[event]
pub struct StandingOrderOpened {
    pub standing_order: Pubkey,
    pub owner: Pubkey,
    pub order_id: u64,
    pub event: Pubkey,
    pub max_price: u64,
    pub quantity: u32,
    pub budget: u64,
    pub deadline: i64,
    pub at: i64,
}

#[event]
pub struct StandingOrderFilled {
    pub standing_order: Pubkey,
    pub owner: Pubkey,
    pub listing: Pubkey,
    pub ticket_mint: Pubkey,
    pub price: u64,
    pub filled: u32,
    pub quantity: u32,
    pub crank: Pubkey,
    pub at: i64,
}

#[event]
pub struct StandingOrderClosed {
    pub standing_order: Pubkey,
    pub owner: Pubkey,
    pub refunded: u64,
    pub filled: u32,
    pub closed_by: Pubkey,
    pub at: i64,
}
