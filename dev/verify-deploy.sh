#!/usr/bin/env bash
# Checks a deployed Desert Bandit (runbook: docs/DEPLOY.md).
#   bash dev/verify-deploy.sh https://YOURDOMAIN/desertbandit [--full]
# Without --full it only READS pages: it never creates a game or writes to the database.
# --full also plays complete games through the live API with tests/http_game.php (needs `php` on this Mac). That creates a
#   few finished test rooms in the database: remove them afterwards with dev/cleanup-test-rooms.sql.
# Exit code 0 = no FAIL (warnings are advice). Prints OK / WARN / FAIL lines; never prints secrets.
set -uo pipefail
BASE=${1:?usage: verify-deploy.sh https://YOURDOMAIN/desertbandit [--full]}; BASE=${BASE%/}; FULL=${2:-}
pass=0; fails=0; warns=0
ok()   { pass=$((pass + 1));   echo "  OK    $*"; }
warn() { warns=$((warns + 1)); echo "  WARN  $*"; }
bad()  { fails=$((fails + 1)); echo "  FAIL  $*"; }
code() { curl -s -m 20 -o /dev/null -w '%{http_code}' "$1"; }
body() { curl -s -m 20 "$1"; }
ctype() { curl -s -m 20 -o /dev/null -w '%{content_type}' "$1"; }

echo "Checking $BASE"
case "$BASE" in https://*) ok "HTTPS address" ;; *) warn "plain http: fine for testing, but turn on the host's SSL certificate for real use" ;; esac

echo "PHP and the database"
t=$(body "$BASE/api.php?a=time"); grep -q '"ok":true' <<<"$t" && ok "api.php?a=time answers (PHP runs)" || bad "api.php?a=time did not answer with {\"ok\":true,...}. NOTE: on this host a PHP file that is missing ALSO answers 500, so first check api.php was uploaded (got: $(echo "$t" | head -c 80 | tr -d '\n'))"
st=$(body "$BASE/api.php?a=stats"); grep -q '"games":[0-9]' <<<"$st" && ok "api.php?a=stats answers (the database login works and the bandit_ tables exist)" || bad "api.php?a=stats did not answer: config.php missing/wrong, install.php not run, or the database is unreachable  (got: $(echo "$st" | head -c 120))"
i=$(body "$BASE/api.php?a=info"); grep -q 'bronco-orange' <<<"$i" && ok "api.php?a=info lists the rigs" || bad "api.php?a=info failed (got: $(echo "$i" | head -c 120))"

echo "Pages and files"
ix=$(body "$BASE/index.html"); [ "$(code "$BASE/index.html")" = 200 ] && grep -q 'Bandit' <<<"$ix" && ok "index.html" || bad "index.html missing or wrong"
for p in assets/css/style.css assets/js/sync.js assets/js/sound.js assets/js/scoring.js assets/js/race.js assets/js/app.js about.html assets/img/pieces/bronco-orange.png assets/fonts/Bungee-Regular.ttf \
         assets/img/reels/0.svg assets/img/reels/1.svg assets/img/reels/2.svg assets/img/reels/3.svg assets/img/reels/4.svg assets/img/reels/5.svg; do
  [ "$(code "$BASE/$p")" = 200 ] && ok "$p" || bad "$p is missing (200 expected)"; done
ct=$(ctype "$BASE/assets/img/reels/0.svg"); case "$ct" in image/svg+xml*) ok "reel faces are served as image/svg+xml" ;; *) bad "reels/0.svg is served as '$ct' (expected image/svg+xml): the .htaccess AddType for .svg was not applied" ;; esac

echo "Protection (these should NOT be readable)"
c=$(body "$BASE/config.php"); if grep -qiE "db_pass|db_user|password" <<<"$c"; then bad "config.php is READABLE and contains settings: block it NOW (check .htaccess) and change the database password"; else ok "config.php does not leak its contents (status $(code "$BASE/config.php"))"; fi
for p in config.sample.php lib/schema.sql lib/game.php lib/rules.php lib/policy.json; do
  s=$(code "$BASE/$p"); case "$s" in 403|404) ok "$p is blocked ($s)" ;; 200) case "$p" in lib/*.php) g=$(body "$BASE/$p"); grep -q '<?php' <<<"$g" && bad "$p is served as TEXT: PHP source is exposed" || ok "$p runs as PHP (empty output)" ;; *) warn "$p is readable (not secret, but .htaccess did not block it)" ;; esac ;; *) warn "$p returned $s" ;; esac; done
[ "$(code "$BASE/install.php")" = 200 ] && warn "install.php is still there: after the tables exist, delete it (it refuses to run again, but remove it anyway)" || ok "install.php is gone (or blocked)"

echo "Caching (the host puts a cache in front of the site)"
h=$(curl -sI -m 20 "$BASE/api.php?a=time"); grep -qi 'no-store' <<<"$h" && ok "api.php replies carry Cache-Control: no-store" || warn "api.php replies are not marked no-store (expected only while api.php is not answering yet)"
grep -qi '^age: *[1-9]' <<<"$h" && bad "api.php?a=time was served from a cache (Age header): game state would be stale" || ok "api.php replies are not served from a cache (no Age header)"
t1=$(body "$BASE/api.php?a=time" | grep -o '"t":[0-9]*' | cut -d: -f2); sleep 1.2; t2=$(body "$BASE/api.php?a=time" | grep -o '"t":[0-9]*' | cut -d: -f2)
if [ -z "${t1:-}" ] || [ -z "${t2:-}" ]; then warn "two-calls cache test skipped: api.php?a=time is not answering yet"
elif [ $((t2 - t1)) -ge 1000 ]; then ok "two api.php?a=time calls 1.2 s apart return different times (not cached)"
else bad "api.php?a=time returned (nearly) the same time twice: a cache is answering instead of PHP"; fi
ma=$(curl -sI -m 20 "$BASE/index.html" | tr -d '\r' | grep -i '^cache-control' | grep -o 'max-age=[0-9]*' | cut -d= -f2)
if [ -z "${ma:-}" ]; then ok "index.html has no long cache time"; elif [ "$ma" -le 600 ]; then ok "index.html is cached at most ${ma} s"; else warn "index.html is cached for ${ma} s: after an update players may see the old version for that long (check the .htaccess Expires lines, or ask the host)"; fi

echo "Speed"
ms=$(curl -s -m 20 -o /dev/null -w '%{time_total}' "$BASE/api.php?a=time" | awk '{printf "%d", $1 * 1000}'); [ "${ms:-9999}" -lt 800 ] && ok "api.php?a=time answered in ${ms} ms" || warn "api.php?a=time took ${ms} ms (the game polls once a second per phone)"

echo "The other game"
dr=$(dirname "$BASE")/desertranger/api.php; drc=$(code "$dr?a=time"); [ "$drc" = 200 ] && ok "Desert Ranger still answers next door (untouched)" || warn "Desert Ranger's api.php?a=time answered $drc (not a problem for this game; just FYI)"

if [ "$FULL" = "--full" ]; then
  echo "Full games through the live API (creates finished test rooms)"
  here=$(cd "$(dirname "$0")/.." && pwd); PHPBIN=${PHP:-$(command -v php || true)}
  if [ -z "$PHPBIN" ]; then warn "no php on this Mac: skipped --full"; else
    "$PHPBIN" "$here/tests/http_game.php" "$BASE" 2>&1 | grep -q 'ALL PASSED' && ok "http_game.php ALL PASSED (games with humans and computers, double taps, host controls)" || bad "http_game.php failed: run it by hand to see which check"
  fi
fi
echo; echo "$pass OK, $warns warning(s), $fails FAIL"
[ $fails -eq 0 ]
