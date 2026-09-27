-- What ground a printed story stands on: Longmont, Nearby, Boulder County or
-- Colorado (0.6.71).
--
-- The front page carries a geography pill row -- Longmont, Nearby, Boulder
-- County, Colorado -- because the paper covers one town properly and the towns
-- around it lightly (`design-system/README.md`, principle 1: "Longmont first",
-- and the order is the same in pills, sections and rails). The pills have never
-- been able to filter anything: a printed story records a headline, a dek, a
-- body and a section, and nothing on the row says which ground it stands on.
-- The owner settled the question on 2026-09-26 (DECISIONS.md, 1:58 PM, KICKOFF
-- Q2, chosen "A"): the pills filter on a NEW area tag carried by each story and
-- set by the editor at publish, rather than on new sections or new sources per
-- area -- an area tag works on day one, against the stories already printed.
--
-- WHY THE PRINTED STORY AND NOT THE DRAFT. The area is a property of what the
-- paper printed, and the pills only ever read printed stories. Putting it on
-- `articles` alone means no draft revision path changes, no re-draft can
-- silently move a story between grounds, and the tag cannot drift away from the
-- story a reader is looking at. The editor sets it in the publish step, which
-- is the same moment they confirm the section, and it travels with the publish
-- request (request-input.ts `cleanPublishRequest`, desk.ts `performPublish`).
--
-- NULL IS THE HOME TOWN, AND THAT IS A DECISION, NOT A GAP. Every story printed
-- before this migration has no area, and the owner's rule is that stories with
-- no area count as Longmont. Reading it that way keeps the pill honest for the
-- 300-odd stories already on the paper -- they are Longmont stories, and the
-- Longmont pill shows them -- and it means the desk can print "not recorded"
-- for the column without inventing a value that claims a person chose it. The
-- read treats null and 'longmont' as the same bucket; nothing else counts as
-- the home town.
--
-- A TEXT COLUMN, NOT A POSTGRES ENUM, for the reason 0097 gave for
-- `sources.proposed_by`: these four are a display vocabulary tied to one town's
-- map, and a second newsroom's map would not be Longmont/Boulder. An enum would
-- make every future addition a migration that drops nothing and rewrites a
-- type. The desk prints an unrecognised value as it stands rather than failing
-- to render the row.
--
-- Additive and nullable-only: nothing existing is rewritten, no read path is
-- required to change, and every story printed before this release reads as
-- "not recorded" -- which the paper shows as Longmont.
alter table articles add column if not exists area text;

comment on column articles.area is
  'Which ground this story stands on: longmont | nearby | county | colorado. Null means not recorded, which the paper reads as the home town (Longmont).';

-- The pills are the one read this table does not already have an index for:
-- "printed stories in one area, newest first" for one newsroom. Partial, because
-- nothing but the paper reads it and every other query here is by status.
create index if not exists articles_area_published_idx
  on articles (newsroom_id, area, published_at desc)
  where status = 'published';
