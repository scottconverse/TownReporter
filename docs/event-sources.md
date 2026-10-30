# Event sources

This file lists the community event feeds that worked in the dev check. It also lists the feeds that were skipped and why.

Run the add step as a dry run first. Then run it with `--apply`. The command needs `DATABASE_URL` in the environment.

```sh
node --experimental-strip-types scripts/seed-event-sources.ts --newsroom 1 --batch all
node --experimental-strip-types scripts/seed-event-sources.ts --newsroom 1 --batch all --apply
```

Use `--batch 1`, `--batch 2`, and so on to add one batch at a time. Running the same batch again is safe. Existing source URLs are reused.

## Longmont

| Source                      | Reader      | Feed link                                                                                                                             | Dev result                                      | Checked                  |
| --------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | ------------------------ |
| City of Longmont events     | tribe       | [Open feed](https://longmontcolorado.gov/wp-json/tribe/events/v1/events?per_page=50)                                                  | worked: 41 events on 7 of 7 days                | 2026-10-30T03:41:15-0600 |
| Firehouse Art Center        | ics         | [Open feed](https://calendar.google.com/calendar/ical/r5a1ofr4s6d7mvuicgvq36l6tc%40group.calendar.google.com/public/basic.ics)        | worked: 21 events on 7 of 7 days                | 2026-10-30T03:41:15-0600 |
| Grossen Bart                | tribe       | [Open feed](https://grossenbart.com/wp-json/tribe/events/v1/events?per_page=50)                                                       | worked: 9 events on 5 of 7 days                 | 2026-10-30T03:41:15-0600 |
| Knuckle Puck Brewing        | ics         | [Open feed](https://calendar.google.com/calendar/ical/h5jurpaksepktjbia4m7b5pv1art4bi7%40import.calendar.google.com/public/basic.ics) | worked: 4 events on 4 of 7 days                 | 2026-10-30T03:41:15-0600 |
| Kuper Wine Bar              | tribe       | [Open feed](https://www.kuperwinebar.com/wp-json/tribe/events/v1/events?per_page=50)                                                  | worked: 4 events on 4 of 7 days                 | 2026-10-30T03:41:15-0600 |
| Longmont Symphony Orchestra | squarespace | [Open feed](https://longmontsymphony.org/season-concerts?format=json)                                                                 | worked: feed read, no events in the next 7 days | 2026-10-30T03:41:15-0600 |
| OUR Center                  | ics         | [Open feed](https://calendar.google.com/calendar/ical/calendarourcenter%40gmail.com/public/basic.ics)                                 | worked: 8 events on 4 of 7 days                 | 2026-10-30T03:41:15-0600 |
| Parkway Food Hall           | tribe       | [Open feed](https://parkwayfoodhall.com/wp-json/tribe/events/v1/events?per_page=50)                                                   | worked: 5 events on 5 of 7 days                 | 2026-10-30T03:41:15-0600 |
| Soundpost Sessions          | squarespace | [Open feed](https://www.soundpostsessions.com/shows?format=json)                                                                      | worked: 1 events on 1 of 7 days                 | 2026-10-30T03:41:15-0600 |
| St. Vrain Cidery            | squarespace | [Open feed](https://www.stvraincidery.com/events?format=json)                                                                         | worked: 3 events on 3 of 7 days                 | 2026-10-30T03:41:15-0600 |

## Berthoud

| Source                       | Reader | Feed link                                                                                                             | Dev result                                      | Checked                  |
| ---------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | ------------------------ |
| Berthoud Historical Society  | ics    | [Open feed](https://berthoudhistoricalsociety.org/?post_type=tribe_events&ical=1&eventDisplay=list)                   | worked: feed read, no events in the next 7 days | 2026-10-30T03:41:51-0600 |
| City Star Brewing live music | ics    | [Open feed](https://citystarbrewing.com/?post_type=tribe_events&tribe_events_cat=live-music&ical=1&eventDisplay=list) | worked: 2 events on 2 of 7 days                 | 2026-10-30T03:41:51-0600 |
| Inside Berthoud              | ics    | [Open feed](https://insideberthoud.com/events/calendar.ics)                                                           | worked: 15 events on 6 of 7 days                | 2026-10-30T03:41:51-0600 |
| Wildfire Arts Center         | ics    | [Open feed](https://tockify.com/api/feeds/ics/wildfire)                                                               | worked: 20 events on 6 of 7 days                | 2026-10-30T03:41:51-0600 |

## Lyons

| Source              | Reader | Feed link                                                                                                                        | Dev result                       | Checked                  |
| ------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- | ------------------------ |
| Inside Lyons        | ics    | [Open feed](https://insidelyons.com/events/calendar.ics)                                                                         | worked: 14 events on 6 of 7 days | 2026-10-30T03:41:51-0600 |
| Lyons Middle Senior | ics    | [Open feed](https://calendar.google.com/calendar/ical/c_2a55ijpsj3lakhj6u9p82cr5ns%40group.calendar.google.com/public/basic.ics) | worked: 3 events on 3 of 7 days  | 2026-10-30T03:41:51-0600 |
| Lyons Recorder      | tribe  | [Open feed](https://lyonsrecorder.org/wp-json/tribe/events/v1/events?per_page=50)                                                | worked: 7 events on 6 of 7 days  | 2026-10-30T03:41:51-0600 |

## Niwot

| Source       | Reader | Feed link                                                | Dev result                      | Checked                  |
| ------------ | ------ | -------------------------------------------------------- | ------------------------------- | ------------------------ |
| Inside Niwot | ics    | [Open feed](https://insideniwot.com/events/calendar.ics) | worked: 5 events on 3 of 7 days | 2026-10-30T03:41:51-0600 |

## Frederick

| Source                     | Reader    | Feed link                                                                           | Dev result                      | Checked                  |
| -------------------------- | --------- | ----------------------------------------------------------------------------------- | ------------------------------- | ------------------------ |
| Town of Frederick calendar | civicplus | [Open feed](https://www.frederickco.gov/RSSFeed.aspx?ModID=58&CID=All-calendar.xml) | worked: 4 events on 3 of 7 days | 2026-10-30T03:41:15-0600 |

## Lafayette

| Source                   | Reader      | Feed link                                                                                 | Dev result                                      | Checked                  |
| ------------------------ | ----------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------- | ------------------------ |
| Center for Musical Arts  | tribe       | [Open feed](https://centerformusicalarts.org/wp-json/tribe/events/v1/events?per_page=50)  | worked: feed read, no events in the next 7 days | 2026-10-30T03:43:50-0600 |
| Lafayette Public Library | libcal      | [Open feed](https://lafayettepubliclibrary.libcal.com/rss.php?iid=4627&m=month&cid=10144) | worked: 23 events on 7 of 7 days                | 2026-10-30T03:43:50-0600 |
| Liquid Mechanics Brewing | squarespace | [Open feed](https://www.liquidmechanicsbrewing.com/events?format=json)                    | worked: feed read, no events in the next 7 days | 2026-10-30T03:43:50-0600 |
| Odd13 Brewing            | squarespace | [Open feed](https://www.odd13brewing.com/events?format=json)                              | worked: 2 events on 2 of 7 days                 | 2026-10-30T03:43:50-0600 |
| Old Town Lafayette       | tribe       | [Open feed](https://oldtownlafayette.com/wp-json/tribe/events/v1/events?per_page=50)      | worked: 8 events on 5 of 7 days                 | 2026-10-30T03:43:50-0600 |

## Louisville

| Source                     | Reader      | Feed link                                                                                              | Dev result                       | Checked                  |
| -------------------------- | ----------- | ------------------------------------------------------------------------------------------------------ | -------------------------------- | ------------------------ |
| Coal Creek Theater         | squarespace | [Open feed](https://www.cctlouisville.org/shows?format=json)                                           | worked: 1 events on 1 of 7 days  | 2026-10-30T03:43:50-0600 |
| Gravity Brewing            | ics         | [Open feed](https://thegravitybrewing.com/events.ics)                                                  | worked: 21 events on 7 of 7 days | 2026-10-30T03:43:50-0600 |
| Jasmine Bar / Courtyard    | squarespace | [Open feed](https://www.thejasminebar.com/events?format=json)                                          | worked: 1 events on 1 of 7 days  | 2026-10-30T03:43:50-0600 |
| Louisville Art Association | ics         | [Open feed](https://tockify.com/api/feeds/ics/laacalendar)                                             | worked: 1 events on 1 of 7 days  | 2026-10-30T03:43:50-0600 |
| Monarch Theatre            | ics         | [Open feed](https://calendar.google.com/calendar/ical/monarchtheatredept%40gmail.com/public/basic.ics) | worked: 5 events on 5 of 7 days  | 2026-10-30T03:43:50-0600 |
| Relish Food Hall           | squarespace | [Open feed](https://www.visitrelish.com/events-calendar?format=json)                                   | worked: 3 events on 3 of 7 days  | 2026-10-30T03:43:50-0600 |

## Boulder

| Source                   | Reader      | Feed link                                                                                                                                                              | Dev result                       | Checked                  |
| ------------------------ | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- | ------------------------ |
| BMoCA                    | squarespace | [Open feed](https://www.bmoca.org/events?format=json)                                                                                                                  | worked: 1 events on 1 of 7 days  | 2026-10-30T03:45:44-0600 |
| Colorado Chautauqua      | tribe       | [Open feed](https://www.chautauqua.com/wp-json/tribe/events/v1/events?per_page=50)                                                                                     | worked: 3 events on 3 of 7 days  | 2026-10-30T03:45:44-0600 |
| Dairy Arts Center        | tribe       | [Open feed](https://thedairy.org/wp-json/tribe/events/v1/events?per_page=50)                                                                                           | worked: 27 events on 6 of 7 days | 2026-10-30T03:45:44-0600 |
| Fairview Performing Arts | ics         | [Open feed](https://calendar.google.com/calendar/ical/c_aff1aad0c2e0e9d16d4f869f39aa708c6c2ad5d1c353ac8a632f094089f1e6df%40group.calendar.google.com/public/basic.ics) | worked: 5 events on 4 of 7 days  | 2026-10-30T03:45:44-0600 |

## Loveland

| Source                           | Reader      | Feed link                                                                                                                                                              | Dev result                                      | Checked                  |
| -------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | ------------------------ |
| High Plains Environmental Center | ics         | [Open feed](https://calendar.google.com/calendar/ical/c_9480b30ac34a2365781c3eff173890c0f47cba542a10921e450382f9786da2b4%40group.calendar.google.com/public/basic.ics) | worked: feed read, no events in the next 7 days | 2026-10-30T03:45:44-0600 |
| Loveland Orchestra               | ics         | [Open feed](https://lovelandorchestra.org/wp-content/uploads/2026/08/The-Loveland-Orchestra-Concerts.ics)                                                              | worked: feed read, no events in the next 7 days | 2026-10-30T03:45:44-0600 |
| MeadKrieger Meadery              | squarespace | [Open feed](https://www.meadkrieger.com/events?format=json)                                                                                                            | worked: feed read, no events in the next 7 days | 2026-10-30T03:45:44-0600 |

## Skipped

These feeds are not in the source list.

| Town      | Source                         | Feed link                                                                             | Reason                                                    | Checked                  |
| --------- | ------------------------------ | ------------------------------------------------------------------------------------- | --------------------------------------------------------- | ------------------------ |
| Berthoud  | Berthoud Town Upcoming Events  | [Open feed](https://www.berthoud.org/RSSFeed.aspx?ModID=58&CID=All-calendar.xml)      | timed out from the newsroom PC (Part 2 CivicPlus recheck) | 2026-10-30T03:41:51-0600 |
| Lyons     | Town of Lyons calendar         | [Open feed](https://www.townoflyons.com/RSSFeed.aspx?ModID=58&CID=All-calendar.xml)   | timed out from the newsroom PC (Part 2 CivicPlus recheck) | 2026-10-30T03:41:51-0600 |
| Lyons     | Visit Lyons Community Calendar | [Open feed](https://www.lyonscolorado.com/RSSFeed.aspx?ModID=58&CID=All-calendar.xml) | timed out from the newsroom PC (Part 2 CivicPlus recheck) | 2026-10-30T03:41:51-0600 |
| Erie      | Town of Erie calendar          | [Open feed](https://www.erieco.gov/RSSFeed.aspx?ModID=58&CID=All-calendar.xml)        | timed out from the newsroom PC (Part 2 CivicPlus recheck) | 2026-10-30T03:43:50-0600 |
| Firestone | Town of Firestone calendar     | [Open feed](https://www.firestoneco.gov/RSSFeed.aspx?ModID=58&CID=All-calendar.xml)   | timed out from the newsroom PC (Part 2 CivicPlus recheck) | 2026-10-30T03:43:50-0600 |
| Lafayette | City of Lafayette              | [Open feed](https://www.lafayetteco.gov/RSSFeed.aspx?ModID=58&CID=All-calendar.xml)   | timed out from the newsroom PC (Part 2 CivicPlus recheck) | 2026-10-30T03:43:50-0600 |
