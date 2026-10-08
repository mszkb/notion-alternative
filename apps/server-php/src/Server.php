<?php

declare(strict_types=1);

namespace NotionAlt;

use NotionAlt\Config\ConfigLoader;
use NotionAlt\Database\DatabaseProvider;
use NotionAlt\Http\AfterResponse;
use NotionAlt\Http\BasePath;
use NotionAlt\Http\Json;
use NotionAlt\Logging\Logger;
use Slim\Factory\ServerRequestCreatorFactory;
use Slim\ResponseEmitter;

/** Entry point of `public/index.php`: configuration, database, app, one request. */
final class Server
{
    public static function run(string $appDir): void
    {
        try {
            $config = ConfigLoader::fromEnvironment($appDir);
        } catch (\Throwable $error) {
            // Without a valid configuration nothing works; the message names variables, not values.
            (new Logger('info'))->log('fatal', 'invalid configuration', ['err' => Logger::serializeError($error)]);
            http_response_code(500);
            header('Content-Type: application/json; charset=utf-8');
            echo Json::encode(['error' => ['code' => 'internal', 'message' => 'Internal server error']]);

            return;
        }
        $logger = new Logger($config->logLevel);
        $database = new DatabaseProvider($config->databasePath, $logger);
        $after = new AfterResponse();
        $app = AppFactory::create($config, $logger, $database->get(...), BasePath::detect($_SERVER), after: $after);
        $response = $app->handle(ServerRequestCreatorFactory::create()->createServerRequestFromGlobals());
        if ($after->pending()) {
            // The client must not wait for the work after the response (no `Connection: close` wait).
            $size = $response->getBody()->getSize();
            if ($size !== null && !$response->hasHeader('Content-Length') && !\in_array($response->getStatusCode(), [204, 304], true)) {
                $response = $response->withHeader('Content-Length', (string) $size);
            }
        }
        (new ResponseEmitter())->emit($response);
        $after->run($logger);
    }
}
