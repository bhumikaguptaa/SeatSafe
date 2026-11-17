use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token_2022::Token2022,
    token_interface::{Mint, TokenAccount, TokenInterface},
};

use crate::{
    constants::*,
    errors::SeatSafeError,
    events::TicketSwapped,
    state::{Config, Event, Listing},
    utils::*,
};

/// Everything a resale settlement touches. Shared by swap_resale and fill_standing_order.
pub struct ResaleSettlement<'a, 'info> {
    pub token_program: &'a AccountInfo<'info>,
    pub usdc_mint: &'a AccountInfo<'info>,
    pub usdc_decimals: u8,
    /// USDC source (buyer's account, or a standing order's budget vault)
    pub from_usdc: &'a AccountInfo<'info>,
    pub from_authority: &'a AccountInfo<'info>,
    pub seller_usdc: &'a AccountInfo<'info>,
    pub organizer_usdc: &'a AccountInfo<'info>,
    pub treasury_usdc: &'a AccountInfo<'info>,
    pub ticket_token_program: &'a AccountInfo<'info>,
    pub ticket_mint: &'a AccountInfo<'info>,
    pub listing: &'a AccountInfo<'info>,
    pub listing_vault: &'a AccountInfo<'info>,
    pub dest_ticket: &'a AccountInfo<'info>,
    pub ticket_authority: &'a AccountInfo<'info>,
    /// receives the emptied vault's rent
    pub rent_receiver: &'a AccountInfo<'info>,
}

/// Pays seller / organizer (royalty) / treasury (fee) and moves the ticket out of the
/// listing vault into `dest_ticket` (frozen), then closes the vault.
/// `signer` must contain the ticket_authority and listing seeds (and the USDC source PDA's
/// seeds when paying from a vault). Returns (seller_amount, royalty, fee).
pub fn settle_resale(
    s: &ResaleSettlement,
    price: u64,
    royalty_bps: u16,
    fee_bps: u16,
    signer: &[&[&[u8]]],
) -> Result<(u64, u64, u64)> {
    let (seller_amount, royalty, fee) = split_resale(price, royalty_bps, fee_bps)?;
    let d = s.usdc_decimals;
    transfer_tokens(s.token_program, s.from_usdc, s.seller_usdc, s.usdc_mint, s.from_authority, seller_amount, d, signer)?;
    transfer_tokens(s.token_program, s.from_usdc, s.organizer_usdc, s.usdc_mint, s.from_authority, royalty, d, signer)?;
    transfer_tokens(s.token_program, s.from_usdc, s.treasury_usdc, s.usdc_mint, s.from_authority, fee, d, signer)?;

    move_ticket(
        s.ticket_token_program,
        s.listing_vault,
        s.dest_ticket,
        s.ticket_mint,
        s.listing,
        s.ticket_authority,
        signer,
    )?;
    close_ticket_vault(s.ticket_token_program, s.listing_vault, s.rent_receiver, s.listing, signer)?;
    Ok((seller_amount, royalty, fee))
}

#[derive(Accounts)]
pub struct SwapResale<'info> {
    /// Relayer: pays for missing ATAs; receives the closed listing's and vault's rent.
    #[account(mut)]
    pub payer: Signer<'info>,
    pub buyer: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
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
        token::mint = usdc_mint,
        token::authority = buyer,
        token::token_program = token_program
    )]
    pub buyer_usdc: Box<InterfaceAccount<'info, TokenAccount>>,
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
        associated_token::authority = buyer,
        associated_token::token_program = ticket_token_program
    )]
    pub buyer_ticket_account: Box<InterfaceAccount<'info, TokenAccount>>,
    /// CHECK: freeze authority PDA. Holds no data.
    #[account(seeds = [TICKET_AUTHORITY_SEED], bump)]
    pub ticket_authority: UncheckedAccount<'info>,
    pub token_program: Interface<'info, TokenInterface>,
    pub ticket_token_program: Program<'info, Token2022>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn handle_swap_resale(ctx: Context<SwapResale>) -> Result<()> {
    let a = &ctx.accounts;
    require_keys_neq!(a.buyer.key(), a.listing.seller, SeatSafeError::BuyerIsSeller);

    let mint_key = a.ticket_mint.key();
    let auth_bump = [ctx.bumps.ticket_authority];
    let listing_bump = [a.listing.bump];
    let signer: &[&[&[u8]]] = &[
        &[TICKET_AUTHORITY_SEED, &auth_bump],
        &[LISTING_SEED, mint_key.as_ref(), &listing_bump],
    ];

    let s = ResaleSettlement {
        token_program: &a.token_program.to_account_info(),
        usdc_mint: &a.usdc_mint.to_account_info(),
        usdc_decimals: a.usdc_mint.decimals,
        from_usdc: &a.buyer_usdc.to_account_info(),
        from_authority: &a.buyer.to_account_info(),
        seller_usdc: &a.seller_usdc.to_account_info(),
        organizer_usdc: &a.organizer_usdc.to_account_info(),
        treasury_usdc: &a.treasury_usdc.to_account_info(),
        ticket_token_program: &a.ticket_token_program.to_account_info(),
        ticket_mint: &a.ticket_mint.to_account_info(),
        listing: &a.listing.to_account_info(),
        listing_vault: &a.listing_vault.to_account_info(),
        dest_ticket: &a.buyer_ticket_account.to_account_info(),
        ticket_authority: &a.ticket_authority.to_account_info(),
        rent_receiver: &a.payer.to_account_info(),
    };
    let price = a.listing.price;
    let (seller_amount, royalty, fee) =
        settle_resale(&s, price, a.event.royalty_bps, a.config.fee_bps, signer)?;

    emit!(TicketSwapped {
        listing: a.listing.key(),
        ticket_mint: mint_key,
        event: a.event.key(),
        seller: a.listing.seller,
        buyer: a.buyer.key(),
        price,
        seller_amount,
        royalty,
        fee,
        at: Clock::get()?.unix_timestamp,
    });
    Ok(())
}
