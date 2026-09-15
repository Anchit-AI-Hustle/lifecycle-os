#!/bin/sh
# Substitute $VARIABLES in the declarative config, then start Kong.
#
# Upstream's classic entrypoint was `eval "echo \"$(cat temp.yml)\""`, which
# strips double quotes and runs anything that looks like a shell expansion.
# This is the awk substitution upstream later moved to (docker/volumes/api/
# kong-entrypoint.sh), minus the opaque-key Lua expressions this kit does not
# use. Busybox awk (the kong:2.8.1 image) supports match/RSTART/ENVIRON.
set -e

awk '{
  result = ""
  rest = $0
  while (match(rest, /\$[A-Za-z_][A-Za-z_0-9]*/)) {
    varname = substr(rest, RSTART + 1, RLENGTH - 1)
    if (varname in ENVIRON) {
      result = result substr(rest, 1, RSTART - 1) ENVIRON[varname]
    } else {
      result = result substr(rest, 1, RSTART + RLENGTH - 1)
    }
    rest = substr(rest, RSTART + RLENGTH)
  }
  print result rest
}' /home/kong/temp.yml > "$KONG_DECLARATIVE_CONFIG"

exec /docker-entrypoint.sh kong docker-start
