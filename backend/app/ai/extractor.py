"""Transcript extraction interface.

``MockExtractor`` is deterministic and dependency-free; it exists so the whole
reconciliation workflow (proposal -> review -> apply) can be exercised in tests
and local demos without calling a model.

``BedrockExtractor`` calls Amazon Bedrock with a strict JSON contract. It is
only selected when ``AI_PROVIDER=bedrock``.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from typing import Any, Protocol

from app.config import get_settings
from app.enums import ProposalOperation, TargetType


@dataclass
class ExtractedProposal:
    operation: ProposalOperation
    target_type: TargetType
    payload: dict[str, Any]
    evidence_excerpt: str
    target_id: str | None = None
    speaker: str | None = None
    spoken_at: str | None = None
    confidence: float = 0.6
    is_ambiguous: bool = False


@dataclass
class ExtractionResult:
    proposals: list[ExtractedProposal] = field(default_factory=list)
    model: str = "mock"


class TranscriptExtractor(Protocol):
    def extract(self, transcript: str, context: dict[str, Any]) -> ExtractionResult: ...


_LINE_RE = re.compile(
    r"^(?:\[(?P<ts>[\d:\.]+)\]\s*)?(?P<speaker>[A-Z][\w .'\-]{1,60}?):\s*(?P<text>.+)$"
)
_STOPWORDS = {
    "the", "and", "for", "with", "that", "this", "from", "into", "have", "has",
    "was", "were", "will", "would", "should", "about", "your", "our", "their",
    "task", "work", "done", "next", "today", "yesterday", "need", "needs", "also",
    "just", "then", "than", "them", "they", "been", "being", "some", "more",
}


def _tokens(text: str) -> set[str]:
    return {
        token
        for token in re.findall(r"[a-z0-9_]{3,}", text.lower())
        if token not in _STOPWORDS
    }


def similarity(a: str, b: str) -> float:
    """Token Jaccard similarity in [0, 1]; used for duplicate detection."""
    left, right = _tokens(a), _tokens(b)
    if not left or not right:
        return 0.0
    return len(left & right) / len(left | right)


def _match_task(text: str, tasks: list[dict]) -> tuple[dict | None, float, bool]:
    lowered = text.lower()
    scored: list[tuple[float, dict]] = []
    text_tokens = _tokens(text)
    for task in tasks:
        score = 0.0
        if task["id"].lower() in lowered or task["id"][:8].lower() in lowered:
            score = 100.0
        title_tokens = _tokens(task["title"])
        if title_tokens:
            overlap = len(title_tokens & text_tokens) / len(title_tokens)
            score += overlap * 10
        assignee = (task.get("assignee") or "").lower()
        if assignee and assignee in lowered:
            score += 2
        if score > 0:
            scored.append((score, task))
    if not scored:
        return None, 0.0, True
    scored.sort(key=lambda pair: pair[0], reverse=True)
    best_score, best = scored[0]
    ambiguous = len(scored) > 1 and scored[1][0] == best_score
    # A weak lexical overlap is ambiguous, not an automatic match.
    if best_score < 3:
        ambiguous = True
    return best, best_score, ambiguous


def _strip_prefix(text: str, patterns: list[str]) -> str:
    for pattern in patterns:
        match = re.search(pattern, text, flags=re.IGNORECASE)
        if match:
            return text[match.end() :].strip(" .,-")
    return text.strip()


def _next_steps(text: str) -> str | None:
    match = re.search(
        r"\b(?:next|then|after that|tomorrow|afterwards)\b[:,]?\s*(.+)",
        text,
        flags=re.IGNORECASE,
    )
    return match.group(1).strip(" .") if match else None


class MockExtractor:
    """Deterministic heuristic extractor for demos and tests."""

    def extract(self, transcript: str, context: dict[str, Any]) -> ExtractionResult:
        tasks = context.get("tasks", [])
        blockers = context.get("blockers", [])
        participants = context.get("participants", [])
        proposals: list[ExtractedProposal] = []

        for raw_line in transcript.splitlines():
            line = raw_line.strip()
            if not line:
                continue
            match = _LINE_RE.match(line)
            if match:
                speaker = match.group("speaker").strip()
                spoken_at = match.group("ts")
                text = match.group("text").strip()
            else:
                speaker, spoken_at, text = None, None, line
            lowered = text.lower()
            if len(text) < 8:
                continue

            task, score, ambiguous = _match_task(text, tasks)
            task_id = task["id"] if task else None
            confidence = 0.9 if score >= 10 else (0.65 if score >= 3 else 0.4)

            is_blocker = bool(
                re.search(
                    r"\b(blocked|blocker|blocking|waiting on|can't|cannot|no access|need access|"
                    r"requires access)\b",
                    lowered,
                )
            )
            is_resolved = bool(
                re.search(r"\b(resolved|unblocked|no longer blocked|fixed the blocker)\b", lowered)
            )
            is_decision = bool(
                re.search(
                    r"\b(decision|decided|we agreed|we will|we're going to|"
                    r"we are going to|we won't)\b",
                    lowered,
                )
            )
            is_action = bool(
                re.search(
                    r"\b(action item|follow[\s-]?up|"
                    r"i'll (send|review|confirm|prepare|follow|check|share|own)|"
                    r"i will (send|review|confirm|prepare|follow|check|share|own)|"
                    r"will (send|review|confirm|prepare|follow|share)|"
                    r"to (send|review|confirm|prepare|follow|share))\b",
                    lowered,
                )
            )
            status = None
            if re.search(r"\b(canceled|cancelled)\b", lowered):
                status = "canceled"
            elif re.search(r"\b(finished|completed|done|shipped|merged|closed)\b", lowered):
                status = "done"
            elif re.search(
                r"\b(started|in progress|working on|moving to|moved to|picked up|began)\b",
                lowered,
            ):
                status = "in_progress"
            elif re.search(r"\b(not started|backlog|planned for)\b", lowered):
                status = "backlog"

            # 1. Blockers first: "finished X but blocked on Y" is two operations.
            if is_blocker and not is_resolved:
                description = _strip_prefix(
                    text,
                    [
                        r".*?\bblocked (?:on|by)\b",
                        r".*?\bblocker (?:is|was)\b",
                        r".*?\bwaiting on\b",
                    ],
                )
                proposals.append(
                    ExtractedProposal(
                        operation=ProposalOperation.CREATE_BLOCKER,
                        target_type=TargetType.TASK,
                        target_id=task_id,
                        payload={
                            "description": description or text,
                            "owner_id": None,
                        },
                        evidence_excerpt=text,
                        speaker=speaker,
                        spoken_at=spoken_at,
                        confidence=confidence,
                        is_ambiguous=ambiguous,
                    )
                )
            elif is_resolved:
                blocker = _match_blocker(text, blockers, task_id)
                proposals.append(
                    ExtractedProposal(
                        operation=ProposalOperation.RESOLVE_BLOCKER,
                        target_type=TargetType.BLOCKER,
                        target_id=blocker["id"] if blocker else None,
                        payload={
                            "resolution_details": text,
                            "blocker_id": blocker["id"] if blocker else None,
                        },
                        evidence_excerpt=text,
                        speaker=speaker,
                        spoken_at=spoken_at,
                        confidence=confidence if blocker else 0.4,
                        is_ambiguous=blocker is None,
                    )
                )

            # 2. Decisions (may be task-scoped or session-scoped).
            if is_decision:
                description = _strip_prefix(
                    text,
                    [
                        r".*?\bdecision\s*[:\-]?\s*",
                        r".*?\bdecided (?:to|that)\b",
                        r".*?\bwe agreed (?:to|that)\b",
                    ],
                )
                proposals.append(
                    ExtractedProposal(
                        operation=ProposalOperation.RECORD_DECISION,
                        target_type=TargetType.TASK if task_id else TargetType.SESSION,
                        target_id=task_id,
                        payload={
                            "description": description or text,
                            "rationale": None,
                        },
                        evidence_excerpt=text,
                        speaker=speaker,
                        spoken_at=spoken_at,
                        confidence=0.8,
                        is_ambiguous=False,
                    )
                )

            # 3. Action items.
            if is_action and not is_decision:
                description = _strip_prefix(
                    text,
                    [
                        r".*?\baction item\s*[:\-]?\s*",
                        r".*?\bfollow[\s-]?up\s*[:\-]?\s*",
                        r"^i'll\s+",
                        r"^i will\s+",
                    ],
                )
                owner_id = None
                for participant in participants:
                    if participant["name"].lower() in lowered:
                        owner_id = participant["id"]
                        break
                if owner_id is None and re.search(r"^i'll|^i will", lowered):
                    owner_id = _speaker_id(speaker, participants)
                proposals.append(
                    ExtractedProposal(
                        operation=ProposalOperation.CREATE_ACTION_ITEM,
                        target_type=TargetType.TASK if task_id else TargetType.SESSION,
                        target_id=task_id,
                        payload={
                            "description": description or text,
                            "owner_id": owner_id,
                            "due_date": None,
                        },
                        evidence_excerpt=text,
                        speaker=speaker,
                        spoken_at=spoken_at,
                        confidence=0.75,
                        is_ambiguous=False,
                    )
                )

            # 4. Status change + progress update.
            if status and task_id:
                proposals.append(
                    ExtractedProposal(
                        operation=ProposalOperation.UPDATE_TASK_STATUS,
                        target_type=TargetType.TASK,
                        target_id=task_id,
                        payload={"status": status},
                        evidence_excerpt=text,
                        speaker=speaker,
                        spoken_at=spoken_at,
                        confidence=confidence,
                        is_ambiguous=ambiguous,
                    )
                )
            progress_signal = bool(
                re.search(
                    r"\b(finished|completed|started|working on|in progress|done|shipped|"
                    r"merged|validated|published|built)\b",
                    lowered,
                )
            )
            if (
                not progress_signal
                and not is_decision
                and re.search(r"\b(yesterday|since|next)\b", lowered)
            ):
                progress_signal = True
            if task_id and progress_signal and not is_decision:
                proposals.append(
                    ExtractedProposal(
                        operation=ProposalOperation.ADD_PROGRESS_UPDATE,
                        target_type=TargetType.TASK,
                        target_id=task_id,
                        payload={
                            "progress": text,
                            "next_steps": _next_steps(text),
                            "attributed_to_user_id": _speaker_id(speaker, participants),
                        },
                        evidence_excerpt=text,
                        speaker=speaker,
                        spoken_at=spoken_at,
                        confidence=confidence,
                        is_ambiguous=ambiguous,
                    )
                )

        # Keep deterministic order and cap noise.
        return ExtractionResult(proposals=proposals[:60], model="mock-heuristic")


def _speaker_id(speaker: str | None, participants: list[dict]) -> str | None:
    if not speaker:
        return None
    for participant in participants:
        if participant["name"].lower() == speaker.lower():
            return participant["id"]
    return None


def _match_blocker(text: str, blockers: list[dict], task_id: str | None) -> dict | None:
    candidates = [b for b in blockers if not task_id or b.get("task_id") == task_id]
    if not candidates:
        candidates = blockers
    best, best_score = None, 0.0
    for blocker in candidates:
        score = similarity(text, blocker["description"])
        if score > best_score:
            best, best_score = blocker, score
    return best if best_score >= 0.25 else None


class BedrockExtractor:
    """Amazon Bedrock implementation using the Converse API."""

    def __init__(self) -> None:
        self.settings = get_settings()

    def extract(self, transcript: str, context: dict[str, Any]) -> ExtractionResult:
        import boto3  # imported lazily so local installs don't need it

        client = boto3.client(
            "bedrock-runtime", region_name=self.settings.bedrock_region
        )
        prompt = _build_prompt(transcript, context)
        response = client.converse(
            modelId=self.settings.bedrock_model_id,
            messages=[{"role": "user", "content": [{"text": prompt}]}],
            inferenceConfig={"maxTokens": 4000, "temperature": 0.0},
        )
        text = response["output"]["message"]["content"][0]["text"]
        data = _loads_json(text)
        proposals = []
        for item in data.get("proposals", []):
            try:
                proposals.append(
                    ExtractedProposal(
                        operation=ProposalOperation(item["operation"]),
                        target_type=TargetType(item.get("target_type", "task")),
                        target_id=item.get("target_id"),
                        payload=item.get("payload") or {},
                        evidence_excerpt=item.get("evidence_excerpt", ""),
                        speaker=item.get("speaker"),
                        spoken_at=item.get("spoken_at"),
                        confidence=float(item.get("confidence", 0.5)),
                        is_ambiguous=bool(item.get("is_ambiguous", False)),
                    )
                )
            except (KeyError, ValueError):
                continue
        return ExtractionResult(proposals=proposals, model=self.settings.bedrock_model_id)


def _build_prompt(transcript: str, context: dict[str, Any]) -> str:
    return f"""You extract structured standup records from a meeting transcript.

Rules:
- Only reference task/blocker ids present in CONTEXT. Never invent ids.
- If a task match is uncertain, set is_ambiguous=true and target_id=null.
- Return only operations that are explicitly supported by the transcript.
- Do not create duplicates of records already listed in CONTEXT.existing_session_records.
- Evidence must be a verbatim transcript excerpt.

Allowed operations: update_task_status, assign_task, add_progress_update,
create_blocker, resolve_blocker, create_action_item, record_decision.

Return JSON exactly in this shape:
{{"proposals": [{{
  "operation": "...",
  "target_type": "task|project|blocker|session",
  "target_id": "uuid or null",
  "payload": {{}},
  "evidence_excerpt": "verbatim excerpt",
  "speaker": "name or null",
  "spoken_at": "timestamp or null",
  "confidence": 0.0,
  "is_ambiguous": false
}}]}}

CONTEXT:
{json.dumps(context, indent=2, default=str)}

TRANSCRIPT:
{transcript}
"""


def _loads_json(text: str) -> dict:
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```[a-zA-Z]*\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end == -1:
        raise ValueError("Model did not return JSON")
    return json.loads(text[start : end + 1])


def get_extractor() -> TranscriptExtractor:
    settings = get_settings()
    if settings.ai_provider == "bedrock":
        return BedrockExtractor()
    return MockExtractor()
