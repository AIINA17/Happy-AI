from ecommerce_sources import ECOMMERCE_SOURCES

from agent.adapters.base import EcommerceAdapter

ADAPTERS: dict[str, EcommerceAdapter] = {
    key: EcommerceAdapter(source=key, label=cfg["label"], base_url=cfg["base_url"])
    for key, cfg in ECOMMERCE_SOURCES.items()
}


def get_adapter(source: str) -> EcommerceAdapter | None:
    return ADAPTERS.get(source)


def list_sources() -> list[str]:
    return list(ADAPTERS.keys())
