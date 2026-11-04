"""Discover and provision the Pipecat Assist app through Supervisor."""

from __future__ import annotations

import re
from typing import Any

import aiohttp

APP_REPOSITORY = "https://github.com/kyvaith/pipecat-homeassistant"
APP_SLUG = "pipecat_assist"
APP_LEGACY_SLUG = "pipecat_assist_legacy_amd64"
APP_ACTIVE_STATES = {"started", "startup"}
_SLUG_PATTERN = re.compile(r"[a-z0-9_]+")


class SupervisorError(Exception):
    """Supervisor rejected a request or returned unusable data."""


class SupervisorApps:
    """Access Supervisor with the credentials provided to Home Assistant Core."""

    def __init__(self, session: aiohttp.ClientSession, url: str, token: str) -> None:
        self._session = session
        self._url = url.rstrip("/")
        self._headers = {"Authorization": f"Bearer {token}"}

    async def _request(
        self,
        method: str,
        path: str,
        *,
        body: dict[str, Any] | None = None,
        timeout: float = 10,
    ) -> Any:
        try:
            async with self._session.request(
                method,
                f"{self._url}{path}",
                headers=self._headers,
                json=body,
                timeout=aiohttp.ClientTimeout(total=timeout),
                allow_redirects=False,
            ) as response:
                if 200 <= response.status < 300:
                    payload = await response.json()
                    if isinstance(payload, dict) and payload.get("result") == "ok":
                        return payload.get("data")
                    raise SupervisorError(f"{method} {path}: invalid response")
                raise SupervisorError(f"{method} {path}: HTTP {response.status}")
        except (TimeoutError, aiohttp.ClientError, ValueError) as err:
            raise SupervisorError(f"{method} {path}: {type(err).__name__}") from err

    async def installed_app(self) -> dict[str, Any] | None:
        """Return an installed Pipecat app, preferring a running instance."""
        payload = await self._request("GET", "/addons")
        addons = payload.get("addons") if isinstance(payload, dict) else None
        if not isinstance(addons, list):
            raise SupervisorError("Invalid installed app list")

        candidates = [
            app
            for app in addons
            if isinstance(app, dict) and _is_pipecat_slug(app.get("slug"))
        ]
        return min(
            candidates,
            key=lambda app: (
                app.get("state") not in APP_ACTIVE_STATES,
                not app["slug"].endswith(f"_{APP_SLUG}"),
            ),
            default=None,
        )

    async def app_info(self, slug: str) -> dict[str, Any]:
        """Get the installed app's state, hostname, and port options."""
        payload = await self._request("GET", f"/addons/{slug}/info")
        if not isinstance(payload, dict):
            raise SupervisorError("Invalid installed app details")
        return {**payload, "slug": slug}

    async def install_app(self) -> str:
        """Register the official source if needed and install its main app."""
        store = await self._store()
        repository = _repository_slug(store)
        if repository is None:
            await self._request(
                "POST",
                "/store/repositories",
                body={"repository": APP_REPOSITORY},
                timeout=120,
            )
            store = await self._store()
            repository = _repository_slug(store)
        if repository is None:
            raise SupervisorError(
                "Pipecat Assist repository is not available in the app store"
            )

        slug = f"{repository}_{APP_SLUG}"
        app = next(
            (
                item
                for item in store["addons"]
                if isinstance(item, dict) and item.get("slug") == slug
            ),
            None,
        )
        if app is None or app.get("repository") != repository:
            raise SupervisorError("Pipecat Assist is missing from its app repository")
        if not app.get("installed"):
            await self._request("GET", f"/store/addons/{slug}/availability")
            await self._request("POST", f"/store/addons/{slug}/install", timeout=600)
        return slug

    async def start_app(self, slug: str) -> None:
        """Start the installed app without modifying its options."""
        await self._request("POST", f"/addons/{slug}/start", timeout=120)

    async def _store(self) -> dict[str, Any]:
        payload = await self._request("GET", "/store")
        if not isinstance(payload, dict) or not all(
            isinstance(payload.get(key), list) for key in ("repositories", "addons")
        ):
            raise SupervisorError("Invalid app store data")
        return payload


def _is_pipecat_slug(slug: Any) -> bool:
    return (
        isinstance(slug, str)
        and bool(_SLUG_PATTERN.fullmatch(slug))
        and (
            slug in (APP_SLUG, APP_LEGACY_SLUG)
            or slug.endswith((f"_{APP_SLUG}", f"_{APP_LEGACY_SLUG}"))
        )
    )


def _repository_slug(store: dict[str, Any]) -> str | None:
    for repo in store["repositories"]:
        if not isinstance(repo, dict):
            continue
        source = str(repo.get("source", "")).rstrip("/").removesuffix(".git")
        slug = repo.get("slug")
        if (
            source == APP_REPOSITORY
            and isinstance(slug, str)
            and _SLUG_PATTERN.fullmatch(slug)
        ):
            return slug
    return None
