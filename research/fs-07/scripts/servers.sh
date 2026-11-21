#!/bin/bash
# Start / stop the nine matrix servers (throwaway root password, bound to 127.0.0.1 only).
# usage: servers.sh up [id...] | down | status
cd "$(dirname "$0")"
PW=fs07-throwaway
ids() { bun -e 'for (const s of JSON.parse(require("fs").readFileSync("servers.json","utf8"))) console.log(s.id, s.family, s.image, s.port)'; }
up() {
  ids | while read id fam img port; do
    if [ $# -gt 0 ] && ! [[ " $* " == *" $id "* ]]; then continue; fi
    docker rm -f fs07-$id >/dev/null 2>&1
    if [ $fam = mysql ]; then
      docker run -d --name fs07-$id -p 127.0.0.1:$port:3306 -e MYSQL_ROOT_PASSWORD=$PW -e MYSQL_ROOT_HOST=% $img \
        --general-log=1 --log-output=TABLE --max-connections=300 --innodb-buffer-pool-size=64M --performance-schema=ON >/dev/null
    else
      docker run -d --name fs07-$id -p 127.0.0.1:$port:3306 -e MARIADB_ROOT_PASSWORD=$PW -e MARIADB_ROOT_HOST=% $img \
        --general-log=1 --log-output=TABLE --max-connections=300 --innodb-buffer-pool-size=64M --performance-schema=ON >/dev/null
    fi
    echo started fs07-$id
  done
}
case "$1" in
  up) shift; up "$@";;
  down) docker ps -aq --filter name=fs07- | xargs -r docker rm -f;;
  status) docker ps -a --filter name=fs07- --format '{{.Names}} {{.Status}}';;
esac
