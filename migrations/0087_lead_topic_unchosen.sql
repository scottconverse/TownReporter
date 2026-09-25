/*
  A lead's section, and whether the scan actually chose it.

  The General scan always writes a section key, because every row, chip and
  filter downstream needs one -- but when the model's reply named no section
  this newsroom accepts, the key it wrote is the desk's fallback, not a
  decision. Without this column that difference was invisible: the Queue row
  showed a guessed section exactly like a chosen one.

  False is right for every row filed before this column existed and for every
  route that is not the scan (a manual lead, a meeting capture), because those
  either named their section or never had a model to ask.
*/
alter table leads add column if not exists topic_unchosen boolean not null default false;
