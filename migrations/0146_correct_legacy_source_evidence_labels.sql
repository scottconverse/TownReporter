-- Correct rows that were saved as official before URL-based source labels
-- were added. Tier A means an official record; journalism is Tier B and a
-- discovery lead is Tier C. Stored labels are read directly by the Sources
-- screen and evidence ranking, so correcting only future inserts leaves old
-- newsroom rows wrong.
with legacy_official as (
  select id, regexp_replace(lower(substring(url from '^https?://([^/:?#]+)')), '^www\.', '') as host
  from sources
  where kind = 'official'
), corrected as (
  select id,
    case
      when host in (
        'timescall.com', 'times-call.com', 'dailycamera.com', 'longmontleader.com',
        'denverpost.com', 'bizwest.com', 'coloradopolitics.com', 'substack.com',
        'sentineltm.com', 'lefthandvalley.com', 'lhvc.com', 'boulderreportinglab.org',
        'boulderweekly.com', 'yellowscene.com', 'kgnu.org', 'kunc.org', '9news.com',
        'denver7.com', 'coloradonewsline.com', 'berthoudsurveyor.com', 'lyonsrecorder.org',
        'thefrontpagefrcc.com', 'schsnews.org', 'axios.com', 'mavnewspaper.com',
        'joshuaberman.net', 'longmontpublicmedia.org'
      ) then 'news'
      when host = 'youtube.com' or host = 'youtu.be' then 'youtube'
      when host in ('twitter.com', 'x.com', 'facebook.com', 'instagram.com', 'nextdoor.com', 'reddit.com') then 'social'
      when host in (
        'visitlongmont.org', 'downtownlongmont.com', 'longmontchamber.org', 'bouldercountyfair.org',
        'bcfm.org', 'lefthandbrewing.com', 'wibbybrewing.com', '300sunsbrewing.com',
        'bootstrapbrewing.com', 'firehouseart.org', 'longmonttheatre.org', 'jesterstheatre.com',
        'dickensoperahouse.co', 'longmontsymphony.org', 'lexlocalevents.com', 'heartoflongmont.org',
        'longmonthumane.org', 'ourcenter.org', 'eventbrite.com', 'meetup.com', 'bouldercoloradousa.com',
        'teamsideline.com', 'kiwanis.org', 'stvrainhistory.org', 'soundpostsessions.com', 'tinkermill.org',
        'abetterstandarddirection.com', 'rmequality.org', 'colorado.com', 'boulderoperacompany.com'
      ) then 'community'
      else 'unclassified'
    end as kind
  from legacy_official
  where host !~ '\.gov$'
    and host !~ '(^|\.)(ci|town|co|county|state)(\.[a-z0-9-]+)?\.[a-z]{2}\.us$'
    and host not in ('longmont.primegov.com', 'svvsd.org', 'rtd-denver.com')
)
update sources as s
set kind = c.kind,
    tier = case when c.kind = 'news' or c.kind = 'youtube' then 'B'
                when c.kind = 'official' then 'A'
                else 'C' end
from corrected as c
where s.id = c.id;
