use anchor_lang::{
    prelude::*,
    system_program::{self, CreateAccount},
};
use anchor_spl::{
    associated_token::{self, AssociatedToken, Create},
    token_2022::{
        self,
        spl_token_2022::{
            extension::ExtensionType,
            state::{AccountState, Mint as SplMint},
        },
        InitializeMint2, MintTo, Token2022,
    },
    token_2022_extensions::{default_account_state_initialize, DefaultAccountStateInitialize},
    token_interface::{Mint, TokenAccount, TokenInterface},
};

use crate::{
    constants::*,
    errors::SeatSafeError,
    events::TicketMinted,
    state::{Config, Event, TicketRecord},
    utils::*,
};

#[derive(Accounts)]
pub struct BuyPrimary<'info> {
    /// Relayer: pays rent for the mint, the buyer's ticket account, the record and any missing ATAs.
    #[account(mut)]
    pub payer: Signer<'info>,
    pub buyer: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
    #[account(
        mut,
        seeds = [EVENT_SEED, event.organizer.as_ref(), &event.event_id.to_le_bytes()],
        bump = event.bump
    )]
    pub event: Box<Account<'info, Event>>,
    /// CHECK: must be the event organizer; only used as the USDC ATA owner.
    #[account(address = event.organizer)]
    pub organizer: UncheckedAccount<'info>,
    /// CHECK: must be the configured treasury; only used as the USDC ATA owner.
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
    /// CHECK: PDA that is mint authority and freeze authority of every ticket mint. Holds no data.
    #[account(seeds = [TICKET_AUTHORITY_SEED], bump)]
    pub ticket_authority: UncheckedAccount<'info>,
    /// CHECK: new ticket mint, created in this instruction at this PDA.
    #[account(
        mut,
        seeds = [TICKET_MINT_SEED, event.key().as_ref(), &event.sold.to_le_bytes()],
        bump
    )]
    pub ticket_mint: UncheckedAccount<'info>,
    /// CHECK: buyer's Token-2022 ATA for the new mint; the ATA program verifies the address when creating it.
    #[account(mut)]
    pub buyer_ticket_account: UncheckedAccount<'info>,
    #[account(
        init,
        payer = payer,
        space = 8 + TicketRecord::INIT_SPACE,
        seeds = [TICKET_SEED, ticket_mint.key().as_ref()],
        bump
    )]
    pub ticket_record: Box<Account<'info, TicketRecord>>,
    /// Token program of the USDC mint (classic SPL Token on devnet).
    pub token_program: Interface<'info, TokenInterface>,
    pub ticket_token_program: Program<'info, Token2022>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn handle_buy_primary(ctx: Context<BuyPrimary>, seat: String) -> Result<()> {
    require!(seat.len() <= MAX_SEAT_LEN, SeatSafeError::SeatTooLong);
    let a = &ctx.accounts;
    require!(a.event.sold < a.event.supply, SeatSafeError::SoldOut);
    require_keys_neq!(a.buyer.key(), a.event.organizer, SeatSafeError::BuyerIsSeller);

    // 1. Pay: price - fee to organizer, fee to treasury.
    let price = a.event.price;
    let fee = bps_of(price, a.config.fee_bps)?;
    let organizer_amount = sub(price, fee)?;
    let decimals = a.usdc_mint.decimals;
    let tp = a.token_program.to_account_info();
    let usdc_mint = a.usdc_mint.to_account_info();
    let buyer_usdc = a.buyer_usdc.to_account_info();
    let buyer = a.buyer.to_account_info();
    transfer_tokens(&tp, &buyer_usdc, &a.organizer_usdc.to_account_info(), &usdc_mint, &buyer, organizer_amount, decimals, &[])?;
    transfer_tokens(&tp, &buyer_usdc, &a.treasury_usdc.to_account_info(), &usdc_mint, &buyer, fee, decimals, &[])?;

    // 2. Create the ticket mint: Token-2022, DefaultAccountState = Frozen, decimals 0,
    //    mint + freeze authority = ticket_authority PDA.
    let event_key = a.event.key();
    let sold_bytes = a.event.sold.to_le_bytes();
    let mint_bump = [ctx.bumps.ticket_mint];
    let mint_seeds: &[&[u8]] = &[TICKET_MINT_SEED, event_key.as_ref(), &sold_bytes, &mint_bump];
    let auth_bump = [ctx.bumps.ticket_authority];
    let auth_seeds: &[&[u8]] = &[TICKET_AUTHORITY_SEED, &auth_bump];

    let ttp = a.ticket_token_program.to_account_info();
    let mint = a.ticket_mint.to_account_info();
    let authority = a.ticket_authority.to_account_info();
    let space = ExtensionType::try_calculate_account_len::<SplMint>(&[
        ExtensionType::DefaultAccountState,
    ])?;
    let lamports = Rent::get()?.minimum_balance(space);
    system_program::create_account(
        CpiContext::new_with_signer(
            system_program::ID,
            CreateAccount {
                from: a.payer.to_account_info(),
                to: mint.clone(),
            },
            &[mint_seeds],
        ),
        lamports,
        space as u64,
        &token_2022::ID,
    )?;
    default_account_state_initialize(
        CpiContext::new(
            token_2022::ID,
            DefaultAccountStateInitialize {
                token_program_id: ttp.clone(),
                mint: mint.clone(),
            },
        ),
        &AccountState::Frozen,
    )?;
    token_2022::initialize_mint2(
        CpiContext::new(token_2022::ID, InitializeMint2 { mint: mint.clone() }),
        0,
        &authority.key(),
        Some(&authority.key()),
    )?;

    // 3. Buyer's ticket account (starts frozen), thaw -> mint 1 -> freeze.
    let buyer_ticket = a.buyer_ticket_account.to_account_info();
    associated_token::create(CpiContext::new(
        associated_token::ID,
        Create {
            payer: a.payer.to_account_info(),
            associated_token: buyer_ticket.clone(),
            authority: buyer.clone(),
            mint: mint.clone(),
            system_program: a.system_program.to_account_info(),
            token_program: ttp.clone(),
        },
    ))?;
    let signer: &[&[&[u8]]] = &[auth_seeds];
    thaw_ticket(&ttp, &buyer_ticket, &mint, &authority, signer)?;
    token_2022::mint_to(
        CpiContext::new_with_signer(
            token_2022::ID,
            MintTo {
                mint: mint.clone(),
                to: buyer_ticket.clone(),
                authority: authority.clone(),
            },
            signer,
        ),
        1,
    )?;
    freeze_ticket(&ttp, &buyer_ticket, &mint, &authority, signer)?;

    // 4. Record + counters.
    let buyer_key = a.buyer.key();
    let mint_key = mint.key();
    let record = &mut ctx.accounts.ticket_record;
    record.event = event_key;
    record.mint = mint_key;
    record.seat = seat.clone();
    record.original_buyer = buyer_key;
    record.bump = ctx.bumps.ticket_record;

    let event = &mut ctx.accounts.event;
    event.sold = event.sold.checked_add(1).ok_or(SeatSafeError::MathOverflow)?;

    emit!(TicketMinted {
        event: event_key,
        ticket_mint: mint_key,
        buyer: buyer_key,
        seat,
        price,
        organizer_amount,
        fee,
        sold: event.sold,
        at: Clock::get()?.unix_timestamp,
    });
    Ok(())
}
