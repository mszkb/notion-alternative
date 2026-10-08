<?php

declare(strict_types=1);

namespace NotionAlt;

use NotionAlt\Attachments\AttachmentRoutes;
use NotionAlt\Attachments\ContentStore;
use NotionAlt\Auth\AuthRoutes;
use NotionAlt\Config\Config;
use NotionAlt\Devices\DeviceRoutes;
use NotionAlt\Health\HealthRoutes;
use NotionAlt\History\HistoryRoutes;
use NotionAlt\Http\ErrorHandler;
use NotionAlt\Http\JsonBodyMiddleware;
use NotionAlt\Http\RequestLogMiddleware;
use NotionAlt\Import\ImportRoutes;
use NotionAlt\Logging\Logger;
use NotionAlt\Search\SearchRoutes;
use NotionAlt\Sync\SyncRoutes;
use NotionAlt\Workspaces\WorkspaceRoutes;
use Slim\App;
use Slim\Interfaces\RouteCollectorProxyInterface;
use Slim\Psr7\Factory\ResponseFactory;

/** Builds the Slim app (counterpart of `buildApp` in apps/server/src/app.ts). */
final class AppFactory
{
    /**
     * @param \Closure(): \PDO              $db    opens the migrated database on first use
     * @param ?ContentStore                 $store attachment contents (default: from the configuration)
     *
     * @return App<null>
     */
    public static function create(Config $config, Logger $logger, \Closure $db, string $basePath = '', ?ContentStore $store = null): App
    {
        $responseFactory = new ResponseFactory();
        $app = new App($responseFactory);
        $app->setBasePath($basePath);

        // Slim runs the middleware added last first: log → errors → routing → body → route.
        $app->add(new JsonBodyMiddleware());
        $app->addRoutingMiddleware();
        $errors = $app->addErrorMiddleware(false, false, false);
        $errors->setDefaultErrorHandler(new ErrorHandler($responseFactory, $logger));
        $app->add(new RequestLogMiddleware($logger));

        // Cheap to build: no I/O until a request needs it.
        $store ??= ContentStore::fromConfig($config->attachments);

        $app->group('/api', /** @param RouteCollectorProxyInterface<null> $api */ static function (RouteCollectorProxyInterface $api) use ($db, $logger, $config, $store): void {
            HealthRoutes::register($api, $db, $logger);
            AuthRoutes::register($api, $db, $config, $logger);
            WorkspaceRoutes::register($api, $db);
            DeviceRoutes::register($api, $db, $logger);
            SyncRoutes::register($api, $db, $config->attachments);
            SearchRoutes::register($api, $db);
            AttachmentRoutes::register($api, $db, $config->attachments, $store);
            HistoryRoutes::register($api, $db);
            ImportRoutes::register($api, $db, $config, $logger);
        });

        return $app;
    }
}
