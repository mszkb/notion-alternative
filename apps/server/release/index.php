<?php

declare(strict_types=1);

// Front controller of the shared-hosting package: every request below /api/ comes here
// (.htaccess). The app itself lives in app/, which the web server must never serve.

require __DIR__ . '/app/vendor/autoload.php';

NotionAlt\Server::run(__DIR__ . '/app');
