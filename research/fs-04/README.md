# FS-04: what can Cloudflare sockets really do?

Research only. This folder holds a probe Worker with a raw-bytes PostgreSQL and MySQL client, a Bun harness with a recording proxy, scripts, result files and a
claim ledger. It changes no OKDriver source, test, root file, ADR or `AGENTS.md`, decides nothing, and makes no claim about OKDriver's speed. Spec area: none yet.
Feature record: none (research). The numbers here are **local-observed**: they were measured on the repository's pinned `workerd` 1.20261118.1, which is
not Cloudflare production. No Cloudflare account was available, so every production cell reads **Not verified here** and the claimable value of every
capability is **false**. `results/production-runbook.md` and `worker/` are how the account owner fills those cells.

Question (roadmap row FS-04): TLS upgrade, certificate access, large writes, concurrent connections, cancel on a second socket. Output: a capability table
from observed behaviour. Used later by P6-T03 ("Cloudflare transport: runs on workerd; large writes chunked; capability table matches FS-04"). FS-01's
provisional `TransportCaps` gets a mapping column below; FS-01 is not edited.

Base: `origin/main` at `19a0d5fad8bd6e92ba1f33e0a0793684fcc3babf`. Run dates 2026-11-25 and 2026-11-26.

## Setup

Everything runs on one Linux machine (`results/environment.json`): `workerd` 1.20261118.1 from the repository's `node_modules` (`workerd serve`, compatibility
date 2026-11-01, **no `nodejs_compat`**; the Worker needs none), Bun 1.4.4, Docker 29.9.3, OpenSSL 3.0.13. Docker Hub answered 429 to unauthenticated pulls, so the
same official images were pulled from `mirror.gcr.io/library`; the digests are the identity of what ran. Versions are what the servers report.

<!-- BEGIN setup -->
| server | image digest | version reported by the server | TLS |
| --- | --- | --- | --- |
| pg17-tls | `sha256:87c8b42f423b45d5247e6aa8fdb2e7762fec164c68a50fe3eb07e7bfcaf4dbcf` | PostgreSQL 17.12 (Debian 17.12-1.pgdg13+1) | CA-signed |
| pg17-plain | `sha256:87c8b42f423b45d5247e6aa8fdb2e7762fec164c68a50fe3eb07e7bfcaf4dbcf` | PostgreSQL 17.12 (Debian 17.12-1.pgdg13+1) | off |
| pg17-selfsigned | `sha256:87c8b42f423b45d5247e6aa8fdb2e7762fec164c68a50fe3eb07e7bfcaf4dbcf` | PostgreSQL 17.12 (Debian 17.12-1.pgdg13+1) | self-signed, untrusted |
| pg17-expired | `sha256:87c8b42f423b45d5247e6aa8fdb2e7762fec164c68a50fe3eb07e7bfcaf4dbcf` | PostgreSQL 17.12 (Debian 17.12-1.pgdg13+1) | expired |
| pg17-clientcert | `sha256:87c8b42f423b45d5247e6aa8fdb2e7762fec164c68a50fe3eb07e7bfcaf4dbcf` | (client certificate required: version taken from the same image) | client certificate required |
| pg19-tls | `sha256:aaa10f7ba7328b4a221a6c3184d83eef885bd16bf1f6de864757863156b0a4d1` | PostgreSQL 19.0 (Debian 19.0-2.pgdg13+1) | CA-signed |
| pg19-plain | `sha256:aaa10f7ba7328b4a221a6c3184d83eef885bd16bf1f6de864757863156b0a4d1` | PostgreSQL 19.0 (Debian 19.0-2.pgdg13+1) | off |
| my84 | `sha256:8c233bad33d520a7aae1c1e619c3a9775f4a1ba2d463d692fada04ec7f40be00` | 8.4.13 | CA-signed |
| ma118 | `sha256:e1d5495f445654134f226f55a41ce0da227116f6f27f283101f405c794d841fc` | 11.8.9-MariaDB-ubu2404 | CA-signed |
<!-- END setup -->

Embedder settings (a workerd config file; Cloudflare production has none): the Worker's `globalOutbound` is a `network` service that allows `public` and `local`
(otherwise `connect()` to 127.0.0.1 is refused) and carries `tlsOptions.trustedCertificates` with a test root CA (otherwise `startTls()` says "not supported on this
connection"). Servers are reached by name (`pg.fs04.test` and three more, added to `/etc/hosts` as 127.0.0.1) because a name mismatch fails the handshake. All
certificates are throwaway (`scripts/lib/certs.ts`): a CA-signed leaf, an untrusted self-signed leaf, an expired CA-signed leaf, and a client certificate.

Instruments, all written for this study:

- **Probe Worker** (`worker/src/`): Web APIs only. A raw-bytes PostgreSQL client (startup, SSLRequest, SCRAM-SHA-256 on WebCrypto, simple and extended query, binary Bind
  parameters, COPY, CancelRequest) and a MySQL/MariaDB client (greeting, SSL request packet, caching_sha2_password and mysql_native_password on WebCrypto, COM_QUERY).
  PostgreSQL wire code and the recording-proxy design are adapted from `research/fs-06/scripts/lib` at commit `5930580`; the MySQL handshake is a port of
  `research/fs-07/wire/shared` at commit `3e2fc81` (Buffer and `node:crypto` became Uint8Array and WebCrypto; the RSA key exchange for caching_sha2 on a plaintext link was not copied
  because the study upgrades to TLS first). Nothing is imported across study folders. The URL comes from a binding (`DATABASE_URL` as a Worker secret in production, `DB_<target>`
  locally); every response passes through a redactor; a bearer token guards `/run` and `/state`.
- **Recording proxy** (`scripts/lib/proxy.ts`): forwards bytes between the Worker and each server, with its own PostgreSQL and MySQL framing, TLS-aware (it stops reading
  plaintext at the switch and parses the ClientHello: SNI, ALPN, versions), streaming sha256 of Bind and CopyData bodies, and two switches used for planted faults (flip one byte, stop reading).
- **Harness** (`scripts/run.ts`): starts a fresh workerd for every run, drives the Worker over HTTP, and writes one result JSON per probe variant and mode.
- **Control**: the same probe code, unchanged, through a `node:net`/`node:tls` adapter in Bun (`scripts/lib/nodesock.ts`) that has the `cloudflare:sockets` shape. A control that passes shows the
  probe and the oracle can detect success where the platform has no restriction; every probe ran as a control first.
- **Server-side truth** (the oracle): `pg_stat_ssl` and the server log line `connection authorized ... SSL enabled (protocol=TLSv1.3 ...)` matched on the run's own `application_name`; the
  SQLSTATE of a cancelled query and the server's `canceling statement due to user request` log line; `sha256()` inside PostgreSQL for every large write, against a hash the harness
  computes itself; `pg_stat_activity` counts polled during the run; for MySQL and MariaDB the server CLI run inside the container (`performance_schema.status_by_thread`,
  `information_schema.processlist`). The proxy's own records (byte offsets, ClientHello, frame hashes, connection open times) are a second, independent witness.

Capability rule (`rules.json`, applied by `scripts/capabilities.ts`): a capability is **true only when every cell it lists passed 5 of 5 fresh runs, end to end, with server-side truth**.
Fewer is "intermittent" (false, counts shown); any cell at 0 of 5 is false; documented-only and unobservable are false. Every cell is labelled `local-observed`, `production-observed`,
`documented-only` or `not observable`. The value a transport may claim is the production column; production is unverified, so the claimable value is false everywhere and each row says what local showed.
In this study no cell was intermittent: every result is 5/5 or 0/5.

## Findings in short

Counts are runs passed out of 5 on PostgreSQL 17.12 unless stated; "19.0" means PostgreSQL 19.0 gave the same.

1. **TLS upgrade works.** SSLRequest, `S`, `startTls()`, SCRAM-SHA-256 (WebCrypto), query: 5/5 on 17 and 19.0. The server logged TLSv1.3 for the run's session and `pg_stat_ssl` said so. The proxy saw exactly 8
   plaintext bytes from the client and 1 from the server, then the ClientHello at c2s offset 8: no byte read beyond the answer, none written before it, none lost or duplicated.
   A server answering `N` leaves the same starttls-mode socket usable in plaintext (5/5). MySQL 8.4 and MariaDB 11.8 upgrade with the 36-byte SSL request packet and no server byte (5/5 each; MySQL's
   `performance_schema` and both servers' `Ssl_cipher` agree).
2. **`startTls()` has a precondition the docs do not state: both locks released and no read outstanding.** With a lock held, `startTls()` does not throw but the returned socket fails at first use (0/5, PostgreSQL, MySQL, MariaDB).
   With a read outstanding, `reader.releaseLock()` throws `Cannot call releaseLock() on a reader with outstanding read promises` (0/5). `reader.cancel()` on the pending read, then `releaseLock()`, then `startTls()` worked 5/5 on all three engines.
   A driver with an always-running read loop cannot upgrade without that step. A second `startTls()` throws `Cannot startTls on a TLS socket.` and leaves the connection usable (5/5); `startTls()` on an "off" or "on" socket throws (5/5).
3. **Direct TLS (`secureTransport: "on"`) cannot work against PostgreSQL 17+.** 0/5 on 17 and 19.0: the ClientHello has no ALPN and the server logs `received direct SSL connection request without ALPN protocol negotiation extension`.
   `alpn` and `alpnProtocols` on `connect()` change nothing (0/5); the Bun control with the same option succeeds 5/5.
4. **Certificates are always verified, and almost no option changes how.** Trusted with the right name accepted; untrusted self-signed, trusted with the wrong name, and expired each rejected 5/5 with no session reaching the server (the server logged
   `certificate unknown`, `bad certificate`, `certificate expired`). The Worker sees all three as the same `internal error; reference = <id>`. `rejectUnauthorized:false`, `ca`, `servername`, `alpn` and a client certificate with key were accepted without error and ignored
   on both `connect()` and `startTls()` (0/5 each; the control honoured all of them 5/5). **`startTls({expectedServerHostname})` works despite the build's "unsupported" log line**: a wrong name is rejected, the right name fixes a connect-by-IP, and it is sent as the SNI value (5/5 each).
5. **No peer certificate, so no channel binding.** The full Socket, SocketInfo and module surface was listed: no member exposes the certificate, a hash or a TLS info object (5/5). The server offered `SCRAM-SHA-256-PLUS` in every TLS session; a Worker cannot compute `tls-server-end-point`.
   A server demanding a client certificate refused every Worker connection (5/5) while the control with the same options was accepted: client certificates cannot be offered per connection.
6. **Large writes did not fail locally at any size tried.** Bind parameter and COPY, single write and 64 KiB or 1 MiB chunks, 64 KiB to 128 MiB, intact in PostgreSQL (`sha256()`) and at the proxy, 5/5 each; over TLS too. No failing size was found, so "smallest that fails" does not exist here
   and the chunk size that always worked is 64 KiB (and 1 MiB). Indicative cost at 128 MiB: the single write peaked at 321 to 322 MiB RSS in workerd, 64 KiB chunks at 100 to 116 MiB, 1 MiB chunks at 130 to 135 MiB; CPU 540 to 910 ms per run. Local workerd has no 128 MB isolate limit; production does, so a single large write may fail there (not tested).
7. **Backpressure is carried by the `write()` promise, not by `desiredSize` or `ready`.** With the proxy not reading, `writer.desiredSize` stayed at 1 and `writer.ready` never pended (0/5), while the write promises stayed pending (5/5: 384 writes of 64 KiB queued, about 8 MiB accepted at mid-stall, the rest unresolved
   until the stall ended). A caller that awaits each write is throttled; one that ignores them queues the whole payload in the runtime. The Bun control shows both signals (desiredSize negative, `ready` pending 383 times), so the probe can see them.
8. **Concurrency was not limited locally.** 1, 2, 6, 7, 8, 24 and 50 sockets from one invocation all logged in, were all visible to `pg_stat_activity` at once, all ran `pg_sleep(1)` in parallel (about 1 s wall), and reached the proxy within 2 ms of each other in the traced run (the check requires under 1 s in every run; 5/5 each; 8 and 50 also on 19.0). Six idle sockets did not stop a seventh from opening.
   The documented limit of six (ledger D-14) and the question whether open sockets or sockets waiting for headers count (D-11, D-14) are **not observed**; the production probes separate them.
9. **Socket lifetime is per request.** `connect()` at global scope threw in every fresh process (`Disallowed operation called within global scope`, 5/5). A socket created in one request and used in the next failed with `Cannot perform I/O on behalf of a different request` (5/5). A socket left open when the response returned
   was closed by the platform at that moment (within 1 s of the response in every run, 5/5; 0 ms in the traced run): there is no idle pool across requests.
10. **Cancel on a second socket works.** `pg_sleep(30)` on socket 1, CancelRequest on socket 2 after 1 s: SQLSTATE 57014 a few milliseconds after the request, 5/5 on 17 and 19.0, also with 6 other sockets busy (the cancel socket was the 8th open and did not wait), and with the main connection on TLS, cancelling in plaintext or after SSLRequest and `startTls()` (the server accepted both).
    MySQL needs a second authenticated connection and `KILL QUERY`: it ended `SELECT SLEEP(30)` in about 2 ms on MySQL 8.4 (SLEEP returns the row `1`, no error) and MariaDB 11.8 (error 1317), 5/5 each.
11. **The competing driver is postgres.js 4.1.1.** Its Workers section documents the same limits (certificate always checked, no channel binding because sockets do not expose the certificate, `sslnegotiation: 'direct'` refused, no ALPN). It does not say "TLS options are ignored"; the platform does. All 21 ledger rows are in `results/ledger.md`.
12. **Two more differences from the docs.** The socket's writable accepted strings, ArrayBuffers, DataViews and a Uint16Array as well as Uint8Array (bytes counted at the proxy) and rejected only a number (ledger D-08). `startTls()` after the server answered `N` returns a socket without throwing; the failure shows up at login.

## Capability table

Generated from `rules.json` and `results/probes/*.json` by `scripts/capabilities.ts` (full table with cell counts: `results/capabilities.md` and `.json`). "control" is the Bun adapter running the same probe; `ok` means its positive control passed 5/5.

<!-- BEGIN capabilities -->
| capability | what is tested | local-observed | PG 19.0 | control | production | claimable | TransportCaps |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `pg.startTls` | PostgreSQL: SSLRequest, S, startTls(), SCRAM, query; pg_stat_ssl and server log confirm TLS | **true** 5/5 | true 5/5 | ok | Not verified here | false | startTls |
| `pg.serverAnswersN` | PostgreSQL: server answers N, the same starttls-mode socket continues in plaintext | **true** 5/5 | true 5/5 | ok | Not verified here | false |  |
| `pg.directTls` | PostgreSQL: secureTransport "on" (direct TLS, needs ALPN postgresql on PG 17+) | **false** 0/5 | false 0/5 | ok | Not verified here | false |  |
| `pg.directTls.alpnOption` | An alpn option on connect() puts ALPN postgresql into the ClientHello and direct TLS succeeds | **false** 0/5 |  | ok | Not verified here | false |  |
| `cert.verification` | Verification matrix: trusted+right name accepted; self-signed untrusted, trusted+wrong name and expired all rejected, no session reaches the server | **true** 5/5 5/5 5/5 5/5 | true 5/5 5/5 | ok | Not verified here | false |  |
| `cert.option.expectedServerHostname` | startTls({expectedServerHostname}) is honoured: wrong name rejects, right name fixes a connect-by-IP, and it becomes the SNI value | **true** 5/5 5/5 5/5 |  | ok | Not verified here | false |  |
| `cert.option.rejectUnauthorized` | rejectUnauthorized:false is honoured (connect and startTls) | **false** 0/5 0/5 |  | ok | Not verified here | false |  |
| `cert.option.ca` | A ca option is honoured (connect and startTls) | **false** 0/5 0/5 |  | ok | Not verified here | false |  |
| `cert.option.servername` | A servername option changes the SNI value (connect and startTls) | **false** 0/5 0/5 |  | ok | Not verified here | false |  |
| `cert.option.alpn` | An alpn / alpnProtocols option puts ALPN into the ClientHello | **false** 0/5 0/5 0/5 |  | ok | Not verified here | false |  |
| `cert.clientCertificate` | A client certificate and key can be offered per connection (server demands one) | **false** 0/5 |  | ok | Not verified here | false |  |
| `cert.peerCertificate.api` | Any API on Socket or SocketInfo exposes the peer certificate or its hash | **false** 0/5 |  |  | Not verified here | false | channelBinding |
| `cert.channelBinding.tlsServerEndPoint` | SCRAM-SHA-256-PLUS with tls-server-end-point (needs the server certificate hash) | **false**  |  |  | Not verified here | false | channelBinding |
| `write.chunked.64KiB.128MiB` | Bind parameter of 128 MiB in 64 KiB chunks, each write awaited, intact in PostgreSQL and at the proxy | **true** 5/5 |  | ok | Not verified here | false |  |
| `write.single.128MiB` | Bind parameter of 128 MiB in one write() call, intact in PostgreSQL and at the proxy | **true** 5/5 | true 5/5 | ok | Not verified here | false |  |
| `write.copy.128MiB` | COPY (binary) of 128 MiB in 64 KiB CopyData messages, intact | **true** 5/5 |  | ok | Not verified here | false |  |
| `write.tls.128MiB` | 128 MiB Bind parameter over the upgraded TLS connection, single write and 64 KiB chunks | **true** 5/5 5/5 |  | ok | Not verified here | false |  |
| `concurrency.n1` | 1 sockets from one invocation: all logged in and held, all usable at once, none queued | **true** 5/5 |  | ok | Not verified here | false |  |
| `concurrency.n2` | 2 sockets from one invocation: all logged in and held, all usable at once, none queued | **true** 5/5 |  | ok | Not verified here | false |  |
| `concurrency.n6` | 6 sockets from one invocation: all logged in and held, all usable at once, none queued | **true** 5/5 |  | ok | Not verified here | false |  |
| `concurrency.n7` | 7 sockets from one invocation: all logged in and held, all usable at once, none queued | **true** 5/5 |  | ok | Not verified here | false |  |
| `concurrency.n8` | 8 sockets from one invocation: all logged in and held, all usable at once, none queued | **true** 5/5 | true 5/5 | ok | Not verified here | false |  |
| `concurrency.n24` | 24 sockets from one invocation: all logged in and held, all usable at once, none queued | **true** 5/5 |  | ok | Not verified here | false |  |
| `concurrency.n50` | 50 sockets from one invocation: all logged in and held, all usable at once, none queued | **true** 5/5 | true 5/5 | ok | Not verified here | false |  |
| `socket.crossRequest` | A socket created in one request is usable in another request | **false** 0/5 |  | ok | Not verified here | false |  |
| `socket.globalScope` | connect() works at global scope (module evaluation) | **false** 0/5 |  |  | Not verified here | false |  |
| `socket.survivesRequestEnd` | A socket left open when the response is returned stays open on the server | **false** 0/5 |  |  | Not verified here | false |  |
| `cancel.secondSocket` | CancelRequest on a second socket ends pg_sleep(30) with 57014 within 2.5 s | **true** 5/5 | true 5/5 | ok | Not verified here | false | secondConnectionForCancel |
| `cancel.whileSixBusy` | The same while 6 other sockets are busy (cancel socket is the 8th open) | **true** 5/5 |  | ok | Not verified here | false |  |
| `cancel.mainOnTls.plainCancel` | Main connection on TLS, CancelRequest in plaintext | **true** 5/5 |  | ok | Not verified here | false |  |
| `cancel.mainOnTls.tlsCancel` | Main connection on TLS, CancelRequest after SSLRequest and startTls() | **true** 5/5 | true 5/5 | ok | Not verified here | false |  |
| `my84.startTls` | MySQL 8.4: SSL request packet, startTls() with no read pending, authentication over TLS | **true** 5/5 |  | ok | Not verified here | false | startTls |
| `my84.killQuery` | MySQL 8.4: KILL QUERY on a second authenticated connection ends SELECT SLEEP(30) | **true** 5/5 |  | ok | Not verified here | false | secondConnectionForCancel |
| `ma118.startTls` | MariaDB 11.8: SSL request packet, startTls() with no read pending, authentication over TLS | **true** 5/5 |  | ok | Not verified here | false | startTls |
| `ma118.killQuery` | MariaDB 11.8: KILL QUERY on a second authenticated connection ends SELECT SLEEP(30) | **true** 5/5 |  | ok | Not verified here | false | secondConnectionForCancel |
| `cloudflare.sixConnectionLimit` | Production enforces a limit of 6 simultaneous connections per invocation (documented) | **false**  |  |  | Not verified here | false |  |
| `transport.keepalive` | TransportCaps.keepalive | **false**  |  |  | Not verified here | false | keepalive |
| `transport.halfOpenDetection` | TransportCaps.halfOpenDetection | **false**  |  |  | Not verified here | false | halfOpenDetection |
| `transport.streaming` | Sockets give bidirectional byte streams (not a stateless request), shown by the TLS, write and cancel probes | **true** 5/5 5/5 5/5 |  | ok | Not verified here | false | streaming |
<!-- END capabilities -->

Behaviours that explain the rows above (same rule, not TransportCaps fields):

<!-- BEGIN behaviours -->
| capability | what is tested | local-observed | PG 19.0 | control | production | claimable | TransportCaps |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `behaviour.startTlsWithOutstandingRead` | startTls() works while a read() is outstanding (releaseLock throws in workerd) | **false** 0/5 |  | ok | Not verified here | false |  |
| `behaviour.startTlsAfterReaderCancel` | startTls() works after reader.cancel() settled the outstanding read and both locks were released | **true** 5/5 |  |  | Not verified here | false |  |
| `behaviour.startTlsWithLocksHeld` | startTls() usable while a reader and a writer lock are still held | **false** 0/5 |  | ok | Not verified here | false |  |
| `behaviour.secondStartTlsRefused` | A second startTls() on the upgraded socket is refused and the connection stays usable | **true** 5/5 |  | ok | Not verified here | false |  |
| `behaviour.startTlsOnlyOnStarttlsSockets` | startTls() is refused on sockets created with secureTransport "off" and "on" | **true** 5/5 5/5 |  | ok | Not verified here | false |  |
| `write.backpressure.desiredSize` | writer.desiredSize drops to 0 or below while the server does not read | **false** 0/5 |  | ok | Not verified here | false |  |
| `write.backpressure.ready` | writer.ready stays pending while the server does not read | **false** 0/5 |  | ok | Not verified here | false |  |
| `write.backpressure.writePromise` | Each write() promise stays pending while the server does not read (awaiting writes is the backpressure) | **true** 5/5 |  | ok | Not verified here | false |  |
| `concurrency.idleSocketsDoNotCount` | Six idle logged-in sockets do not stop a seventh from opening | **true** 5/5 |  | ok | Not verified here | false |  |
| `my84.startTlsWithOutstandingRead` | MySQL 8.4: startTls() with a read pending | **false** 0/5 |  | ok | Not verified here | false |  |
| `my84.startTlsAfterReaderCancel` | MySQL 8.4: startTls() after reader.cancel() of the pending read | **true** 5/5 |  |  | Not verified here | false |  |
| `ma118.startTlsWithOutstandingRead` | MariaDB 11.8: startTls() with a read pending | **false** 0/5 |  | ok | Not verified here | false |  |
| `ma118.startTlsAfterReaderCancel` | MariaDB 11.8: startTls() after reader.cancel() of the pending read | **true** 5/5 |  |  | Not verified here | false |  |
<!-- END behaviours -->

Largest write at 5 of 5, local (Bind parameter or COPY, intact in PostgreSQL and at the proxy):

<!-- BEGIN limits -->
| write form | largest 5/5 | first failing | peak workerd RSS at largest, MiB (indicative) |
| --- | --- | --- | --- |
| bind-single | 128MiB | none up to 128MiB | 322 |
| bind-chunk64k | 128MiB | none up to 128MiB | 116 |
| bind-chunk1m | 128MiB | none up to 128MiB | 135 |
| bind-chunk64k-nowait | 128MiB | none up to 128MiB | 328 |
| copy-chunk64k | 128MiB | none up to 128MiB | 138 |
| tls-bind-single | 128MiB | none up to 128MiB | 323 |
| tls-bind-chunk64k | 128MiB | none up to 128MiB | 107 |
<!-- END limits -->

### TransportCaps mapping (FS-01 provisional, not edited)

| `TransportCaps` field | claimable value for a Cloudflare transport | what local showed | rows |
| --- | --- | --- | --- |
| `startTls` | **false** (production not verified) | works on PostgreSQL 17 and 19.0, MySQL 8.4 and MariaDB 11.8 (5/5) if the transport reads nothing but the server's answer before the switch and settles any pending read with `reader.cancel()`, releases both locks, then calls `startTls()` | `pg.startTls`, `my84.startTls`, `ma118.startTls`, `behaviour.startTlsAfterReaderCancel` |
| `channelBinding` | **`'none'`** (false for `tls-server-end-point`; production not verified) | no member exposes the peer certificate; SCRAM-SHA-256-PLUS cannot be computed; false is also the value for "unobservable" | `cert.peerCertificate.api`, `cert.channelBinding.tlsServerEndPoint` |
| `secondConnectionForCancel` | **false** (production not verified) | PostgreSQL CancelRequest on a second socket and MySQL/MariaDB `KILL QUERY` on a second authenticated connection worked 5/5, including with 6 other sockets busy; the production limit of six was not observed | `cancel.secondSocket`, `cancel.whileSixBusy`, `cancel.mainOnTls.*`, `my84.killQuery`, `ma118.killQuery` |
| `streaming` | **false** (production not verified) | sockets are bidirectional byte streams; TLS, 128 MiB writes and cancel all worked as streams | `transport.streaming` |
| `keepalive` | **false** | not observable: no idle or keepalive probe was run | `transport.keepalive` |
| `halfOpenDetection` | **false** | not observable: no peer-stops-answering probe was run (`allowHalfOpen` was never varied, ledger D-06) | `transport.halfOpenDetection` |

## Planted faults

Each fault must be caught by the check named for it, in 5 of 5 runs, in both modes (a fault caught by the wrong check, or by a login failure, would not count):

<!-- BEGIN planted -->
| planted fault | mode | check that must fail | caught 5/5 | checks that failed |
| --- | --- | --- | --- | --- |
| planted.p1.starttls.server-without-tls | worker | answerS | true | answerS 0/5, upgradeCallOk 0/5, serverSsl 0/5, proxyClientHello 0/5, noStrayBytes 0/5 |
| planted.p6.kill.my84.wrong-id | worker | endedWithin2500msOfKill | true | killAccepted 0/5, endedWithin2500msOfKill 0/5 |
| planted.p1.starttls.flip | control | loginOk | true | loginOk 0/5, serverSsl 0/5, queryOk 0/5 |
| planted.p3.write.bind-single.1MiB | control | pgShaMatches | true | pgShaMatches 0/5 |
| planted.p3.write.bind-single.1MiB | worker | pgShaMatches | true | pgShaMatches 0/5 |
| planted.p6.kill.my84.wrong-id | control | endedWithin2500msOfKill | true | killAccepted 0/5, endedWithin2500msOfKill 0/5 |
| planted.p1.starttls.flip | worker | loginOk | true | loginOk 0/5, serverSsl 0/5, queryOk 0/5 |
| planted.p5.cancel.wrong-key | worker | endedWithin2500msOfCancel | true | endedWithin2500msOfCancel 0/5 |
| planted.p5.cancel.wrong-key | control | endedWithin2500msOfCancel | true | endedWithin2500msOfCancel 0/5 |
| planted.p1.starttls.server-without-tls | control | answerS | true | answerS 0/5, upgradeCallOk 0/5, serverSsl 0/5, proxyClientHello 0/5, noStrayBytes 0/5 |
<!-- END planted -->

## Claims

`results/ledger.md`, checked by `scripts/check-ledger.ts` against `claims.json`: 21 claims (the two roadmap lines, 15 Cloudflare statements and 4 competing-driver statements), 11 Confirmed, 5 Corrected, 5 Not verifiable here.
Every documentation quote was read as raw page text (pages saved with `curl`, Cloudflare through its `index.md` variant), is at most 15 words, and was verified verbatim against the saved page's recorded sha256 (51 of 51). The two roadmap lines:

- **R-01 (competing driver)** is postgres.js 4.1.1. *Corrected*: its README documents that the certificate is always checked, that channel binding is unavailable because sockets do not expose the certificate, and that direct negotiation is refused for lack of ALPN. Measured on workerd, these are platform limits, and TLS options other than `startTls({expectedServerHostname})` are ignored.
- **R-02 (Workers: no socket at global scope; connection-count limits; TLS options and channel binding constrained)**: *Corrected*. Global scope, TLS options and channel binding confirmed locally. A connection-count limit was not observed locally (50 sockets, none queued); the documented six is documented-only.

## Not verified

- **Everything on Cloudflare production**: every production cell. No account. Runbook and deployable Worker are in place; `scripts/production.ts` without its variables writes `results/production/NOT-VERIFIED.json`. The production code path was rehearsed against local workerd through `DATABASE_URL` (the same `main` target), and `wrangler deploy --dry-run` built the bundle with the pinned wrangler.
- The documented limit of six connections, whether queued or rejected, whether idle or only header-waiting sockets count, and whether a cancel socket waits behind busy ones (D-11, D-14); port 25 and Cloudflare-IP blocking (D-09, D-12); the trust store (publicly trusted CAs only); the isolate memory limit; `allowHalfOpen` behaviour (D-06); `closed` rejecting; keepalive and half-open detection.
- Whether the build's "unsupported" log line for `expectedServerHostname` reflects something in production.
- Not attempted by design (out of scope): Hyperdrive, Neon HTTP and WebSocket drivers, Durable Object sockets, inbound sockets, `eval` rules, other workerd versions, performance claims, Deno. Also not tried: a userland TLS stack over a `secureTransport: "off"` socket to obtain a certificate hash; an embedder-level client keypair (not a Worker API); `sslnegotiation` or protocol 3.2 behaviour; MySQL and MariaDB beyond the TLS upgrade and `KILL QUERY` (no large writes, concurrency or certificate matrix); PostgreSQL 19.0 beyond the subset listed in the table (TLS upgrade, direct TLS, concurrency 8 and 50, cancel, certificate accept and wrong name, single writes to 128 MiB).

## Defects the instruments had

Found by the controls and the planted faults, fixed, and the final results regenerated by one clean `run-all.sh` pass of the final code. None changed a conclusion; each would have produced a wrong cell or a wrong reason.

1. The server-log window leaked lines from the previous run, so "no authenticated session" was judged against stale lines (control certificate rows 2 of 5). Fixed by matching on the run's own `application_name` and an exact `--since`.
2. The control had no alias for the connect-by-IP target; the client-certificate server's `pg_hba.conf` listed `host ... reject` before `hostssl`, rejecting everything.
3. The proxy never finalised its COPY body digest (`proxyHashMatches` 0 of 5 for every COPY run).
4. The backpressure judge assumed `desiredSize` or `ready` would signal; the platform signals through the write promise. The judge was split into three separate checks and the probe gained a mid-stall snapshot.
5. The leave-open probe sampled `pg_stat_activity` after the platform had already closed the socket; the judge now uses the proxy's close time against the response time.
6. The MySQL processlist oracle counted its own query text (it contains `sleep(30)`) and sampled before the kill finished; the planted `KILL` fault was first reported as caught before probe 6 itself had been shown to work, so that result was discarded and the fault re-run after probe 6 was verified.
7. The lock-variant probe released the reader first and left the writer locked, blurring which lock caused the failure; the reader and writer are now released separately.
8. The Bun adapter's `reader.cancel()` destroys the socket, so the control for the cancel-then-release variant fails by design (0/5); that row's positive control is therefore left out and the workaround rests on the Worker result alone (5/5 on three engines).
9. Raw results first came to 3.9 MB; traces are now kept in full for the first run of each variant only, later runs keep checks, timings and resource samples (the capability table is identical before and after).
10. Smoke runs with two repeats briefly appeared in the table as "too few runs"; the committed files are all from the final five-run pass.

## Decisions beyond the brief

- Branch `chore/fs-04-cloudflare-sockets` as the brief names it; the session's own development branch was not used for the commit.
- Images from `mirror.gcr.io/library` because Docker Hub rate-limited; digests recorded.
- Test host names added to `/etc/hosts`; certificates are CA-signed leaves (the trusted list holds the CA) rather than trusted self-signed certificates, plus an untrusted self-signed leaf and an expired leaf.
- The "plain Bun client" control is the same probe code through a node adapter, not a separate client, so a control cannot disagree with the Worker through a different implementation of the probe.
- A fresh workerd process per run for every variant (`--fresh`), so no run sees another's global state.
- Extra probes beyond the six: lock and pending-read variants of `startTls()`, `startTls()` misuse, writable chunk types, blocked destinations, and the PostgreSQL 19.0 subset.
- wrangler pinned to 4.162.0 (published 2026-11-13) in the runbook; it was run only for `deploy --dry-run` into the ignored `work/` folder.
- `rules.json` counts a negated cell (global scope, socket survives request end, peer certificate API) as true only when the named check fails 5 of 5.

## Proposed decision (for the ADR author; nothing here is decided)

| topic | proposal | evidence | still needed |
| --- | --- | --- | --- |
| Cloudflare transport capabilities | `startTls` true, `secondConnectionForCancel` true, `streaming` true, `channelBinding` `'none'`, `keepalive` and `halfOpenDetection` false, each only after the production cell is observed | capability table, local column | production run of `pg.startTls`, `cancel.*`, `concurrency.*` |
| Channel binding | on Workers `channel_binding=require` is a capability error at config time; `prefer` behaves as `disable`; never offer `SCRAM-SHA-256-PLUS` | no certificate API (5/5); server offers PLUS anyway | production surface listing |
| Direct TLS | `sslnegotiation=direct` is a capability error on Workers for PostgreSQL 17+ | ClientHello without ALPN, server log, option ignored | production ClientHello is unobservable locally: needs a production attempt |
| TLS options | reject at config time any option the platform ignores (`rejectUnauthorized`, `ca`, `servername`, `alpn`, client certificate) instead of passing it silently; always pass `expectedServerHostname` with the configured host | options ignored 0/5; `expectedServerHostname` honoured 5/5 | whether production honours `expectedServerHostname` |
| Upgrade sequence | read nothing but the server's answer before the switch, no always-on read loop; settle any pending read with `reader.cancel()`, release both locks, call `startTls()` once | lock variants 0/5, cancel-then-release 5/5 (3 engines), second call refused | production lock behaviour |
| Writes | chunk at 64 KiB, `await` every `write()` promise (the only backpressure signal), never rely on `desiredSize` or `ready` | 128 MiB 5/5 in all forms; ready and desiredSize never signalled; 321 MiB RSS for one 128 MiB write against 100 to 116 MiB chunked | where the production memory limit makes a single write fail |
| Connection budget | until production shows otherwise assume at most six simultaneous sockets per invocation, so a pool on Workers is at most six including the cancel socket's slot | documented limit (ledger D-14); not seen locally | production N = 7, 8, 24, 50 and cancel with 6 busy |
| Socket lifetime | no module-scope connection, no pool across requests, close everything before the response; one connection per request | global scope throws, cross-request I/O fails, platform closes at request end (all 5/5) | production repeat |
| Cancel | PostgreSQL: CancelRequest on a second plaintext socket; MySQL and MariaDB: a second authenticated connection and `KILL QUERY` (it uses a slot of the connection budget) | 5/5 on all engines, also with the main connection on TLS | production repeat |
| Error mapping | TLS failures arrive as one opaque `internal error; reference = <id>`: classify as `tls`, phase `connect`, with no cause | three different server-side alerts, one client-side text | none |

## Reproduce

```sh
cd research/fs-04
sudo dockerd &                      # if the Docker daemon is not running
./scripts/run-all.sh                # servers, every probe in control and Worker mode, blocked destinations, environment, capability table, ledger
bun scripts/readme-tables.ts        # refills the generated blocks of this README
bunx tsc -p research/fs-04/tsconfig.json    # from the repository root: own tsconfig, local `declare module "cloudflare:sockets"` shim
```

Every report script (`capabilities.ts`, `check-ledger.ts`, `readme-tables.ts`) runs from the committed result files. `scripts/production.ts` needs `FS04_WORKER_URL` and `FS04_PROBE_TOKEN` (see the runbook).
Files: `rules.json` (capability rule), `claims.json` and `scripts/ledger.json` / `scripts/ledger.docs.json` (ledger), `results/probes/` (one file per probe variant and mode), `results/blocked.json`, `results/environment.json`, `results/capabilities.*`, `results/ledger.md`, `results/production-runbook.md`, `worker/` (the deployable Worker and `wrangler.jsonc`).
`work/` (certificates, secrets, saved documentation pages, scratch) is git-ignored by `research/fs-04/.gitignore`.
