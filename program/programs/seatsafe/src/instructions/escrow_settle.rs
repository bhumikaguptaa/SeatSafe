//! Tier 2 escrow payouts. All five share the SettleEscrow accounts:
//! confirm_receipt (buyer), release_expired (anyone), refund_expired (anyone),
//! resolve_dispute (arbiter), dispute_timeout (anyone).

use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token_interface::{Mint, TokenAccount, TokenInterface},
};

use crate::{
    constants::*,
    errors::SeatSafeError,
    events::*,
    instructions::escrow::escrow_signer_seeds,
    state::{Config, EscrowOrder, EscrowState},
    utils::*,
};

#[derive(Accounts)]
pub struct SettleEscrow<'info> {
    /// Relayer: pays for any missing USDC ATA.
    #[account(mut)]
    pub payer: Signer<'info>,
    /// Who triggered the payout. Role is checked per instruction.
    pub caller: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
    #[account(
        mut,
        seeds = [ESCROW_SEED, escrow.seller.as_ref(), &escrow.order_id.to_le_bytes()],
        bump = escrow.bump
    )]
    pub escrow: Box<Account<'info, EscrowOrder>>,
    /// CHECK: must be the escrow's seller; only used as USDC ATA owner.
    #[account(address = escrow.seller)]
    pub seller: UncheckedAccount<'info>,
    /// CHECK: must be the escrow's buyer; only used as USDC ATA owner.
    #[account(constraint = escrow.buyer == Some(buyer.key()) @ SeatSafeError::InvalidState)]
    pub buyer: UncheckedAccount<'info>,
    /// CHECK: must be the configured treasury; only used as USDC ATA owner.
    #[account(address = config.treasury)]
    pub treasury: UncheckedAccount<'info>,
    #[account(address = config.usdc_mint, mint::token_program = token_program)]
    pub usdc_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        mut,
        associated_token::mint = usdc_mint,
        associated_token::authority = escrow,
        associated_token::token_program = token_program
    )]
    pub escrow_vault: Box<InterfaceAccount<'info, TokenAccount>>,
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
        associated_token::authority = buyer,
        associated_token::token_program = token_program
    )]
    pub buyer_usdc: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        init_if_needed,
        payer = payer,
        associated_token::mint = usdc_mint,
        associated_token::authority = treasury,
        associated_token::token_program = token_program
    )]
    pub treasury_usdc: Box<InterfaceAccount<'info, TokenAccount>>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

enum Recipient {
    Seller,
    Buyer,
    Treasury,
}

impl<'info> SettleEscrow<'info> {
    fn pay(&self, to: Recipient, amount: u64) -> Result<()> {
        let to = match to {
            Recipient::Seller => self.seller_usdc.to_account_info(),
            Recipient::Buyer => self.buyer_usdc.to_account_info(),
            Recipient::Treasury => self.treasury_usdc.to_account_info(),
        };
        let order_id_bytes = self.escrow.order_id.to_le_bytes();
        let bump = [self.escrow.bump];
        let seeds = escrow_signer_seeds(&self.escrow, &order_id_bytes, &bump);
        transfer_tokens(
            &self.token_program.to_account_info(),
            &self.escrow_vault.to_account_info(),
            &to,
            &self.usdc_mint.to_account_info(),
            &self.escrow.to_account_info(),
            amount,
            self.usdc_mint.decimals,
            &[&seeds],
        )
    }

    /// Normal completion: price - fee + bond to the seller, fee to the treasury.
    fn complete(&mut self, auto: bool) -> Result<()> {
        let fee = bps_of(self.escrow.price, self.config.fee_bps)?;
        let seller_amount = sub(self.escrow.price, fee)?;
        let bond = self.escrow.bond;
        self.pay(Recipient::Seller, add(seller_amount, bond)?)?;
        self.pay(Recipient::Treasury, fee)?;
        self.escrow.state = EscrowState::Completed;
        emit!(OrderCompleted {
            escrow: self.escrow.key(),
            buyer: self.buyer.key(),
            seller: self.escrow.seller,
            seller_amount,
            fee,
            bond_returned: bond,
            auto,
            at: Clock::get()?.unix_timestamp,
        });
        Ok(())
    }
}

pub fn handle_confirm_receipt(mut ctx: Context<SettleEscrow>) -> Result<()> {
    let a = &mut ctx.accounts;
    require_keys_eq!(a.caller.key(), a.buyer.key(), SeatSafeError::Unauthorized);
    require!(a.escrow.state == EscrowState::Sent, SeatSafeError::InvalidState);
    a.complete(false)
}

pub fn handle_release_expired(mut ctx: Context<SettleEscrow>) -> Result<()> {
    let a = &mut ctx.accounts;
    require!(a.escrow.state == EscrowState::Sent, SeatSafeError::InvalidState);
    require!(
        Clock::get()?.unix_timestamp > a.escrow.confirm_deadline,
        SeatSafeError::DeadlineNotReached
    );
    a.complete(true)
}

pub fn handle_refund_expired(mut ctx: Context<SettleEscrow>) -> Result<()> {
    let a = &mut ctx.accounts;
    require!(a.escrow.state == EscrowState::Funded, SeatSafeError::InvalidState);
    let now = Clock::get()?.unix_timestamp;
    require!(now > a.escrow.ship_deadline, SeatSafeError::DeadlineNotReached);

    let amount = add(a.escrow.price, a.escrow.bond)?;
    a.pay(Recipient::Buyer, amount)?;
    a.escrow.state = EscrowState::Refunded;
    emit!(OrderRefunded {
        escrow: a.escrow.key(),
        buyer: a.buyer.key(),
        seller: a.escrow.seller,
        amount,
        at: now,
    });
    Ok(())
}

pub fn handle_resolve_dispute(mut ctx: Context<SettleEscrow>, buyer_bps: u16) -> Result<()> {
    let a = &mut ctx.accounts;
    require_keys_eq!(a.caller.key(), a.config.arbiter, SeatSafeError::Unauthorized);
    require!(a.escrow.state == EscrowState::Disputed, SeatSafeError::InvalidState);
    require!(buyer_bps <= BPS_DENOMINATOR, SeatSafeError::InvalidBps);

    let total = add(a.escrow.price, a.escrow.bond)?;
    let buyer_amount = bps_of(total, buyer_bps)?;
    let seller_amount = sub(total, buyer_amount)?;
    a.pay(Recipient::Buyer, buyer_amount)?;
    a.pay(Recipient::Seller, seller_amount)?;
    a.escrow.state = EscrowState::Resolved;
    emit!(DisputeResolved {
        escrow: a.escrow.key(),
        buyer: a.buyer.key(),
        seller: a.escrow.seller,
        buyer_amount,
        seller_amount,
        timeout: false,
        at: Clock::get()?.unix_timestamp,
    });
    Ok(())
}

pub fn handle_dispute_timeout(mut ctx: Context<SettleEscrow>) -> Result<()> {
    let a = &mut ctx.accounts;
    require!(a.escrow.state == EscrowState::Disputed, SeatSafeError::InvalidState);
    let now = Clock::get()?.unix_timestamp;
    require!(now > a.escrow.dispute_deadline, SeatSafeError::DeadlineNotReached);

    // Arbiter never ruled: price back to the buyer, bond back to the seller.
    let buyer_amount = a.escrow.price;
    let seller_amount = a.escrow.bond;
    a.pay(Recipient::Buyer, buyer_amount)?;
    a.pay(Recipient::Seller, seller_amount)?;
    a.escrow.state = EscrowState::Resolved;
    emit!(DisputeResolved {
        escrow: a.escrow.key(),
        buyer: a.buyer.key(),
        seller: a.escrow.seller,
        buyer_amount,
        seller_amount,
        timeout: true,
        at: now,
    });
    Ok(())
}
