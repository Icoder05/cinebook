// Ticket validation at the venue: a ticket can be checked in once.
export default /* sql */ `
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS checked_in_at timestamptz;
`;
