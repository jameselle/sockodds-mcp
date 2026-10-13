# Fixtures

`docs/` holds example responses from the public SockOdds API v1 docs, so tests check parsing against the
documented shape. Each docs page shows the output its sample printed when run against a local copy of the
API with invented prices:

| File | Copied from |
| --- | --- |
| `odds-quickstart.json` | https://sockodds.com/docs/quickstart/ (the odds request in step 3) |
| `odds-event-handicap.json` | https://sockodds.com/docs/odds/ ("One event's prices") |
| `odds-withheld.json` | https://sockodds.com/docs/odds/ ("Why a price can be missing") |
| `events-rlwc.json` | https://sockodds.com/docs/ (`GET /v1/events?league=rlwc` sample) |
| `leagues-rugby-league.json` | https://sockodds.com/docs/ (`GET /v1/leagues?sport=rugby_league` sample) |
| `error-400.json`, `error-404.json` | https://sockodds.com/docs/errors/ |
| `error-401.json` | https://sockodds.com/docs/authentication/ |
| `error-403.json` | https://sockodds.com/docs/limits/ (a league outside the free plan) |
| `error-429.json`, `error-429-monthly.json` | Built from the problem fields and the two 429 titles in https://sockodds.com/docs/errors/ (the docs show no recorded 429 body) |

`demo/` holds INVENTED data in the v1 shape, used by demo mode (`SOCKODDS_DEMO=1`) and by tests. Every id,
price and timestamp is made up and none are real or current odds.
