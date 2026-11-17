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
}
