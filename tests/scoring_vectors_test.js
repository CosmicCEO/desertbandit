#!/usr/bin/env node
// The browser's scoring port (desertbandit/assets/js/scoring.js) against the vectors the PHP tests wrote (tests/vectors/scoring.json).
//   node tests/scoring_vectors_test.js        exit code 0 = every case matches
'use strict';
var path = require('path'), fs = require('fs');
var S = require(path.join(__dirname, '../desertbandit/assets/js/scoring.js'));
var V = JSON.parse(fs.readFileSync(path.join(__dirname, 'vectors/scoring.json'), 'utf8'));
var pass = 0, fail = 0;
function check(name, got, want) {
  if (JSON.stringify(got) === JSON.stringify(want)) { pass++; return; }
  fail++;
  if (fail <= 20) console.log('FAIL ' + name + '\n     got  ' + JSON.stringify(got) + '\n     want ' + JSON.stringify(want));
}
V.scoring.forEach(function (c, i) { check('scoreSelection #' + i + ' ' + JSON.stringify(c.symbols), S.scoreSelection(c.symbols), c.points); });
V.scoringReels.forEach(function (c, i) { check('scoringReels #' + i + ' ' + JSON.stringify(c.reels), S.scoringReels(c.reels, c.locked), c.scoring); });
V.bank.forEach(function (c, i) { check('bankAmount #' + i + ' ' + c.card + ' ' + c.stake + ' ' + c.sweeps, S.bankAmount(c.card, c.stake, c.sweeps), c.amount); });
// bankReason agrees with bankAmount: a reason exactly when banking is not allowed
V.bank.forEach(function (c, i) { check('bankReason #' + i, S.bankReason(c.card, c.stake, c.sweeps) === '', c.amount !== null); });
console.log(pass + ' passed, ' + fail + ' failed (' + V.scoring.length + ' selections, ' + V.scoringReels.length + ' tables, ' + V.bank.length + ' bank cases)');
process.exit(fail ? 1 : 0);
