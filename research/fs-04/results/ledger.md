# Claim ledger

21 claims: the 2 roadmap lines FS-04 closes and 19 statements taken from Cloudflare's pages and from the competing driver's documentation. Verdicts: Confirmed 11, Corrected 5, Not verifiable here 5. Rendered by `scripts/check-ledger.ts` from `scripts/ledger.json` and `scripts/ledger.docs.json`; the script fails when a claim is missing, duplicated or extra, when a quote is over 15 words, and (with the saved pages on disk) when a quote is not verbatim in the page whose sha256 is recorded.

How to read a row. **Scope** says what the verdict rests on: `local-observed` is the pinned workerd 1.20261118.1 with embedder trust settings (not Cloudflare production), `documented-only` is a page nobody tested, `not observable` has no instrument. A `Confirmed` with scope `local-observed` does not confirm production; the capability table keeps the production column at "Not verified here". Every documentation statement was read as **raw page text**: the page saved by `curl` (Cloudflare pages through their `index.md` variant, GitHub files from `raw.githubusercontent.com`), and read as text; no summarising tool was used for any quote. Quotes are at most 15 words.

| ID | area | verdict | scope | in one line |
| --- | --- | --- | --- | --- |
| R-01 | Competing driver on Workers | Corrected | local-observed | The driver is postgres.js 4.1.1; it documents certificate-always-checked and no channel binding, not 'TLS options ignored'. On workerd both are platform limits, and every TLS option except expectedServerHostname is ignored. |
| R-02 | Workers platform constraints | Corrected | local-observed | No socket at global scope: confirmed. TLS options and channel binding constrained: confirmed. Connection-count limits: not seen locally (50 sockets, none queued); the 6 is documented-only. |
| D-01 | connect() address forms | Confirmed | local-observed | Both address forms open a socket and `opened` yields SocketInfo. |
| D-02 | secureTransport modes | Confirmed | local-observed | All three secureTransport modes behave as stated and the default is off. |
| D-03 | Documented socket options | Corrected | local-observed | A startTls option exists that the docs do not list: expectedServerHostname is honoured. Every other TLS option tried is ignored. |
| D-04 | startTls precondition | Confirmed | local-observed | startTls() throws on sockets not created with secureTransport 'starttls'. |
| D-05 | startTls result | Corrected | local-observed | startTls() returns a new socket and a second call is refused (TypeError); the locks must be released first or the new socket is unusable. The old socket's state is in the evidence file. |
| D-06 | allowHalfOpen behaviour | Not verifiable here | documented-only | allowHalfOpen was passed as false in every probe and never varied; no half-close behaviour was tested. |
| D-07 | opened and closed promises | Confirmed | local-observed | `opened` resolves with remoteAddress (string) and localAddress (undefined) locally; the original socket's `closed` resolves after startTls(); a rejecting `closed` was not observed. |
| D-08 | Writable accepts Uint8Array | Corrected | local-observed | The writable accepted strings, ArrayBuffers, DataViews and a Uint16Array as well as Uint8Array; only a number was rejected. |
| D-09 | Cloudflare IPs blocked | Not verifiable here | documented-only | No Cloudflare-owned address was reachable or testable from here. |
| D-10 | No global-scope sockets | Confirmed | local-observed | connect() at global scope throws 'Disallowed operation called within global scope'. |
| D-11 | Sockets count toward limit | Not verifiable here | documented-only | No limit on open sockets was seen locally (50 open at once); production counting is documented-only. |
| D-12 | Port 25 blocked | Not verifiable here | documented-only | Port 25 could not be distinguished from a closed port here. |
| D-13 | Localhost and private ranges | Confirmed | local-observed | With an outbound service that does not allow local addresses, loopback and localhost are refused with the quoted message; production blocking is documented-only. |
| D-14 | Six connection limit | Not verifiable here | documented-only | No queueing at 7, 8, 24 or 50 sockets locally; the documented limit counts connections waiting for response headers, and no production run exists. |
| D-15 | Cross-request I/O error | Confirmed | local-observed | A socket created in one request fails in another with the quoted message. |
| D-16 | Server certificate always verified | Confirmed | local-observed | The certificate is always verified, whatever options are passed. |
| D-17 | Channel binding unavailable | Confirmed | local-observed | Sockets expose no server certificate, so no channel binding is possible. |
| D-18 | Direct TLS needs ALPN | Confirmed | local-observed | Direct TLS fails because the ClientHello has no ALPN, and an alpn option does not add one. |
| D-19 | TLS handshake failure mode | Confirmed | local-observed | A failed TLS handshake surfaces as an opaque error whose text does not say why; the cause is only visible server-side. |

## R-01 Competing driver on Workers: Corrected (local-observed)

**Claim** (roadmap). [V] a competing driver documents that on Workers TLS options are ignored and `channel_binding=require` is unavailable; whether that is a platform limit is FS-04's question.

**Documentation.**
- postgres.js 4.1.1 README, tag v4.1.1, fetched 2026-11-25, sha256 `477423bacaf7` (read as **raw page text**): "The server certificate is always checked, whatever `ssl` is set to."
- postgres.js 4.1.1 README, tag v4.1.1, fetched 2026-11-25, sha256 `477423bacaf7` (read as **raw page text**): "Channel binding isn't available, as Workers sockets don't expose the server certificate"
- postgres.js 4.1.1 README, tag v4.1.1, fetched 2026-11-25, sha256 `477423bacaf7` (read as **raw page text**): "so `channel_binding: 'require'` is rejected with `CHANNEL_BINDING_REQUIRED`."
- Cloudflare Workers docs, TCP sockets, fetched 2026-11-25, sha256 `cc0aac34dd1a` (read as **raw page text**): "`secureTransport` "off" | "on" | "starttls" — Defaults to `off`"

**Measured here.** The competing driver is postgres.js (npm `postgres` 4.1.1, README section on Cloudflare Workers, first present in v4.0.0). It states the certificate is always checked, that channel binding is unavailable because Workers sockets do not expose the certificate, and that `sslnegotiation: 'direct'` is refused because sockets cannot send ALPN; it never says TLS options are ignored. Measured on the pinned workerd: the platform itself does all three. A self-signed untrusted, a wrong-name and an expired certificate were each rejected 5/5 and the server logged no authenticated session (cert.verification). `rejectUnauthorized:false`, `ca`, `servername`, `alpn`/`alpnProtocols` and a client certificate with key were ignored 0/5 on both connect() and startTls() (the Bun control honoured every one 5/5, so the probes can see an honoured option). `startTls({expectedServerHostname})` is the one TLS option that works: a wrong name is rejected, the right name fixes a connect-by-IP, and it becomes the SNI value, 5/5 each. No member of Socket, SocketInfo or the cloudflare:sockets module exposes the peer certificate or a hash (p2.surface 5/5), so tls-server-end-point and SCRAM-SHA-256-PLUS cannot be computed. Direct TLS to PostgreSQL 17 and 19.0 failed 0/5: the ClientHello has no ALPN and the server logged 'direct SSL connection request without ALPN'. So the driver's statements are platform limits on workerd; whether Cloudflare's production runtime has the same limits was not observed.

**Evidence files.** `results/probes/p2.matrix.selfsigned-untrusted.worker.json`, `results/probes/p2.matrix.trusted-wrong-name.worker.json`, `results/probes/p2.matrix.expired.worker.json`, `results/probes/p2.opt.startTls.rejectUnauthorized-false.worker.json`, `results/probes/p2.opt.connect.ca.worker.json`, `results/probes/p2.opt.startTls.servername.worker.json`, `results/probes/p2.opt.connect.alpn.worker.json`, `results/probes/p2.clientcert.options.worker.json`, `results/probes/p2.opt.startTls.expectedServerHostname-wrong.worker.json`, `results/probes/p2.opt.startTls.expectedServerHostname-fixes-ip.worker.json`, `results/probes/p2.surface.worker.json`, `results/probes/p1.direct-tls.pg17-tls.worker.json`, `results/capabilities.md`

**Corrected sentence.** postgres.js 4.1.1 documents that on Workers the server certificate is always checked and that `channel_binding: 'require'` is rejected because the sockets do not expose the certificate. On workerd 1.20261118.1 both are platform limits: connect() and startTls() ignore rejectUnauthorized, ca, servername, alpn and client-certificate options, startTls() honours only expectedServerHostname, no API exposes the peer certificate, and a direct-TLS ClientHello carries no ALPN. Not verified on Cloudflare production.

## R-02 Workers platform constraints: Corrected (local-observed)

**Claim** (roadmap). [V] Workers: no socket at global scope; connection-count limits apply; TLS options and channel binding are constrained.

**Documentation.**
- Cloudflare Workers docs, TCP sockets, fetched 2026-11-25, sha256 `cc0aac34dd1a` (read as **raw page text**): "TCP sockets cannot be created in global scope and shared across requests."
- Cloudflare Workers docs, TCP sockets, fetched 2026-11-25, sha256 `cc0aac34dd1a` (read as **raw page text**): "Each open TCP socket counts towards the maximum number of"
- Cloudflare Workers docs, Limits, fetched 2026-11-25, sha256 `654550ada073` (read as **raw page text**): "Each Worker invocation can have up to six connections simultaneously waiting for response headers."
- postgres.js 4.1.1 README, tag v4.1.1, fetched 2026-11-25, sha256 `477423bacaf7` (read as **raw page text**): "A connection belongs to the request that opened it"
- postgres.js 4.1.1 README, tag v4.1.1, fetched 2026-11-25, sha256 `477423bacaf7` (read as **raw page text**): "Channel binding isn't available, as Workers sockets don't expose the server certificate"
- postgres.js 4.1.1 README, tag v4.1.1, fetched 2026-11-25, sha256 `477423bacaf7` (read as **raw page text**): "The server certificate is always checked, whatever `ssl` is set to."

**Measured here.** Global scope: connect() at module evaluation threw in 5 of 5 fresh workerd processes with the message 'Disallowed operation called within global scope' (p4.global-scope). TLS options and channel binding: see R-01 (ignored options, no certificate API, no ALPN). Connection count: 1, 2, 6, 7, 8, 24 and 50 sockets from one invocation all logged in, all were seen at once by pg_stat_activity, all ran pg_sleep(1) in parallel (about 1 s wall), and the proxy saw every TCP connection arrive within a few milliseconds, so nothing was queued, on PostgreSQL 17 (5/5 each) and for N = 8 and 50 on 19.0. Six idle sockets did not stop a seventh from opening. The embedder (workerd) sets no such limit; Cloudflare's documented limit of six was not observed.

**Evidence files.** `results/probes/p4.global-scope.worker.json`, `results/probes/p4.concurrent.n6.worker.json`, `results/probes/p4.concurrent.n7.worker.json`, `results/probes/p4.concurrent.n8.worker.json`, `results/probes/p4.concurrent.n24.worker.json`, `results/probes/p4.concurrent.n50.worker.json`, `results/probes/p4.idle-count.n6.worker.json`, `results/capabilities.md`

**Corrected sentence.** Workers sockets cannot be created at global scope (the call throws in every fresh isolate observed), TLS options other than startTls expectedServerHostname are ignored and no channel binding is possible (workerd, local). A connection-count limit was not observed locally and is documented as six connections waiting for response headers; production behaviour is Not verified here.

## D-01 connect() address forms: Confirmed (local-observed)

**Claim** (cloudflare-doc). connect() accepts either a SocketAddress object with hostname and port or a single string, plus an optional SocketOptions object, and returns a Socket.

**Documentation.**
- Cloudflare Workers docs, TCP sockets, fetched 2026-11-25, sha256 `cc0aac34dd1a` (read as **raw page text**): "`connect(address: SocketAddress | string, options?: optional SocketOptions)` : `Socket`"
- postgres.js 4.1.1 source src/cf.js, tag v4.1.1, fetched 2026-11-25, sha256 `0cbb109b2226` (read as **raw page text**): "connect({ hostname: host, port }, { secureTransport: tls ? 'starttls' : 'off', allowHalfOpen: false })"

**Measured here.** connect({hostname, port}, options) was used in every probe. connect("127.0.0.1:port") with no options opened and reported secureTransport 'off' and opened-info keys remoteAddress and localAddress. The address in the string form was a loopback test server, not a production host.

**Evidence files.** `results/blocked.json`, `results/probes/p1.starttls.pg17-tls.worker.json`

## D-02 secureTransport modes: Confirmed (local-observed)

**Claim** (cloudflare-doc). SocketOptions.secureTransport takes "off", "on" or "starttls" and defaults to "off"; "on" starts TLS when the socket is created.

**Documentation.**
- Cloudflare Workers docs, TCP sockets, fetched 2026-11-25, sha256 `cc0aac34dd1a` (read as **raw page text**): "`secureTransport` "off" | "on" | "starttls" — Defaults to `off`"
- Cloudflare Workers docs, TCP sockets, fetched 2026-11-25, sha256 `cc0aac34dd1a` (read as **raw page text**): "`on` — Use TLS."

**Measured here.** 'starttls': p1.starttls (5/5). 'on': TLS from the first byte, proven by the ClientHello at the proxy and the server's direct-TLS log line (p1.direct-tls; the handshake then fails for lack of ALPN). 'off' is used by the concurrency, write and cancel probes (plaintext, 5/5), and a connect() with no options reported secureTransport 'off' (blocked.json).

**Evidence files.** `results/blocked.json`, `results/probes/p1.starttls.pg17-tls.worker.json`, `results/probes/p1.direct-tls.pg17-tls.worker.json`, `results/probes/p4.concurrent.n6.worker.json`

## D-03 Documented socket options: Corrected (local-observed)

**Claim** (cloudflare-doc). The documented SocketOptions members are only secureTransport and allowHalfOpen; no certificate, CA, SNI or expected-hostname option is documented for connect() or startTls().

**Documentation.**
- Cloudflare Workers docs, TCP sockets, fetched 2026-11-25, sha256 `cc0aac34dd1a` (read as **raw page text**): "`secureTransport` "off" | "on" | "starttls" — Defaults to `off`"
- Cloudflare Workers docs, TCP sockets, fetched 2026-11-25, sha256 `cc0aac34dd1a` (read as **raw page text**): "`allowHalfOpen` boolean — Defaults to `false`"
- pg-cloudflare source src/index.ts, node-postgres master, fetched 2026-11-25, sha256 `50fe877a1f39` (read as **raw page text**): "import { SocketOptions, Socket, TlsOptions } from 'cloudflare:sockets'"

**Measured here.** The page lists only secureTransport and allowHalfOpen. On workerd startTls({expectedServerHostname}) works as described in R-01 (wrong name rejected 5/5, fixes a connect-by-IP 5/5, becomes the SNI 5/5). rejectUnauthorized, ca, servername, alpn, alpnProtocols, cert and key were accepted without error and had no effect, on connect() and on startTls() (0/5 each; the Bun control honoured them, 5/5). The pg-cloudflare source imports a TlsOptions type for startTls, which agrees with the option existing.

**Evidence files.** `results/probes/p2.opt.startTls.expectedServerHostname-wrong.worker.json`, `results/probes/p2.opt.startTls.expectedServerHostname-fixes-ip.worker.json`, `results/probes/p2.opt.startTls.expectedServerHostname-sni.worker.json`, `results/probes/p2.opt.startTls.rejectUnauthorized-false.worker.json`, `results/probes/p2.opt.connect.rejectUnauthorized-false.worker.json`, `results/probes/p2.opt.startTls.ca.worker.json`, `results/probes/p2.opt.startTls.servername.worker.json`, `results/probes/p2.opt.startTls.alpn.worker.json`, `results/probes/p2.opt.connect.alpnProtocols.worker.json`, `results/probes/p2.clientcert.options.worker.json`

**Corrected sentence.** The documented SocketOptions are secureTransport and allowHalfOpen. startTls() also takes expectedServerHostname, which workerd honours (it verifies the certificate against that name and sends it as SNI); other TLS options passed to connect() or startTls() are silently ignored. Cloudflare production was not tested.

## D-04 startTls precondition: Confirmed (local-observed)

**Claim** (cloudflare-doc). startTls() can be called only on a socket created with secureTransport set to "starttls".

**Documentation.**
- Cloudflare Workers docs, TCP sockets, fetched 2026-11-25, sha256 `cc0aac34dd1a` (read as **raw page text**): "`startTls()` can only be called if `secureTransport` is set to `starttls`"
- Cloudflare Workers docs, TCP sockets, fetched 2026-11-25, sha256 `cc0aac34dd1a` (read as **raw page text**): "you must set [`secureTransport`](https://developers.cloudflare.com/workers/runtime-apis/tcp-sockets/#socketoptions) to `starttls`"

**Measured here.** On a socket created with 'off' it threw a TypeError ('The `secureTransport` socket option must be set to 'starttls' for startTls to be used.'); on 'on' it threw 'Cannot startTls on a TLS socket.' (5/5 each).

**Evidence files.** `results/probes/p1.starttls-misuse.off.worker.json`, `results/probes/p1.starttls-misuse.on.worker.json`

## D-05 startTls result: Corrected (local-observed)

**Claim** (cloudflare-doc). startTls() returns a new Socket, the original socket can no longer be read or written, and startTls() should be called once per socket.

**Documentation.**
- Cloudflare Workers docs, TCP sockets, fetched 2026-11-25, sha256 `cc0aac34dd1a` (read as **raw page text**): "Upgrades an insecure socket to a secure one that uses TLS, returning a new"
- Cloudflare Workers docs, TCP sockets, fetched 2026-11-25, sha256 `cc0aac34dd1a` (read as **raw page text**): "the initial socket is closed and can no longer be read from"
- Cloudflare Workers docs, TCP sockets, fetched 2026-11-25, sha256 `cc0aac34dd1a` (read as **raw page text**): "`startTls()` should only be called once on an existing socket."

**Measured here.** startTls() returned a usable new socket in p1.starttls (5/5). A second startTls() on the upgraded socket threw 'Cannot startTls on a TLS socket.' and the connection stayed usable (5/5). The page does not say that the original socket's reader and writer must be released before the call: with a lock held, or with a read outstanding (releaseLock throws 'Cannot call releaseLock() on a reader with outstanding read promises.'), startTls() itself does not throw but the returned socket's streams fail at first use ('The ReadableStream has been locked to a reader' / 'This WritableStream is currently locked to a writer'), 0/5 each, on PostgreSQL and on MySQL and MariaDB. reader.cancel() on the outstanding read, then releaseLock, then startTls() worked 5/5 on all three. In the first-run trace of p2.surface, after the call the original socket object still reported secureTransport 'starttls' and upgraded false, was not locked (the locks had been released), and its `closed` promise had already resolved (oldSocket in p2.surface); the new socket reported secureTransport 'on' and upgraded false as well, so the `upgraded` flag did not tell the two apart.

**Evidence files.** `results/probes/p1.starttls.pg17-tls.worker.json`, `results/probes/p1.second-starttls.worker.json`, `results/probes/p1.lock.none-released.worker.json`, `results/probes/p1.lock.read-pending.worker.json`, `results/probes/p1.lock.cancel-pending.worker.json`, `results/probes/p2.surface.worker.json`, `results/probes/p6.tls.my84.read-pending.worker.json`, `results/probes/p6.tls.my84.cancel-pending.worker.json`

**Corrected sentence.** startTls() returns a new socket and may be called once; before calling it the caller must release the reader and writer locks, and an outstanding read() must first be settled with reader.cancel(), otherwise startTls() returns a socket whose streams are unusable. (workerd, local.)

## D-06 allowHalfOpen behaviour: Not verifiable here (documented-only)

**Claim** (cloudflare-doc). allowHalfOpen defaults to false, which closes the writable side automatically at end-of-file; true keeps the writable side open after EOF.

**Documentation.**
- Cloudflare Workers docs, TCP sockets, fetched 2026-11-25, sha256 `cc0aac34dd1a` (read as **raw page text**): "`allowHalfOpen` boolean — Defaults to `false`"
- Cloudflare Workers docs, TCP sockets, fetched 2026-11-25, sha256 `cc0aac34dd1a` (read as **raw page text**): "the writable side of the TCP socket will remain open on EOF"

**Measured here.** Every probe created sockets with allowHalfOpen false. No probe made the server close its side while the client kept writing, so the stated default and the true-setting behaviour were not observed.

**Evidence files.** `results/environment.json`

## D-07 opened and closed promises: Confirmed (local-observed)

**Claim** (cloudflare-doc). socket.opened resolves with SocketInfo (remoteAddress and localAddress, each possibly undefined) once connected and rejects on error; socket.closed resolves when the socket closes and rejects on error.

**Documentation.**
- Cloudflare Workers docs, TCP sockets, fetched 2026-11-25, sha256 `cc0aac34dd1a` (read as **raw page text**): "This promise is resolved when the socket connection is established"
- Cloudflare Workers docs, TCP sockets, fetched 2026-11-25, sha256 `cc0aac34dd1a` (read as **raw page text**): "This promise is resolved when the socket is closed"
- Cloudflare Workers docs, TCP sockets, fetched 2026-11-25, sha256 `cc0aac34dd1a` (read as **raw page text**): "The address of the local network endpoint for this socket. May not always be set."

**Measured here.** opened-info on a connected socket had remoteAddress of type string and localAddress of type undefined, on both the starttls socket and the upgraded one, matching 'may not always be set'. The `closed` promise of the original socket resolved as soon as startTls() had returned (oldSocket.closed in the first-run trace of p2.surface; the later runs kept only their checks). No probe observed `closed` rejecting, and `closed` for a socket the server closed was not observed.

**Evidence files.** `results/probes/p2.surface.worker.json`, `results/probes/p1.starttls.pg17-tls.worker.json`

## D-08 Writable accepts Uint8Array: Corrected (local-observed)

**Claim** (cloudflare-doc). The socket's WritableStream accepts only Uint8Array chunks or views of them.

**Documentation.**
- Cloudflare Workers docs, TCP sockets, fetched 2026-11-25, sha256 `cc0aac34dd1a` (read as **raw page text**): "The `WritableStream` returned only accepts chunks of `Uint8Array` or its views."

**Measured here.** Fresh socket per chunk type, bytes counted at the proxy: string 3 bytes (UTF-8), ArrayBuffer 8, Uint8Array 8, Uint8Array subarray 8, DataView 8, Uint16Array 8, number rejected with 'This TransformStream is being used as a byte stream, but received an object of non-ArrayBuffer/ArrayBufferView type'. So locally the writable is more permissive than the page says.

**Evidence files.** `results/blocked.json`

**Corrected sentence.** The socket's WritableStream accepts any ArrayBuffer or ArrayBuffer view, and a string (written as UTF-8), and rejects other values (workerd, local). The study's clients write Uint8Array only.

## D-09 Cloudflare IPs blocked: Not verifiable here (documented-only)

**Claim** (cloudflare-doc). Outbound connect() to Cloudflare IP ranges is refused.

**Documentation.**
- Cloudflare Workers docs, TCP sockets, fetched 2026-11-25, sha256 `cc0aac34dd1a` (read as **raw page text**): "Outbound TCP sockets to [Cloudflare IP ranges ↗︎](https://www.cloudflare.com/ips/) are blocked."
- Cloudflare Workers docs, connect() handler, fetched 2026-11-25, sha256 `44ecd7d796bd` (read as **raw page text**): "Outbound TCP connections to Cloudflare IP addresses are blocked."

**Measured here.** The sandbox has no route to Cloudflare addresses, so a refusal of 1.1.1.1:53 in blocked.json says nothing about the platform rule: workerd answered every disallowed or unreachable address with the same text. The production rule is documented-only.

**Evidence files.** `results/blocked.json`

## D-10 No global-scope sockets: Confirmed (local-observed)

**Claim** (cloudflare-doc). A TCP socket cannot be created in global scope and shared across requests; connect() during global scope fails with a disallowed-operation error.

**Documentation.**
- Cloudflare Workers docs, TCP sockets, fetched 2026-11-25, sha256 `cc0aac34dd1a` (read as **raw page text**): "TCP sockets cannot be created in global scope and shared across requests."
- Cloudflare Hyperdrive docs, Troubleshoot and debug, fetched 2026-11-25, sha256 `40db0b72aabb` (read as **raw page text**): "Disallowed operation called within global scope. Asynchronous I/O (ex: fetch() or connect())"
- postgres.js 4.1.1 README, tag v4.1.1, fetched 2026-11-25, sha256 `477423bacaf7` (read as **raw page text**): "A connection belongs to the request that opened it"

**Measured here.** Module evaluation of the probe Worker called connect(); in 5 of 5 fresh workerd processes it threw an Error whose message begins 'Disallowed operation called within global scope. Asynchronous I/O (ex: fetch() or connect()), setting a timeout, and generating random values are not allowed within global scope.' The postgres.js statement that a connection belongs to the request that opened it is covered by D-15.

**Evidence files.** `results/probes/p4.global-scope.worker.json`

## D-11 Sockets count toward limit: Not verifiable here (documented-only)

**Claim** (cloudflare-doc). Each open TCP socket counts toward the maximum number of simultaneously open connections.

**Documentation.**
- Cloudflare Workers docs, TCP sockets, fetched 2026-11-25, sha256 `cc0aac34dd1a` (read as **raw page text**): "Each open TCP socket counts towards the maximum number of"

**Measured here.** 50 sockets from one invocation were all open and used at once (5/5), so the stated maximum of simultaneously open connections is not enforced by this workerd. Whether Cloudflare counts every open socket toward its limit was not observed. D-14 records the limits page's narrower wording.

**Evidence files.** `results/probes/p4.concurrent.n50.worker.json`, `results/probes/p4.concurrent.n24.worker.json`

## D-12 Port 25 blocked: Not verifiable here (documented-only)

**Claim** (cloudflare-doc). Outbound connect() to port 25 is refused with the message "Connections to port 25 are prohibited".

**Documentation.**
- Cloudflare Workers docs, TCP sockets, fetched 2026-11-25, sha256 `cc0aac34dd1a` (read as **raw page text**): "By default, Workers cannot create outbound TCP connections on port `25`"
- Cloudflare Workers docs, TCP sockets, fetched 2026-11-25, sha256 `cc0aac34dd1a` (read as **raw page text**): "Connections to port 25 are prohibited"

**Measured here.** connect() to 127.0.0.1:25 was refused with the generic 'proxy request failed, cannot connect to the specified address', as was every other refused address; nothing listens on port 25, so a port-25 rule cannot be told from a refusal by the host. The message 'Connections to port 25 are prohibited' was not seen.

**Evidence files.** `results/blocked.json`

## D-13 Localhost and private ranges: Confirmed (local-observed)

**Claim** (cloudflare-doc). connect() to localhost or private network IPs is refused with "proxy request failed, cannot connect to the specified address".

**Documentation.**
- Cloudflare Workers docs, TCP sockets, fetched 2026-11-25, sha256 `cc0aac34dd1a` (read as **raw page text**): "proxy request failed, cannot connect to the specified address"
- Cloudflare Workers docs, TCP sockets, fetched 2026-11-25, sha256 `cc0aac34dd1a` (read as **raw page text**): "Examples of a disallowed address include Cloudflare IPs, `localhost`, and private network IPs."

**Measured here.** workerd with outbound allow ["public"]: 127.0.0.1 and `localhost` both failed with 'proxy request failed, cannot connect to the specified address'. With ["public","local"] both opened, and an unrouted private address (10.255.255.1) was still refused with the same text. The rule here is the embedder's, not Cloudflare's; the page's claim about production is unverified.

**Evidence files.** `results/blocked.json`

## D-14 Six connection limit: Not verifiable here (documented-only)

**Claim** (cloudflare-doc). At most six connections per invocation may be waiting for response headers at once, and a seventh attempted while six are waiting is queued rather than rejected.

**Documentation.**
- Cloudflare Workers docs, Limits, fetched 2026-11-25, sha256 `654550ada073` (read as **raw page text**): "Each Worker invocation can have up to six connections simultaneously waiting for response headers."
- Cloudflare Workers docs, Limits, fetched 2026-11-25, sha256 `654550ada073` (read as **raw page text**): "while the initial connection is being established and the server has not yet responded"
- Cloudflare Workers docs, Limits, fetched 2026-11-25, sha256 `654550ada073` (read as **raw page text**): "it is queued until one of the existing connections receives its response headers."

**Measured here.** Local workerd: N = 7, 8, 24 and 50 all logged in and were usable at once, opened within a few milliseconds of each other at the proxy (not queued); a cancel socket opened immediately as the 8th while 6 other sockets were busy. The limits page counts connections 'waiting for response headers' and the sockets page counts open sockets (D-11); the two readings were not separated because the limit does not exist locally. Run the production probes (runbook) to separate them.

**Evidence files.** `results/probes/p4.concurrent.n7.worker.json`, `results/probes/p4.concurrent.n8.worker.json`, `results/probes/p4.concurrent.n50.worker.json`, `results/probes/p5.cancel.busy6.worker.json`

## D-15 Cross-request I/O error: Confirmed (local-observed)

**Claim** (cloudflare-doc). An I/O object such as a stream created in one request handler cannot be used from another request's handler and raises "Cannot perform I/O on behalf of a different request".

**Documentation.**
- Cloudflare Workers docs, Errors and exceptions, fetched 2026-11-25, sha256 `ed9f459462f7` (read as **raw page text**): "Cannot perform I/O on behalf of a different request."
- Cloudflare Workers docs, Errors and exceptions, fetched 2026-11-25, sha256 `ed9f459462f7` (read as **raw page text**): "cannot be accessed from a different request's handler."

**Measured here.** A socket created and logged in during one HTTP request was used from a second request to the same isolate: the query and the write both failed with 'Cannot perform I/O on behalf of a different request. I/O objects (such as streams, request/response bodies, and others) created in the context of one request handler cannot be accessed from a different request's handler.' (I/O type: Writable), 5/5. The Bun control, which has no request boundary, used the socket 5/5.

**Evidence files.** `results/probes/p4.cross-request.worker.json`, `results/probes/p4.cross-request.control.json`

## D-16 Server certificate always verified: Confirmed (local-observed)

**Claim** (competing-driver). postgres.js documents that on Workers the server certificate is always verified whatever the ssl option is set to.

**Documentation.**
- postgres.js 4.1.1 README, tag v4.1.1, fetched 2026-11-25, sha256 `477423bacaf7` (read as **raw page text**): "The server certificate is always checked, whatever `ssl` is set to."
- postgres.js 4.1.1 README, tag v4.1.1, fetched 2026-11-25, sha256 `477423bacaf7` (read as **raw page text**): "Workers always verify the certificate; Hyperdrive connects to such servers for you."

**Measured here.** Untrusted self-signed, wrong name and expired were each rejected 5/5 with no session reaching PostgreSQL (server log: certificate unknown, bad certificate, certificate expired). rejectUnauthorized:false changed nothing (0/5). Trust here is the test CA given to workerd; 'publicly trusted CA' was not tested.

**Evidence files.** `results/probes/p2.matrix.selfsigned-untrusted.worker.json`, `results/probes/p2.matrix.trusted-wrong-name.worker.json`, `results/probes/p2.matrix.expired.worker.json`, `results/probes/p2.opt.startTls.rejectUnauthorized-false.worker.json`, `results/probes/p2.opt.connect.rejectUnauthorized-false.worker.json`

## D-17 Channel binding unavailable: Confirmed (local-observed)

**Claim** (competing-driver). postgres.js documents that on Workers channel binding is unavailable because the sockets do not expose the server certificate, so channel_binding 'require' is rejected with CHANNEL_BINDING_REQUIRED.

**Documentation.**
- postgres.js 4.1.1 README, tag v4.1.1, fetched 2026-11-25, sha256 `477423bacaf7` (read as **raw page text**): "Channel binding isn't available, as Workers sockets don't expose the server certificate"
- postgres.js 4.1.1 README, tag v4.1.1, fetched 2026-11-25, sha256 `477423bacaf7` (read as **raw page text**): "so `channel_binding: 'require'` is rejected with `CHANNEL_BINDING_REQUIRED`."
- postgres.js 4.1.1 README, tag v4.1.1, fetched 2026-11-25, sha256 `477423bacaf7` (read as **raw page text**): "Cloudflare Workers sockets don't expose the server certificate, so there `'prefer'` doesn't bind"

**Measured here.** The full surface of Socket, its readable and writable, the opened-info and the module exports was listed before and after the upgrade: socket members are close, closed, opened, readable, secureTransport, startTls, upgraded, writable; the module exports connect and an internal helper. None of the 10 names a driver would look for (peerCertificate, getPeerCertificate, getCertificate, certificate, cert, tlsInfo, getProtocol, getCipher, tlsSocket, alpnProtocol) exists, 5/5 runs; the only TLS-related members report state (secureTransport, upgraded), not the certificate. The server offered SCRAM-SHA-256-PLUS in every TLS session; the Worker has no certificate hash to bind to.

**Evidence files.** `results/probes/p2.surface.worker.json`, `results/probes/p1.starttls.pg17-tls.worker.json`

## D-18 Direct TLS needs ALPN: Confirmed (local-observed)

**Claim** (competing-driver). postgres.js documents that on Workers sslnegotiation 'direct' is refused because Workers sockets cannot send ALPN.

**Documentation.**
- postgres.js 4.1.1 README, tag v4.1.1, fetched 2026-11-25, sha256 `477423bacaf7` (read as **raw page text**): "`sslnegotiation: 'direct'` is refused with `SSL_NEGOTIATION_NOT_SUPPORTED`, as Workers sockets cannot send ALPN."
- postgres.js 4.1.1 source src/cf.js, tag v4.1.1, fetched 2026-11-25, sha256 `0cbb109b2226` (read as **raw page text**): "sslnegotiation: direct needs ALPN, which Cloudflare Workers sockets do not offer"

**Measured here.** secureTransport 'on' to PostgreSQL 17 and 19.0 failed 0/5; the proxy parsed the ClientHello (no ALPN extension) and the server logged 'received direct SSL connection request without ALPN protocol negotiation extension'. connect({alpn:['postgresql']}) and the alpnProtocols spelling changed nothing (0/5); the Bun control with the same option succeeded 5/5.

**Evidence files.** `results/probes/p1.direct-tls.pg17-tls.worker.json`, `results/probes/p1.direct-tls.pg19-tls.worker.json`, `results/probes/p1.direct-tls.alpn-option.pg17-tls.worker.json`, `results/probes/p2.opt.connect.alpn.worker.json`, `results/probes/p2.opt.startTls.alpn.worker.json`, `results/probes/p1.direct-tls.alpn-option.pg17-tls.control.json`

## D-19 TLS handshake failure mode: Confirmed (local-observed)

**Claim** (competing-driver). postgres.js documents that a Workers TLS handshake fails, most often when the server certificate is not signed by a publicly trusted CA, and surfaces this as TLS_HANDSHAKE_FAILED.

**Documentation.**
- postgres.js 4.1.1 README, tag v4.1.1, fetched 2026-11-25, sha256 `477423bacaf7` (read as **raw page text**): "most often because the server's certificate is not signed by a publicly trusted CA."

**Measured here.** For the self-signed, wrong-name and expired cases the Worker saw the same text, 'internal error; reference = <id>', while the server log showed three different alerts (certificate unknown, bad certificate, certificate expired). The driver's TLS_HANDSHAKE_FAILED code and its advice about publicly trusted CAs are consistent with that; a driver cannot tell the causes apart from the exception.

**Evidence files.** `results/probes/p2.matrix.selfsigned-untrusted.worker.json`, `results/probes/p2.matrix.trusted-wrong-name.worker.json`, `results/probes/p2.matrix.expired.worker.json`
