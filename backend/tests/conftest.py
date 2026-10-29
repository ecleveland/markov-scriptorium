"""Shared fixtures for the backend tests."""

from __future__ import annotations

from typing import Any

import pytest

from scriptorium.scanner.ocr import TextLine


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


@pytest.fixture(autouse=True)
def _no_real_tesseract(request: pytest.FixtureRequest, monkeypatch: pytest.MonkeyPatch) -> None:
    """Fail any test that runs the real Tesseract binary without the tesseract marker (VEG-649).

    The unit tests drive ``read_lines`` and ``probe`` with ``subprocess.run``
    faked, so the guard refuses only a call that would reach the real one. A
    real run depends on what the machine has installed.
    """
    if request.node.get_closest_marker("tesseract") is not None:
        return
    import subprocess

    from scriptorium.scanner.engines import tesseract

    real_run = subprocess.run

    def refuse_real_run() -> None:
        # The adapter calls subprocess.run through the module, which is what
        # the unit tests replace.
        if subprocess.run is real_run:
            raise AssertionError("real Tesseract called outside the tesseract marker")

    read_lines = tesseract.TesseractOcr.read_lines
    probe = tesseract.probe

    def guarded_read(self: tesseract.TesseractOcr, *args: Any, **kwargs: Any) -> list[TextLine]:
        refuse_real_run()
        return read_lines(self, *args, **kwargs)

    def guarded_probe(binary: str) -> None:
        refuse_real_run()
        probe(binary)

    monkeypatch.setattr(tesseract.TesseractOcr, "read_lines", guarded_read)
    monkeypatch.setattr(tesseract, "probe", guarded_probe)
