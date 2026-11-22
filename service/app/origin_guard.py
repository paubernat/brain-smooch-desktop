"""CSRF guard for the local API: a web page can send a "simple" cross-origin POST to
`http://127.0.0.1:8765` without a CORS preflight, and CORS alone only hides the response.

Every request that can change state (anything but GET/HEAD/OPTIONS) carrying an `Origin`
header is rejected with 403 unless that origin is the local web itself
(`http://127.0.0.1:<port>`, `http://localhost:<port>`) or the extension (`moz-extension://`).
Requests without `Origin` (curl, PowerShell, the installer) are not browser cross-site
requests and stay allowed.
"""

import json

from starlette.types import ASGIApp, Receive, Scope, Send

SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})
EXTENSION_SCHEME = "moz-extension://"


def allowed_origins(port: int) -> frozenset[str]:
    return frozenset({f"http://127.0.0.1:{port}", f"http://localhost:{port}"})


def origin_allowed(origin: str, port: int) -> bool:
    origin = origin.strip().rstrip("/").lower()
    return origin.startswith(EXTENSION_SCHEME) or origin in allowed_origins(port)


class OriginGuardMiddleware:
    def __init__(self, app: ASGIApp, *, port: int) -> None:
        self.app = app
        self.port = port

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "http" and scope["method"].upper() not in SAFE_METHODS:
            origin = next(
                (value.decode("latin-1") for name, value in scope["headers"] if name == b"origin"),
                None,
            )
            if origin is not None and not origin_allowed(origin, self.port):
                body = json.dumps({"detail": f"origin not allowed: {origin}"}).encode()
                await send(
                    {
                        "type": "http.response.start",
                        "status": 403,
                        "headers": [
                            (b"content-type", b"application/json"),
                            (b"content-length", str(len(body)).encode()),
                        ],
                    }
                )
                await send({"type": "http.response.body", "body": body})
                return
        await self.app(scope, receive, send)
