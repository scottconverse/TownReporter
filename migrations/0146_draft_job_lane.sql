-- FB16: keep existing queued drafts and direct batch inserts on the writing lane.
update desk_jobs set lane = 'draft' where kind = 'draft' and lane = 'default';
