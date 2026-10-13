<?php

declare(strict_types=1);

// api/app/config.php for the end-to-end tests, same values as the server that
// apps/web/playwright.config.ts starts; scripts/webspace-test.sh.
return [
    'DATA_DIR' => '/var/www/notion-data',
    'COOKIE_SECURE' => false,
    'ALLOW_REGISTRATION' => true,
    'LOG_LEVEL' => 'warn',
    'TRUST_PROXY' => true,
    'REGISTER_MAX_ATTEMPTS_PER_IP' => 100000,
    'PUSH_ALLOWED_HOSTS' => 'push.test',
    'WORKSPACE_STORAGE_MB' => 0.05,
];
