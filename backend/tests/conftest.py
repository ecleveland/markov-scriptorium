"""Shared fixtures for the backend tests."""

from __future__ import annotations

import pytest


@pytest.fixture(autouse=True)
def _no_real_vision(request: pytest.FixtureRequest, monkeypatch: pytest.MonkeyPatch) -> None:
    """Fail any test that reaches Apple Vision without the vision marker (VEG-231).

    A real read takes the GPU and depends on the machine, so only the marked
    integration tests may make one. Everything else uses FakeOcr.
    """
    if request.node.get_closest_marker("vision") is not None:
        return
    try:
        from scriptorium.scanner.engines import vision
    except ImportError:
        # Not macOS, or pyobjc is missing, so there is no Vision to guard.
        return

    def refuse(*args: object, **kwargs: object) -> list[object]:
        raise AssertionError("real Vision called outside the vision marker")

    monkeypatch.setattr(vision.VisionOcr, "read_lines", refuse)
