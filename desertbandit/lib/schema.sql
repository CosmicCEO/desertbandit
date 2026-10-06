-- Desert Bandit schema (Wave 1). Run by install.php; MySQL 5.6+ / MariaDB 10+. Only new bandit_ tables: it never touches another game's tables.
-- Statements are separated by a line containing only ";" -- install.php splits on that and strips "--" comment lines.
-- No JSON column type (older MySQL); JSON is stored in TEXT.

CREATE TABLE IF NOT EXISTS bandit_games (
  id               INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  code             CHAR(4)      NOT NULL,                      -- room code, e.g. "KQWE"
  status           VARCHAR(10)  NOT NULL DEFAULT 'lobby',      -- lobby | active | finished
  host_player_id   INT UNSIGNED NULL,
  target           INT UNSIGNED NOT NULL DEFAULT 5000,         -- victory total in dollars
  turn_number      INT UNSIGNED NOT NULL DEFAULT 0,            -- +1 per accepted action; clients echo it
  state_json       TEXT NULL,                                  -- the engine state; the authority while a game runs (null in the lobby)
  winner_player_id INT UNSIGNED NULL,
  last_action_key  VARCHAR(64)  NULL,                          -- idempotency key of the last accepted action
  created_at       DATETIME     NOT NULL,
  updated_at       DATETIME     NOT NULL,
  UNIQUE KEY uq_bandit_games_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
;
CREATE TABLE IF NOT EXISTS bandit_players (
  id           INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  game_id      INT UNSIGNED NOT NULL,
  seat         TINYINT UNSIGNED NOT NULL,                      -- 0..3, join order = turn order
  display_name VARCHAR(24)  NOT NULL,
  vehicle      VARCHAR(20)  NOT NULL,                          -- e.g. "bronco-orange"
  token_hash   CHAR(64)     NULL,                              -- sha256 of the secret seat token; NULL for a computer seat
  is_bot       TINYINT UNSIGNED NOT NULL DEFAULT 0,
  bank         INT          NOT NULL DEFAULT 0,                -- mirror of the engine state
  out_flag     TINYINT UNSIGNED NOT NULL DEFAULT 0,            -- mirror of the engine state (sitting out)
  joined_at    DATETIME     NOT NULL,
  last_seen_at DATETIME     NOT NULL,
  UNIQUE KEY uq_bandit_players_seat (game_id, seat),
  UNIQUE KEY uq_bandit_players_vehicle (game_id, vehicle),
  UNIQUE KEY uq_bandit_players_token (token_hash),
  CONSTRAINT fk_bandit_players_game FOREIGN KEY (game_id) REFERENCES bandit_games (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
;
CREATE TABLE IF NOT EXISTS bandit_events (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  game_id     INT UNSIGNED NOT NULL,
  turn_number INT UNSIGNED NOT NULL,
  type        VARCHAR(16)  NOT NULL,                           -- join | leave | start | turn | roll | lock | ...
  message     VARCHAR(500) NOT NULL,                           -- the log line shown to players
  payload     TEXT NULL,                                       -- JSON: the event data
  play_at_ms  BIGINT NULL,                                     -- server clock (ms since epoch) to start the animations
  created_at  DATETIME     NOT NULL,
  KEY ix_bandit_events_game (game_id, id),
  CONSTRAINT fk_bandit_events_game FOREIGN KEY (game_id) REFERENCES bandit_games (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
;
