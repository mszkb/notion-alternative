<?php

declare(strict_types=1);

// Front controller for every request: Apache rewrites to it (.htaccess), and the built-in server
// uses it as router script (`php -S 127.0.0.1:8000 -t public public/index.php`). There are no
// static files to serve, so the built-in server never gets `return false`.

require __DIR__ . '/../vendor/autoload.php';

NotionAlt\Server::run(dirname(__DIR__));
