"""Human-readable public identifiers for tasks and projects.

``public_id`` is allocated from a per-kind counter row and never changes for the
lifetime of the record. UUID primary keys, routes and relationships are
untouched: the public id is an additional, stable display/search handle.

Allocation uses a compare-and-swap loop over ``public_id_sequences`` so it is
safe under concurrent transactions on both SQLite and PostgreSQL:

* PostgreSQL (READ COMMITTED) blocks the competing ``UPDATE`` and re-evaluates
  the ``last_value = :seen`` predicate after the winner commits, yielding a
  ``rowcount`` of 0; this loop then retries with the fresh value.
* SQLite serialises writers, so the same predicate produces the same
  retry-on-rowcount-0 behaviour without relying on ``max(id)``.

Gaps are permitted (a rolled-back transaction may burn a number); uniqueness and
stability are guaranteed, ordering by allocation is monotonic.
"""

from __future__ import annotations

from sqlalchemy import event, insert, select, update
from sqlalchemy.engine import Connection
from sqlalchemy.exc import IntegrityError

KIND_TASK = "task"
KIND_PROJECT = "project"

PREFIXES = {KIND_TASK: "TASK", KIND_PROJECT: "PROJ"}

MAX_ALLOCATION_ATTEMPTS = 64


def format_public_id(kind: str, number: int) -> str:
    return f"{PREFIXES[kind]}-{number}"


def allocate_public_id(connection: Connection, kind: str) -> str:
    """Reserve the next number for ``kind`` and return the formatted public id."""
    from app.models.entities import PublicIdSequence  # local import avoids a cycle

    for _attempt in range(MAX_ALLOCATION_ATTEMPTS):
        current = connection.execute(
            select(PublicIdSequence.last_value).where(PublicIdSequence.kind == kind)
        ).scalar_one_or_none()
        if current is None:
            # First allocation for a kind (fresh database or a local schema that
            # predates the counter seed). The savepoint keeps a concurrent
            # insert race from poisoning the surrounding transaction.
            try:
                with connection.begin_nested():
                    connection.execute(
                        insert(PublicIdSequence).values(kind=kind, last_value=0)
                    )
            except IntegrityError:
                pass
            continue
        result = connection.execute(
            update(PublicIdSequence)
            .where(
                PublicIdSequence.kind == kind,
                PublicIdSequence.last_value == current,
            )
            .values(last_value=current + 1)
        )
        if result.rowcount == 1:
            return format_public_id(kind, current + 1)
    raise RuntimeError(f"Could not allocate a public id for {kind!r}")


def install_public_id_listeners() -> None:
    """Attach allocators so every ORM create gets an id (services, seed, tests)."""
    from app.models.entities import Project, Task  # local import avoids a cycle

    bindings = (
        (Task, _assign_task_public_id),
        (Project, _assign_project_public_id),
    )
    for mapper, listener in bindings:
        if not event.contains(mapper, "before_insert", listener):
            event.listen(mapper, "before_insert", listener)


def _assign_task_public_id(mapper, connection: Connection, target) -> None:
    if not getattr(target, "public_id", None):
        target.public_id = allocate_public_id(connection, KIND_TASK)


def _assign_project_public_id(mapper, connection: Connection, target) -> None:
    if not getattr(target, "public_id", None):
        target.public_id = allocate_public_id(connection, KIND_PROJECT)
