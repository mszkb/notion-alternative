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
use NotionAlt\Http\AfterResponse;
use NotionAlt\Http\ErrorHandler;
use NotionAlt\Http\JsonBodyMiddleware;
use NotionAlt\Http\RequestLogMiddleware;
use NotionAlt\Import\ImportRoutes;
use NotionAlt\Logging\Logger;
use NotionAlt\Metrics\Metrics;
use NotionAlt\Metrics\MetricsMiddleware;
use NotionAlt\Metrics\MetricsRoutes;
use NotionAlt\Push\PushRoutes;
use NotionAlt\Search\SearchRoutes;
use NotionAlt\Sharing\ShareLinkRoutes;
use NotionAlt\Sync\SyncRoutes;
use NotionAlt\Workspaces\MemberRoutes;
use NotionAlt\Workspaces\WorkspaceRoutes;
use Slim\App;
use Slim\Interfaces\RouteCollectorProxyInterface;
use Slim\Psr7\Factory\ResponseFactory;

/** Builds the Slim app: middleware and all routes below `/api`. */
final class AppFactory
{
    /**
     * @param \Closure(): \PDO              $db    opens the migrated database on first use
     * @param ?ContentStore                 $store attachment contents (default: from the configuration)
     * @param ?AfterResponse                $after work after the response (default: none is run)
     *
     * @return App<null>
     */
    public static function create(Config $config, Logger $logger, \Closure $db, string $basePath = '', ?ContentStore $store = null, ?AfterResponse $after = null): App
    {
        $responseFactory = new ResponseFactory();
        $app = new App($responseFactory);
        $app->setBasePath($basePath);
        // Cheap to build: no I/O until a request needs it.
        $store ??= ContentStore::fromConfig($config->attachments);
        $after ??= new AfterResponse();

        // Slim runs the middleware added last first: log → metrics → errors → routing → body →
        // metrics (route template) → route.
        $metrics = new Metrics($config->metricsEnabled, $db, $config->databasePath, $logger);
        $app->add(new MetricsMiddleware($metrics, $after, inner: true));
        $app->add(new JsonBodyMiddleware());
        $app->addRoutingMiddleware();
        $errors = $app->addErrorMiddleware(false, false, false);
        $errors->setDefaultErrorHandler(new ErrorHandler($responseFactory, $logger));
        $app->add(new MetricsMiddleware($metrics, $after));
        $app->add(new RequestLogMiddleware($logger));


        $app->group('/api', /** @param RouteCollectorProxyInterface<null> $api */ static function (RouteCollectorProxyInterface $api) use ($db, $logger, $config, $store, $after, $metrics): void {
            HealthRoutes::register($api, $db, $logger);
            AuthRoutes::register($api, $db, $config, $logger);
            WorkspaceRoutes::register($api, $db);
            MemberRoutes::register($api, $db);
            DeviceRoutes::register($api, $db, $logger);
            if ($config->metricsEnabled) {
                MetricsRoutes::register($api, $metrics);
            }
            SyncRoutes::register($api, $db, $config->attachments, $config->push, $after, $metrics);
            SearchRoutes::register($api, $db);
            AttachmentRoutes::register($api, $db, $config->attachments, $store);
            HistoryRoutes::register($api, $db);
            PushRoutes::register($api, $db, $config->push);
            ImportRoutes::register($api, $db, $config, $logger);
            ShareLinkRoutes::register($api, $db, $config, $store);
        });

        return $app;
    }
}
