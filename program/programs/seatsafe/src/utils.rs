//! Shared helpers: checked fee math, USDC transfers, and Plan B ticket moves
//! (thaw -> transfer -> re-freeze, signed by the ticket_authority PDA).

use anchor_lang::prelude::*;
use anchor_spl::{
    token_2022::{
        self,
        spl_token_2022::{
            extension::StateWithExtensions,
            state::{Account as SplTokenAccount, AccountState},
        },
        CloseAccount, FreezeAccount, ThawAccount,
    },
    token_interface::{self, TransferChecked},
};

use crate::constants::BPS_DENOMINATOR;
use crate::errors::SeatSafeError;

/// amount * bps / 10_000, rounded down, with overflow checks.
pub fn bps_of(amount: u64, bps: u16) -> Result<u64> {
    let v = (amount as u128)
        .checked_mul(bps as u128)
        .ok_or(SeatSafeError::MathOverflow)?
        / BPS_DENOMINATOR as u128;
    u64::try_from(v).map_err(|_| SeatSafeError::MathOverflow.into())
}

pub fn add(a: u64, b: u64) -> Result<u64> {
    a.checked_add(b).ok_or(SeatSafeError::MathOverflow.into())
}

pub fn sub(a: u64, b: u64) -> Result<u64> {
    a.checked_sub(b).ok_or(SeatSafeError::MathOverflow.into())
}

pub fn add_secs(t: i64, secs: i64) -> Result<i64> {
    t.checked_add(secs).ok_or(SeatSafeError::MathOverflow.into())
}

/// Splits a resale price into (seller_amount, royalty, fee).
pub fn split_resale(price: u64, royalty_bps: u16, fee_bps: u16) -> Result<(u64, u64, u64)> {
    let royalty = bps_of(price, royalty_bps)?;
    let fee = bps_of(price, fee_bps)?;
    let seller_amount = sub(sub(price, royalty)?, fee)?;
    Ok((seller_amount, royalty, fee))
}

/// USDC (or any interface token) transfer_checked. No-op for 0.
#[allow(clippy::too_many_arguments)]
pub fn transfer_tokens<'info>(
    token_program: &AccountInfo<'info>,
    from: &AccountInfo<'info>,
    to: &AccountInfo<'info>,
    mint: &AccountInfo<'info>,
    authority: &AccountInfo<'info>,
    amount: u64,
    decimals: u8,
    signer_seeds: &[&[&[u8]]],
) -> Result<()> {
    if amount == 0 {
        return Ok(());
    }
    token_interface::transfer_checked(
        CpiContext::new_with_signer(
            token_program.key(),
            TransferChecked {
                from: from.clone(),
                mint: mint.clone(),
                to: to.clone(),
                authority: authority.clone(),
            },
            signer_seeds,
        ),
        amount,
        decimals,
    )
}

fn is_frozen(token_account: &AccountInfo) -> Result<bool> {
    let data = token_account.try_borrow_data()?;
    let state = StateWithExtensions::<SplTokenAccount>::unpack(&data)?;
    Ok(state.base.state == AccountState::Frozen)
}

/// Thaw a Token-2022 ticket account if it is frozen (ticket_authority PDA signs).
pub fn thaw_ticket<'info>(
    ticket_token_program: &AccountInfo<'info>,
    account: &AccountInfo<'info>,
    mint: &AccountInfo<'info>,
    ticket_authority: &AccountInfo<'info>,
    signer_seeds: &[&[&[u8]]],
) -> Result<()> {
    if !is_frozen(account)? {
        return Ok(());
    }
    token_2022::thaw_account(CpiContext::new_with_signer(
        ticket_token_program.key(),
        ThawAccount {
            account: account.clone(),
            mint: mint.clone(),
            authority: ticket_authority.clone(),
        },
        signer_seeds,
    ))
}

/// Freeze a Token-2022 ticket account if it is not frozen (ticket_authority PDA signs).
pub fn freeze_ticket<'info>(
    ticket_token_program: &AccountInfo<'info>,
    account: &AccountInfo<'info>,
    mint: &AccountInfo<'info>,
    ticket_authority: &AccountInfo<'info>,
    signer_seeds: &[&[&[u8]]],
) -> Result<()> {
    if is_frozen(account)? {
        return Ok(());
    }
    token_2022::freeze_account(CpiContext::new_with_signer(
        ticket_token_program.key(),
        FreezeAccount {
            account: account.clone(),
            mint: mint.clone(),
            authority: ticket_authority.clone(),
        },
        signer_seeds,
    ))
}

/// Moves one ticket: thaw both sides, transfer 1, freeze the destination.
/// `owner` must be a signer or a PDA whose seeds are in `signer_seeds`.
/// The source is left thawed; the caller re-freezes it or closes it.
#[allow(clippy::too_many_arguments)]
pub fn move_ticket<'info>(
    ticket_token_program: &AccountInfo<'info>,
    from: &AccountInfo<'info>,
    to: &AccountInfo<'info>,
    mint: &AccountInfo<'info>,
    owner: &AccountInfo<'info>,
    ticket_authority: &AccountInfo<'info>,
    signer_seeds: &[&[&[u8]]],
) -> Result<()> {
    thaw_ticket(ticket_token_program, from, mint, ticket_authority, signer_seeds)?;
    thaw_ticket(ticket_token_program, to, mint, ticket_authority, signer_seeds)?;
    token_2022::transfer_checked(
        CpiContext::new_with_signer(
            ticket_token_program.key(),
            token_2022::TransferChecked {
                from: from.clone(),
                mint: mint.clone(),
                to: to.clone(),
                authority: owner.clone(),
            },
            signer_seeds,
        ),
        1,
        0,
    )?;
    freeze_ticket(ticket_token_program, to, mint, ticket_authority, signer_seeds)
}

/// Closes an empty, thawed ticket vault owned by a PDA; rent goes to `destination`.
pub fn close_ticket_vault<'info>(
    ticket_token_program: &AccountInfo<'info>,
    vault: &AccountInfo<'info>,
    destination: &AccountInfo<'info>,
    vault_owner: &AccountInfo<'info>,
    signer_seeds: &[&[&[u8]]],
) -> Result<()> {
    token_2022::close_account(CpiContext::new_with_signer(
        ticket_token_program.key(),
        CloseAccount {
            account: vault.clone(),
            destination: destination.clone(),
            authority: vault_owner.clone(),
        },
        signer_seeds,
    ))
}
