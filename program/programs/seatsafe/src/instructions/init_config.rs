use anchor_lang::prelude::*;
use anchor_spl::token_interface::Mint;

use crate::{constants::*, errors::SeatSafeError, events::ConfigInitialized, state::Config};

#[derive(Accounts)]
pub struct InitConfig<'info> {
    /// Relayer: pays rent.
    #[account(mut)]
    pub payer: Signer<'info>,
    /// Becomes Config.admin.
    pub admin: Signer<'info>,
    #[account(
        init,
        payer = payer,
        space = 8 + Config::INIT_SPACE,
        seeds = [CONFIG_SEED],
        bump
    )]
    pub config: Account<'info, Config>,
    /// USDC mint (devnet: Circle USDC; tests: a mock 6-decimal mint).
    pub usdc_mint: InterfaceAccount<'info, Mint>,
    pub system_program: Program<'info, System>,
}

pub fn handle_init_config(
    ctx: Context<InitConfig>,
    arbiter: Pubkey,
    treasury: Pubkey,
    fee_bps: u16,
    dispute_window_secs: i64,
) -> Result<()> {
    require!(fee_bps <= MAX_ROYALTY_PLUS_FEE_BPS, SeatSafeError::InvalidBps);
    require!(dispute_window_secs > 0, SeatSafeError::InvalidWindow);

    let config = &mut ctx.accounts.config;
    config.admin = ctx.accounts.admin.key();
    config.arbiter = arbiter;
    config.treasury = treasury;
    config.usdc_mint = ctx.accounts.usdc_mint.key();
    config.fee_bps = fee_bps;
    config.dispute_window_secs = dispute_window_secs;
    config.bump = ctx.bumps.config;

    emit!(ConfigInitialized {
        config: config.key(),
        admin: config.admin,
        arbiter,
        treasury,
        usdc_mint: config.usdc_mint,
        fee_bps,
        at: Clock::get()?.unix_timestamp,
    });
    Ok(())
}
