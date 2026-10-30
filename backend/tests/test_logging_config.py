"""Tests for SCRIPTORIUM_LOG_LEVEL and the scriptorium logger's handler (VEG-657).

uvicorn configures only its own loggers, so without configure_logging the
scriptorium loggers have no handler and their lines never print.
"""

from __future__ import annotations

import logging
from collections.abc import Iterator

import pytest

from scriptorium.main import configure_logging


@pytest.fixture
def scriptorium_logger() -> Iterator[logging.Logger]:
    # The app configured this logger at import. Each test starts it bare so
    # the handler count is its own, and the app's setup comes back after.
    logger = logging.getLogger("scriptorium")
    level, handlers = logger.level, logger.handlers[:]
    logger.handlers.clear()
    yield logger
    logger.handlers[:] = handlers
    logger.setLevel(level)


def test_debug_in_any_case_sets_debug(
    scriptorium_logger: logging.Logger, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("SCRIPTORIUM_LOG_LEVEL", "debug")
    configure_logging()
    assert scriptorium_logger.level == logging.DEBUG


def test_an_unset_level_means_info(
    scriptorium_logger: logging.Logger, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.delenv("SCRIPTORIUM_LOG_LEVEL", raising=False)
    configure_logging()
    assert scriptorium_logger.level == logging.INFO


def test_an_unknown_level_falls_back_to_info_with_a_warning(
    scriptorium_logger: logging.Logger,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    monkeypatch.setenv("SCRIPTORIUM_LOG_LEVEL", "loud")
    configure_logging()
    assert scriptorium_logger.level == logging.INFO
    warnings = [r for r in caplog.records if r.levelno == logging.WARNING]
    assert len(warnings) == 1
    assert warnings[0].name == "scriptorium"
    assert "loud" in warnings[0].getMessage()


def test_a_second_call_adds_no_second_handler(
    scriptorium_logger: logging.Logger, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.delenv("SCRIPTORIUM_LOG_LEVEL", raising=False)
    configure_logging()
    configure_logging()
    assert len(scriptorium_logger.handlers) == 1
    assert scriptorium_logger.propagate


def test_every_level_lines_up_with_uvicorn(
    scriptorium_logger: logging.Logger, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.delenv("SCRIPTORIUM_LOG_LEVEL", raising=False)
    configure_logging()
    (handler,) = scriptorium_logger.handlers
    assert handler.formatter is not None

    def formatted(level: int) -> str:
        record = scriptorium_logger.makeRecord("scriptorium", level, __file__, 1, "x", (), None)
        assert handler.formatter is not None
        return handler.formatter.format(record)

    # uvicorn pads "LEVEL:" to 9 characters and adds a space, as in "INFO:     ".
    assert formatted(logging.INFO) == "INFO:     scriptorium: x"
    assert formatted(logging.DEBUG) == "DEBUG:    scriptorium: x"
    assert formatted(logging.WARNING) == "WARNING:  scriptorium: x"
