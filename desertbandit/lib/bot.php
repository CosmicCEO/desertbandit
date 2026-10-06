<?php
/**
 * Desert Bandit computer player: the exact best policy from tools/simulate.py, read from lib/policy.json
 * (written by tools/gen_policy.py). Pure: no database, no randomness. PHP 7.4 and 8.x compatible.
 *
 *   $bot = new BanditBot(__DIR__ . '/policy.json');
 *   $move = $bot->decide($state);   // array('kind' => 'roll' | 'bank', 'picks' => array(reel positions))
 *
 * It follows simulate.py's play_turn: among the scoring picks it keeps the one with the best expected value, then banks when banking
 * is allowed and is worth at least as much as rolling on. The Sweep Bonus uses the average bonus, as the solver does.
 */
require_once __DIR__ . '/rules.php';

class BanditBot
{
    private $pol;
    private $unit;

    public function __construct($policyPath)
    {
        $raw = file_get_contents($policyPath);
        $this->pol = json_decode($raw, true);
        if (!is_array($this->pol) || !isset($this->pol['cards'])) {
            throw new RuntimeException('Bad policy file.');
        }
        $this->unit = (int)$this->pol['unit'];
    }

    /** Expected final payout, in units, when forced to roll $n free reels with stake $s units and $f sweeps. */
    public function rollValue($kind, $n, $s, $f)
    {
        $tab = $this->pol['cards'][$kind]['R'];
        $fi = min($f, count($tab) - 1);
        $si = (int)min($s, (int)$this->pol['smax']);
        return $tab[$fi][$n - 1][$si];
    }

    /** Exact expected payout of a whole turn for this card (dollars), as solved offline. */
    public function expectedTurn($kind)
    {
        return $this->pol['cards'][$kind]['ev'];
    }

    private function bankUnits($kind, $s, $f)
    {
        $p = $this->pol['params'];
        if ($s <= 0 || $kind === 'broken' || $kind === 'offroad') {
            return null;
        }
        if ($kind === 'fire') {
            return $s * $this->unit >= $p['groundFireMin'] ? $s + $p['groundFireBonus'] / $this->unit : null;
        }
        if ($kind === 'overdue') {
            return $f >= 2 ? $s * $p['overdueMult'] + $p['overdueBonus'] / $this->unit : null;
        }
        if ($kind === 'subpoena') {
            return $s + $p['subpoenaSteal'] / $this->unit;
        }
        return $s;
    }

    private function value($kind, $n, $s, $f)
    {
        $b = $this->bankUnits($kind, $s, $f);
        if ($s * $this->unit >= $this->pol['cap'] && $b !== null) {
            return $b;
        }
        $r = $this->rollValue($kind, $n, $s, $f);
        return $b === null ? $r : max($b, $r);
    }

    /** After keeping the last free reel: array(terminal value or null, next stake, next sweeps). */
    private function sweep($kind, $s, $f)
    {
        $p = $this->pol['params'];
        if ($kind === 'offroad') {
            return array($s * $p['offroadMult'] + $p['offroadBonus'] / $this->unit, $s, $f);
        }
        if ($kind === 'sweep' && $f === 0) {
            $avg = array_sum($p['sweepBonus']) / count($p['sweepBonus']) / $this->unit;
            return array(null, $s + $avg, 1);
        }
        return array(null, $s, min($f + 1, 2));
    }

    /**
     * Every useful way to keep reels from the free ones: array(used => array('pts' => dollars, 'picks' => positions)).
     * One entry per number of reels used, the best scoring one (as the simulator's lock_options does).
     */
    public function lockOptions(array $reels, array $locked)
    {
        $positions = array();
        $free = 0;
        for ($i = 0; $i < BanditRules::REELS; $i++) {
            if (!$locked[$i]) {
                $positions[$reels[$i]][] = $i;
                $free++;
            }
        }
        $combos = array(array('used' => 0, 'pts' => 0, 'picks' => array()));
        for ($sym = 0; $sym < BanditRules::SYMBOL_COUNT; $sym++) {
            $pos = isset($positions[$sym]) ? $positions[$sym] : array();
            $k = count($pos);
            $choices = array(array(0, 0, array()));
            if ($k >= 3) {
                $choices[] = array($k, BanditRules::$TRIPLE[$sym] * BanditRules::$KIND_MULT[$k], $pos);
                if ($k > 3) {
                    $choices[] = array(3, BanditRules::$TRIPLE[$sym], array_slice($pos, 0, 3));
                }
            }
            if (isset(BanditRules::$SINGLE[$sym])) {
                for ($j = 1; $j <= $k; $j++) {
                    $choices[] = array($j, $j * BanditRules::$SINGLE[$sym], array_slice($pos, 0, $j));
                }
            }
            $next = array();
            foreach ($combos as $c) {
                foreach ($choices as $ch) {
                    $next[] = array('used' => $c['used'] + $ch[0], 'pts' => $c['pts'] + $ch[1], 'picks' => array_merge($c['picks'], $ch[2]));
                }
            }
            $combos = $next;
        }
        $best = array();
        foreach ($combos as $c) {
            if ($c['used'] > 0 && (!isset($best[$c['used']]) || $c['pts'] > $best[$c['used']]['pts'])) {
                $best[$c['used']] = array('pts' => $c['pts'], 'picks' => $c['picks']);
            }
        }
        if ($free === BanditRules::REELS && count($positions) === BanditRules::REELS) {      // six different symbols
            if (!isset($best[6]) || BanditRules::STRAIGHT > $best[6]['pts']) {
                $all = array();
                foreach ($positions as $pos) {
                    $all[] = $pos[0];
                }
                sort($all);
                $best[6] = array('pts' => BanditRules::STRAIGHT, 'picks' => $all);
            }
        }
        ksort($best);
        return $best;
    }

    public function decide(array $state)
    {
        if ($state['phase'] === 'start') {
            return array('kind' => 'roll', 'picks' => array());
        }
        $kind = $state['card'];
        $n = 0;
        foreach ($state['locked'] as $l) {
            if (!$l) {
                $n++;
            }
        }
        $s = (int)($state['stake'] / $this->unit);
        $f = (int)$state['sweeps'];
        $options = $this->lockOptions($state['reels'], $state['locked']);
        $bestV = -1.0;
        $chosen = null;
        foreach ($options as $used => $o) {
            $s2 = $s + $o['pts'] / $this->unit;
            if ($used === $n) {
                $sw = $this->sweep($kind, $s2, $f);
                $v = $sw[0] !== null ? $sw[0] : $this->value($kind, 6, $sw[1], $sw[2]);
                $next = array($sw[0], 6, $sw[1], $sw[2]);
            } else {
                $v = $this->value($kind, $n - $used, $s2, $f);
                $next = array(null, $n - $used, $s2, $f);
            }
            if ($v > $bestV) {
                $bestV = $v;
                $chosen = array('picks' => $o['picks'], 'next' => $next);
            }
        }
        if ($chosen === null) {
            throw new RuntimeException('The bot was handed a roll with nothing to keep.');
        }
        list($terminal, $n2, $s3, $f3) = $chosen['next'];
        if ($terminal !== null) {
            return array('kind' => 'roll', 'picks' => $chosen['picks']);       // an Off-Road sweep: the engine pays it out
        }
        $b = $this->bankUnits($kind, $s3, $f3);
        if ($b !== null && $b >= $this->rollValue($kind, $n2, $s3, $f3) - 1e-9) {
            return array('kind' => 'bank', 'picks' => $chosen['picks']);
        }
        return array('kind' => 'roll', 'picks' => $chosen['picks']);
    }
}
