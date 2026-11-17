use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token_2022::Token2022,
    token_interface::{Mint, TokenAccount},
};

use crate::{
    constants::*,
    errors::SeatSafeError,
    events::ListingCreated,
    state::{Event, Listing, TicketRecord},
    utils::*,
};

#[derive(Accounts)]
pub struct ListResale<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    pub seller: Signer<'info>,
    #[account(mint::token_program = ticket_token_program)]
    pub ticket_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        seeds = [TICKET_SEED, ticket_mint.key().as_ref()],
        bump = ticket_record.bump
    )]
    pub ticket_record: Box<Account<'info, TicketRecord>>,
    #[account(address = ticket_record.event)]
    pub event: Box<Account<'info, Event>>,
    #[account(
        mut,
        associated_token::mint = ticket_mint,
        associated_token::authority = seller,
        associated_token::token_program = ticket_token_program
    )]
    pub seller_ticket_account: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        init,
        payer = payer,
        space = 8 + Listing::INIT_SPACE,
        seeds = [LISTING_SEED, ticket_mint.key().as_ref()],
        bump
    )]
    pub listing: Box<Account<'info, Listing>>,
    /// Holds the ticket while listed (frozen).
    #[account(
        init,
        payer = payer,
        associated_token::mint = ticket_mint,
        associated_token::authority = listing,
        associated_token::token_program = ticket_token_program
    )]
    pub listing_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    /// CHECK: freeze authority PDA. Holds no data.
    #[account(seeds = [TICKET_AUTHORITY_SEED], bump)]
    pub ticket_authority: UncheckedAccount<'info>,
    pub ticket_token_program: Program<'info, Token2022>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn handle_list_resale(ctx: Context<ListResale>, price: u64) -> Result<()> {
    let a = &ctx.accounts;
    require!(price > 0, SeatSafeError::InvalidAmount);
    // The cap: the live "scalper blocked" demo moment.
    require!(price <= a.event.resale_cap, SeatSafeError::AboveResaleCap);
    require!(a.seller_ticket_account.amount == 1, SeatSafeError::TicketNotHeld);

    let auth_bump = [ctx.bumps.ticket_authority];
    let auth_seeds: &[&[u8]] = &[TICKET_AUTHORITY_SEED, &auth_bump];
    let signer: &[&[&[u8]]] = &[auth_seeds];

    let ttp = a.ticket_token_program.to_account_info();
    let mint = a.ticket_mint.to_account_info();
    let authority = a.ticket_authority.to_account_info();
    let seller_ticket = a.seller_ticket_account.to_account_info();
    move_ticket(
        &ttp,
        &seller_ticket,
        &a.listing_vault.to_account_info(),
        &mint,
        &a.seller.to_account_info(),
        &authority,
        signer,
    )?;
    freeze_ticket(&ttp, &seller_ticket, &mint, &authority, signer)?;

    let now = Clock::get()?.unix_timestamp;
    let seller = a.seller.key();
    let event_key = a.event.key();
    let mint_key = a.ticket_mint.key();
    let listing = &mut ctx.accounts.listing;
    listing.seller = seller;
    listing.ticket_mint = mint_key;
    listing.event = event_key;
    listing.price = price;
    listing.created_at = now;
    listing.bump = ctx.bumps.listing;

    emit!(ListingCreated {
        listing: listing.key(),
        ticket_mint: mint_key,
        event: event_key,
        seller,
        price,
        at: now,
    });
    Ok(())
}
