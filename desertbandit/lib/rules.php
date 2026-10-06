<?php
/**
 * Desert Bandit rules engine: pure. No database, no globals, no randomness of its own.
 * The caller passes $rand, a callable ($min, $max) returning an int in [$min, $max] (production passes random_int).
 *
 * PHP 7.4 and 8.x compatible: array() syntax, no match, no enums, no typed properties.
 * Rules and numbers: docs/DESIGN.md. The same numbers drive tools/simulate.py and the computer player (lib/bot.php).
 *
 * State (plain array, stored as JSON):
 *   status   'active' | 'finished'
 *   target   victory total in dollars
 *   turn     counts accepted actions (roll / bank / skip / sit out of the current player); the API's stale-tap check
 *   current  index into players of the player on turn
 *   players  list of array(id, name, bank, out)
 *   card     goal card key of the current turn: sweep | broken | fire | offroad | subpoena | overdue
 *   phase    'start' (nothing rolled yet this turn) | 'rolled' (reels on the table, the player must pick scoring reels)
 *   reels    six symbol numbers 0..5, or null before the first roll of a turn
 *   locked   six bools, true for reels already kept this turn
 *   stake    dollars kept this turn but not banked
 *   sweeps   sweeps made this turn (0..2)
 *   winner   player id or null
 *
 * Every public action returns array('state' => ..., 'events' => ..., 'log' => ...), or throws BanditRuleError (the API answers 409).
 * Events are what the clients animate and read out; every event has a 'type' and a 'playerId'.
 */

class BanditRuleError extends Exception
{
}

class BanditRules
{
    const REELS = 6;
    const SYMBOL_COUNT = 6;
    const STRAIGHT = 1500;                       // one of each symbol on six reels: the Supersweep
    const GROUND_FIRE_MIN = 1000;
    const GROUND_FIRE_BONUS = 500;
    const OFFROAD_MULT = 2;
    const OFFROAD_BONUS = 300;
    const SUBPOENA_STEAL = 100;
    const OVERDUE_MULT = 2;
    const OVERDUE_BONUS = 2000;
    const MIN_TARGET = 2500;
    const MAX_TARGET = 15000;
    const DEFAULT_TARGET = 5000;
    const MAX_BROKEN_IN_A_ROW = 12;              // guard: after this many skipped turns in a row a playable card is dealt

    // lone symbols that score on their own: symbol number => dollars each
    public static $SINGLE = array(0 => 100, 1 => 50);
    // three of a kind by symbol number; 4 / 5 / 6 of a kind multiply it
    public static $TRIPLE = array(0 => 1000, 1 => 600, 2 => 500, 3 => 400, 4 => 300, 5 => 200);
    public static $KIND_MULT = array(3 => 1, 4 => 2, 5 => 3, 6 => 4);
    public static $SWEEP_BONUS = array(300, 400, 500);   // Found an Olla: small, medium, large
    // goal cards in deal order with their percent of turns (they add to 100)
    public static $CARDS = array(
        array('sweep', 56), array('broken', 11), array('fire', 11),
        array('offroad', 11), array('subpoena', 7), array('overdue', 4),
    );
    public static $CARD_NAMES = array(
        'sweep' => 'Found an Olla', 'broken' => 'Vehicle Breaks Down', 'fire' => 'Ground Fire Report',
        'offroad' => 'Off-Road Bust', 'subpoena' => 'Subpoena', 'overdue' => 'Reports Overdue',
    );
    public static $CARD_TEXT = array(
        'sweep' => 'Keep all six reels in one turn and an olla pays a $300, $400 or $500 bonus.',
        'broken' => 'Your vehicle breaks down. This turn is skipped.',
        'fire' => 'You cannot bank under $1,000. Bank $1,000 or more and it pays $500 extra.',
        'offroad' => 'No banking. Keep rolling until you sweep all six reels: it pays twice the stake plus $300. A bust pays nothing.',
        'subpoena' => 'A normal turn. When you bank, you take $100 from the leader (nothing if you lead).',
        'overdue' => 'Bank only after two sweeps. A bank pays twice the stake plus $2,000. Any bust pays nothing.',
    );

    public static function cardName($key)
    {
        return isset(self::$CARD_NAMES[$key]) ? self::$CARD_NAMES[$key] : $key;
    }

    public static function cardText($key)
    {
        return isset(self::$CARD_TEXT[$key]) ? self::$CARD_TEXT[$key] : '';
    }

    public static function cleanTarget($target)
    {
        $t = (int)$target;
        if ($t < self::MIN_TARGET || $t > self::MAX_TARGET || $t % 500 !== 0) {
            throw new BanditRuleError('The victory total must be between $2,500 and $15,000, in steps of $500.');
        }
        return $t;
    }

    // ------------------------------------------------------------------ scoring (pure)

    /**
     * Dollars for keeping exactly these reels (a list of symbol numbers), or null when they do not all score.
     * Three or more of a kind pays the symbol's three-of-a-kind value times 1 / 2 / 3 / 4 for 3 / 4 / 5 / 6 of a kind.
     * One or two of a kind only score for the symbols in $SINGLE. Six different symbols are the Supersweep.
     */
    public static function scoreSelection(array $symbols)
    {
        $n = count($symbols);
        if ($n < 1 || $n > self::REELS) {
            return null;
        }
        $counts = array_fill(0, self::SYMBOL_COUNT, 0);
        foreach ($symbols as $s) {
            if (!is_int($s) || $s < 0 || $s >= self::SYMBOL_COUNT) {
                return null;
            }
            $counts[$s]++;
        }
        if ($n === self::REELS && count(array_unique($symbols)) === self::REELS) {
            return self::STRAIGHT;
        }
        $total = 0;
        for ($i = 0; $i < self::SYMBOL_COUNT; $i++) {
            $j = $counts[$i];
            if ($j === 0) {
                continue;
            }
            if ($j >= 3) {
                $total += self::$TRIPLE[$i] * self::$KIND_MULT[$j];
            } elseif (isset(self::$SINGLE[$i])) {
                $total += $j * self::$SINGLE[$i];
            } else {
                return null;
            }
        }
        return $total;
    }

    /**
     * Which of the six reels can be part of some scoring pick right now. Locked reels are false.
     * A reel scores if its symbol scores alone, or at least three free reels show it, or the six free reels are all different.
     */
    public static function scoringReels(array $reels, array $locked)
    {
        $out = array_fill(0, self::REELS, false);
        $counts = array_fill(0, self::SYMBOL_COUNT, 0);
        $freeN = 0;
        for ($i = 0; $i < self::REELS; $i++) {
            if (!$locked[$i] && $reels[$i] !== null) {
                $counts[$reels[$i]]++;
                $freeN++;
            }
        }
        $straight = $freeN === self::REELS && count(array_filter($counts)) === self::REELS;
        for ($i = 0; $i < self::REELS; $i++) {
            if ($locked[$i] || $reels[$i] === null) {
                continue;
            }
            $s = $reels[$i];
            $out[$i] = $straight || isset(self::$SINGLE[$s]) || $counts[$s] >= 3;
        }
        return $out;
    }

    /** What banking $stake would pay for this card and sweep count, or null when banking is not allowed. */
    public static function bankAmount($card, $stake, $sweeps)
    {
        if ($stake <= 0 || $card === 'broken' || $card === 'offroad') {
            return null;
        }
        if ($card === 'fire') {
            return $stake >= self::GROUND_FIRE_MIN ? $stake + self::GROUND_FIRE_BONUS : null;
        }
        if ($card === 'overdue') {
            return $sweeps >= 2 ? $stake * self::OVERDUE_MULT + self::OVERDUE_BONUS : null;
        }
        return $stake;
    }

    // ------------------------------------------------------------------ new game

    /** $players: list of array('id' => int, 'name' => string), in turn order. The first player starts. */
    public static function newGameState(array $players, $target, $rand)
    {
        if (count($players) < 2 || count($players) > 4) {
            throw new BanditRuleError('Desert Bandit needs 2 to 4 players.');
        }
        $list = array();
        foreach ($players as $p) {
            $list[] = array('id' => (int)$p['id'], 'name' => (string)$p['name'], 'bank' => 0, 'out' => false);
        }
        $state = array(
            'status' => 'active', 'target' => self::cleanTarget($target), 'turn' => 0, 'current' => 0, 'players' => $list,
            'card' => 'sweep', 'phase' => 'start', 'reels' => null, 'locked' => array_fill(0, self::REELS, false),
            'stake' => 0, 'sweeps' => 0, 'winner' => null,
        );
        $events = array();
        self::beginTurn($state, $events, $rand, 0);
        return array('state' => $state, 'events' => $events, 'log' => self::logOf($events));
    }

    // ------------------------------------------------------------------ actions

    /**
     * Roll. At the start of a turn, $picks must be empty and all six reels roll.
     * After a roll, $picks (reel positions 0..5) are kept first, then the rest roll again.
     */
    public static function roll(array $state, array $picks, $rand)
    {
        self::mustBeActive($state);
        $events = array();
        $pid = $state['players'][$state['current']]['id'];
        if ($state['phase'] === 'start') {
            if (count($picks) > 0) {
                throw new BanditRuleError('Roll the reels first, then pick the ones you want to keep.');
            }
        } else {
            $r = self::applyPicks($state, $picks, $events, $rand);
            if ($r !== null) {                                   // Off-Road Bust sweep: the turn ends with a payout
                self::payOut($state, $r, 'offroad', $events, $rand);
                $state['turn']++;
                return self::done($state, $events);
            }
        }
        // roll every reel that is not kept
        $rolled = array();
        $reels = ($state['reels'] === null) ? array_fill(0, self::REELS, null) : $state['reels'];
        for ($i = 0; $i < self::REELS; $i++) {
            if (!$state['locked'][$i]) {
                $reels[$i] = (int)call_user_func($rand, 0, self::SYMBOL_COUNT - 1);
                $rolled[] = $i;
            }
        }
        $state['reels'] = $reels;
        $scoring = self::scoringReels($reels, $state['locked']);
        $events[] = array('type' => 'roll', 'playerId' => $pid, 'reels' => $reels, 'rolled' => $rolled, 'scoring' => $scoring);
        if (!in_array(true, $scoring, true)) {
            $events[] = array('type' => 'bust', 'playerId' => $pid, 'lost' => $state['stake']);
            self::endTurn($state, $events, $rand);
        } else {
            $state['phase'] = 'rolled';
        }
        $state['turn']++;
        return self::done($state, $events);
    }

    /** Keep $picks, then bank the stake (the card decides whether banking is allowed and what it pays). */
    public static function bank(array $state, array $picks, $rand)
    {
        self::mustBeActive($state);
        if ($state['phase'] !== 'rolled') {
            throw new BanditRuleError('Roll the reels first.');
        }
        if ($state['card'] === 'offroad') {
            throw new BanditRuleError('Off-Road Bust: no banking. Keep rolling until you sweep all six reels.');
        }
        $events = array();
        self::applyPicks($state, $picks, $events, $rand);
        $amount = self::bankAmount($state['card'], $state['stake'], $state['sweeps']);
        if ($amount === null) {
            if ($state['card'] === 'fire') {
                throw new BanditRuleError('Ground Fire Report: you need $1,000 to bank.');
            }
            if ($state['card'] === 'overdue') {
                throw new BanditRuleError('Reports Overdue: you can bank only after two sweeps.');
            }
            throw new BanditRuleError('You cannot bank that.');
        }
        self::payOut($state, $amount, 'bank', $events, $rand);
        $state['turn']++;
        return self::done($state, $events);
    }

    /** Host skip: the player on turn loses the unbanked stake and the next player starts. */
    public static function skipTurn(array $state, $rand)
    {
        self::mustBeActive($state);
        $events = array();
        $pid = $state['players'][$state['current']]['id'];
        $events[] = array('type' => 'skip', 'playerId' => $pid, 'lost' => $state['stake']);
        self::endTurn($state, $events, $rand);
        $state['turn']++;
        return self::done($state, $events);
    }

    /** Host sit out: an away player is passed over on every turn until they come back ($on false). */
    public static function sitOut(array $state, $playerId, $on, $rand)
    {
        self::mustBeActive($state);
        $idx = self::indexOf($state, $playerId);
        if ($idx === null) {
            throw new BanditRuleError('No such player.');
        }
        $on = (bool)$on;
        if ($state['players'][$idx]['out'] === $on) {
            return self::done($state, array());                  // already so: harmless
        }
        if ($on && self::activeCount($state) <= 1) {
            throw new BanditRuleError('At least one player has to stay in.');
        }
        $state['players'][$idx]['out'] = $on;
        $events = array(array('type' => $on ? 'sitout' : 'back', 'playerId' => (int)$playerId));
        if ($on && $idx === $state['current']) {
            self::endTurn($state, $events, $rand);
            $state['turn']++;
        }
        return self::done($state, $events);
    }

    // ------------------------------------------------------------------ internals

    private static function mustBeActive(array $state)
    {
        if ($state['status'] !== 'active') {
            throw new BanditRuleError('The game is over.');
        }
    }

    private static function indexOf(array $state, $playerId)
    {
        foreach ($state['players'] as $i => $p) {
            if ($p['id'] === (int)$playerId) {
                return $i;
            }
        }
        return null;
    }

    private static function activeCount(array $state)
    {
        $n = 0;
        foreach ($state['players'] as $p) {
            if (!$p['out']) {
                $n++;
            }
        }
        return $n;
    }

    private static function nextActive(array $state, $from)
    {
        $n = count($state['players']);
        for ($k = 1; $k <= $n; $k++) {
            $i = ($from + $k) % $n;
            if (!$state['players'][$i]['out']) {
                return $i;
            }
        }
        return $from;
    }

    private static function drawCard($rand, $allowBroken)
    {
        while (true) {
            $roll = (int)call_user_func($rand, 1, 100);
            $acc = 0;
            foreach (self::$CARDS as $c) {
                $acc += $c[1];
                if ($roll <= $acc) {
                    if ($c[0] === 'broken' && !$allowBroken) {
                        break;                                   // deal again
                    }
                    return $c[0];
                }
            }
        }
    }

    /** Start the turn of player $idx: deal a goal card. A broken-down vehicle skips the turn and the next player starts. */
    private static function beginTurn(array &$state, array &$events, $rand, $idx)
    {
        for ($tries = 0; ; $tries++) {
            $state['current'] = $idx;
            $state['card'] = self::drawCard($rand, $tries < self::MAX_BROKEN_IN_A_ROW);
            $state['phase'] = 'start';
            $state['reels'] = null;
            $state['locked'] = array_fill(0, self::REELS, false);
            $state['stake'] = 0;
            $state['sweeps'] = 0;
            $pid = $state['players'][$idx]['id'];
            $events[] = array('type' => 'turn', 'playerId' => $pid, 'card' => $state['card']);
            if ($state['card'] !== 'broken') {
                return;
            }
            $events[] = array('type' => 'broken', 'playerId' => $pid);
            $idx = self::nextActive($state, $idx);
        }
    }

    private static function endTurn(array &$state, array &$events, $rand)
    {
        $next = self::nextActive($state, $state['current']);
        self::beginTurn($state, $events, $rand, $next);
    }

    /**
     * Keep the picked reels: validate, add their value to the stake, mark them locked, and handle a sweep (all six kept).
     * Returns null normally, or the payout of an Off-Road Bust sweep.
     */
    private static function applyPicks(array &$state, array $picks, array &$events, $rand)
    {
        if (count($picks) < 1) {
            throw new BanditRuleError('Pick at least one reel that scores.');
        }
        $symbols = array();
        $seen = array();
        foreach ($picks as $p) {
            if (!is_int($p) || $p < 0 || $p >= self::REELS || isset($seen[$p]) || $state['locked'][$p] || $state['reels'][$p] === null) {
                throw new BanditRuleError('Those reels cannot be kept.');
            }
            $seen[$p] = true;
            $symbols[] = $state['reels'][$p];
        }
        $points = self::scoreSelection($symbols);
        if ($points === null) {
            throw new BanditRuleError('Every reel you keep has to score.');
        }
        sort($picks);
        $pid = $state['players'][$state['current']]['id'];
        foreach ($picks as $p) {
            $state['locked'][$p] = true;
        }
        $state['stake'] += $points;
        $events[] = array('type' => 'lock', 'playerId' => $pid, 'picks' => $picks, 'points' => $points, 'stake' => $state['stake']);
        if (in_array(false, $state['locked'], true)) {
            return null;
        }
        // sweep: all six kept
        if ($state['card'] === 'offroad') {
            $events[] = array('type' => 'sweep', 'playerId' => $pid, 'bonus' => 0, 'sweeps' => $state['sweeps'] + 1);
            return $state['stake'] * self::OFFROAD_MULT + self::OFFROAD_BONUS;
        }
        $bonus = 0;
        if ($state['card'] === 'sweep' && $state['sweeps'] === 0) {
            $bonus = self::$SWEEP_BONUS[(int)call_user_func($rand, 0, count(self::$SWEEP_BONUS) - 1)];
            $state['stake'] += $bonus;
        }
        $state['sweeps'] = min($state['sweeps'] + 1, 2);
        $state['locked'] = array_fill(0, self::REELS, false);
        $events[] = array('type' => 'sweep', 'playerId' => $pid, 'bonus' => $bonus, 'sweeps' => $state['sweeps']);
        return null;
    }

    /** Add $amount to the current player's bank (and the Subpoena steal), then declare a winner or pass the turn. */
    private static function payOut(array &$state, $amount, $via, array &$events, $rand)
    {
        $idx = $state['current'];
        $pid = $state['players'][$idx]['id'];
        $steal = null;
        if ($state['card'] === 'subpoena' && $via === 'bank') {
            $leader = null;
            foreach ($state['players'] as $i => $p) {
                if ($i !== $idx && ($leader === null || $p['bank'] > $state['players'][$leader]['bank'])) {
                    $leader = $i;
                }
            }
            if ($leader !== null && $state['players'][$leader]['bank'] > $state['players'][$idx]['bank']) {
                $take = min(self::SUBPOENA_STEAL, $state['players'][$leader]['bank']);
                $state['players'][$leader]['bank'] -= $take;
                $state['players'][$idx]['bank'] += $take;
                $steal = array('fromId' => $state['players'][$leader]['id'], 'amount' => $take);
            }
        }
        $state['players'][$idx]['bank'] += $amount;
        $events[] = array(
            'type' => 'bank', 'playerId' => $pid, 'amount' => $amount, 'stake' => $state['stake'], 'via' => $via,
            'steal' => $steal, 'bank' => $state['players'][$idx]['bank'],
        );
        if ($state['players'][$idx]['bank'] >= $state['target']) {
            $state['status'] = 'finished';
            $state['winner'] = $pid;
            $state['stake'] = 0;
            $state['phase'] = 'start';
            $state['reels'] = null;
            $state['locked'] = array_fill(0, self::REELS, false);
            $events[] = array('type' => 'win', 'playerId' => $pid, 'bank' => $state['players'][$idx]['bank']);
            return;
        }
        self::endTurn($state, $events, $rand);
    }

    private static function done(array $state, array $events)
    {
        return array('state' => $state, 'events' => $events, 'log' => self::logOf($events));
    }

    /** One plain-English line per event (the API stores it as the event message). */
    public static function logOf(array $events)
    {
        $lines = array();
        foreach ($events as $e) {
            $lines[] = self::line($e);
        }
        return $lines;
    }

    private static function money($n)
    {
        return '$' . number_format($n);
    }

    private static function line(array $e)
    {
        switch ($e['type']) {
            case 'turn':
                return 'New turn. Goal card: ' . self::cardName($e['card']) . '.';
            case 'broken':
                return 'The vehicle breaks down. Turn skipped.';
            case 'roll':
                return 'Rolled ' . count($e['rolled']) . ' reel' . (count($e['rolled']) === 1 ? '' : 's') . '.';
            case 'lock':
                return 'Kept ' . count($e['picks']) . ' reel' . (count($e['picks']) === 1 ? '' : 's') . ' for ' . self::money($e['points']) . '. Stake ' . self::money($e['stake']) . '.';
            case 'sweep':
                return 'Sweep!' . ($e['bonus'] > 0 ? ' Bonus ' . self::money($e['bonus']) . '.' : '');
            case 'bust':
                return 'Bust. ' . self::money($e['lost']) . ' lost.';
            case 'bank':
                return 'Banked ' . self::money($e['amount']) . '. Total ' . self::money($e['bank']) . '.' . ($e['steal'] ? ' Took ' . self::money($e['steal']['amount']) . ' from the leader.' : '');
            case 'win':
                return 'Wins with ' . self::money($e['bank']) . '!';
            case 'skip':
                return 'Turn skipped by the host.';
            case 'sitout':
                return 'Sitting out.';
            case 'back':
                return 'Back in the game.';
        }
        return $e['type'];
    }
}
