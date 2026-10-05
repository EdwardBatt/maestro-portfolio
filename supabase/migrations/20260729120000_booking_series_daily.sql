-- ADR-0006: multi-day bookings are daily series (one instance per day).
alter table booking_series drop constraint booking_series_freq_check;
alter table booking_series add constraint booking_series_freq_check
  check (freq in ('weekly', 'daily'));
