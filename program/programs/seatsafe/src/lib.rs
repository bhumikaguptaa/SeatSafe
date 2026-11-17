pub mod constants;
pub mod errors;
pub mod events;
pub mod instructions;
pub mod state;
pub mod utils;

use anchor_lang::prelude::*;

pub use constants::*;
pub use events::*;
pub use instructions::*;
pub use state::*;

declare_id!("7fnVUPd18tDr2CbEgjTxt55Emq4CMMskR9qxprjQjypy");

#[program]
pub mod seatsafe {
    use super::*;

    // ----- Setup -----
    pub fn init_config(
        ctx: Context<InitConfig>,
        arbiter: Pubkey,
        treasury: Pubkey,
        fee_bps: u16,
        dispute_window_secs: i64,
    ) -> Result<()> {
        instructions::init_config::handle_init_config(ctx, arbiter, treasury, fee_bps, dispute_window_secs)
    }

    // ----- Tier 1: primary sale -----
    pub fn create_event(
        ctx: Context<CreateEvent>,
        event_id: u64,
        price: u64,
        supply: u32,
        resale_cap: u64,
        royalty_bps: u16,
        starts_at: i64,
    ) -> Result<()> {
        instructions::create_event::handle_create_event(
            ctx, event_id, price, supply, resale_cap, royalty_bps, starts_at,
        )
    }

    pub fn buy_primary(ctx: Context<BuyPrimary>, seat: String) -> Result<()> {
        instructions::buy_primary::handle_buy_primary(ctx, seat)
    }

    // ----- Tier 1: resale -----
    pub fn list_resale(ctx: Context<ListResale>, price: u64) -> Result<()> {
        instructions::list_resale::handle_list_resale(ctx, price)
    }

    pub fn cancel_listing(ctx: Context<CancelListing>) -> Result<()> {
        instructions::cancel_listing::handle_cancel_listing(ctx)
    }

    pub fn swap_resale(ctx: Context<SwapResale>) -> Result<()> {
        instructions::swap_resale::handle_swap_resale(ctx)
    }

    // ----- Tier 2: escrow -----
    pub fn create_escrow_listing(
        ctx: Context<CreateEscrowListing>,
        order_id: u64,
        price: u64,
        bond: u64,
        ship_window_secs: i64,
        confirm_window_secs: i64,
    ) -> Result<()> {
        instructions::escrow::handle_create_escrow_listing(
            ctx, order_id, price, bond, ship_window_secs, confirm_window_secs,
        )
    }

    pub fn fund_escrow(ctx: Context<FundEscrow>) -> Result<()> {
        instructions::escrow::handle_fund_escrow(ctx)
    }

    pub fn mark_sent(ctx: Context<MarkSent>) -> Result<()> {
        instructions::escrow::handle_mark_sent(ctx)
    }

    pub fn confirm_receipt(ctx: Context<SettleEscrow>) -> Result<()> {
        instructions::escrow_settle::handle_confirm_receipt(ctx)
    }

    pub fn refund_expired(ctx: Context<SettleEscrow>) -> Result<()> {
        instructions::escrow_settle::handle_refund_expired(ctx)
    }

    pub fn release_expired(ctx: Context<SettleEscrow>) -> Result<()> {
        instructions::escrow_settle::handle_release_expired(ctx)
    }

    pub fn cancel_escrow_listing(ctx: Context<CancelEscrowListing>) -> Result<()> {
        instructions::escrow::handle_cancel_escrow_listing(ctx)
    }

    pub fn open_dispute(ctx: Context<OpenDispute>) -> Result<()> {
        instructions::escrow::handle_open_dispute(ctx)
    }

    pub fn resolve_dispute(ctx: Context<SettleEscrow>, buyer_bps: u16) -> Result<()> {
        instructions::escrow_settle::handle_resolve_dispute(ctx, buyer_bps)
    }

    pub fn dispute_timeout(ctx: Context<SettleEscrow>) -> Result<()> {
        instructions::escrow_settle::handle_dispute_timeout(ctx)
    }

    // ----- Standing orders (agents) -----
    pub fn open_standing_order(
        ctx: Context<OpenStandingOrder>,
        order_id: u64,
        max_price: u64,
        quantity: u32,
        deadline_secs: i64,
    ) -> Result<()> {
        instructions::standing_order::handle_open_standing_order(
            ctx, order_id, max_price, quantity, deadline_secs,
        )
    }

    pub fn fill_standing_order(ctx: Context<FillStandingOrder>) -> Result<()> {
        instructions::standing_order::handle_fill_standing_order(ctx)
    }

    pub fn close_standing_order(ctx: Context<CloseStandingOrder>) -> Result<()> {
        instructions::standing_order::handle_close_standing_order(ctx)
    }
}
