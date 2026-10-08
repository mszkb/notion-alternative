# Contract-Tests

Black-Box-Tests des HTTP-API ([#118](https://github.com/mszkb/notion-alternative/issues/118), [ADR 0018](../../docs/adr/0018-php-backend.md)) gegen jede Server-Implementierung (Node, PHP). Sie sprechen nur HTTP (`fetch`) und legen alle Daten über das API an.

```sh
pnpm --filter @notion-alt/contract-tests test                  # startet den Node-Server selbst
SERVER_CMD='php -S 127.0.0.1:$PORT -t apps/server-php/public' \
  pnpm --filter @notion-alt/contract-tests test                # anderer Server, gleicher Ablauf
SERVER_URL=http://127.0.0.1:3000 pnpm --filter @notion-alt/contract-tests test   # laufender Server
```

Ablauf, Umgebung des gestarteten Servers, Abdeckung und Lücken: [`docs/testing/contract-tests.md`](../../docs/testing/contract-tests.md).
