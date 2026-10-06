<?php

declare(strict_types=1);

namespace NotionAlt;

use NotionAlt\Config\ConfigLoader;
use NotionAlt\Database\DatabaseProvider;
use NotionAlt\Http\BasePath;
use NotionAlt\Http\Json;
use NotionAlt\Logging\Logger;

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
        AppFactory::create($config, $logger, $database->get(...), BasePath::detect($_SERVER))->run();
    }
}
