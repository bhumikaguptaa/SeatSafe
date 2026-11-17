use anchor_lang::prelude::*;

use crate::{
    constants::*,
    errors::SeatSafeError,
    events::EventCreated,
    state::{Config, Event},
};

#[derive(Accounts)]
#[instruction(event_id: u64)]
pub struct CreateEvent<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    pub organizer: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(
        init,
        payer = payer,
        space = 8 + Event::INIT_SPACE,
        seeds = [EVENT_SEED, organizer.key().as_ref(), &event_id.to_le_bytes()],
        bump
    )]
    pub event: Account<'info, Event>,
    pub system_program: Program<'info, System>,
}

pub fn handle_create_event(
    ctx: Context<CreateEvent>,
    event_id: u64,
    price: u64,
    supply: u32,
    resale_cap: u64,
    royalty_bps: u16,
    starts_at: i64,
) -> Result<()> {
    require!(price > 0, SeatSafeError::InvalidAmount);
    require!(supply > 0, SeatSafeError::InvalidAmount);
    require!(resale_cap >= price, SeatSafeError::InvalidResaleCap);
    let total_bps = (royalty_bps as u32) + (ctx.accounts.config.fee_bps as u32);
    require!(
        total_bps <= MAX_ROYALTY_PLUS_FEE_BPS as u32,
        SeatSafeError::InvalidRoyalty
    );

    let event = &mut ctx.accounts.event;
    event.organizer = ctx.accounts.organizer.key();
    event.event_id = event_id;
    event.price = price;
    event.supply = supply;
    event.sold = 0;
    event.resale_cap = resale_cap;
    event.royalty_bps = royalty_bps;
    event.starts_at = starts_at;
    event.bump = ctx.bumps.event;

    emit!(EventCreated {
        event: event.key(),
        organizer: event.organizer,
        event_id,
        price,
        supply,
        resale_cap,
        royalty_bps,
        starts_at,
        at: Clock::get()?.unix_timestamp,
    });
    Ok(())
}
