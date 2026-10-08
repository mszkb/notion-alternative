<?php

// Setup check of the shared-hosting package (#128): open https://<host>/api/check.php after the
// upload. Shows only yes/no results, no paths or values from the configuration. Delete the file
// once everything is green; once an account exists it shows nothing but that hint (404).
// Written without PHP 8 syntax, so it also explains an outdated PHP.

declare(strict_types=1);

$checks = [];

/**
 * @param list<array{string, bool, string}> $checks
 */
function notionAltCheck(array &$checks, string $label, bool $ok, string $hint = ''): void
{
    $checks[] = [$label, $ok, $hint];
}

function notionAltBytes(string $value): int
{
    $number = (int) $value;
    $unit = strtolower(substr(trim($value), -1));
    if ($unit === 'g') {
        return $number * 1024 * 1024 * 1024;
    }
    if ($unit === 'm') {
        return $number * 1024 * 1024;
    }

    return $unit === 'k' ? $number * 1024 : $number;
}

$modernPhp = version_compare(PHP_VERSION, '8.2.0', '>=');
notionAltCheck($checks, 'PHP 8.2 oder neuer', $modernPhp, 'In der Verwaltung des Hosters die PHP-Version umstellen.');
foreach (['pdo_sqlite', 'mbstring', 'json', 'openssl', 'sodium', 'curl'] as $extension) {
    notionAltCheck($checks, "PHP-Erweiterung {$extension}", extension_loaded($extension), 'Beim Hoster aktivieren lassen.');
}
$autoload = __DIR__ . '/app/vendor/autoload.php';
notionAltCheck($checks, 'Programmdateien vollständig (app/vendor)', is_file($autoload), 'Das Paket vollständig hochladen.');

$config = null;
if ($modernPhp && is_file($autoload)) {
    require $autoload;
    try {
        NotionAlt\Database\Database::assertFts5();
        notionAltCheck($checks, 'SQLite mit Volltextsuche (FTS5)', true);
    } catch (Throwable $error) {
        notionAltCheck($checks, 'SQLite mit Volltextsuche (FTS5)', false, 'Diese PHP-Installation hat SQLite ohne FTS5; den Hoster fragen.');
    }
    try {
        $config = NotionAlt\Config\ConfigLoader::fromEnvironment(__DIR__ . '/app');
        notionAltCheck($checks, 'Konfiguration gültig (app/config.php)', true);
    } catch (Throwable $error) {
        notionAltCheck($checks, 'Konfiguration gültig (app/config.php)', false, 'Die Werte in app/config.php prüfen (siehe config.example.php).');
    }
}
if ($config !== null && is_file($config->databasePath)) {
    try {
        $existing = NotionAlt\Database\Database::open($config->databasePath);
        $users = $existing->query('select count(*) from users');
        $setUp = $users !== false && (int) $users->fetchColumn() > 0;
    } catch (Throwable $error) {
        $setUp = false;
    }
    if ($setUp) {
        // In use: no details for anonymous visitors.
        http_response_code(404);
        header('Content-Type: text/plain; charset=utf-8');
        header('Cache-Control: no-store');
        echo "Die Einrichtung ist abgeschlossen. Bitte api/check.php löschen.\n";

        exit;
    }
}
if ($config !== null) {
    $dataDir = dirname($config->databasePath);
    $writable = (is_dir($dataDir) || @mkdir($dataDir, 0770, true)) && is_writable($dataDir);
    notionAltCheck($checks, 'Datenverzeichnis beschreibbar', $writable, 'DATA_DIR anlegen und dem Webserver Schreibrechte geben.');
    $documentRoot = $_SERVER['DOCUMENT_ROOT'] ?? '';
    $root = is_string($documentRoot) && $documentRoot !== '' ? realpath($documentRoot) : false;
    $data = realpath($dataDir);
    $outside = $root === false || $data === false || strpos($data . '/', rtrim($root, '/') . '/') !== 0;
    notionAltCheck($checks, 'Datenverzeichnis außerhalb des Webroots', $outside, 'DATA_DIR in app/config.php auf einen Ordner außerhalb von public_html/htdocs setzen.');
    notionAltCheck($checks, 'Sichere Cookies (COOKIE_SECURE)', $config->cookieSecure, 'Für HTTPS COOKIE_SECURE auf true setzen.');
    $limit = (string) ini_get('memory_limit');
    $memory = $limit === '-1' ? PHP_INT_MAX : notionAltBytes($limit);
    notionAltCheck(
        $checks,
        'Speicherlimit reicht für Anhänge und Importe',
        $memory >= 4 * max($config->attachments->maxBytes, intdiv($config->importMaxBytes, 2)),
        'memory_limit erhöhen oder ATTACHMENT_MAX_MB/IMPORT_MAX_MB senken.',
    );
}

header('Content-Type: text/html; charset=utf-8');
header('Cache-Control: no-store');
$allOk = true;
foreach ($checks as $check) {
    $allOk = $allOk && $check[1];
}
?>
<!doctype html>
<html lang="de">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Einrichtung prüfen</title></head>
<body>
<h1>Einrichtung prüfen</h1>
<p><?= $allOk ? 'Alles bereit. Diese Datei (api/check.php) jetzt löschen und die App öffnen.' : 'Noch nicht alles bereit:' ?></p>
<ul>
<?php foreach ($checks as $check) { ?>
<li><?= $check[1] ? '✅' : '❌' ?> <?= htmlspecialchars($check[0]) ?><?= $check[1] || $check[2] === '' ? '' : ' – ' . htmlspecialchars($check[2]) ?></li>
<?php } ?>
</ul>
<p>Außerdem: <a href="health">/api/health</a> muss <code>{"status":"ok"}</code> zeigen (sonst fehlt mod_rewrite), und der Cron-Eintrag <code>php …/api/app/bin/cron.php</code> alle 5 Minuten.</p>
</body>
</html>
