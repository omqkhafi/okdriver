# Authentication matrix

Plain-password logins. "plain" is a TCP connection without TLS, "TLS" upgrades inside the handshake without certificate verification. P = this prototype, M2 = mysql2, MC = MariaDB Connector/Node.js. ok / refused (with the reason in the JSON).

## my84

Plugins loaded in the fresh server before anything was installed: caching_sha2_password, mysql_native_password (DISABLED), sha256_password

| plugin | create user | plain P / M2 / MC | TLS P / M2 / MC | note |
| --- | --- | --- | --- | --- |
| caching_sha2_password | ok | ok / ok / ok | ok / ok / ok | GREETING,AUTH_MORE,AUTH_MORE,OK ; GREETING,AUTH_MORE,OK |
| sha256_password | ok | ok / ok / ok | ok / ok / ok | GREETING,AUTH_SWITCH,AUTH_MORE,OK ; GREETING,AUTH_SWITCH,AUTH_MORE,OK |
| mysql_native_password | [1524] (HY000) Plugin 'mysql_native_password' is not loaded | | |  |

## my84-native-on

Plugins loaded in the fresh server before anything was installed: caching_sha2_password, mysql_native_password, sha256_password

| plugin | create user | plain P / M2 / MC | TLS P / M2 / MC | note |
| --- | --- | --- | --- | --- |
| caching_sha2_password | ok | ok / ok / ok | ok / ok / ok | GREETING,AUTH_MORE,AUTH_MORE,OK ; GREETING,AUTH_MORE,OK |
| sha256_password | ok | ok / ok / ok | ok / ok / ok | GREETING,AUTH_SWITCH,AUTH_MORE,OK ; GREETING,AUTH_SWITCH,AUTH_MORE,OK |
| mysql_native_password | ok | ok / ok / ok | ok / ok / ok | GREETING,AUTH_SWITCH,OK ; GREETING,AUTH_SWITCH,OK |

## my97

Plugins loaded in the fresh server before anything was installed: caching_sha2_password, sha256_password

| plugin | create user | plain P / M2 / MC | TLS P / M2 / MC | note |
| --- | --- | --- | --- | --- |
| caching_sha2_password | ok | ok / ok / ok | ok / ok / ok | GREETING,AUTH_MORE,AUTH_MORE,OK ; GREETING,AUTH_MORE,OK |
| sha256_password | ok | ok / ok / ok | ok / ok / ok | GREETING,AUTH_SWITCH,AUTH_MORE,OK ; GREETING,AUTH_SWITCH,AUTH_MORE,OK |
| mysql_native_password | [1524] (HY000) Plugin 'mysql_native_password' is not loaded | | |  |
| mysql_native_password | [1524] (HY000) Plugin 'mysql_native_password' is not loaded | | | after INSTALL PLUGIN |

## my2610

Plugins loaded in the fresh server before anything was installed: caching_sha2_password, sha256_password

| plugin | create user | plain P / M2 / MC | TLS P / M2 / MC | note |
| --- | --- | --- | --- | --- |
| caching_sha2_password | ok | ok / ok / ok | ok / ok / ok | GREETING,AUTH_MORE,AUTH_MORE,OK ; GREETING,AUTH_MORE,OK |
| sha256_password | ok | ok / ok / ok | ok / ok / ok | GREETING,AUTH_SWITCH,AUTH_MORE,OK ; GREETING,AUTH_SWITCH,AUTH_MORE,OK |
| mysql_native_password | [1524] (HY000) Plugin 'mysql_native_password' is not loaded | | |  |
| mysql_native_password | [1524] (HY000) Plugin 'mysql_native_password' is not loaded | | | after INSTALL PLUGIN |

## ma106

Plugins loaded in the fresh server before anything was installed: mysql_native_password, mysql_old_password, unix_socket

| plugin | create user | plain P / M2 / MC | TLS P / M2 / MC | note |
| --- | --- | --- | --- | --- |
| mysql_native_password | ok | ok / ok / ok | refused / refused / refused | GREETING,OK ; GREETING,OK |
| mysql_old_password | ok | refused / refused / refused | refused / refused / refused | GREETING,ERR ; GREETING,ERR |
| ed25519 | ok | ok / refused / ok | refused / refused / refused | GREETING,AUTH_SWITCH,OK ; GREETING,AUTH_SWITCH,OK |
| parsec | [1524] (HY000) Plugin 'parsec' is not loaded | | |  |
| caching_sha2_password | [1524] (HY000) Plugin 'caching_sha2_password' is not loaded | | |  |
| unix_socket | ok | refused / refused / refused | refused / refused / refused | GREETING,ERR ; GREETING,ERR |

## ma1011

Plugins loaded in the fresh server before anything was installed: mysql_native_password, mysql_old_password, unix_socket

| plugin | create user | plain P / M2 / MC | TLS P / M2 / MC | note |
| --- | --- | --- | --- | --- |
| mysql_native_password | ok | ok / ok / ok | refused / refused / refused | GREETING,OK ; GREETING,OK |
| mysql_old_password | ok | refused / refused / refused | refused / refused / refused | GREETING,ERR ; GREETING,ERR |
| ed25519 | ok | ok / refused / ok | refused / refused / refused | GREETING,AUTH_SWITCH,OK ; GREETING,AUTH_SWITCH,OK |
| parsec | [1524] (HY000) Plugin 'parsec' is not loaded | | |  |
| caching_sha2_password | [1524] (HY000) Plugin 'caching_sha2_password' is not loaded | | |  |
| unix_socket | ok | refused / refused / refused | refused / refused / refused | GREETING,ERR ; GREETING,ERR |

## ma114

Plugins loaded in the fresh server before anything was installed: mysql_native_password, mysql_old_password, unix_socket

| plugin | create user | plain P / M2 / MC | TLS P / M2 / MC | note |
| --- | --- | --- | --- | --- |
| mysql_native_password | ok | ok / ok / ok | ok / ok / ok | GREETING,OK ; GREETING,OK |
| mysql_old_password | ok | refused / refused / refused | refused / refused / refused | GREETING,ERR ; GREETING,ERR |
| ed25519 | ok | ok / refused / ok | ok / refused / ok | GREETING,AUTH_SWITCH,OK ; GREETING,AUTH_SWITCH,OK |
| parsec | [1524] (HY000) Plugin 'parsec' is not loaded | | |  |
| caching_sha2_password | ok | refused / refused / refused | ok / ok / ok | GREETING,AUTH_SWITCH,AUTH_MORE,ERR ; GREETING,AUTH_SWITCH,AUTH_MORE,ERR |
| unix_socket | ok | refused / refused / refused | refused / refused / refused | GREETING,ERR ; GREETING,ERR |

## ma118

Plugins loaded in the fresh server before anything was installed: mysql_native_password, mysql_old_password, unix_socket

| plugin | create user | plain P / M2 / MC | TLS P / M2 / MC | note |
| --- | --- | --- | --- | --- |
| mysql_native_password | ok | ok / ok / ok | ok / ok / ok | GREETING,OK ; GREETING,OK |
| mysql_old_password | ok | refused / refused / refused | refused / refused / refused | GREETING,ERR ; GREETING,ERR |
| ed25519 | ok | ok / refused / ok | ok / refused / ok | GREETING,AUTH_SWITCH,OK ; GREETING,AUTH_SWITCH,OK |
| parsec | ok | ok / refused / ok | ok / refused / ok | GREETING,AUTH_SWITCH,AUTH_MORE,OK ; GREETING,AUTH_SWITCH,AUTH_MORE,OK |
| caching_sha2_password | ok | refused / refused / refused | ok / ok / ok | GREETING,AUTH_SWITCH,AUTH_MORE,ERR ; GREETING,AUTH_SWITCH,AUTH_MORE,ERR |
| unix_socket | ok | refused / refused / refused | refused / refused / refused | GREETING,ERR ; GREETING,ERR |

## ma123

Plugins loaded in the fresh server before anything was installed: mysql_native_password, mysql_old_password, unix_socket

| plugin | create user | plain P / M2 / MC | TLS P / M2 / MC | note |
| --- | --- | --- | --- | --- |
| mysql_native_password | ok | ok / ok / ok | ok / ok / ok | GREETING,OK ; GREETING,OK |
| mysql_old_password | ok | refused / refused / refused | refused / refused / refused | GREETING,ERR ; GREETING,ERR |
| ed25519 | ok | ok / refused / ok | ok / refused / ok | GREETING,AUTH_SWITCH,OK ; GREETING,AUTH_SWITCH,OK |
| parsec | ok | ok / refused / ok | ok / refused / ok | GREETING,AUTH_SWITCH,AUTH_MORE,OK ; GREETING,AUTH_SWITCH,AUTH_MORE,OK |
| caching_sha2_password | ok | refused / refused / refused | ok / ok / ok | GREETING,AUTH_SWITCH,AUTH_MORE,ERR ; GREETING,AUTH_SWITCH,AUTH_MORE,ERR |
| unix_socket | ok | refused / refused / refused | refused / refused / refused | GREETING,ERR ; GREETING,ERR |

## ma130

Plugins loaded in the fresh server before anything was installed: mysql_native_password, mysql_old_password, unix_socket

| plugin | create user | plain P / M2 / MC | TLS P / M2 / MC | note |
| --- | --- | --- | --- | --- |
| mysql_native_password | ok | ok / ok / ok | ok / ok / ok | GREETING,OK ; GREETING,OK |
| mysql_old_password | ok | refused / refused / refused | refused / refused / refused | GREETING,ERR ; GREETING,ERR |
| ed25519 | ok | ok / refused / ok | ok / refused / ok | GREETING,AUTH_SWITCH,OK ; GREETING,AUTH_SWITCH,OK |
| parsec | ok | ok / refused / ok | ok / refused / ok | GREETING,AUTH_SWITCH,AUTH_MORE,OK ; GREETING,AUTH_SWITCH,AUTH_MORE,OK |
| caching_sha2_password | ok | refused / refused / refused | ok / ok / ok | GREETING,AUTH_SWITCH,AUTH_MORE,ERR ; GREETING,AUTH_SWITCH,AUTH_MORE,ERR |
| unix_socket | ok | refused / refused / refused | refused / refused / refused | GREETING,ERR ; GREETING,ERR |
