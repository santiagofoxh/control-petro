"""Pemex Portal Comercial Scraper.

Scrapes TAR availability, delivery schedules, pricing, and alerts from
https://www.comercialrefinacion.pemex.com/portal/

This module uses Playwright for browser automation to handle the JSP-based
portal with session cookies, CSRF tokens, and JavaScript-rendered content.

USAGE:
    Once credentials are configured, this runs automatically every 15 minutes
    via the scheduler. Can also be triggered manually via API.

IMPORTANT:
    - Real CSS selectors need to be mapped once we have portal credentials
    - Placeholder selectors marked with # TODO: MAP SELECTOR
    - The portal uses Java Servlets with JSESSIONID session management
"""

import asyncio
import logging
import random
import time
from datetime import datetime, date
from typing import Optional

logger = logging.getLogger("pemex.scraper")


# ------------------------------------------------------------------ #
# Portal URL patterns discovered from research
# ------------------------------------------------------------------ #

PORTAL_URLS = {
    "base": "https://www.comercialrefinacion.pemex.com/portal/",
    "login": "https://www.comercialrefinacion.pemex.com/portal/",  # Login form is on the main page
    "menu": "https://www.comercialrefinacion.pemex.com/portal/menu/controlador?Destino=menu_cte.jsp",
    "tar_info": "https://www.comercialrefinacion.pemex.com/portal/scgli002/controlador?Destino=mexico.jsp&MapaDestino=info_tad",
    "delivery_program": "https://www.comercialrefinacion.pemex.com/portal/scadi006/controlador?Destino=scadi006_01.jsp",
    "communications": "https://www.comercialrefinacion.pemex.com/portal/scadi008/controlador?Destino=comunicados",
    "logistica_menu": "https://www.comercialrefinacion.pemex.com/portal/menu/controlador?Destino=menu_log_ejecutivos.jsp",
}


class PemexScrapeResult:
    """Container for data scraped in one session."""

    def __init__(self, credential_id: int):
        self.credential_id = credential_id
        self.started_at = datetime.utcnow()
        self.finished_at = None
        self.status = "running"
        self.pages_scraped = 0
        self.error_message = None

        # Scraped data
        self.tar_availability = []   # list of dicts
        self.delivery_schedules = [] # list of dicts
        self.prices = []             # list of dicts
        self.alerts = []             # list of dicts

    @property
    def total_records(self):
        return (len(self.tar_availability) + len(self.delivery_schedules)
                + len(self.prices) + len(self.alerts))

    def finish(self, status="success", error=None):
        self.finished_at = datetime.utcnow()
        self.status = status
        self.error_message = error


class PemexScraper:
    """Browser-based scraper for Portal Comercial Pemex.

    Uses Playwright to automate a headless Chromium browser.
    Handles login, session management, and page-by-page scraping.
    """

    def __init__(self, credential_id: int, username: str, password: str,
                 portal_url: str = None):
        self.credential_id = credential_id
        self.username = username
        self.password = password
        self.portal_url = portal_url or PORTAL_URLS["base"]
        self.browser = None
        self.context = None
        self.page = None
        self._logged_in = False

    async def __aenter__(self):
        await self._launch_browser()
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        await self._close_browser()

    async def _launch_browser(self):
        """Launch headless Chromium with realistic settings."""
        try:
            from playwright.async_api import async_playwright
        except ImportError:
            raise ImportError(
                "Playwright not installed. Run: pip install playwright && playwright install chromium"
            )

        self._playwright = await async_playwright().start()
        self.browser = await self._playwright.chromium.launch(
            headless=True,
            args=[
                "--disable-blink-features=AutomationControlled",
                "--no-sandbox",
            ]
        )
        self.context = await self.browser.new_context(
            viewport={"width": 1366, "height": 768},
            user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/120.0.0.0 Safari/537.36"
            ),
            locale="es-MX",
            timezone_id="America/Mexico_City",
        )
        self.page = await self.context.new_page()
        logger.info("Browser launched for credential %d", self.credential_id)

    async def _close_browser(self):
        """Cleanly close browser resources."""
        if self.page:
            await self.page.close()
        if self.context:
            await self.context.close()
        if self.browser:
            await self.browser.close()
        if hasattr(self, "_playwright"):
            await self._playwright.stop()
        logger.info("Browser closed for credential %d", self.credential_id)

    async def _random_delay(self, min_s=2.0, max_s=6.0):
        """Random human-like delay between actions."""
        delay = random.uniform(min_s, max_s)
        await asyncio.sleep(delay)

    # ------------------------------------------------------------------ #
    # Login
    # ------------------------------------------------------------------ #

    async def login(self) -> bool:
        """Log into Portal Comercial Pemex.

        Returns True if login succeeded.

        TODO: Map real form selectors once we have credentials:
        - Username field selector
        - Password field selector
        - Submit button selector
        - Success indicator (post-login element)
        - Error message selector
        """
        logger.info("Attempting login for credential %d", self.credential_id)

        try:
            await self.page.goto(self.portal_url, wait_until="networkidle", timeout=30000)
            await self._random_delay(1.0, 3.0)

            # ---- TODO: MAP SELECTORS FROM REAL PORTAL ----
            # The portal likely has a form with username/password fields.
            # Common patterns for JSP portals:
            #
            # await self.page.fill('input[name="usuario"]', self.username)
            # await self.page.fill('input[name="contrasena"]', self.password)
            # await self.page.click('input[type="submit"]')
            #
            # Or it might use:
            # await self.page.fill('#txtUsuario', self.username)
            # await self.page.fill('#txtPassword', self.password)
            # await self.page.click('#btnIngresar')
            #
            # After submitting, wait for navigation:
            # await self.page.wait_for_url("**/menu/**", timeout=15000)

            # For now, raise NotImplementedError until we have real selectors
            raise NotImplementedError(
                "Login selectors not yet mapped. "
                "Need to inspect Portal Comercial Pemex with real credentials. "
                "See pemex/scraper.py login() method."
            )

            self._logged_in = True
            logger.info("Login successful for credential %d", self.credential_id)
            return True

        except NotImplementedError:
            raise
        except Exception as e:
            logger.error("Login failed for credential %d: %s", self.credential_id, e)
            return False

    # ------------------------------------------------------------------ #
    # TAR Availability Scraping
    # ------------------------------------------------------------------ #

    async def scrape_tar_availability(self) -> list:
        """Scrape TAR terminal availability data.

        Navigates to the TAR info page and extracts:
        - Terminal name
        - Fuel availability status (available/limited/closed)
        - Level percentages if shown
        - Wait times if shown

        Returns list of dicts with scraped data.

        TODO: Map real page structure once we have portal access:
        - TAR info page URL is: scgli002/controlador?Destino=mexico.jsp&MapaDestino=info_tad
        - Likely shows an interactive map of Mexico with TAR markers
        - Each TAR might have a detail popup/page
        """
        if not self._logged_in:
            raise RuntimeError("Must login before scraping")

        logger.info("Scraping TAR availability for credential %d", self.credential_id)
        results = []

        try:
            # Navigate to TAR info page
            await self.page.goto(PORTAL_URLS["tar_info"], wait_until="networkidle", timeout=30000)
            await self._random_delay(2.0, 5.0)

            # ---- TODO: MAP SELECTORS FROM REAL PORTAL ----
            # Example patterns we might find:
            #
            # # Get all TAR rows from a table
            # tar_rows = await self.page.query_selector_all('table.tar-list tr[data-tar-id]')
            # for row in tar_rows:
            #     tar_id = await row.get_attribute('data-tar-id')
            #     name = await row.query_selector('td.tar-name').inner_text()
            #     magna_status = await row.query_selector('td.magna-status').inner_text()
            #     premium_status = await row.query_selector('td.premium-status').inner_text()
            #     diesel_status = await row.query_selector('td.diesel-status').inner_text()
            #
            #     for fuel, status in [('magna', magna_status), ('premium', premium_status), ('diesel', diesel_status)]:
            #         results.append({
            #             'tar_pemex_id': tar_id,
            #             'tar_name': name,
            #             'fuel_type': fuel,
            #             'status': _parse_status(status),
            #             'level_percent': _parse_level(status),
            #             'scraped_at': datetime.utcnow(),
            #         })
            #
            # Or the portal might use a map with clickable markers:
            # markers = await self.page.query_selector_all('.map-marker')
            # for marker in markers:
            #     await marker.click()
            #     await self._random_delay(0.5, 1.5)
            #     popup_text = await self.page.query_selector('.marker-popup').inner_text()
            #     # parse popup_text for availability data

            logger.info("TAR availability: selectors not yet mapped")
            self.pages_scraped = 1

        except Exception as e:
            logger.error("Error scraping TAR availability: %s", e)

        return results

    # ------------------------------------------------------------------ #
    # Delivery Schedule Scraping
    # ------------------------------------------------------------------ #

    async def scrape_delivery_schedules(self) -> list:
        """Scrape delivery schedule (programa de entregas) for this client.

        Navigates to: scadi006/controlador?Destino=scadi006_01.jsp

        Returns list of dicts with schedule data.

        TODO: Map real page structure once we have portal access.
        """
        if not self._logged_in:
            raise RuntimeError("Must login before scraping")

        logger.info("Scraping delivery schedules for credential %d", self.credential_id)
        results = []

        try:
            await self.page.goto(PORTAL_URLS["delivery_program"], wait_until="networkidle", timeout=30000)
            await self._random_delay(2.0, 5.0)

            # ---- TODO: MAP SELECTORS FROM REAL PORTAL ----
            # Expected: a table/calendar of scheduled deliveries
            # Likely columns: Date, TAR, Shift/Turno, Time, Fuel, Volume, Status

            logger.info("Delivery schedules: selectors not yet mapped")

        except Exception as e:
            logger.error("Error scraping delivery schedules: %s", e)

        return results

    # ------------------------------------------------------------------ #
    # Pricing Scraping
    # ------------------------------------------------------------------ #

    async def scrape_prices(self) -> list:
        """Scrape current Pemex fuel prices.

        Returns list of price dicts.

        TODO: Map real price page once we have portal access.
        """
        if not self._logged_in:
            raise RuntimeError("Must login before scraping")

        logger.info("Scraping prices for credential %d", self.credential_id)
        results = []

        try:
            # Prices might be on the menu page or a dedicated section
            await self.page.goto(PORTAL_URLS["menu"], wait_until="networkidle", timeout=30000)
            await self._random_delay(2.0, 5.0)

            # ---- TODO: MAP SELECTORS FROM REAL PORTAL ----

            logger.info("Prices: selectors not yet mapped")

        except Exception as e:
            logger.error("Error scraping prices: %s", e)

        return results

    # ------------------------------------------------------------------ #
    # Alerts / Communications
    # ------------------------------------------------------------------ #

    async def scrape_alerts(self) -> list:
        """Scrape operational alerts and communications.

        Navigates to: scadi008/controlador?Destino=comunicados

        Returns list of alert dicts.

        TODO: Map real page structure once we have portal access.
        """
        if not self._logged_in:
            raise RuntimeError("Must login before scraping")

        logger.info("Scraping alerts for credential %d", self.credential_id)
        results = []

        try:
            await self.page.goto(PORTAL_URLS["communications"], wait_until="networkidle", timeout=30000)
            await self._random_delay(2.0, 5.0)

            # ---- TODO: MAP SELECTORS FROM REAL PORTAL ----
            # Expected: a list of communications/notices
            # Parse: title, description, date, severity

            logger.info("Alerts: selectors not yet mapped")

        except Exception as e:
            logger.error("Error scraping alerts: %s", e)

        return results

    # ------------------------------------------------------------------ #
    # Full Scrape Orchestration
    # ------------------------------------------------------------------ #

    async def scrape_all(self) -> PemexScrapeResult:
        """Run a complete scrape session: login + all data types.

        Returns PemexScrapeResult with all scraped data.
        """
        result = PemexScrapeResult(self.credential_id)

        try:
            # Step 1: Login
            success = await self.login()
            if not success:
                result.finish("failed", "Login failed")
                return result

            # Step 2: Scrape each data type with delays between
            result.tar_availability = await self.scrape_tar_availability()
            await self._random_delay(3.0, 7.0)

            result.delivery_schedules = await self.scrape_delivery_schedules()
            await self._random_delay(3.0, 7.0)

            result.prices = await self.scrape_prices()
            await self._random_delay(3.0, 7.0)

            result.alerts = await self.scrape_alerts()

            # Calculate stats
            result.pages_scraped = 4
            result.finish("success")
            logger.info(
                "Scrape complete for credential %d: %d records",
                self.credential_id, result.total_records,
            )

        except NotImplementedError as e:
            result.finish("failed", str(e))
            logger.warning("Scraper not yet configured: %s", e)
        except Exception as e:
            result.finish("failed", str(e))
            logger.error("Scrape failed for credential %d: %s", self.credential_id, e)

        return result


# ------------------------------------------------------------------ #
# Synchronous wrapper for use from Flask / scheduler
# ------------------------------------------------------------------ #

def run_scrape(credential_id: int) -> PemexScrapeResult:
    """Run a full scrape for one credential (synchronous wrapper).

    Usage:
        from pemex.scraper import run_scrape
        result = run_scrape(credential_id=1)
    """
    from pemex.credentials import get_credentials

    username, password = get_credentials(credential_id)

    async def _run():
        async with PemexScraper(credential_id, username, password) as scraper:
            return await scraper.scrape_all()

    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(_run())
    finally:
        loop.close()


def save_scrape_results(db_session, result: PemexScrapeResult):
    """Persist a PemexScrapeResult into the database.

    Creates a ScrapeLog entry and saves all scraped data.
    """
    from database import (
        ScrapeLog, TARAvailability, TARDeliverySchedule,
        PemexPrice, PemexAlert, TARTerminal,
    )

    # Create audit log
    log = ScrapeLog(
        credential_id=result.credential_id,
        started_at=result.started_at,
        finished_at=result.finished_at,
        status=result.status,
        pages_scraped=result.pages_scraped,
        records_saved=result.total_records,
        error_message=result.error_message,
        duration_seconds=(
            (result.finished_at - result.started_at).total_seconds()
            if result.finished_at else None
        ),
    )
    db_session.add(log)
    db_session.flush()  # Get log.id

    # Save TAR availability
    for item in result.tar_availability:
        tar = TARTerminal.query.filter_by(pemex_id=item.get("tar_pemex_id")).first()
        if not tar:
            continue
        avail = TARAvailability(
            tar_id=tar.id,
            fuel_type=item["fuel_type"],
            status=item.get("status", "unknown"),
            level_percent=item.get("level_percent"),
            estimated_liters=item.get("estimated_liters"),
            wait_time_minutes=item.get("wait_time_minutes"),
            notes=item.get("notes"),
            scraped_at=item.get("scraped_at", datetime.utcnow()),
            scrape_log_id=log.id,
        )
        db_session.add(avail)

    # Save delivery schedules
    for item in result.delivery_schedules:
        tar = TARTerminal.query.filter_by(pemex_id=item.get("tar_pemex_id")).first()
        if not tar:
            continue
        sched = TARDeliverySchedule(
            credential_id=result.credential_id,
            tar_id=tar.id,
            scheduled_date=item.get("scheduled_date"),
            shift_code=item.get("shift_code"),
            shift_time=item.get("shift_time"),
            fuel_type=item.get("fuel_type"),
            volume_liters=item.get("volume_liters"),
            status=item.get("status"),
            scraped_at=datetime.utcnow(),
            scrape_log_id=log.id,
        )
        db_session.add(sched)

    # Save prices
    for item in result.prices:
        tar = TARTerminal.query.filter_by(pemex_id=item.get("tar_pemex_id")).first()
        price = PemexPrice(
            tar_id=tar.id if tar else None,
            region=item.get("region"),
            fuel_type=item["fuel_type"],
            price_per_liter=item["price_per_liter"],
            price_type=item.get("price_type"),
            effective_date=item.get("effective_date", date.today()),
            scraped_at=datetime.utcnow(),
        )
        db_session.add(price)

    # Save alerts
    for item in result.alerts:
        tar = TARTerminal.query.filter_by(pemex_id=item.get("tar_pemex_id")).first()
        alert = PemexAlert(
            tar_id=tar.id if tar else None,
            alert_type=item.get("alert_type", "info"),
            title=item.get("title"),
            description=item.get("description"),
            severity=item.get("severity", "info"),
            effective_from=item.get("effective_from"),
            effective_until=item.get("effective_until"),
            scraped_at=datetime.utcnow(),
            scrape_log_id=log.id,
        )
        db_session.add(alert)

    log.records_saved = result.total_records
    log.tar_count = len(set(
        item.get("tar_pemex_id") for item in result.tar_availability
    ))
    db_session.commit()

    return log
