# Web Scraping Pattern

A standardized pattern for implementing web scraping functionality with background processing, rate limiting, per-user state management, and real-time progress tracking. Covers both requests+BeautifulSoup (for public sites) and Selenium (for JavaScript-rendered or login-required sites).

---

## Quick Start for Claude

When a user needs web scraping functionality:

1. Determine approach: Use requests+BeautifulSoup for public HTML sites; use Selenium for JS-rendered or login-required sites — see [Decision Tree](#decision-tree)
2. Create a base scraper class in `backend/app/scrapers/base.py`
3. Implement site-specific scrapers inheriting from the base class
4. Add per-user state management in `backend/app/services/state_manager.py`
5. Create a background worker service in `backend/app/services/scraper_service.py`
6. Add API endpoints for upload, start, pause, resume, stop, status, and download
7. Build frontend with status polling, progress bar, and controls

---

## Table of Contents

- [Decision Tree: Selenium vs requests+BeautifulSoup](#decision-tree)
- [Architecture Overview](#architecture-overview)
- [Approach 1: requests + BeautifulSoup (Recommended Default)](#approach-1-requests--beautifulsoup)
  - [Base Scraper Class](#base-scraper-class)
  - [Implementing a Site Scraper](#implementing-a-site-scraper)
  - [Token/Nonce Management](#tokennonce-management)
- [Approach 2: Selenium (Browser Automation)](#approach-2-selenium)
  - [Dependencies](#selenium-dependencies)
  - [Chrome Remote Debugging](#chrome-remote-debugging)
  - [Anti-Detection & Stealth](#anti-detection--stealth)
  - [Human-Like Behavior](#human-like-behavior)
- [Rate Limiting & Politeness](#rate-limiting--politeness)
- [Per-User State Management](#per-user-state-management)
- [Background Threading](#background-threading)
- [Data Output & Storage](#data-output--storage)
- [API Endpoints](#api-endpoints)
- [Frontend Integration](#frontend-integration)
- [Complete Example](#complete-example)
- [Checklist](#checklist)

---

## Decision Tree

```
                    Does the target site...
                           |
            +--------------+--------------+
            |                             |
 Require JavaScript rendering,    Serve static HTML with
 login, or heavy bot detection?   data visible in page source?
            |                             |
     Use Selenium                Use requests +
     (Approach 2)                BeautifulSoup (Approach 1)
```

| Factor | requests + BS4 | Selenium |
|--------|---------------|----------|
| Speed | Fast (ms per request) | Slow (seconds per page) |
| Resource usage | Low (no browser) | High (full Chrome instance) |
| JS-rendered content | Cannot access | Full access |
| Login-required sites | Possible with cookies | Native support |
| Bot detection bypass | Limited | Strong (with stealth mode) |
| Complexity | Low | High |
| Dependencies | `requests`, `beautifulsoup4`, `lxml` | `selenium`, `webdriver-manager`, `undetected-chromedriver` |

**Start with requests+BeautifulSoup.** Only move to Selenium if you confirm the data is not in the HTML source (check "View Page Source" in browser).

---

## Architecture Overview

```
Frontend (React)                    Backend (FastAPI)
┌──────────────────┐               ┌──────────────────────────────────┐
│ Upload file      │─POST /upload─>│ Parse Excel/CSV, queue items     │
│ Start/Pause/     │─POST /start──>│ Launch background thread         │
│ Stop controls    │─POST /pause──>│ Set pause_flag on state          │
│                  │─POST /stop───>│ Set stop_flag on state           │
│ Poll status      │─GET /status──>│ Return ScraperState snapshot     │
│ Download results │─GET /download>│ Return Excel file                │
└──────────────────┘               └──────────────┬───────────────────┘
                                                  │
                                   ┌──────────────▼───────────────────┐
                                   │  Background Thread               │
                                   │  ┌────────────────────────────┐  │
                                   │  │ for item in queue:         │  │
                                   │  │   if stop_flag: break      │  │
                                   │  │   while pause_flag: wait   │  │
                                   │  │   scraper.search(item)     │  │
                                   │  │   save to Excel            │  │
                                   │  │   polite_delay()           │  │
                                   │  └────────────────────────────┘  │
                                   └──────────────────────────────────┘
```

---

## Approach 1: requests + BeautifulSoup

### Base Scraper Class

All site-specific scrapers inherit from this base class. It provides session management, headers, rate limiting, and HTML/JSON fetching.

```python
# backend/app/scrapers/base.py

from abc import ABC, abstractmethod
from typing import Optional, Dict
import requests
from bs4 import BeautifulSoup
import logging
import time
import random

logger = logging.getLogger(__name__)


class BaseScraper(ABC):
    """Abstract base class for web scrapers."""

    SCRAPER_NAME: str = ""
    BASE_URL: str = ""

    def __init__(self):
        self.session = requests.Session()
        self.session.headers.update({
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/120.0.0.0 Safari/537.36"
            ),
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.5",
        })

    @abstractmethod
    def search(self, query: str) -> Dict:
        """
        Search for an item on this site.

        Returns dict with standardized keys:
            - item_found: str or None
            - name: str or None
            - price: str or None
            - availability: str or None
            - url: str or None
            - error: str or None
        """
        pass

    def _polite_delay(self, min_seconds: float = 0.5, max_seconds: float = 1.5):
        """Random delay between requests to avoid overwhelming the server."""
        time.sleep(random.uniform(min_seconds, max_seconds))

    def _get_soup(self, url: str, params: dict = None) -> Optional[BeautifulSoup]:
        """Fetch a page and return parsed BeautifulSoup object."""
        try:
            response = self.session.get(url, params=params, timeout=15)
            response.raise_for_status()
            return BeautifulSoup(response.text, "lxml")
        except Exception as e:
            logger.error(f"[{self.SCRAPER_NAME}] Error fetching {url}: {e}")
            return None

    def _get_json(self, url: str, params: dict = None, headers: dict = None) -> Optional[dict]:
        """Fetch JSON from an API endpoint."""
        try:
            resp_headers = {**self.session.headers, **(headers or {})}
            response = self.session.get(url, params=params, headers=resp_headers, timeout=15)
            response.raise_for_status()
            return response.json()
        except Exception as e:
            logger.error(f"[{self.SCRAPER_NAME}] Error fetching JSON {url}: {e}")
            return None
```

### Implementing a Site Scraper

Inherit from `BaseScraper` and implement the `search()` method:

```python
# backend/app/scrapers/example_site.py

import re
import logging
from typing import Dict
from .base import BaseScraper

logger = logging.getLogger(__name__)


class ExampleSiteScraper(BaseScraper):
    SCRAPER_NAME = "Example Site"
    BASE_URL = "https://www.example.com"
    SEARCH_URL = "https://www.example.com/search"

    def search(self, query: str) -> Dict:
        result = {
            "item_found": None,
            "name": None,
            "price": None,
            "availability": None,
            "url": None,
            "error": None,
        }

        # Fetch search results page
        soup = self._get_soup(self.SEARCH_URL, params={"q": query})
        if not soup:
            result["error"] = "Failed to fetch search page"
            return result

        # Find product items using CSS selectors
        items = soup.select(".product-item")
        if not items:
            result["error"] = "No results found"
            return result

        # Find best match
        best = None
        for item in items:
            sku = item.select_one(".sku")
            if sku and query.lower() in sku.get_text(strip=True).lower():
                best = item
                break
        if not best:
            best = items[0]

        # Extract data
        sku_el = best.select_one(".sku")
        if sku_el:
            result["item_found"] = sku_el.get_text(strip=True)

        name_el = best.select_one("h3 a")
        if name_el:
            result["name"] = name_el.get_text(strip=True)

        price_el = best.select_one(".price")
        if price_el:
            result["price"] = price_el.get_text(strip=True)

        stock_el = best.select_one(".stock-quantity")
        if stock_el:
            result["availability"] = stock_el.get_text(strip=True)

        link_el = best.select_one("a[href]")
        if link_el:
            href = link_el.get("href", "")
            if href and not href.startswith("http"):
                href = f"{self.BASE_URL}{href}"
            result["url"] = href

        return result
```

### Token/Nonce Management

Some sites require tokens extracted from an initial page load before search API calls work:

```python
# Pattern for sites with CSRF/nonce tokens

class TokenProtectedScraper(BaseScraper):
    SCRAPER_NAME = "Token Site"
    BASE_URL = "https://www.example.com"

    def __init__(self):
        super().__init__()
        self._nonce = None
        self._token = None

    def _fetch_tokens(self):
        """Extract nonce and token from the search page."""
        soup = self._get_soup(f"{self.BASE_URL}/search")
        if not soup:
            return

        # Look for tokens in script tags or hidden inputs
        import re
        scripts = soup.find_all("script")
        for script in scripts:
            text = script.string or ""
            nonce_match = re.search(r'"nonce":\s*"([^"]+)"', text)
            token_match = re.search(r'"token":\s*"([^"]+)"', text)
            if nonce_match:
                self._nonce = nonce_match.group(1)
            if token_match:
                self._token = token_match.group(1)

    def search(self, query: str) -> Dict:
        # Fetch tokens if we don't have them
        if not self._nonce or not self._token:
            self._fetch_tokens()

        # Use tokens in API call
        response = self.session.post(
            f"{self.BASE_URL}/api/search",
            data={"nonce": self._nonce, "token": self._token, "query": query},
            timeout=15,
        )

        if response.status_code != 200:
            # Token may have expired — clear and retry
            self._nonce = None
            self._token = None
            return {"error": "Token expired, will retry"}

        return self._parse_response(response.json())
```

---

## Approach 2: Selenium (Browser Automation)

Use Selenium when the target site requires JavaScript rendering, login, or has aggressive bot detection.

### Selenium Dependencies

```
# requirements.txt (add these alongside standard packages)
selenium>=4.0
webdriver-manager>=4.0
undetected-chromedriver>=3.5   # Optional: for sites with bot detection
```

### Chrome Remote Debugging

Launch Chrome as a separate process and connect Selenium to it. This allows the user to log in manually before scraping begins.

```python
# backend/app/services/chrome_launcher.py

import os
import sys
import subprocess
import time
from selenium import webdriver
from selenium.webdriver.chrome.service import Service
from webdriver_manager.chrome import ChromeDriverManager


def resolve_chrome_binary() -> tuple[str, str]:
    """Find Chrome binary and create a temp user data directory."""
    is_windows = sys.platform.startswith("win")
    is_mac = sys.platform == "darwin"

    if is_windows:
        candidates = [
            r"C:\Program Files\Google\Chrome\Application\chrome.exe",
            r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
            os.path.expanduser(r"~\AppData\Local\Google\Chrome\Application\chrome.exe"),
        ]
        chrome = next((p for p in candidates if os.path.exists(p)), None)
        temp_dir = os.path.join(os.environ.get("TEMP", r"C:\Temp"), "chrome_scraper")
    elif is_mac:
        chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
        temp_dir = "/tmp/chrome_scraper"
    else:
        chrome = "google-chrome"
        temp_dir = "/tmp/chrome_scraper"

    return chrome, temp_dir


def kill_existing_debuggers(port: int = 9222):
    """Kill Chrome instances using the debugging port (not all Chrome)."""
    if sys.platform.startswith("win"):
        subprocess.run(
            ["powershell", "-Command",
             f"Get-CimInstance Win32_Process | Where-Object {{ $_.Name -eq 'chrome.exe' -and "
             f"$_.CommandLine -like '*remote-debugging-port={port}*' }} | "
             f"ForEach-Object {{ Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }}"],
            capture_output=True,
        )
    else:
        subprocess.run(["pkill", "-f", f"remote-debugging-port={port}"], capture_output=True)
    time.sleep(1)


def launch_chrome(url: str, port: int = 9222) -> webdriver.Chrome:
    """
    Launch Chrome with remote debugging and connect Selenium to it.

    Args:
        url: Initial URL to open
        port: Debugging port number
    Returns:
        Connected Selenium WebDriver instance
    """
    kill_existing_debuggers(port)

    chrome_path, temp_dir = resolve_chrome_binary()
    if not chrome_path:
        raise RuntimeError("Chrome not found")

    # Launch Chrome with debugging enabled
    subprocess.Popen([
        chrome_path,
        f"--remote-debugging-port={port}",
        f"--user-data-dir={temp_dir}",
        url,
    ])
    time.sleep(3)

    # Connect Selenium to the running Chrome instance
    options = webdriver.ChromeOptions()
    options.add_experimental_option("debuggerAddress", f"127.0.0.1:{port}")

    service = Service(ChromeDriverManager().install())
    driver = webdriver.Chrome(service=service, options=options)

    return driver
```

### Anti-Detection & Stealth

For sites with bot detection, use these techniques:

```python
# Option 1: undetected-chromedriver (recommended for protected sites)
try:
    import undetected_chromedriver as uc
    options = uc.ChromeOptions()
    driver = uc.Chrome(options=options)
except ImportError:
    # Fallback: regular Chrome with stealth settings
    pass

# Option 2: Remove webdriver property via CDP
driver.execute_cdp_cmd("Page.addScriptToEvaluateOnNewDocument", {
    "source": """
        Object.defineProperty(navigator, 'webdriver', {
            get: () => undefined
        })
    """
})
```

### Human-Like Behavior

Simulate human browsing patterns to avoid detection:

```python
# backend/app/scrapers/selenium_utils.py

import random
import time
from selenium.webdriver.common.action_chains import ActionChains


def human_delay(min_seconds: float = 1.0, max_seconds: float = 4.0):
    """Random delay with occasional longer pauses."""
    delay = random.uniform(min_seconds, max_seconds)
    # 5% chance of being 1.5x longer (simulates distraction)
    if random.random() < 0.05:
        delay *= 1.5
    time.sleep(delay)


def human_scroll(driver, element):
    """Scroll to element with slight randomization and overshoot."""
    try:
        driver.execute_script(
            "arguments[0].scrollIntoView({block: 'center', behavior: 'smooth'});",
            element,
        )
        human_delay(0.1, 0.25)

        # 20% chance of slight overshoot then correction
        if random.random() < 0.2:
            driver.execute_script("window.scrollBy(0, arguments[0]);", random.randint(-30, 30))
            human_delay(0.05, 0.15)
    except Exception:
        driver.execute_script("arguments[0].scrollIntoView({block: 'center'});", element)


def human_click(driver, element):
    """Click with random method selection (ActionChains vs direct)."""
    try:
        if random.random() < 0.6:
            actions = ActionChains(driver)
            actions.move_to_element(element)
            human_delay(0.05, 0.15)
            actions.click()
            actions.perform()
        else:
            element.click()
    except Exception:
        driver.execute_script("arguments[0].click();", element)


def human_mouse_movement(driver):
    """Random subtle mouse movements (call occasionally between actions)."""
    if random.random() < 0.2:
        try:
            actions = ActionChains(driver)
            actions.move_by_offset(random.randint(-15, 15), random.randint(-15, 15))
            actions.perform()
            human_delay(0.03, 0.1)
        except Exception:
            pass
```

---

## Rate Limiting & Politeness

| Approach | Min Delay | Max Delay | Notes |
|----------|-----------|-----------|-------|
| requests + BS4 | 0.5s | 1.5s | Sufficient for most public sites |
| Selenium (public) | 1.0s | 4.0s | Add random scroll/mouse movement |
| Selenium (protected) | 1.0s | 4.0s | 5% chance of 1.5x longer pause |

Always call `_polite_delay()` or `human_delay()` **between each request**, not just between items. If scraping 3 sites per item, delay between each site.

---

## Per-User State Management

Each user gets an isolated scraping session with progress tracking and flow control.

```python
# backend/app/services/state_manager.py

import threading
from datetime import datetime
from typing import Dict, List, Optional


class ScraperState:
    """Tracks scraping state for a single user session."""

    def __init__(self):
        self.status: str = "idle"           # idle | scraping | paused | completed | error
        self.item_queue: List[str] = []
        self.results: List[dict] = []
        self.current_index: int = 0
        self.total_items: int = 0
        self.current_item: str = ""
        self.messages: List[str] = []
        self.scrape_thread: Optional[threading.Thread] = None
        self.pause_flag: bool = False
        self.stop_flag: bool = False
        self.input_file_name: str = ""
        self.output_file: str = ""

    def log(self, message: str):
        timestamp = datetime.now().strftime("%H:%M:%S")
        self.messages.append(f"[{timestamp}] {message}")
        # Ring buffer: keep last 200 messages
        if len(self.messages) > 200:
            self.messages = self.messages[-200:]

    def reset(self):
        self.status = "idle"
        self.item_queue = []
        self.results = []
        self.current_index = 0
        self.total_items = 0
        self.current_item = ""
        self.pause_flag = False
        self.stop_flag = False
        self.output_file = ""

    @property
    def progress_percent(self) -> int:
        if self.total_items == 0:
            return 0
        return int((self.current_index / self.total_items) * 100)


class UserStateManager:
    """Manages per-user scraper state with thread-safe access."""

    def __init__(self):
        self._states: Dict[str, ScraperState] = {}
        self._last_access: Dict[str, datetime] = {}
        self._lock = threading.Lock()
        self._state_ttl = 86400  # 24 hours

    def get_state(self, user_id: str) -> ScraperState:
        with self._lock:
            self._last_access[user_id] = datetime.now()
            if user_id not in self._states:
                self._states[user_id] = ScraperState()
            return self._states[user_id]

    def cleanup_old_states(self):
        """Remove states idle for longer than TTL."""
        with self._lock:
            now = datetime.now()
            to_remove = []
            for user_id, last_access in self._last_access.items():
                if (now - last_access).total_seconds() > self._state_ttl:
                    state = self._states.get(user_id)
                    if state and state.status not in ("scraping", "paused"):
                        to_remove.append(user_id)
            for uid in to_remove:
                del self._states[uid]
                del self._last_access[uid]


# Global singleton
state_manager = UserStateManager()
```

For Selenium-based scrapers, extend `ScraperState` to hold the driver reference:

```python
class SeleniumScraperState(ScraperState):
    def __init__(self):
        super().__init__()
        self.driver = None  # Selenium WebDriver instance
```

---

## Background Threading

The worker function runs in a daemon thread, checking stop/pause flags each iteration.

```python
# backend/app/services/scraper_service.py

import threading
import logging
import time
from datetime import datetime
from pathlib import Path
from typing import List

import pandas as pd

from ..scrapers.example_site import ExampleSiteScraper
from .state_manager import ScraperState

logger = logging.getLogger(__name__)

OUTPUTS_DIR = Path(__file__).parent.parent.parent / "outputs"
OUTPUTS_DIR.mkdir(exist_ok=True)


def run_scraper(state: ScraperState, user_id: str):
    """Background worker that scrapes for each item in the queue."""
    scraper = ExampleSiteScraper()

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    output_path = OUTPUTS_DIR / f"{user_id[:8]}_results_{timestamp}.xlsx"
    state.output_file = str(output_path)
    state.status = "scraping"
    state.log(f"Starting scrape of {state.total_items} items")

    try:
        for i in range(state.current_index, len(state.item_queue)):
            # Check stop flag
            if state.stop_flag:
                state.log("Scraping stopped by user")
                state.status = "idle"
                return

            # Block while paused
            while state.pause_flag:
                if state.stop_flag:
                    state.status = "idle"
                    return
                time.sleep(0.5)

            item = state.item_queue[i]
            state.current_index = i
            state.current_item = item
            state.log(f"Searching: {item} ({i + 1}/{state.total_items})")

            # Scrape
            try:
                data = scraper.search(item)
                result = {"query": item, **data, "searched_at": datetime.now().isoformat()}
                state.results.append(result)
            except Exception as e:
                state.results.append({"query": item, "error": str(e)})
                state.log(f"  Error: {e}")

            state.current_index = i + 1
            scraper._polite_delay()

            # Incremental save after each item
            _save_results_to_excel(state.results, output_path)

        state.status = "completed"
        state.log(f"Scraping complete! {len(state.results)} items processed.")

    except Exception as e:
        state.status = "error"
        state.log(f"Fatal error: {e}")
        logger.error(f"Scraper fatal error for user {user_id}: {e}", exc_info=True)


def _save_results_to_excel(results: List[dict], output_path: Path):
    """Save results to Excel incrementally."""
    df = pd.DataFrame(results)
    df.to_excel(str(output_path), index=False, engine="openpyxl")


def start_scraper_thread(state: ScraperState, user_id: str):
    """Launch the scraping process in a background daemon thread."""
    thread = threading.Thread(
        target=run_scraper,
        args=(state, user_id),
        daemon=True,
    )
    state.scrape_thread = thread
    thread.start()
```

---

## Data Output & Storage

### Incremental Excel Saving

Save after each item so partial results survive crashes:

```python
def _save_results_to_excel(results: list[dict], output_path: Path):
    df = pd.DataFrame(results)
    # Optional: enforce column order
    column_order = ["query", "name", "price", "availability", "url", "error", "searched_at"]
    existing_cols = [c for c in column_order if c in df.columns]
    df = df[existing_cols]
    df.to_excel(str(output_path), index=False, engine="openpyxl")
```

### File Naming Convention

Follow the [File-Retention-Pattern.md](File-Retention-Pattern.md) convention:

```
{user_id[:8]}_results_{YYYYMMDD_HHMMSS}.xlsx
```

For styled output, see [Excel-Output-Formatting-Pattern.md](Excel-Output-Formatting-Pattern.md).

---

## API Endpoints

Complete router for scraper control:

```python
# backend/app/routers/scraper.py

import os
from pathlib import Path
from datetime import datetime

import pandas as pd
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import FileResponse

from ..core.security import get_current_user
from ..models.user import CurrentUser
from ..services.state_manager import state_manager
from ..services.scraper_service import start_scraper_thread

router = APIRouter()
UPLOADS_DIR = Path(__file__).parent.parent.parent / "uploads"
OUTPUTS_DIR = Path(__file__).parent.parent.parent / "outputs"


def _get_user_state(user: CurrentUser):
    return state_manager.get_state(user.oid)


@router.post("/upload")
async def upload_file(
    file: UploadFile = File(...),
    current_user: CurrentUser = Depends(get_current_user),
):
    """Upload an Excel/CSV file containing items to scrape."""
    state = _get_user_state(current_user)

    if state.status in ("scraping", "paused"):
        raise HTTPException(status_code=400, detail="Stop current run before uploading")

    filename = file.filename or "upload"
    ext = os.path.splitext(filename)[1].lower()
    if ext not in (".xlsx", ".xls", ".csv"):
        raise HTTPException(status_code=400, detail="Upload Excel or CSV file")

    UPLOADS_DIR.mkdir(exist_ok=True)
    safe_name = f"{current_user.oid[:8]}_{datetime.now().strftime('%Y%m%d_%H%M%S')}_{filename}"
    upload_path = UPLOADS_DIR / safe_name

    content = await file.read()
    with open(upload_path, "wb") as f:
        f.write(content)

    try:
        df = pd.read_csv(upload_path) if ext == ".csv" else pd.read_excel(upload_path, engine="openpyxl")

        # Flexible column detection
        target_col = None
        for col in df.columns:
            if col.strip().lower() in ("query", "search", "item", "part number", "part_number", "pn", "url"):
                target_col = col
                break
        if target_col is None:
            target_col = df.columns[0]

        # Extract unique items
        items = []
        seen = set()
        for val in df[target_col].fillna(""):
            val_str = str(val).strip()
            if val_str and val_str.lower() not in seen:
                items.append(val_str)
                seen.add(val_str.lower())

        if not items:
            return {"success": False, "error": "No items found in file"}

        state.item_queue = items
        state.results = []
        state.current_index = 0
        state.total_items = len(items)
        state.input_file_name = filename
        state.log(f"Loaded {len(items)} items from {filename}")

        return {"success": True, "filename": filename, "total_items": len(items)}

    except Exception as e:
        return {"success": False, "error": f"Error reading file: {str(e)}"}


@router.get("/status")
async def get_status(current_user: CurrentUser = Depends(get_current_user)):
    """Get current scraping status."""
    state = _get_user_state(current_user)
    output_ready = bool(state.output_file and Path(state.output_file).exists())

    return {
        "status": state.status,
        "current_item": state.current_item,
        "completed": state.current_index,
        "total": state.total_items,
        "progress_percent": state.progress_percent,
        "output_file": Path(state.output_file).name if output_ready else "",
        "output_ready": output_ready,
        "messages": state.messages[-30:],
    }


@router.get("/output/recent")
async def get_recent_output(current_user: CurrentUser = Depends(get_current_user)):
    """Get the most recent 10 results for live display."""
    state = _get_user_state(current_user)

    if not state.output_file or not Path(state.output_file).exists():
        return {"rows": [], "columns": []}

    try:
        df = pd.read_excel(state.output_file, engine="openpyxl")
        recent = df.tail(10)
        return {
            "rows": recent.fillna("").to_dict(orient="records"),
            "columns": list(recent.columns),
        }
    except Exception:
        return {"rows": [], "columns": []}


@router.post("/start")
async def start_scraping(current_user: CurrentUser = Depends(get_current_user)):
    state = _get_user_state(current_user)
    if state.status == "scraping":
        return {"success": False, "error": "Already scraping"}
    if not state.item_queue:
        return {"success": False, "error": "No items loaded. Upload a file first."}
    state.stop_flag = False
    state.pause_flag = False
    start_scraper_thread(state, current_user.oid)
    return {"success": True}


@router.post("/pause")
async def pause_scraping(current_user: CurrentUser = Depends(get_current_user)):
    state = _get_user_state(current_user)
    if state.status != "scraping":
        return {"success": False, "error": "Not currently scraping"}
    state.pause_flag = True
    state.status = "paused"
    state.log("Scraping paused")
    return {"success": True}


@router.post("/resume")
async def resume_scraping(current_user: CurrentUser = Depends(get_current_user)):
    state = _get_user_state(current_user)
    if state.status != "paused":
        return {"success": False, "error": "Not currently paused"}
    state.pause_flag = False
    state.status = "scraping"
    state.log("Scraping resumed")
    return {"success": True}


@router.post("/stop")
async def stop_scraping(current_user: CurrentUser = Depends(get_current_user)):
    state = _get_user_state(current_user)
    state.stop_flag = True
    state.pause_flag = False
    state.log("Stop requested...")
    return {"success": True}


@router.post("/clear")
async def clear_queue(current_user: CurrentUser = Depends(get_current_user)):
    state = _get_user_state(current_user)
    if state.status in ("scraping", "paused"):
        return {"success": False, "error": "Stop scraping first"}
    state.reset()
    state.log("Queue cleared")
    return {"success": True}


@router.get("/download/{filename}")
async def download_results(
    filename: str,
    current_user: CurrentUser = Depends(get_current_user),
):
    filepath = OUTPUTS_DIR / filename
    if not filepath.exists():
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(
        path=str(filepath),
        filename=filename,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )
```

---

## Frontend Integration

### Status Polling Hook

```jsx
// frontend/src/hooks/useScraperStatus.js

import { useState, useEffect } from "react";
import { useAuth } from "./useAuth";

export function useScraperStatus(isActive) {
  const [status, setStatus] = useState(null);
  const { getAccessToken } = useAuth();

  useEffect(() => {
    if (!isActive) return;

    const poll = async () => {
      const token = await getAccessToken();
      const res = await fetch("/api/scraper/status", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) setStatus(await res.json());
    };

    poll(); // Immediate first poll
    const interval = setInterval(poll, 2000);
    return () => clearInterval(interval);
  }, [isActive]);

  return status;
}
```

### Progress & Controls UI

```jsx
// frontend/src/components/ScraperControls.jsx

export function ScraperControls({ status, onStart, onPause, onResume, onStop }) {
  if (!status) return null;

  return (
    <div className="space-y-4">
      {/* Progress bar */}
      <div className="w-full bg-gray-200 rounded-full h-2.5 dark:bg-gray-700">
        <div
          className="bg-blue-600 h-2.5 rounded-full transition-all"
          style={{ width: `${status.progress_percent}%` }}
        />
      </div>
      <p className="text-sm text-muted-foreground">
        {status.completed} / {status.total} — {status.progress_percent}%
        {status.current_item && ` (${status.current_item})`}
      </p>

      {/* Control buttons */}
      <div className="flex gap-2">
        {status.status === "idle" && (
          <button onClick={onStart} className="btn btn-primary">Start</button>
        )}
        {status.status === "scraping" && (
          <button onClick={onPause} className="btn btn-secondary">Pause</button>
        )}
        {status.status === "paused" && (
          <button onClick={onResume} className="btn btn-primary">Resume</button>
        )}
        {["scraping", "paused"].includes(status.status) && (
          <button onClick={onStop} className="btn btn-destructive">Stop</button>
        )}
      </div>

      {/* Messages log */}
      <div className="h-48 overflow-y-auto rounded border bg-muted/50 p-3 font-mono text-xs">
        {status.messages?.map((msg, i) => (
          <div key={i}>{msg}</div>
        ))}
      </div>
    </div>
  );
}
```

---

## Complete Example

### Directory Structure

```
backend/
├── app/
│   ├── scrapers/
│   │   ├── __init__.py
│   │   ├── base.py              # BaseScraper ABC
│   │   ├── example_site.py      # Concrete scraper
│   │   └── selenium_utils.py    # Human-like behavior helpers (if using Selenium)
│   ├── services/
│   │   ├── state_manager.py     # ScraperState + UserStateManager
│   │   └── scraper_service.py   # Background worker + start_scraper_thread
│   ├── models/
│   │   └── scraper.py           # Pydantic response models (optional)
│   ├── routers/
│   │   └── scraper.py           # API endpoints
│   └── main.py                  # Include: app.include_router(scraper_router, prefix="/api/scraper")
├── uploads/                     # Uploaded input files
├── outputs/                     # Generated result files
└── requirements.txt
```

### Register the Router

```python
# backend/app/main.py

from .routers.scraper import router as scraper_router

app.include_router(scraper_router, prefix="/api/scraper", tags=["scraper"])
```

---

## Checklist

### Backend — Scraper
- [ ] Created `base.py` with `BaseScraper` ABC
- [ ] Implemented site-specific scraper(s) with `search()` method
- [ ] Session headers include realistic User-Agent
- [ ] `_polite_delay()` called between each request
- [ ] 15-second timeout on all HTTP requests
- [ ] Error handling returns `{"error": "..."}` instead of raising

### Backend — Selenium (if applicable)
- [ ] Chrome remote debugging launch with `--remote-debugging-port`
- [ ] `kill_existing_debuggers()` called before launch
- [ ] `webdriver-manager` for automatic ChromeDriver resolution
- [ ] Human-like delays and mouse movements between actions
- [ ] Stealth: webdriver property removed via CDP

### Backend — State & Threading
- [ ] `ScraperState` class with `pause_flag` and `stop_flag`
- [ ] `UserStateManager` with thread-safe lock
- [ ] Background thread is `daemon=True`
- [ ] Worker checks `stop_flag` then `pause_flag` each iteration
- [ ] State cleanup for 24-hour TTL

### Backend — API
- [ ] Upload endpoint parses Excel/CSV with flexible column detection
- [ ] Start/pause/resume/stop endpoints modify state flags
- [ ] Status endpoint returns progress, messages, and output readiness
- [ ] Download endpoint returns Excel file
- [ ] All endpoints use `get_current_user` dependency

### Frontend
- [ ] Status polling every 2 seconds while active
- [ ] Progress bar showing percent complete
- [ ] Start/Pause/Resume/Stop control buttons
- [ ] Messages log display (monospace, scrollable)
- [ ] Download button when output ready
