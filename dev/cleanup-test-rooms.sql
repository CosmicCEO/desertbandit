-- Preview and remove old (test) rooms from the Desert Bandit tables (bandit_games, bandit_players, bandit_events).
-- Run it in phpMyAdmin (or the mysql client) on the database the game uses. It never touches Desert Ranger's tables.
-- Times in the database are UTC. Deleting a row from `bandit_games` also removes its players and events (ON DELETE CASCADE).
-- Nothing is deleted until you uncomment one of the DELETE lines at the bottom.

-- 1. Edit the cutoff: rooms created BEFORE this moment are the ones listed and (later) removed.
SET @cutoff = '2026-10-07 00:00:00';

-- 2. PREVIEW: every room that the DELETE would remove (code, state, turns played, who was in it).
SELECT g.code, g.status, g.turn_number AS turns, g.created_at,
       (SELECT COUNT(*) FROM bandit_players p WHERE p.game_id = g.id) AS players,
       (SELECT GROUP_CONCAT(p.display_name ORDER BY p.seat SEPARATOR ', ') FROM bandit_players p WHERE p.game_id = g.id) AS who
FROM bandit_games g
WHERE g.created_at < @cutoff
ORDER BY g.created_at;

SELECT COUNT(*) AS rooms_before_cutoff,
       SUM(status = 'finished') AS finished, SUM(status = 'lobby') AS lobby, SUM(status = 'active') AS still_active
FROM bandit_games WHERE created_at < @cutoff;

-- 3. When the preview shows only rooms you are happy to lose, run ONE of these (remove the leading "-- "):
-- Finished and lobby rooms only (keeps any game still marked active):
-- DELETE FROM bandit_games WHERE created_at < @cutoff AND status IN ('finished', 'lobby');
-- Everything before the cutoff, including rooms still marked active:
-- DELETE FROM bandit_games WHERE created_at < @cutoff;
