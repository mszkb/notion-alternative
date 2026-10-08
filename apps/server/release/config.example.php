<?php

declare(strict_types=1);

// Copy to config.php in this folder and adjust. Environment variables win over these values.
// All settings: docs/operations/deployment.md. Relative paths are relative to this folder.
return [
    // Outside the web root, e.g. next to public_html. Holds the database and attachments.
    'DATA_DIR' => '/home/USER/notion-data',
    // HTTPS only (every web host offers it): the session cookie is sent over HTTPS only.
    'COOKIE_SECURE' => true,
    // Open registration for the first account, then set back to false.
    'ALLOW_REGISTRATION' => true,
    'PUSH_SUBJECT' => 'mailto:admin@example.com',
    // Only with a reverse proxy in front (most web hosts): client address from X-Forwarded-For.
    // On your own server without a proxy, e.g. at home, set it to false.
    'TRUST_PROXY' => true,
];
