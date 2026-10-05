// The day-booking convention (09:00 office-local anchor) is now canonical in
// src/lib/bookings/day-span.ts so the subtask-schedule Edge Function shares one source of
// truth with the grid. Re-exported here so existing imports (and day-span.test.ts) keep working.
export { DAY_START_HOUR, daySpan } from '../../../lib/bookings/day-span.ts'
