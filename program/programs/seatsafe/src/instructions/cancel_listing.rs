use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token_2022::Token2022,
    token_interface::{Mint, TokenAccount},
};

use crate::{constants::*, events::ListingCancelled, state::Listing, utils::*};

#[derive(Accounts)]
pub struct CancelListing<'info> {
    /// Relayer: pays for the seller's ticket account if missing; receives listing + vault rent.
    #[account(mut)]
    pub payer: Signer<'info>,
    pub seller: Signer<'info>,
    #[account(mint::token_program = ticket_token_program)]
    pub ticket_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        mut,
        seeds = [LISTING_SEED, ticket_mint.key().as_ref()],
        bump = listing.bump,
        has_one = seller,
        close = payer
    )]
    pub listing: Box<Account<'info, Listing>>,
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
        associated_token::authority = seller,
        associated_token::token_program = ticket_token_program
    )]
    pub seller_ticket_account: Box<InterfaceAccount<'info, TokenAccount>>,
    /// CHECK: freeze authority PDA. Holds no data.
    #[account(seeds = [TICKET_AUTHORITY_SEED], bump)]
    pub ticket_authority: UncheckedAccount<'info>,
    pub ticket_token_program: Program<'info, Token2022>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn handle_cancel_listing(ctx: Context<CancelListing>) -> Result<()> {
    let a = &ctx.accounts;
    let mint_key = a.ticket_mint.key();
    let auth_bump = [ctx.bumps.ticket_authority];
    let listing_bump = [a.listing.bump];
    let signer: &[&[&[u8]]] = &[
        &[TICKET_AUTHORITY_SEED, &auth_bump],
        &[LISTING_SEED, mint_key.as_ref(), &listing_bump],
    ];

    let ttp = a.ticket_token_program.to_account_info();
    let vault = a.listing_vault.to_account_info();
    let listing_info = a.listing.to_account_info();
    move_ticket(
        &ttp,
        &vault,
        &a.seller_ticket_account.to_account_info(),
        &a.ticket_mint.to_account_info(),
        &listing_info,
        &a.ticket_authority.to_account_info(),
        signer,
    )?;
    close_ticket_vault(&ttp, &vault, &a.payer.to_account_info(), &listing_info, signer)?;

    emit!(ListingCancelled {
        listing: a.listing.key(),
        ticket_mint: mint_key,
        seller: a.seller.key(),
        at: Clock::get()?.unix_timestamp,
    });
    Ok(())
}
