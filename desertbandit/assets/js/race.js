/*
 * race.js - the race strip above the machine: a dirt road from START to the victory total with one rig per player.
 * A rig's place along the road is bank / target (capped at the finish); moves glide with a CSS transition.
 * The road is also the Desert Ranger board: square floor(bank / target x 51) names the place a rig has reached.
 */
(function () {
  'use strict';

  function RaceStrip(el) {
    this.el = el;
    this.rigs = {};          // player id -> img
    this.board = null;
    this.track = document.createElement('div');
    this.track.className = 'race-track';
    el.appendChild(this.track);
    var road = document.createElement('div');
    road.className = 'race-road';
    road.innerHTML = '<span class="race-start">START</span><span class="race-fin"></span>';
    el.appendChild(road);
    this.fin = road.querySelector('.race-fin');
    var self = this;
    try {
      fetch('board/desert-ranger.json', { cache: 'no-cache' }).then(function (r) { return r.ok ? r.json() : null; })
        .then(function (b) { self.board = b; }).catch(function () { /* place names are a nicety */ });
    } catch (e) { /* no fetch: fine */ }
  }

  RaceStrip.prototype.fraction = function (bank, target) {
    if (!target) return 0;
    return Math.max(0, Math.min(1, bank / target));
  };

  /** Name of the board square a bank reaches (null when the board data is not loaded). */
  RaceStrip.prototype.placeName = function (bank, target) {
    if (!this.board || !this.board.squares) return null;
    var n = this.board.squares.length - 1, i = Math.floor(this.fraction(bank, target) * n), sq = this.board.squares[i];
    return sq ? sq.name : null;
  };

  /**
   * players: [{id, vehicle, name}], banks: {id: dollars}, target, currentId.
   * Rigs that share a spot are staggered up and down so each stays visible.
   */
  RaceStrip.prototype.render = function (players, banks, target, currentId) {
    var self = this, seen = {};
    this.fin.textContent = '$' + Number(target || 0).toLocaleString('en-US');
    players.forEach(function (p, k) {
      seen[p.id] = true;
      var img = self.rigs[p.id];
      if (!img) {
        img = document.createElement('img');
        img.className = 'race-rig';
        img.alt = p.name;
        img.src = 'assets/img/pieces/' + p.vehicle + '.png';
        img.setAttribute('data-pid', p.id);
        self.track.appendChild(img);
        self.rigs[p.id] = img;
      }
      var f = self.fraction(banks[p.id] || 0, target);
      // left: from 0 to (track width - rig width), as a percentage of the track with a fixed rig width
      img.style.left = 'calc(' + (f * 100).toFixed(2) + '% - ' + (f * 44).toFixed(1) + 'px)';
      img.style.top = (k % 2 ? 10 : 0) + 'px';
      img.style.zIndex = p.id === currentId ? 5 : 2 + k;
      img.className = 'race-rig' + (p.id === currentId ? ' cur' : '');
      img.title = p.name + ': $' + Number(banks[p.id] || 0).toLocaleString('en-US');
    });
    Object.keys(this.rigs).forEach(function (id) {
      if (!seen[id]) { self.track.removeChild(self.rigs[id]); delete self.rigs[id]; }
    });
  };

  /** The rig image of a player (the bank animation flies coins to it). */
  RaceStrip.prototype.rigOf = function (id) { return this.rigs[id] || null; };

  window.BanditRace = RaceStrip;
})();
