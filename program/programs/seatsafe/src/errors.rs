use anchor_lang::prelude::*;

#[error_code]
pub enum SeatSafeError {
    #[msg("Listing price is above the event's resale cap")]
    AboveResaleCap,
    #[msg("Deadline has not been reached yet")]
    DeadlineNotReached,
    #[msg("Deadline has passed")]
    DeadlinePassed,
    #[msg("Account is not in the right state for this action")]
    InvalidState,
    #[msg("Signer is not allowed to do this")]
    Unauthorized,
    #[msg("Event is sold out")]
    SoldOut,
    #[msg("Buyer and seller must be different")]
    BuyerIsSeller,
    #[msg("Listing price is above the standing order's max price")]
    PriceAboveMax,
    #[msg("Seller rating is too low")]
    RatingTooLow,
    #[msg("Math overflow")]
    MathOverflow,
    #[msg("Resale cap must be at least the face price")]
    InvalidResaleCap,
    #[msg("Royalty plus fee is above the allowed maximum")]
    InvalidRoyalty,
    #[msg("Basis points must be between 0 and 10000")]
    InvalidBps,
    #[msg("Amount must be greater than zero")]
    InvalidAmount,
    #[msg("Time window must be greater than zero")]
    InvalidWindow,
    #[msg("Seat label is too long")]
    SeatTooLong,
    #[msg("Seller does not hold this ticket")]
    TicketNotHeld,
    #[msg("Listing is for a different event")]
    WrongEvent,
    #[msg("Standing order is already filled")]
    OrderFilled,
}
