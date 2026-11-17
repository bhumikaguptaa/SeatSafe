//! Agent standing orders: lock a USDC budget, let a crank fill it from matching
//! Tier 1 listings, refund whatever is left on close.

use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token_2022::Token2022,
    token_interface::{Mint, TokenAccount, TokenInterface},
};

use crate::{
    constants::*,
    errors::SeatSafeError,
    events::*,
    instructions::swap_resale::{settle_resale, ResaleSettlement},
    state::{Config, Event, Listing, StandingOrder, StandingOrderState},
    utils::*,
};

// ---------------------------------------------------------------------------
// open_standing_order
// ---------------------------------------------------------------------------

#[derive(Accounts)]
#[instruction(order_id: u64)]
pub struct OpenStandingOrder<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    pub owner: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
    /// The event this order buys for.
    #[account(
        seeds = [EVENT_SEED, event.organizer.as_ref(), &event.event_id.to_le_bytes()],
        bump = event.bump
    )]
    pub event: Box<Account<'info, Event>>,
    #[account(
        init,
        payer = payer,
        space = 8 + StandingOrder::INIT_SPACE,
        seeds = [STANDING_SEED, owner.key().as_ref(), &order_id.to_le_bytes()],
        bump
    )]
    pub standing_order: Box<Account<'info, StandingOrder>>,
    #[account(address = config.usdc_mint, mint::token_program = token_program)]
    pub usdc_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        mut,
        token::mint = usdc_mint,
        token::authority = owner,
        token::token_program = token_program
    )]
    pub owner_usdc: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        init,
        payer = payer,
        associated_token::mint = usdc_mint,
        associated_token::authority = standing_order,
        associated_token::token_program = token_program
    )]
    pub budget_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn handle_open_standing_order(
    ctx: Context<OpenStandingOrder>,
    order_id: u64,
    max_price: u64,
    quantity: u32,
    deadline_secs: i64,
) -> Result<()> {
    require!(max_price > 0 && quantity > 0, SeatSafeError::InvalidAmount);
    require!(deadline_secs > 0, SeatSafeError::InvalidWindow);
    let budget = max_price
        .checked_mul(quantity as u64)
        .ok_or(SeatSafeError::MathOverflow)?;

    let a = &ctx.accounts;
    transfer_tokens(
        &a.token_program.to_account_info(),
        &a.owner_usdc.to_account_info(),
        &a.budget_vault.to_account_info(),
        &a.usdc_mint.to_account_info(),
        &a.owner.to_account_info(),
        budget,
        a.usdc_mint.decimals,
        &[],
    )?;

    let now = Clock::get()?.unix_timestamp;
    let owner = a.owner.key();
    let event = a.event.key();
    let order = &mut ctx.accounts.standing_order;
    order.owner = owner;
    order.order_id = order_id;
    order.event = event;
    order.max_price = max_price;
    order.quantity = quantity;
    order.filled = 0;
    order.deadline = add_secs(now, deadline_secs)?;
    order.state = StandingOrderState::Open;
    order.bump = ctx.bumps.standing_order;

    emit!(StandingOrderOpened {
        standing_order: order.key(),
        owner,
        order_id,
        event,
        max_price,
        quantity,
        budget,
        deadline: order.deadline,
        at: now,
    });
    Ok(())
}

// ---------------------------------------------------------------------------
// fill_standing_order
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct FillStandingOrder<'info> {
    /// Relayer: pays for missing ATAs; receives the closed listing's and vault's rent.
    #[account(mut)]
    pub payer: Signer<'info>,
    /// Any crank (our backend). Trusted only to pick a listing; all rules are checked here.
    pub crank: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
    #[account(
        mut,
        seeds = [STANDING_SEED, standing_order.owner.as_ref(), &standing_order.order_id.to_le_bytes()],
        bump = standing_order.bump
    )]
    pub standing_order: Box<Account<'info, StandingOrder>>,
    /// CHECK: must be the standing order owner; receives the ticket.
    #[account(address = standing_order.owner)]
    pub owner: UncheckedAccount<'info>,
    #[account(mint::token_program = ticket_token_program)]
    pub ticket_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        mut,
        seeds = [LISTING_SEED, ticket_mint.key().as_ref()],
        bump = listing.bump,
        close = payer
    )]
    pub listing: Box<Account<'info, Listing>>,
    #[account(address = listing.event)]
    pub event: Box<Account<'info, Event>>,
    /// CHECK: must be the listing's seller; only used as USDC ATA owner.
    #[account(address = listing.seller)]
    pub seller: UncheckedAccount<'info>,
    /// CHECK: must be the event organizer; only used as USDC ATA owner.
    #[account(address = event.organizer)]
    pub organizer: UncheckedAccount<'info>,
    /// CHECK: must be the configured treasury; only used as USDC ATA owner.
    #[account(address = config.treasury)]
    pub treasury: UncheckedAccount<'info>,
    #[account(address = config.usdc_mint, mint::token_program = token_program)]
    pub usdc_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        mut,
        associated_token::mint = usdc_mint,
        associated_token::authority = standing_order,
        associated_token::token_program = token_program
    )]
    pub budget_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        init_if_needed,
        payer = payer,
        associated_token::mint = usdc_mint,
        associated_token::authority = seller,
        associated_token::token_program = token_program
    )]
    pub seller_usdc: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        init_if_needed,
        payer = payer,
        associated_token::mint = usdc_mint,
        associated_token::authority = organizer,
        associated_token::token_program = token_program
    )]
    pub organizer_usdc: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        init_if_needed,
        payer = payer,
        associated_token::mint = usdc_mint,
        associated_token::authority = treasury,
        associated_token::token_program = token_program
    )]
    pub treasury_usdc: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        mut,
        associated_token::mint = ticket_mint,
        associated_token::authority = listing,
        associated_token::token_program = ticket_token_program
    )]
    pub listing_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        init_if_needed,
        payer = payer,
        associated_token::mint = ticket_mint,
        associated_token::authority = owner,
        associated_token::token_program = ticket_token_program
    )]
    pub owner_ticket_account: Box<InterfaceAccount<'info, TokenAccount>>,
    /// CHECK: freeze authority PDA. Holds no data.
    #[account(seeds = [TICKET_AUTHORITY_SEED], bump)]
    pub ticket_authority: UncheckedAccount<'info>,
    pub token_program: Interface<'info, TokenInterface>,
    pub ticket_token_program: Program<'info, Token2022>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn handle_fill_standing_order(ctx: Context<FillStandingOrder>) -> Result<()> {
    let a = &ctx.accounts;
    let order = &a.standing_order;
    let now = Clock::get()?.unix_timestamp;
    require!(order.state == StandingOrderState::Open, SeatSafeError::OrderFilled);
    require!(order.filled < order.quantity, SeatSafeError::OrderFilled);
    require!(now <= order.deadline, SeatSafeError::DeadlinePassed);
    require_keys_eq!(a.listing.event, order.event, SeatSafeError::WrongEvent);
    require!(a.listing.price <= order.max_price, SeatSafeError::PriceAboveMax);
    require_keys_neq!(a.listing.seller, order.owner, SeatSafeError::BuyerIsSeller);

    let mint_key = a.ticket_mint.key();
    let owner_key = order.owner;
    let order_id_bytes = order.order_id.to_le_bytes();
    let auth_bump = [ctx.bumps.ticket_authority];
    let listing_bump = [a.listing.bump];
    let order_bump = [order.bump];
    let signer: &[&[&[u8]]] = &[
        &[TICKET_AUTHORITY_SEED, &auth_bump],
        &[LISTING_SEED, mint_key.as_ref(), &listing_bump],
        &[STANDING_SEED, owner_key.as_ref(), &order_id_bytes, &order_bump],
    ];

    let s = ResaleSettlement {
        token_program: &a.token_program.to_account_info(),
        usdc_mint: &a.usdc_mint.to_account_info(),
        usdc_decimals: a.usdc_mint.decimals,
        from_usdc: &a.budget_vault.to_account_info(),
        from_authority: &a.standing_order.to_account_info(),
        seller_usdc: &a.seller_usdc.to_account_info(),
        organizer_usdc: &a.organizer_usdc.to_account_info(),
        treasury_usdc: &a.treasury_usdc.to_account_info(),
        ticket_token_program: &a.ticket_token_program.to_account_info(),
        ticket_mint: &a.ticket_mint.to_account_info(),
        listing: &a.listing.to_account_info(),
        listing_vault: &a.listing_vault.to_account_info(),
        dest_ticket: &a.owner_ticket_account.to_account_info(),
        ticket_authority: &a.ticket_authority.to_account_info(),
        rent_receiver: &a.payer.to_account_info(),
    };
    let price = a.listing.price;
    let (seller_amount, royalty, fee) =
        settle_resale(&s, price, a.event.royalty_bps, a.config.fee_bps, signer)?;

    let listing_key = a.listing.key();
    let seller = a.listing.seller;
    let event_key = a.event.key();
    let crank = a.crank.key();

    let order = &mut ctx.accounts.standing_order;
    order.filled = order.filled.checked_add(1).ok_or(SeatSafeError::MathOverflow)?;
    if order.filled == order.quantity {
        order.state = StandingOrderState::Filled;
    }

    emit!(TicketSwapped {
        listing: listing_key,
        ticket_mint: mint_key,
        event: event_key,
        seller,
        buyer: owner_key,
        price,
        seller_amount,
        royalty,
        fee,
        at: now,
    });
    emit!(StandingOrderFilled {
        standing_order: order.key(),
        owner: owner_key,
        listing: listing_key,
        ticket_mint: mint_key,
        price,
        filled: order.filled,
        quantity: order.quantity,
        crank,
        at: now,
    });
    Ok(())
}

// ---------------------------------------------------------------------------
// close_standing_order
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct CloseStandingOrder<'info> {
    /// Relayer: pays for the owner's USDC ATA if missing.
    #[account(mut)]
    pub payer: Signer<'info>,
    /// The owner (any time) or anyone (after the deadline).
    pub caller: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
    #[account(
        mut,
        seeds = [STANDING_SEED, standing_order.owner.as_ref(), &standing_order.order_id.to_le_bytes()],
        bump = standing_order.bump
    )]
    pub standing_order: Box<Account<'info, StandingOrder>>,
    /// CHECK: must be the standing order owner; receives the refund.
    #[account(address = standing_order.owner)]
    pub owner: UncheckedAccount<'info>,
    #[account(address = config.usdc_mint, mint::token_program = token_program)]
    pub usdc_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        mut,
        associated_token::mint = usdc_mint,
        associated_token::authority = standing_order,
        associated_token::token_program = token_program
    )]
    pub budget_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        init_if_needed,
        payer = payer,
        associated_token::mint = usdc_mint,
        associated_token::authority = owner,
        associated_token::token_program = token_program
    )]
    pub owner_usdc: Box<InterfaceAccount<'info, TokenAccount>>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn handle_close_standing_order(ctx: Context<CloseStandingOrder>) -> Result<()> {
    let a = &ctx.accounts;
    let order = &a.standing_order;
    let now = Clock::get()?.unix_timestamp;
    require!(order.state != StandingOrderState::Closed, SeatSafeError::InvalidState);
    if a.caller.key() != order.owner {
        require!(now > order.deadline, SeatSafeError::DeadlineNotReached);
    }

    let refunded = a.budget_vault.amount;
    let owner_key = order.owner;
    let order_id_bytes = order.order_id.to_le_bytes();
    let bump = [order.bump];
    let seeds: &[&[u8]] = &[STANDING_SEED, owner_key.as_ref(), &order_id_bytes, &bump];
    transfer_tokens(
        &a.token_program.to_account_info(),
        &a.budget_vault.to_account_info(),
        &a.owner_usdc.to_account_info(),
        &a.usdc_mint.to_account_info(),
        &a.standing_order.to_account_info(),
        refunded,
        a.usdc_mint.decimals,
        &[seeds],
    )?;

    let closed_by = a.caller.key();
    let order = &mut ctx.accounts.standing_order;
    order.state = StandingOrderState::Closed;
    emit!(StandingOrderClosed {
        standing_order: order.key(),
        owner: owner_key,
        refunded,
        filled: order.filled,
        closed_by,
        at: now,
    });
    Ok(())
}
