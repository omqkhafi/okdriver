#!/usr/bin/env bash
# Generates a throwaway CA and a server certificate for localhost into work/certs (ignored, never committed).
set -euo pipefail
d="$(cd "$(dirname "$0")/.." && pwd)/work/certs"
mkdir -p "$d"; cd "$d"
[ -f server.crt ] && exit 0
openssl req -x509 -newkey rsa:2048 -nodes -keyout ca.key -out ca.crt -days 30 -subj "/CN=fs03-test-ca" 2>/dev/null
openssl req -newkey rsa:2048 -nodes -keyout server.key -out server.csr -subj "/CN=localhost" 2>/dev/null
printf 'subjectAltName=DNS:localhost,IP:127.0.0.1\n' > san.ext
openssl x509 -req -in server.csr -CA ca.crt -CAkey ca.key -CAcreateserial -out server.crt -days 30 -extfile san.ext 2>/dev/null
chmod 644 server.key
echo certs ready
