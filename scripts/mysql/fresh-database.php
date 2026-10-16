<?php

declare(strict_types=1);

// Creates an empty MariaDB/MySQL database and prints its DATABASE_URL (ADR 0024). For tests: the
// contract tests run it before every server they start (SERVER_DATABASE_CMD), PHPUnit through
// TEST_DATABASE_URL. Usage: php scripts/mysql/fresh-database.php mysql://root:root@127.0.0.1:3306
// (an account that may create databases; the new one is named notion_test_<random>).
// `--drop-all` removes all notion_test_* databases instead.

$admin = $argv[1] ?? getenv('MYSQL_ADMIN_URL') ?: '';
$parts = parse_url($admin);
if ($parts === false || !isset($parts['host'], $parts['user'])) {
    fwrite(STDERR, "usage: php fresh-database.php mysql://user:password@host:port [--drop-all]\n");
    exit(2);
}
$user = rawurldecode($parts['user']);
$password = rawurldecode($parts['pass'] ?? '');
$host = $parts['host'];
$port = $parts['port'] ?? 3306;
$pdo = new PDO("mysql:host={$host};port={$port}", $user, $password, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);

if (in_array('--drop-all', $argv, true)) {
    foreach ($pdo->query("show databases like 'notion\\_test\\_%'")->fetchAll(PDO::FETCH_COLUMN) as $name) {
        $pdo->exec("drop database `{$name}`");
    }
    exit(0);
}

$name = 'notion_test_' . bin2hex(random_bytes(6));
$pdo->exec("create database `{$name}` character set utf8mb4 collate utf8mb4_bin");
echo "mysql://{$parts['user']}:" . ($parts['pass'] ?? '') . "@{$host}:{$port}/{$name}\n";
