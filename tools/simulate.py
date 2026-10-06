#!/usr/bin/env python3
"""Desert Bandit pay-table simulator (Wave 0).

Solves each goal card's turn exactly (dynamic programming over free reels, unbanked stake and card state), then plays sampled turns with that
best policy to report bust rate, payout, rolls per turn and game length. The same policy is the proposed computer player.

Money is in dollars; the DP works in $50 units. Edit the PAY block, rerun, and read the report. No dependencies.

    python3 tools/simulate.py            # report
    python3 tools/simulate.py --games 20000
"""
import argparse, itertools, random, sys
from functools import lru_cache
from math import factorial

# ------------------------------------------------------------------ PAY TABLE (all values are proposals, tuned by this tool)
SYMBOLS = ['Olla', 'Sunset Mountain', '17 Palms', 'Sheep', 'Palm Trees', 'Dos Cabezas']   # index 0..5, premium singles are the first two
SINGLE = {0: 100, 1: 50}                                                 # a lone Olla / Sunset Mountain scores on its own
TRIPLE = {0: 1000, 1: 600, 2: 500, 3: 400, 4: 300, 5: 200}              # three of a kind; more of a kind multiplies it
KIND_MULT = {3: 1, 4: 2, 5: 3, 6: 4}
STRAIGHT = 1500                                                          # one of each symbol on six reels: the "Supersweep"
UNIT = 50
CAP = 6000                                                               # a stake this big is always banked (keeps the DP finite)

SWEEP_BONUS = [300, 400, 500]       # Found an Olla: paid on the first sweep (all six reels locked)
GROUND_FIRE_MIN = 1000              # Ground Fire Report: cannot bank below this
GROUND_FIRE_BONUS = 500             # ...and a successful bank pays this extra
OFFROAD_MULT = 2                    # Off-Road Bust: a sweep ends the turn and pays stake x this + bonus
OFFROAD_BONUS = 300
SUBPOENA_STEAL = 100                # Subpoena: a bank also takes this from the leader (a swing, only if you are not the leader)
OVERDUE_MULT = 2                    # Reports Overdue: bank only after two sweeps, paid stake x this + the bonus
OVERDUE_BONUS = 2000
CARDS = [                            # (name, mechanic, percent of turns), odds from the DETERMINATION note
    ('Found an Olla', 'Sweep Bonus', 56),
    ('Vehicle Breaks Down', 'Out of Order', 11),
    ('Ground Fire Report', 'Grand Force', 11),
    ('Off-Road Bust', 'Bop Till Ya Drop', 11),
    ('Subpoena', 'Revenge', 7),
    ('Reports Overdue', 'Double or Nothing', 4),
]


# ------------------------------------------------------------------ roll outcomes and lock options
def multisets(n):
    """All counts-tuples over 6 symbols with total n, with their probability."""
    out = []
    for c in itertools.product(range(n + 1), repeat=6):
        if sum(c) != n:
            continue
        p = factorial(n)
        for k in c:
            p //= factorial(k)
        out.append((c, p / 6.0 ** n))
    return out


def lock_options(c):
    """Best points for each number of reels locked, for a roll with these counts. [(used, points)], sorted by used."""
    per = []
    for i, k in enumerate(c):
        ch = [(0, 0)]
        if k >= 3:
            ch.append((k, TRIPLE[i] * KIND_MULT[k]))
            if k > 3:
                ch.append((3, TRIPLE[i]))
        if i in SINGLE:
            for j in range(1, k + 1):
                ch.append((j, j * SINGLE[i]))
        per.append(ch)
    best = {}
    for combo in itertools.product(*per):
        used = sum(u for u, _ in combo)
        pts = sum(p for _, p in combo)
        if used and pts > best.get(used, 0):
            best[used] = pts
    if all(k == 1 for k in c):                       # six different symbols
        best[6] = max(best.get(6, 0), STRAIGHT)
    return sorted(best.items())


OUTCOMES = {n: [(c, p, lock_options(c)) for c, p in multisets(n)] for n in range(1, 7)}
BUST = {n: sum(p for c, p, o in OUTCOMES[n] if not o) for n in range(1, 7)}


# ------------------------------------------------------------------ the solver: one card = one set of rules
class Card:
    """kind: sweep | broken | fire | offroad | subpoena | overdue. State f: sweeps made so far (capped at 2)."""

    def __init__(self, kind):
        self.kind = kind
        self.bonus_units = sum(SWEEP_BONUS) / len(SWEEP_BONUS) / UNIT

    def bank(self, s, f):                    # value of banking now, or None when banking is not allowed
        k = self.kind
        if s <= 0 or k in ('broken', 'offroad'):
            return None
        if k == 'fire':
            return s + GROUND_FIRE_BONUS / UNIT if s * UNIT >= GROUND_FIRE_MIN else None
        if k == 'overdue':
            return s * OVERDUE_MULT + OVERDUE_BONUS / UNIT if f >= 2 else None
        if k == 'subpoena':
            return s + SUBPOENA_STEAL / UNIT
        return s

    def sweep(self, s, f):
        """After locking the last free reel: (terminal payout, or None, next s, next f)."""
        k = self.kind
        if k == 'offroad':
            return s * OFFROAD_MULT + OFFROAD_BONUS / UNIT, s, f
        if k == 'sweep' and f == 0:
            return None, s + self.bonus_units, 1
        return None, s, min(f + 1, 2)


def solve(card):
    sys.setrecursionlimit(10000)

    @lru_cache(maxsize=None)
    def R(n, s, f):
        """Expected final payout (in units) when forced to roll n free reels with stake s."""
        tot = 0.0
        for c, p, opts in OUTCOMES[n]:
            if not opts:
                continue                                    # bust: 0
            best = 0.0
            for used, pts in opts:
                s2 = s + pts / UNIT
                if used == n:
                    term, s3, f3 = card.sweep(s2, f)
                    v = term if term is not None else D(6, s3, f3)
                else:
                    v = D(n - used, s2, f)
                if v > best:
                    best = v
            tot += p * best
        return tot

    @lru_cache(maxsize=None)
    def D(n, s, f):
        b = card.bank(s, f)
        if s * UNIT >= CAP and b is not None:
            return b
        r = R(n, s, f)
        return r if b is None else max(b, r)

    return R, D


# ------------------------------------------------------------------ play sampled turns with the solved policy
def play_turn(card, R, D, rng):
    """Returns (payout $, rolls, busted). Stake in units."""
    n, s, f, rolls = 6, 0, 0, 0
    if card.kind == 'broken':
        return 0, 0, False
    while True:
        rolls += 1
        c = [0] * 6
        for _ in range(n):
            c[rng.randrange(6)] += 1
        opts = lock_options(tuple(c))
        if not opts:
            return 0, rolls, True
        best, bv, bnext = None, -1.0, None
        for used, pts in opts:
            s2 = s + pts / UNIT
            if used == n:
                term, s3, f3 = card.sweep(s2, f)
                v = term if term is not None else D(6, s3, f3)
                nxt = (6, s3, f3, term)
            else:
                v = D(n - used, s2, f)
                nxt = (n - used, s2, f, None)
            if v > bv:
                bv, bnext = v, nxt
        n, s, f, term = bnext
        if term is not None:
            return term * UNIT, rolls, False
        b = card.bank(s, f)
        if b is not None and b >= R(n, s, f) - 1e-9:
            return b * UNIT, rolls, False


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--turns', type=int, default=20000, help='sampled turns per card')
    ap.add_argument('--games', type=int, default=5000, help='sampled games per player count')
    ap.add_argument('--target', type=int, default=5000)
    ap.add_argument('--roll-seconds', type=float, default=12.0, help='time a human takes for one roll cycle (spin, look, lock, tap)')
    ap.add_argument('--seed', type=int, default=1)
    ap.add_argument('--set', action='append', default=[], metavar='NAME=VALUE', help='override a card parameter, e.g. --set SUBPOENA_STEAL=150')
    a = ap.parse_args()
    for kv in a.set:
        k, v = kv.split('=')
        assert k in ('GROUND_FIRE_MIN', 'GROUND_FIRE_BONUS', 'OFFROAD_MULT', 'OFFROAD_BONUS', 'SUBPOENA_STEAL', 'OVERDUE_MULT', 'OVERDUE_BONUS'), k
        globals()[k] = int(v)
    rng = random.Random(a.seed)
    kinds = {'Found an Olla': 'sweep', 'Vehicle Breaks Down': 'broken', 'Ground Fire Report': 'fire',
             'Off-Road Bust': 'offroad', 'Subpoena': 'subpoena', 'Reports Overdue': 'overdue'}

    print('Single-roll bust chance by free reels: ' + '  '.join('%d: %.1f%%' % (n, 100 * BUST[n]) for n in range(1, 7)))
    print('\nCard                  odds  EV exact  EV sampled  bust%  mean rolls  mean payout when paid')
    samples, allrolls = {}, {}
    total_ev = 0.0
    for name, mech, pct in CARDS:
        card = Card(kinds[name])
        R, D = solve(card)
        ev = 0.0 if card.kind == 'broken' else R(6, 0, 0) * UNIT
        pay, rolls, busts = [], 0, 0
        for _ in range(a.turns):
            p, r, b = play_turn(card, R, D, rng)
            pay.append(p); rolls += r; busts += b
        paid = [p for p in pay if p > 0]
        samples[name] = pay
        allrolls[name] = rolls / len(pay)
        total_ev += ev * pct / 100
        print('%-21s %3d%%  %8.0f  %10.0f  %5.1f  %10.2f  %8.0f' % (
            name, pct, ev, sum(pay) / len(pay), 100 * busts / len(pay), rolls / len(pay), sum(paid) / len(paid) if paid else 0))
    print('\nMean payout per turn across the deck: $%.0f' % total_ev)

    deck = [(n, pct) for n, m, pct in CARDS]
    print('\nGame to $%d (sampled turns, Subpoena steal ignored for length)   roll cycle %.0f s' % (a.target, a.roll_seconds))
    print('players  turns each (mean / p10 / p90)   rolls total   est. minutes')
    for players in (2, 3, 4):
        lens, rolltot = [], []
        for _ in range(a.games):
            bank = [0] * players
            turns = rl = 0
            while max(bank) < a.target:
                for i in range(players):
                    name = rng.choices([d[0] for d in deck], [d[1] for d in deck])[0]
                    bank[i] += rng.choice(samples[name])
                    rl += max(1, allrolls[name])
                    if bank[i] >= a.target:
                        break
                turns += 1
            lens.append(turns); rolltot.append(rl)
        lens.sort()
        print('   %d       %5.1f / %d / %d                %6.0f        %5.1f' % (
            players, sum(lens) / len(lens), lens[len(lens) // 10], lens[9 * len(lens) // 10],
            sum(rolltot) / len(rolltot), sum(rolltot) / len(rolltot) * a.roll_seconds / 60))


if __name__ == '__main__':
    main()
