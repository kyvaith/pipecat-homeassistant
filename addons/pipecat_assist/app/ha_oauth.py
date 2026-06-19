"""Home Assistant OAuth helpers for MCP access."""

from __future__ import annotations

import secrets
import time
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlencode, urljoin

import httpx

from app.config import ConfigStore, IntegrationConfig

OAUTH_STATES: dict[str, "OAuthState"] = {}
STATE_TTL_SECONDS = 600


@dataclass
class OAuthState:
    client_id: str
    redirect_uri: str
    token_url: str
    fallback_token_url: str
    created_at: float


def _default_token_url(mcp_url: str, ha_url: str) -> str:
    del mcp_url
    return urljoin(ha_url.rstrip("/") + "/", "auth/token")


def _prune_states() -> None:
    now = time.time()
    expired = [state for state, value in OAUTH_STATES.items() if now - value.created_at > STATE_TTL_SECONDS]
    for state in expired:
        OAUTH_STATES.pop(state, None)


def build_authorize_url(
    *,
    authorize_url: str,
    client_id: str,
    redirect_uri: str,
    token_url: str,
) -> str:
    """Create a Home Assistant OAuth authorize URL and remember state."""

    _prune_states()
    state = secrets.token_urlsafe(24)
    OAUTH_STATES[state] = OAuthState(
        client_id=client_id,
        redirect_uri=redirect_uri,
        token_url=token_url,
        fallback_token_url=urljoin(authorize_url, "token"),
        created_at=time.time(),
    )
    query = urlencode(
        {
            "response_type": "code",
            "client_id": client_id,
            "redirect_uri": redirect_uri,
            "state": state,
        }
    )
    separator = "&" if "?" in authorize_url else "?"
    return f"{authorize_url}{separator}{query}"


async def exchange_code(store: ConfigStore, *, code: str, state: str) -> None:
    """Exchange an OAuth authorization code and persist MCP tokens."""

    _prune_states()
    oauth_state = OAUTH_STATES.pop(state, None)
    if not oauth_state:
        raise RuntimeError("OAuth state expired. Start the Home Assistant OAuth flow again.")

    form = {
        "grant_type": "authorization_code",
        "code": code,
        "client_id": oauth_state.client_id,
    }
    async with httpx.AsyncClient(timeout=20.0, follow_redirects=True) as client:
        used_token_url = oauth_state.token_url
        response = await _post_token(client, oauth_state.token_url, form)
        if (
            response.status_code in {401, 403, 404, 405, 502, 503}
            and oauth_state.fallback_token_url
            and oauth_state.fallback_token_url != oauth_state.token_url
        ):
            used_token_url = oauth_state.fallback_token_url
            response = await _post_token(client, used_token_url, form)
    if response.status_code >= 400:
        raise RuntimeError(f"Home Assistant OAuth token exchange failed: HTTP {response.status_code} {response.text}")

    payload = response.json()
    _save_oauth_payload(
        store,
        mcp_integration=store.load().mcp_integration,
        payload=payload,
        client_id=oauth_state.client_id,
        token_url=used_token_url,
    )


async def resolve_mcp_token(store: ConfigStore) -> str:
    """Return a usable MCP token, refreshing OAuth access tokens when needed."""

    config = store.load()
    integration = config.mcp_integration
    if not integration or not integration.oauth_refresh_token:
        return config.fallback_mcp_token

    if integration.oauth_access_token and integration.oauth_expires_at > time.time() + 90:
        return integration.oauth_access_token

    if not integration.oauth_client_id or not integration.oauth_token_url:
        return config.fallback_mcp_token

    payload = await _refresh_oauth_token(integration)
    _save_oauth_payload(
        store,
        mcp_integration=integration,
        payload=payload,
        client_id=integration.oauth_client_id,
        token_url=integration.oauth_token_url,
    )
    return store.load().mcp_integration.oauth_access_token


def clear_oauth(store: ConfigStore) -> None:
    """Remove saved OAuth tokens from the Home Assistant MCP integration."""

    config = store.load()
    integration = config.mcp_integration
    if not integration:
        return
    integration.oauth_access_token = ""
    integration.oauth_refresh_token = ""
    integration.oauth_expires_at = 0
    integration.oauth_client_id = ""
    integration.oauth_token_url = ""
    store.save(config)


def oauth_token_url_for_store(store: ConfigStore, ha_url: str, token_url: str = "") -> str:
    """Return the token URL that should be used for the current add-on context."""

    config = store.load()
    return token_url or _default_token_url(config.effective_mcp_url, ha_url)


async def _refresh_oauth_token(integration: IntegrationConfig) -> dict[str, Any]:
    async with httpx.AsyncClient(timeout=20.0, follow_redirects=True) as client:
        response = await _post_token(
            client,
            integration.oauth_token_url,
            {
                "grant_type": "refresh_token",
                "refresh_token": integration.oauth_refresh_token,
                "client_id": integration.oauth_client_id,
            },
        )
    if response.status_code >= 400:
        raise RuntimeError(f"Home Assistant OAuth refresh failed: HTTP {response.status_code} {response.text}")
    return response.json()


async def _post_token(
    client: httpx.AsyncClient,
    token_url: str,
    data: dict[str, str],
) -> httpx.Response:
    return await client.post(
        token_url,
        data=data,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )


def _save_oauth_payload(
    store: ConfigStore,
    *,
    mcp_integration: IntegrationConfig | None,
    payload: dict[str, Any],
    client_id: str,
    token_url: str,
) -> None:
    if not mcp_integration:
        raise RuntimeError("Home Assistant MCP integration is not configured")

    config = store.load()
    integration = config.mcp_integration
    if not integration:
        raise RuntimeError("Home Assistant MCP integration is not configured")

    access_token = str(payload.get("access_token") or "")
    refresh_token = str(payload.get("refresh_token") or integration.oauth_refresh_token or "")
    expires_in = int(payload.get("expires_in") or 1800)
    if not access_token:
        raise RuntimeError("Home Assistant OAuth response did not include an access token")
    if not refresh_token:
        raise RuntimeError("Home Assistant OAuth response did not include a refresh token")

    integration.oauth_access_token = access_token
    integration.oauth_refresh_token = refresh_token
    integration.oauth_expires_at = time.time() + max(expires_in - 30, 60)
    integration.oauth_client_id = client_id
    integration.oauth_token_url = token_url
    store.save(config)
