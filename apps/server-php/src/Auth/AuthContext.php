<?php

declare(strict_types=1);

namespace NotionAlt\Auth;

use NotionAlt\Http\HttpError;
use Psr\Http\Message\ServerRequestInterface;

/** The signed-in user of a request (`request.user` and `request.deviceId` in the Node server). */
final class AuthContext
{
    public const ATTRIBUTE = 'notion-alt.auth';

    /**
     * @param array{id: string, email: string, createdAt: string} $user
     */
    public function __construct(
        public readonly array $user,
        /** Device registered with the current session, if any. */
        public readonly ?string $deviceId,
        public readonly string $token,
    ) {}

    public function userId(): string
    {
        return $this->user['id'];
    }

    /** The context set by {@see RequireAuth}; 401 if the route has none. */
    public static function of(ServerRequestInterface $request): self
    {
        $context = $request->getAttribute(self::ATTRIBUTE);
        if (!$context instanceof self) {
            throw new HttpError(401, 'unauthorized', 'Authentication required');
        }

        return $context;
    }
}
