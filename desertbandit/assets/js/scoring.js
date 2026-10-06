/*
 * scoring.js - the browser's copy of the scoring rules in lib/rules.php (scoreSelection, scoringReels, bankAmount).
 * The server is the authority; this only drives the hints, the stake preview and the button labels.
 * tests/scoring_vectors_test.js checks it against tests/vectors/scoring.json (written by the PHP tests).
 * Plain ES5. Loads in the browser (window.BanditScoring) and in Node (module.exports).
 */
(function (root) {
  'use strict';

  var REELS = 6, SYMBOL_COUNT = 6, STRAIGHT = 1500;
  var GROUND_FIRE_MIN = 1000, GROUND_FIRE_BONUS = 500, OVERDUE_MULT = 2, OVERDUE_BONUS = 2000;
  var SINGLE = { 0: 100, 1: 50 };
  var TRIPLE = [1000, 600, 500, 400, 300, 200];
  var KIND_MULT = { 3: 1, 4: 2, 5: 3, 6: 4 };

  function isSymbol(s) { return typeof s === 'number' && s % 1 === 0 && s >= 0 && s < SYMBOL_COUNT; }

  /** Dollars for keeping exactly these symbols, or null when they do not all score. */
  function scoreSelection(symbols) {
    var n = symbols ? symbols.length : 0, counts = [0, 0, 0, 0, 0, 0], i, distinct = 0, total = 0;
    if (n < 1 || n > REELS) return null;
    for (i = 0; i < n; i++) {
      if (!isSymbol(symbols[i])) return null;
      counts[symbols[i]]++;
    }
    for (i = 0; i < SYMBOL_COUNT; i++) if (counts[i] > 0) distinct++;
    if (n === REELS && distinct === REELS) return STRAIGHT;
    for (i = 0; i < SYMBOL_COUNT; i++) {
      var j = counts[i];
      if (j === 0) continue;
      if (j >= 3) total += TRIPLE[i] * KIND_MULT[j];
      else if (SINGLE.hasOwnProperty(i)) total += j * SINGLE[i];
      else return null;
    }
    return total;
  }

  /** Which of the six reels can be part of some scoring pick right now (locked reels are false). */
  function scoringReels(reels, locked) {
    var out = [false, false, false, false, false, false], counts = [0, 0, 0, 0, 0, 0], freeN = 0, i, distinct = 0;
    for (i = 0; i < REELS; i++) {
      if (!locked[i] && reels[i] !== null && reels[i] !== undefined) { counts[reels[i]]++; freeN++; }
    }
    for (i = 0; i < SYMBOL_COUNT; i++) if (counts[i] > 0) distinct++;
    var straight = freeN === REELS && distinct === REELS;
    for (i = 0; i < REELS; i++) {
      if (locked[i] || reels[i] === null || reels[i] === undefined) continue;
      var s = reels[i];
      out[i] = straight || SINGLE.hasOwnProperty(s) || counts[s] >= 3;
    }
    return out;
  }

  /** What banking `stake` would pay for this card and sweep count, or null when banking is not allowed. */
  function bankAmount(card, stake, sweeps) {
    if (stake <= 0 || card === 'broken' || card === 'offroad') return null;
    if (card === 'fire') return stake >= GROUND_FIRE_MIN ? stake + GROUND_FIRE_BONUS : null;
    if (card === 'overdue') return sweeps >= 2 ? stake * OVERDUE_MULT + OVERDUE_BONUS : null;
    return stake;
  }

  /** Why banking is not allowed right now (for the greyed BANK button), or '' when it is. */
  function bankReason(card, stake, sweeps) {
    if (card === 'offroad') return 'No banking: sweep or bust';
    if (card === 'broken') return 'Turn skipped';
    if (stake <= 0) return 'Hold a scoring reel';
    if (card === 'fire' && stake < GROUND_FIRE_MIN) return 'Needs $1,000';
    if (card === 'overdue' && sweeps < 2) return 'Needs two sweeps';
    return '';
  }

  var api = {
    REELS: REELS, SINGLE: SINGLE, TRIPLE: TRIPLE,
    scoreSelection: scoreSelection, scoringReels: scoringReels, bankAmount: bankAmount, bankReason: bankReason
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.BanditScoring = api;
})(typeof window !== 'undefined' ? window : null);
