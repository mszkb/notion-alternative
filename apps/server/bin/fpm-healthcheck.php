<?php

declare(strict_types=1);

// Docker healthcheck of the PHP-FPM container: one FastCGI request for GET /api/health to
// 127.0.0.1:9000 (no cgi-fcgi binary needed). Exit 0 if the app answers 200.

$socket = @stream_socket_client('tcp://127.0.0.1:9000', $errno, $error, 2);
if ($socket === false) {
    exit(1);
}
stream_set_timeout($socket, 2);

$record = static fn(int $type, string $content): string => pack('CCnnCx', 1, $type, 1, \strlen($content), 0) . $content;
$params = '';
foreach ([
    'GATEWAY_INTERFACE' => 'FastCGI/1.0',
    'REQUEST_METHOD' => 'GET',
    'SCRIPT_FILENAME' => dirname(__DIR__) . '/public/index.php',
    'SCRIPT_NAME' => '/index.php',
    'REQUEST_URI' => '/api/health',
    'QUERY_STRING' => '',
    'SERVER_PROTOCOL' => 'HTTP/1.1',
    'REMOTE_ADDR' => '127.0.0.1',
    'SERVER_NAME' => 'localhost',
    'SERVER_PORT' => '80',
] as $name => $value) {
    $params .= chr(\strlen($name)) . chr(\strlen($value)) . $name . $value;
}
// FCGI_BEGIN_REQUEST (role responder), FCGI_PARAMS, empty FCGI_PARAMS, empty FCGI_STDIN.
fwrite($socket, $record(1, pack('nCx5', 1, 0)) . $record(4, $params) . $record(4, '') . $record(5, ''));

$output = '';
while (!feof($socket)) {
    $header = fread($socket, 8);
    if ($header === false || \strlen($header) < 8) {
        break;
    }
    /** @var array{type: int, length: int, padding: int} $fields */
    $fields = unpack('Cversion/Ctype/nid/nlength/Cpadding/Creserved', $header);
    $body = $fields['length'] + $fields['padding'] > 0 ? (string) fread($socket, $fields['length'] + $fields['padding']) : '';
    if ($fields['type'] === 6) {
        $output .= substr($body, 0, $fields['length']);
    } elseif ($fields['type'] === 3) {
        break;
    }
}
fclose($socket);

// No Status header means 200 in FastCGI responses.
$ok = preg_match('/^Status: (\d+)/mi', $output, $match) === 1 ? $match[1] === '200' : str_contains($output, '"status":"ok"');
exit($ok ? 0 : 1);
