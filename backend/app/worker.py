"""SQS worker entry point for transcript reconciliation.

The API Lambda only enqueues; this worker performs Bedrock extraction and
proposal generation so transcript analysis never blocks a user request.
"""

from __future__ import annotations

import json
import logging

from app.services.ai import process_transcript_job

logger = logging.getLogger("standup.worker")
logging.basicConfig(level=logging.INFO)


def handler(event: dict, _context=None) -> dict:
    processed = 0
    failed = 0
    for record in event.get("Records", []):
        try:
            body = json.loads(record.get("body", "{}"))
            transcript_id = body.get("transcript_id")
            if not transcript_id:
                logger.warning("Skipping SQS record without transcript_id")
                continue
            process_transcript_job(transcript_id)
            processed += 1
        except Exception:  # let SQS redrive/DLQ handle it
            failed += 1
            logger.exception("Transcript job failed")
    if failed:
        # Raising lets SQS redrive the message (and eventually land it in the DLQ).
        raise RuntimeError(f"{failed} transcript job(s) failed")
    return {"processed": processed, "failed": failed}
