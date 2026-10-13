<?php

declare(strict_types=1);

// api/app/config.php for the contract tests (docs/testing/contract-tests.md, "Umgebung des
// Servers"); scripts/webspace-test.sh. Plain HTTP on localhost, hence COOKIE_SECURE false.
return [
    'DATA_DIR' => '/var/www/notion-data',
    'COOKIE_SECURE' => false,
    'ALLOW_REGISTRATION' => true,
    'METRICS_ENABLED' => true,
    'LOG_LEVEL' => 'warn',
    'TRUST_PROXY' => true,
    'LOGIN_MAX_FAILURES_PER_EMAIL' => 3,
    'LOGIN_MAX_FAILURES_PER_IP' => 6,
    'REGISTER_MAX_ATTEMPTS_PER_IP' => 4,
    'ATTACHMENT_MAX_MB' => 1,
    'WORKSPACE_STORAGE_MB' => 0.003,
    'PUSH_ALLOWED_HOSTS' => '127.0.0.1',
];
