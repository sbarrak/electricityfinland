#!/bin/sh
# Like run.sh but WITHOUT login, for testing on this computer only (http://localhost:8000).
DEV_NO_LOGIN=1 exec "$(dirname "$0")/run.sh" "$@"
