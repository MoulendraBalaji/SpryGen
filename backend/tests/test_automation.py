"""Automation-manager tests: SSRF guard, single-flight lock, abort + bounds.

These exercise the parts that do not require Selenium/PyAutoGUI to be installed.
"""

from __future__ import annotations

import pytest

from backend.services.automation import AutomationManager, MAX_STEPS


@pytest.fixture()
def manager():
    m = AutomationManager()
    yield m
    m.end()


def test_web_scrape_blocks_loopback(manager):
    result = manager.web_scrape("http://127.0.0.1:8000/")
    assert result.ok is False
    assert result.error is not None
    assert result.error.code == "BLOCKED_HOST"


def test_blocked_scrape_does_not_hold_the_slot(manager):
    manager.web_scrape("http://10.0.0.1/")
    # A rejected URL fails before try_begin, so the slot must still be free.
    assert manager.try_begin("probe") is True
    manager.end()


def test_browser_task_blocks_private_goto(manager):
    result = manager.browser_task([{"action": "goto", "url": "http://192.168.0.1/"}])
    assert result.ok is False
    assert result.error is not None
    assert result.error.code == "BLOCKED_HOST"


def test_browser_task_rejects_empty_and_huge_step_lists(manager):
    assert manager.browser_task([]).error.code == "BAD_PARAMS"
    huge = [{"action": "extract", "selector": "p"}] * (MAX_STEPS + 1)
    assert manager.browser_task(huge).error.code == "BAD_PARAMS"


def test_single_flight_rejects_concurrent_workflow(manager):
    assert manager.try_begin("first") is True
    # A second workflow (even with a valid public URL) is refused as busy.
    busy = manager.web_scrape("https://1.1.1.1/")
    assert busy.ok is False
    assert busy.error is not None
    assert busy.error.code == "BUSY"
    manager.end()
    assert manager.try_begin("second") is True


def test_request_abort_sets_flag(manager):
    assert manager.abort_requested() is False
    manager.request_abort()
    assert manager.abort_requested() is True


def test_end_releases_slot(manager):
    assert manager.try_begin("work") is True
    manager.end()
    assert manager.try_begin("again") is True
