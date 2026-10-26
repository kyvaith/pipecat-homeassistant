"""Resolve OpenAI endpoints without leaking cloud credentials to local servers."""

from urllib.parse import urlsplit, urlunsplit

from app.config import IntegrationConfig

OPENAI_REALTIME_URL = "wss://api.openai.com/v1/realtime"
LOCAL_API_KEY_PLACEHOLDER = "not-needed"


def openai_base_url(integration: IntegrationConfig | None) -> str:
    if not integration or integration.kind not in {"openai", "openai_cloud"}:
        return ""
    return integration.base_url.strip().rstrip("/")


def openai_realtime_url(integration: IntegrationConfig | None) -> str:
    base = openai_base_url(integration)
    if not base:
        return OPENAI_REALTIME_URL
    parsed = urlsplit(base)
    scheme = {"http": "ws", "https": "wss"}.get(parsed.scheme, parsed.scheme)
    path = parsed.path.rstrip("/")
    if not path.endswith("/realtime"):
        path += "/realtime"
    return urlunsplit((scheme, parsed.netloc, path, parsed.query, ""))


def openai_api_key(
    integration: IntegrationConfig, role: str, fallback: str = ""
) -> str:
    key = integration.api_key.strip()
    if openai_base_url(integration):
        return key or LOCAL_API_KEY_PLACEHOLDER
    key = key or fallback.strip()
    if not key:
        raise RuntimeError(f"{integration.name} is missing api_key for {role}")
    return key
