# Fixtures

`docs/` holds example responses copied from the public SockOdds docs, so tests check parsing against
the documented shape:

| File | Copied from |
| --- | --- |
| `events-quickstart.json` | https://sockodds.com/docs/basics/quickstart/ (Step 3 response) |
| `event-odds-excerpt.json` | https://sockodds.com/docs/data-types/odds/ ("Accessing odds" example) |
| `events-homepage-sample.json` | https://sockodds.com/ (recorded sample JSON response) |
| `error-401.json`, `error-429.json` | https://sockodds.com/docs/endpoints/getEvents/ (status codes) |
| `rate-limit-notice.json` | https://sockodds.com/docs/info/rate-limiting/ (notice example; the docs' `[...]` data is an empty list here) |

Small edits: one long dash in a market name is written as a hyphen. Nothing else is changed.

`demo/` holds INVENTED data in the same shape, used by demo mode (`SOCKODDS_DEMO=1`) and by tests.
Event IDs and team names follow the docs' examples; every price and timestamp is made up and none
are real or current odds.
