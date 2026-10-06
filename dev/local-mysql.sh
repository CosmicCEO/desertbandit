#!/usr/bin/env bash
# Starts a throw-away MySQL 5.7 for local development and tests (MAMP's binary, its own data folder, port 8890, root with no password)
# and creates the database desertbandit_dev. It never touches MAMP's own data. Safe to run twice.
#   bash dev/local-mysql.sh           start (initialises the data folder the first time)
#   bash dev/local-mysql.sh stop
# Env: BANDIT_MYSQL_DIR (default ~/.cache/desertbandit-mysql), BANDIT_MYSQL_PORT (default 8890)
set -eu
BIN=/Applications/MAMP/Library/bin/mysql57
DIR="${BANDIT_MYSQL_DIR:-$HOME/.cache/desertbandit-mysql}"
PORT="${BANDIT_MYSQL_PORT:-8890}"
MYSQL="$BIN/bin/mysql --no-defaults -h127.0.0.1 -P$PORT -uroot"
[ -x "$BIN/bin/mysqld" ] || { echo "MAMP's MySQL 5.7 was not found at $BIN"; exit 1; }
if [ "${1:-start}" = stop ]; then
  [ -f "$DIR/mysql.pid" ] && kill "$(cat "$DIR/mysql.pid")" && echo "stopped" || echo "not running"
  exit 0
fi
if $MYSQL -e 'select 1' >/dev/null 2>&1; then echo "MySQL is already up on 127.0.0.1:$PORT"
else
  mkdir -p "$DIR"
  if [ ! -d "$DIR/data/mysql" ]; then
    "$BIN/bin/mysqld" --no-defaults --initialize-insecure --basedir="$BIN" --lc-messages-dir="$BIN/share" --datadir="$DIR/data" >"$DIR/init.log" 2>&1
  fi
  nohup "$BIN/bin/mysqld" --no-defaults --basedir="$BIN" --lc-messages-dir="$BIN/share" --datadir="$DIR/data" --port="$PORT" \
    --bind-address=127.0.0.1 --socket="$DIR/mysql.sock" --pid-file="$DIR/mysql.pid" --log-error="$DIR/err.log" >/dev/null 2>&1 &
  for i in $(seq 1 40); do $MYSQL -e 'select 1' >/dev/null 2>&1 && break; sleep 1; done
  $MYSQL -e 'select 1' >/dev/null 2>&1 || { echo "MySQL did not start; see $DIR/err.log"; exit 1; }
fi
$MYSQL -e 'create database if not exists desertbandit_dev character set utf8mb4'
echo "ready: 127.0.0.1:$PORT  user root (no password)  database desertbandit_dev"
