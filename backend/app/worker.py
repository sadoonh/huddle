"""Retired transcript worker entry point.

Transcript review/processing is no longer an active product surface. The queue
event source mapping is disabled by default in Terraform (`count = 0`) and this
handler deliberately does not process or delete messages, so retained queued
data is left for an explicit retention decision.
"""

from __future__ import annotations

import logging

logger = logging.getLogger("standup.worker")
logging.basicConfig(level=logging.INFO)


def handler(event: dict, _context=None) -> dict:
    records = event.get("Records", [])
    logger.warning(
        "Transcript processing is retired; ignoring %d queued message(s) without deleting them.",
        len(records),
    )
    return {"processed": 0, "ignored": len(records)}
