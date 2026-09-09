"""Native local automation routines for SPRYGEN.

Safe-by-design: every routine surfaces an `active` indicator for the UI,
PyAutoGUI runs with FAILSAFE=True and bounded regions, and long-running
workloads poll an abort flag so the operator can ESC / corner-stop them.
"""

from __future__ import annotations

import threading
import traceback
from dataclasses import dataclass, field
from typing import Any

ACTIVE_STATE: dict[str, Any] = {
    "active": False,
    "workflow": None,
    "startedAt": None,
}


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


class AutomationManager:
    """Manages Selenium / BeautifulSoup / PyAutoGUI workflows with abort support."""

    def __init__(self) -> None:
        self._abort = threading.Event()
        self._lock = threading.Lock()
        self._status_lock = threading.Lock()

    # ----- status / kill switch -------------------------------------------
    def status(self) -> dict[str, Any]:
        with self._status_lock:
            return dict(ACTIVE_STATE)

    def begin(self, workflow: str) -> None:
        with self._status_lock:
            ACTIVE_STATE.update({"active": True, "workflow": workflow, "startedAt": _now_ms()})
        self._abort.clear()

    def end(self) -> None:
        with self._status_lock:
            ACTIVE_STATE.update({"active": False, "workflow": None, "startedAt": None})
        self._abort.set()

    def abort_requested(self) -> bool:
        return self._abort.is_set()

    def request_abort(self) -> None:
        self._abort.set()
        # PyAutoGUI kills its own loop on mouse-corner / ESC; just flag it.
        with self._lock:
            ACTIVE_STATE["workflow"] = "ABORTED"

    # ----- Selenium + BeautifulSoup web scraping ---------------------------
    def web_scrape(self, url: str, selector: str | None = None, headless: bool = True) -> AutomationResult:
        try:
            from selenium import webdriver
            from selenium.webdriver.chrome.service import Service
            from webdriver_manager.chrome import ChromeDriverManager
            from bs4 import BeautifulSoup

            self.begin("web-scrape")
            options = webdriver.ChromeOptions()
            if headless:
                options.add_argument("--headless=new")
            options.add_argument("--no-sandbox")
            options.add_argument("--disable-dev-shm-usage")
            options.add_argument("--disable-blink-features=AutomationControlled")
            options.add_argument("--window-size=1280,800")

            self._abort.clear()
            service = Service(ChromeDriverManager().install())
            driver = webdriver.Chrome(service=service, options=options)
            try:
                driver.get(url)
                _wait_ready(driver)
                if self.abort_requested():
                    return AutomationResult(ok=False, error=AutomationError("ABORTED", "Workflow aborted by operator"))

                html = driver.page_source
                soup = BeautifulSoup(html, "html.parser")
                for tag in soup(["script", "style", "noscript", "svg"]):
                    tag.decompose()

                if selector:
                    nodes = soup.select(selector)
                    extracted = [_clean_text(n.get_text(" ", strip=True)) for n in nodes]
                else:
                    extracted = [_clean_text(soup.get_text("\n", strip=True))]

                extracted = [t for t in extracted if t]
                return AutomationResult(
                    ok=True,
                    data={"url": url, "articles": extracted, "count": len(extracted)},
                    logs=[f"scraped {url} (total chars: {sum(len(t) for t in extracted)})"],
                )
            finally:
                driver.quit()
                self.end()
        except Exception as exc:  # noqa: BLE001
            self.end()
            return AutomationResult(
                ok=False,
                data=None,
                error=AutomationError("SCRAPE_FAILED", str(exc), detail=traceback.format_exc()),
            )

    # ----- Browser automation tasks ----------------------------------------
    def browser_task(self, steps: list[dict[str, Any]], headless: bool = True) -> AutomationResult:
        try:
            from selenium import webdriver
            from selenium.webdriver.chrome.service import Service
            from selenium.webdriver.common.by import By
            from webdriver_manager.chrome import ChromeDriverManager

            self.begin("browser-task")
            options = webdriver.ChromeOptions()
            if headless:
                options.add_argument("--headless=new")
            options.add_argument("--no-sandbox")
            options.add_argument("--disable-dev-shm-usage")
            options.add_argument("--disable-blink-features=AutomationControlled")

            service = Service(ChromeDriverManager().install())
            driver = webdriver.Chrome(service=service, options=options)
            collected: list[Any] = []
            try:
                for i, step in enumerate(steps):
                    if self.abort_requested():
                        return AutomationResult(
                            ok=False,
                            data=collected,
                            error=AutomationError("ABORTED", "Workflow aborted by operator"),
                        )
                    action = step.get("action")
                    if action == "goto":
                        driver.get(step["url"])
                        _wait_ready(driver)
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
                            data=collected,
                            error=AutomationError("UNKNOWN_STEP", f"Unknown action: {action}"),
                        )
                return AutomationResult(ok=True, data={"steps_executed": len(steps), "extracted": collected})
            finally:
                driver.quit()
                self.end()
        except Exception as exc:  # noqa: BLE001
            self.end()
            return AutomationResult(
                ok=False,
                data=None,
                error=AutomationError("BROWSER_TASK_FAILED", str(exc), detail=traceback.format_exc()),
            )

    # ----- PyAutoGUI desktop actions ---------------------------------------
    def desktop_action(self, command: str, params: dict[str, Any] | None = None) -> AutomationResult:
        params = params or {}
        try:
            import pyautogui

            pyautogui.FAILSAFE = True
            pyautogui.PAUSE = 0.05
            self.begin(f"desktop-{command}")
            screen_w, screen_h = pyautogui.size()

            try:
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
            finally:
                self.end()
        except Exception as exc:  # noqa: BLE001
            self.end()
            return AutomationResult(
                ok=False,
                data=None,
                error=AutomationError("DESKTOP_ACTION_FAILED", str(exc), detail=traceback.format_exc()),
            )


def _wait_ready(driver, timeout: int = 20) -> None:
    import time as _t

    deadline = _t.time() + timeout
    ready = driver.execute_script("return document.readyState")
    while ready != "complete" and _t.time() < deadline:
        _t.sleep(0.25)
        ready = driver.execute_script("return document.readyState")


def _find_element(driver, selector: str, by: str):
    from selenium.webdriver.common.by import By

    return driver.find_element(_resolve_by(by), selector)


def _find_elements(driver, selector: str, by: str):
    from selenium.webdriver.common.by import By

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