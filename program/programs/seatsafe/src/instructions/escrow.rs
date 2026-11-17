//! Tier 2 escrow for outside tickets: list (seller bond), fund, mark sent, cancel, open dispute.
//! Payouts live in escrow_settle.rs.

use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token_interface::{Mint, TokenAccount, TokenInterface},
};

use crate::{
    constants::*,
    errors::SeatSafeError,
    events::*,
    state::{Config, EscrowOrder, EscrowState},
    utils::*,
};

pub fn escrow_signer_seeds<'a>(
    escrow: &'a EscrowOrder,
    order_id_bytes: &'a [u8; 8],
    bump: &'a [u8; 1],
) -> [&'a [u8]; 4] {
    [ESCROW_SEED, escrow.seller.as_ref(), order_id_bytes, bump]
}

// ---------------------------------------------------------------------------
// create_escrow_listing
// ---------------------------------------------------------------------------

#[derive(Accounts)]
#[instruction(order_id: u64)]
pub struct CreateEscrowListing<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    pub seller: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
    #[account(
        init,
        payer = payer,
        space = 8 + EscrowOrder::INIT_SPACE,
        seeds = [ESCROW_SEED, seller.key().as_ref(), &order_id.to_le_bytes()],
        bump
    )]
    pub escrow: Box<Account<'info, EscrowOrder>>,
    #[account(address = config.usdc_mint, mint::token_program = token_program)]
    pub usdc_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        mut,
        token::mint = usdc_mint,
        token::authority = seller,
        token::token_program = token_program
    )]
    pub seller_usdc: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        init,
        payer = payer,
        associated_token::mint = usdc_mint,
        associated_token::authority = escrow,
        associated_token::token_program = token_program
    )]
    pub escrow_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn handle_create_escrow_listing(
    ctx: Context<CreateEscrowListing>,
    order_id: u64,
    price: u64,
    bond: u64,
    ship_window_secs: i64,
    confirm_window_secs: i64,
) -> Result<()> {
    require!(price > 0, SeatSafeError::InvalidAmount);
    require!(
        ship_window_secs > 0 && confirm_window_secs > 0,
        SeatSafeError::InvalidWindow
    );
    let a = &ctx.accounts;
    transfer_tokens(
        &a.token_program.to_account_info(),
        &a.seller_usdc.to_account_info(),
        &a.escrow_vault.to_account_info(),
        &a.usdc_mint.to_account_info(),
        &a.seller.to_account_info(),
        bond,
        a.usdc_mint.decimals,
        &[],
    )?;

    let seller = a.seller.key();
    let escrow = &mut ctx.accounts.escrow;
    escrow.seller = seller;
    escrow.buyer = None;
    escrow.order_id = order_id;
    escrow.price = price;
    escrow.bond = bond;
    escrow.state = EscrowState::Listed;
    escrow.ship_deadline = 0;
    escrow.confirm_deadline = 0;
    escrow.ship_window_secs = ship_window_secs;
    escrow.confirm_window_secs = confirm_window_secs;
    escrow.dispute_deadline = 0;
    escrow.bump = ctx.bumps.escrow;

    emit!(EscrowListed {
        escrow: escrow.key(),
        seller,
        order_id,
        price,
        bond,
        ship_window_secs,
        confirm_window_secs,
        at: Clock::get()?.unix_timestamp,
    });
    Ok(())
}

// ---------------------------------------------------------------------------
// fund_escrow
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct FundEscrow<'info> {
    pub buyer: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
    #[account(
        mut,
        seeds = [ESCROW_SEED, escrow.seller.as_ref(), &escrow.order_id.to_le_bytes()],
        bump = escrow.bump
    )]
    pub escrow: Box<Account<'info, EscrowOrder>>,
    #[account(address = config.usdc_mint, mint::token_program = token_program)]
    pub usdc_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        mut,
        token::mint = usdc_mint,
        token::authority = buyer,
        token::token_program = token_program
    )]
    pub buyer_usdc: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        mut,
        associated_token::mint = usdc_mint,
        associated_token::authority = escrow,
        associated_token::token_program = token_program
    )]
    pub escrow_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    pub token_program: Interface<'info, TokenInterface>,
}

pub fn handle_fund_escrow(ctx: Context<FundEscrow>) -> Result<()> {
    let a = &ctx.accounts;
    require!(a.escrow.state == EscrowState::Listed, SeatSafeError::InvalidState);
    require_keys_neq!(a.buyer.key(), a.escrow.seller, SeatSafeError::BuyerIsSeller);

    transfer_tokens(
        &a.token_program.to_account_info(),
        &a.buyer_usdc.to_account_info(),
        &a.escrow_vault.to_account_info(),
        &a.usdc_mint.to_account_info(),
        &a.buyer.to_account_info(),
        a.escrow.price,
        a.usdc_mint.decimals,
        &[],
    )?;

    let now = Clock::get()?.unix_timestamp;
    let buyer = a.buyer.key();
    let escrow = &mut ctx.accounts.escrow;
    escrow.buyer = Some(buyer);
    escrow.ship_deadline = add_secs(now, escrow.ship_window_secs)?;
    escrow.state = EscrowState::Funded;

    emit!(OrderFunded {
        escrow: escrow.key(),
        buyer,
        seller: escrow.seller,
        price: escrow.price,
        ship_deadline: escrow.ship_deadline,
        at: now,
    });
    Ok(())
}

// ---------------------------------------------------------------------------
// mark_sent
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct MarkSent<'info> {
    pub seller: Signer<'info>,
    #[account(
        mut,
        seeds = [ESCROW_SEED, escrow.seller.as_ref(), &escrow.order_id.to_le_bytes()],
        bump = escrow.bump,
        has_one = seller @ SeatSafeError::Unauthorized
    )]
    pub escrow: Box<Account<'info, EscrowOrder>>,
}

pub fn handle_mark_sent(ctx: Context<MarkSent>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let escrow = &mut ctx.accounts.escrow;
    require!(escrow.state == EscrowState::Funded, SeatSafeError::InvalidState);
    require!(now <= escrow.ship_deadline, SeatSafeError::DeadlinePassed);

    escrow.state = EscrowState::Sent;
    escrow.confirm_deadline = add_secs(now, escrow.confirm_window_secs)?;

    emit!(TicketSent {
        escrow: escrow.key(),
        seller: escrow.seller,
        buyer: escrow.buyer.unwrap_or_default(),
        confirm_deadline: escrow.confirm_deadline,
        at: now,
    });
    Ok(())
}

// ---------------------------------------------------------------------------
// cancel_escrow_listing
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct CancelEscrowListing<'info> {
    pub seller: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
    #[account(
        mut,
        seeds = [ESCROW_SEED, escrow.seller.as_ref(), &escrow.order_id.to_le_bytes()],
        bump = escrow.bump,
        has_one = seller @ SeatSafeError::Unauthorized
    )]
    pub escrow: Box<Account<'info, EscrowOrder>>,
    #[account(address = config.usdc_mint, mint::token_program = token_program)]
    pub usdc_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        mut,
        token::mint = usdc_mint,
        token::authority = seller,
        token::token_program = token_program
    )]
    pub seller_usdc: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        mut,
        associated_token::mint = usdc_mint,
        associated_token::authority = escrow,
        associated_token::token_program = token_program
    )]
    pub escrow_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    pub token_program: Interface<'info, TokenInterface>,
}

pub fn handle_cancel_escrow_listing(ctx: Context<CancelEscrowListing>) -> Result<()> {
    let a = &ctx.accounts;
    require!(a.escrow.state == EscrowState::Listed, SeatSafeError::InvalidState);

    let order_id_bytes = a.escrow.order_id.to_le_bytes();
    let bump = [a.escrow.bump];
    let seeds = escrow_signer_seeds(&a.escrow, &order_id_bytes, &bump);
    let bond = a.escrow.bond;
    transfer_tokens(
        &a.token_program.to_account_info(),
        &a.escrow_vault.to_account_info(),
        &a.seller_usdc.to_account_info(),
        &a.usdc_mint.to_account_info(),
        &a.escrow.to_account_info(),
        bond,
        a.usdc_mint.decimals,
        &[&seeds],
    )?;

    let escrow = &mut ctx.accounts.escrow;
    escrow.state = EscrowState::Cancelled;
    emit!(EscrowCancelled {
        escrow: escrow.key(),
        seller: escrow.seller,
        bond_returned: bond,
        at: Clock::get()?.unix_timestamp,
    });
    Ok(())
}

// ---------------------------------------------------------------------------
// open_dispute
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct OpenDispute<'info> {
    /// Buyer or seller of this escrow.
    pub caller: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
    #[account(
        mut,
        seeds = [ESCROW_SEED, escrow.seller.as_ref(), &escrow.order_id.to_le_bytes()],
        bump = escrow.bump
    )]
    pub escrow: Box<Account<'info, EscrowOrder>>,
}

pub fn handle_open_dispute(ctx: Context<OpenDispute>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let caller = ctx.accounts.caller.key();
    let window = ctx.accounts.config.dispute_window_secs;
    let escrow = &mut ctx.accounts.escrow;
    require!(
        caller == escrow.seller || Some(caller) == escrow.buyer,
        SeatSafeError::Unauthorized
    );
    // A dispute can only be opened while the current deadline is still running, so it
    // can't be used to block an automatic refund/release that is already due.
    match escrow.state {
        EscrowState::Funded => require!(now <= escrow.ship_deadline, SeatSafeError::DeadlinePassed),
        EscrowState::Sent => require!(now <= escrow.confirm_deadline, SeatSafeError::DeadlinePassed),
        _ => return err!(SeatSafeError::InvalidState),
    }

    escrow.state = EscrowState::Disputed;
    escrow.dispute_deadline = add_secs(now, window)?;

    emit!(DisputeOpened {
        escrow: escrow.key(),
        opened_by: caller,
        dispute_deadline: escrow.dispute_deadline,
        at: now,
    });
    Ok(())
}
