"""Native Selenium / BeautifulSoup / PyAutoGUI workflows with safety rails.

Safety properties:

* **SSRF guard** — every URL is validated by :mod:`backend.services.netguard`
  (http/https only; loopback / private / link-local / reserved addresses are
  refused) before a browser navigates to it.
* **Single-flight** — only one automation workflow may run at a time. A second
  request is rejected with a ``BUSY`` error instead of interleaving keystrokes
  and mouse moves.
* **Real abort** — ``request_abort`` sets a flag *and* quits the active
  WebDriver, so an in-flight ``driver.get``/``click`` is interrupted rather than
  merely observed between steps.
* **Bounded work** — page-load/script timeouts and caps on the amount of text
  and number of items returned keep a hostile page from exhausting memory.
"""

from __future__ import annotations
from dataclasses import dataclass, field
from typing import Any
import threading
import traceback

from ..netguard import SSRFError, assert_public_url

ACTIVE_STATE: dict[str, Any] = {
    "active": False,
    "workflow": None,
    "startedAt": None,
}

# Bounds: refuse to spend unbounded time/memory on any single workflow.
PAGE_LOAD_TIMEOUT = 30
MAX_STEPS = 50
MAX_ITEMS = 200
MAX_TEXT_CHARS = 100_000
MAX_TOTAL_CHARS = 1_000_000


@dataclass
class AutomationError(Exception):
    code: str
    message: str
    detail: str = ""


@dataclass
class AutomationResult:
    ok: bool
    data: Any = None
    error: AutomationError | None = None
    logs: list[str] = field(default_factory=list)


def _aborted_result() -> AutomationResult:
    return AutomationResult(ok=False, error=AutomationError("ABORTED", "Workflow aborted by operator"))


def _busy_result() -> AutomationResult:
    return AutomationResult(
        ok=False,
        error=AutomationError("BUSY", "Another automation workflow is already running"),
    )


class AutomationManager:
    """Manages Selenium / BeautifulSoup / PyAutoGUI workflows with abort support."""

    def __init__(self) -> None:
        self._abort = threading.Event()
        self._busy = False
        self._busy_lock = threading.Lock()
        self._driver: Any | None = None
        self._driver_lock = threading.Lock()
        self._status_lock = threading.Lock()

    # ----- status / single-flight / kill switch ---------------------------
    def status(self) -> dict[str, Any]:
        with self._status_lock:
            return dict(ACTIVE_STATE)

    def try_begin(self, workflow: str) -> bool:
        """Acquire the single-flight slot; return False if a workflow is running."""
        with self._busy_lock:
            if self._busy:
                return False
            self._busy = True
        with self._status_lock:
            ACTIVE_STATE.update({"active": True, "workflow": workflow, "startedAt": _now_ms()})
        self._abort.clear()
        return True

    def end(self) -> None:
        self._clear_driver()
        with self._busy_lock:
            self._busy = False
        with self._status_lock:
            ACTIVE_STATE.update({"active": False, "workflow": None, "startedAt": None})
        self._abort.set()

    def abort_requested(self) -> bool:
        return self._abort.is_set()

    def request_abort(self) -> None:
        self._abort.set()
        with self._driver_lock:
            driver = self._driver
        if driver is not None:
            # Interrupts the running driver.get()/click() so the workflow thread
            # unwinds promptly instead of waiting for the page to finish.
            try:
                driver.quit()
            except Exception:  # noqa: BLE001
                pass
        with self._status_lock:
            if ACTIVE_STATE["active"]:
                ACTIVE_STATE["workflow"] = "ABORTED"

    def _set_driver(self, driver: Any) -> None:
        with self._driver_lock:
            self._driver = driver

    def _clear_driver(self, driver: Any | None = None) -> None:
        with self._driver_lock:
            if driver is None or self._driver is driver:
                self._driver = None

    # ----- Selenium + BeautifulSoup web scraping ---------------------------
    def web_scrape(self, url: str, selector: str | None = None, headless: bool = True) -> AutomationResult:
        try:
            target = assert_public_url(url)
        except SSRFError as exc:
            return AutomationResult(ok=False, error=AutomationError(exc.code, exc.message))

        if not self.try_begin("web-scrape"):
            return _busy_result()

        driver = None
        try:
            from selenium import webdriver
            from selenium.webdriver.chrome.service import Service
            from webdriver_manager.chrome import ChromeDriverManager
            from bs4 import BeautifulSoup

            options = webdriver.ChromeOptions()
            if headless:
                options.add_argument("--headless=new")
            options.add_argument("--no-sandbox")
            options.add_argument("--disable-dev-shm-usage")
            options.add_argument("--disable-blink-features=AutomationControlled")
            options.add_argument("--window-size=1280,800")

            service = Service(ChromeDriverManager().install())
            driver = webdriver.Chrome(service=service, options=options)
            self._set_driver(driver)
            driver.set_page_load_timeout(PAGE_LOAD_TIMEOUT)
            driver.set_script_timeout(PAGE_LOAD_TIMEOUT)

            driver.get(target)
            _wait_ready(driver, timeout=PAGE_LOAD_TIMEOUT)
            if self.abort_requested():
                return _aborted_result()

            html = driver.page_source
            soup = BeautifulSoup(html, "html.parser")
            for tag in soup(["script", "style", "noscript", "svg"]):
                tag.decompose()

            if selector:
                nodes = soup.select(selector)
                extracted = [_clean_text(n.get_text(" ", strip=True)) for n in nodes]
            else:
                extracted = [_clean_text(soup.get_text("\n", strip=True))]

            extracted = _cap_collected(extracted)
            return AutomationResult(
                ok=True,
                data={"url": target, "articles": extracted, "count": len(extracted)},
                logs=[f"scraped {target} (total chars: {sum(len(t) for t in extracted)})"],
            )
        except Exception as exc:  # noqa: BLE001
            if self.abort_requested():
                return _aborted_result()
            return AutomationResult(
                ok=False,
                data=None,
                error=AutomationError("SCRAPE_FAILED", str(exc), detail=traceback.format_exc()),
            )
        finally:
            self._clear_driver(driver)
            _safe_quit(driver)
            self.end()

    # ----- Browser automation tasks ----------------------------------------
    def browser_task(self, steps: list[dict[str, Any]], headless: bool = True) -> AutomationResult:
        if not isinstance(steps, list) or not steps:
            return AutomationResult(ok=False, error=AutomationError("BAD_PARAMS", "No steps supplied"))
        if len(steps) > MAX_STEPS:
            return AutomationResult(
                ok=False,
                error=AutomationError("BAD_PARAMS", f"Too many steps ({len(steps)} > {MAX_STEPS})"),
            )

        # Validate every navigation target before starting the browser so a
        # blocked URL aborts cleanly with a clear error.
        for step in steps:
            if step.get("action") == "goto":
                try:
                    assert_public_url(str(step.get("url", "")))
                except SSRFError as exc:
                    return AutomationResult(ok=False, error=AutomationError(exc.code, exc.message))

        if not self.try_begin("browser-task"):
            return _busy_result()

        driver = None
        collected: list[Any] = []
        try:
            from selenium import webdriver
            from selenium.webdriver.chrome.service import Service
            from webdriver_manager.chrome import ChromeDriverManager

            options = webdriver.ChromeOptions()
            if headless:
                options.add_argument("--headless=new")
            options.add_argument("--no-sandbox")
            options.add_argument("--disable-dev-shm-usage")
            options.add_argument("--disable-blink-features=AutomationControlled")

            service = Service(ChromeDriverManager().install())
            driver = webdriver.Chrome(service=service, options=options)
            self._set_driver(driver)
            driver.set_page_load_timeout(PAGE_LOAD_TIMEOUT)
            driver.set_script_timeout(PAGE_LOAD_TIMEOUT)

            for step in steps:
                if self.abort_requested():
                    return AutomationResult(
                        ok=False,
                        data={"extracted": _cap_collected(collected)},
                        error=AutomationError("ABORTED", "Workflow aborted by operator"),
                    )
                action = step.get("action")
                if action == "goto":
                    driver.get(str(step.get("url", "")))
                    _wait_ready(driver, timeout=PAGE_LOAD_TIMEOUT)
                elif action == "click":
                    el = _find_element(driver, step.get("selector", ""), step.get("by", "css"))
                    el.click()
                elif action == "type":
                    el = _find_element(driver, step.get("selector", ""), step.get("by", "css"))
                    el.send_keys(step.get("text", ""))
                elif action == "extract":
                    els = _find_elements(driver, step.get("selector", ""), step.get("by", "css"))
                    collected.extend([e.text for e in els if e.text])
                elif action == "screenshot":
                    shot = driver.get_screenshot_as_png()
                    collected.append({"screenshot_bytes": len(shot)})
                else:
                    return AutomationResult(
                        ok=False,
                        data={"extracted": _cap_collected(collected)},
                        error=AutomationError("UNKNOWN_STEP", f"Unknown action: {action}"),
                    )

            return AutomationResult(
                ok=True,
                data={"steps_executed": len(steps), "extracted": _cap_collected(collected)},
            )
        except Exception as exc:  # noqa: BLE001
            if self.abort_requested():
                return AutomationResult(
                    ok=False,
                    data={"extracted": _cap_collected(collected)},
                    error=AutomationError("ABORTED", "Workflow aborted by operator"),
                )
            return AutomationResult(
                ok=False,
                data=None,
                error=AutomationError("BROWSER_TASK_FAILED", str(exc), detail=traceback.format_exc()),
            )
        finally:
            self._clear_driver(driver)
            _safe_quit(driver)
            self.end()

    # ----- PyAutoGUI desktop actions ---------------------------------------
    def desktop_action(self, command: str, params: dict[str, Any] | None = None) -> AutomationResult:
        params = params or {}
        if not self.try_begin(f"desktop-{command}"):
            return _busy_result()

        try:
            import pyautogui

            pyautogui.FAILSAFE = True
            pyautogui.PAUSE = 0.05
            if self.abort_requested():
                return _aborted_result()
            screen_w, screen_h = pyautogui.size()

            if command == "screenshot":
                region = params.get("region")
                if region:
                    img = pyautogui.screenshot(region=tuple(region))
                else:
                    img = pyautogui.screenshot()
                return AutomationResult(ok=True, data={"image_bytes": _png_size(img)})
            if command == "hotkey":
                keys = params.get("keys")
                if not keys:
                    return AutomationResult(
                        ok=False,
                        error=AutomationError("BAD_PARAMS", "hotkey requires 'keys'"),
                    )
                pyautogui.hotkey(*keys)
                return AutomationResult(ok=True, data={"hotkey": keys})
            if command == "type":
                text = params.get("text", "")
                pyautogui.typewrite(text, interval=params.get("interval", 0.02))
                return AutomationResult(ok=True, data={"typed": len(text)})
            if command == "move":
                x, y = int(params.get("x", 0)), int(params.get("y", 0))
                _bounded(x, y, screen_w, screen_h)
                pyautogui.moveTo(x, y, duration=params.get("duration", 0.2))
                return AutomationResult(ok=True, data={"pos": [x, y]})
            if command == "click":
                x, y = int(params.get("x", 0)), int(params.get("y", 0))
                _bounded(x, y, screen_w, screen_h)
                pyautogui.click(x, y)
                return AutomationResult(ok=True, data={"clicked": [x, y]})
            if command == "switch_window":
                keys = params.get("keys") or ["alt", "tab"]
                pyautogui.hotkey(*keys)
                return AutomationResult(ok=True, data={"switch": keys})
            return AutomationResult(
                ok=False,
                error=AutomationError("UNKNOWN_ACTION", f"Unknown desktop action: {command}"),
            )
        except Exception as exc:  # noqa: BLE001
            if self.abort_requested():
                return _aborted_result()
            return AutomationResult(
                ok=False,
                data=None,
                error=AutomationError("DESKTOP_ACTION_FAILED", str(exc), detail=traceback.format_exc()),
            )
        finally:
            self.end()


def _wait_ready(driver, timeout: int = PAGE_LOAD_TIMEOUT) -> None:
    import time as _t

    deadline = _t.time() + timeout
    try:
        ready = driver.execute_script("return document.readyState")
        while ready != "complete" and _t.time() < deadline:
            _t.sleep(0.25)
            ready = driver.execute_script("return document.readyState")
    except Exception:  # noqa: BLE001
        # A driver quit (abort) makes execute_script throw; let the caller decide.
        return


def _find_element(driver, selector: str, by: str):
    from selenium.webdriver.common.by import By  # noqa: F401

    return driver.find_element(_resolve_by(by), selector)


def _find_elements(driver, selector: str, by: str):
    from selenium.webdriver.common.by import By  # noqa: F401

    return driver.find_elements(_resolve_by(by), selector)


def _resolve_by(by: str):
    from selenium.webdriver.common.by import By

    return {
        "css": By.CSS_SELECTOR,
        "xpath": By.XPATH,
        "id": By.ID,
        "class": By.CLASS_NAME,
        "tag": By.TAG_NAME,
    }.get(by, By.CSS_SELECTOR)


def _clean_text(raw: str) -> str:
    import re

    return re.sub(r"\s+", " ", raw).strip()


def _cap_collected(items: list[Any]) -> list[Any]:
    """Cap the number of items and total characters returned to Electron."""
    capped: list[Any] = []
    total = 0
    for item in items:
        if len(capped) >= MAX_ITEMS or total >= MAX_TOTAL_CHARS:
            break
        if isinstance(item, str):
            if not item:
                continue
            text = item[:MAX_TEXT_CHARS]
            remaining = MAX_TOTAL_CHARS - total
            if len(text) > remaining:
                text = text[:remaining]
            if text:
                capped.append(text)
                total += len(text)
        else:
            capped.append(item)
    return capped


def _safe_quit(driver: Any | None) -> None:
    if driver is None:
        return
    try:
        driver.quit()
    except Exception:  # noqa: BLE001
        pass


def _png_size(img) -> int:
    import io

    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return len(buf.getvalue())


def _bounded(x: int, y: int, w: int, h: int) -> None:
    if x < 0 or y < 0 or x >= w or y >= h:
        raise AutomationError(
            "OUT_OF_BOUNDS",
            f"Coordinates ({x},{y}) outside safe bounds ({w}x{h}) — refusing.",
        )


def _now_ms() -> int:
    import time

    return int(time.time() * 1000)


automation = AutomationManager()
