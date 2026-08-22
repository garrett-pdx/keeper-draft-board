# Mudd League draft-tendency analysis (2023-2025)

Source: `scripts/analyze-draft-positions.py`, reading `static/data/league-history.json`
and `static/data/players.json`. Covers the three most recent completed drafts (2023,
2024, 2025), each a single 14-round `primary` draft. Keeper picks are excluded from
every count below (a kept player was never a live draft-day decision that year).
Full per-round, per-season, per-manager counts are in the companion
`draft-position-analysis.json` in this same directory.

Post-keeper-filter pick totals: 2023 = 121, 2024 = 120, 2025 = 122 (each comfortably
under the 140-pick ceiling, consistent with ~19-20 keepers removed per season across
10 teams).

## Q1: Does the league value RBs over WRs?

Combined across all three drafts and all 14 rounds: **RB 136 picks, WR 147 picks** --
roughly even overall, WR slightly ahead. But that overall tie hides a clear round-by-round
pattern:

| Round band | RB | WR | QB | TE | Lean |
| --- | --- | --- | --- | --- | --- |
| Round 1 only | 19 | 8 | 0 | 0 | RB, ~2.4:1 |
| Rounds 1-3 | 39 | 28 | 9 | 4 | RB, ~1.4:1 |
| Rounds 1-5 | 54 | 54 | 13 | 12 | Even |
| Rounds 4-8 | 44 | 57 | 12 | 17 | WR |
| Rounds 9-14 | 53 | 62 | 18 | 20 | WR (narrower) |

**Finding: the league is RB-heavy early and WR-heavy from the middle rounds on.**
Round 1 is the sharpest signal -- no QB or TE was drafted in round 1 in any of the
three years, and RBs outnumbered WRs there by roughly 2.4 to 1. That RB lean
persists (narrower) through round 3, flips to a WR lean by round 4, and WR stays
modestly ahead the rest of the way through round 14. Round 2 itself is the one
early-round exception where WR led (12 vs 8) before RB retook the lead in round 3
(12 vs 8) -- so the RB-early pattern isn't perfectly monotonic round-by-round, but
it's the clear multi-round trend.

QBs and TEs are both drafted steadily starting round 2, never dominant in any single
round, with a gentle uptick in TE volume in the double-digit rounds (round 10 alone
saw 8 TEs drafted across the three years, the single highest TE round).

## Q2: Do managers draft multiple QBs or TEs in one draft?

Across 30 manager-seasons (10 active managers who fielded a team in all three of
2023/2024/2025, minus BBrown16 who joined in 2023 -- giving 3+3+3+...+3 = 30 total
manager-season rows once each manager's actual seasons-in-league are respected),
**21 of 30 (70%) drafted 2+ QBs or 2+ TEs in that draft.** This is common, not rare,
across the league -- but a few managers are the clear repeat offenders:

**Consistently double up, every single year (3/3 seasons):**
- **tuckersdumbteam** -- drafted 2+ QBs AND 2+ TEs in all three drafts (2023, 2024, 2025).
- **TnT44** -- drafted 2+ TEs in all three drafts (QB never doubled up).
- **BBrown16** -- drafted 2+ QBs in all three drafts (in-league since 2023); also 2+ TEs
  in two of those three (2023, 2025).

**Frequently, but not every year (2/3 seasons):**
- **kshoyer** -- 2+ QBs in 2 of 3 seasons, 2+ TEs in 2 of 3 seasons.
- **malstol** -- 2+ QBs in 2 of 3 seasons, 2+ TEs in 2 of 3 seasons.
- **Gurret** -- 2+ QBs in 2 of 3 seasons (2024, 2025); never doubled up on TE.

**Rarely or never:**
- **mikestreinz** -- 2+ QBs once (2024); never 2+ TE.
- **Kabroa** -- 2+ TE once (2024); never 2+ QB.
- **jonahcartwright** -- 2+ TE once (2024); never 2+ QB.
- **paulslaats** -- 2+ QB once (2025); never 2+ TE.

**Notably, no manager in this league ever drafted 2+ QB AND 2+ TE and did so in a
season where the other did not also happen** -- tuckersdumbteam and BBrown16 both hit
the QB+TE double in the same season more than once (tuckersdumbteam all three years,
BBrown16 in 2023 and 2025), making them the two managers most inclined to stockpile
both positions rather than punt one for depth at the other.

Two former managers (Football_Team, who never actually held a roster in any season,
and JJJet/Jordan Leonard, who played 2022 only) are excluded entirely from this
breakdown rather than shown with misleading 0/0 rows, since neither drafted in
2023-2025.
