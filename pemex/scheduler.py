"""Pemex TAR scrape scheduler.

Runs scrapes every 15 minutes for all active credentials, staggered
to avoid hitting the Pemex portal with simultaneous logins.

Uses APScheduler BackgroundScheduler for non-blocking operation
within the Flask process.
"""

import logging
import time
from datetime import datetime

logger = logging.getLogger("pemex.scheduler")

# Global scheduler reference
_scheduler = None
_app = None


def init_scheduler(app):
    """Initialize the Pemex scrape scheduler.

    Call this from app.py after init_db().
    Only starts if PEMEX_SCRAPER_ENABLED env var is set.
    """
    global _scheduler, _app
    import os

    if not os.environ.get("PEMEX_SCRAPER_ENABLED"):
        logger.info("Pemex scraper disabled (set PEMEX_SCRAPER_ENABLED=1 to enable)")
        return

    try:
        from apscheduler.schedulers.background import BackgroundScheduler
        from apscheduler.triggers.interval import IntervalTrigger
    except ImportError:
        logger.warning("APScheduler not installed. Pemex scheduler disabled.")
        return

    _app = app

    _scheduler = BackgroundScheduler(
        job_defaults={
            "coalesce": True,          # If multiple missed, run once
            "max_instances": 1,         # Never overlap runs
            "misfire_grace_time": 300,  # 5 min grace for missed triggers
        }
    )

    # Main job: scrape all credentials every 15 minutes
    _scheduler.add_job(
        func=_run_all_scrapes,
        trigger=IntervalTrigger(minutes=15),
        id="pemex_tar_scrape",
        name="Pemex TAR Availability Scrape",
        next_run_time=None,  # Don't run immediately on startup
    )

    # Health check: verify scheduler is alive every 5 minutes
    _scheduler.add_job(
        func=_scheduler_heartbeat,
        trigger=IntervalTrigger(minutes=5),
        id="pemex_heartbeat",
        name="Scheduler Heartbeat",
    )

    _scheduler.start()
    logger.info("Pemex scheduler started (interval: 15 min)")


def trigger_scrape_now():
    """Manually trigger an immediate scrape of all credentials.

    Returns dict with job info.
    """
    if not _scheduler:
        return {"error": "Scheduler not initialized", "enabled": False}

    job = _scheduler.get_job("pemex_tar_scrape")
    if job:
        _scheduler.modify_job("pemex_tar_scrape", next_run_time=datetime.utcnow())
        return {"triggered": True, "job_id": "pemex_tar_scrape"}
    return {"error": "Scrape job not found"}


def get_scheduler_status():
    """Get current scheduler status for the dashboard."""
    if not _scheduler:
        return {
            "enabled": False,
            "running": False,
            "message": "Pemex scraper disabled (set PEMEX_SCRAPER_ENABLED=1)",
        }

    job = _scheduler.get_job("pemex_tar_scrape")
    return {
        "enabled": True,
        "running": _scheduler.running,
        "next_run": job.next_run_time.isoformat() if job and job.next_run_time else None,
        "interval_minutes": 15,
    }


def _run_all_scrapes():
    """Execute scrapes for all active credentials, staggered.

    This runs inside the APScheduler thread, so we need
    the Flask app context for database access.
    """
    if not _app:
        logger.error("No Flask app reference. Cannot run scrapes.")
        return

    with _app.app_context():
        from pemex.credentials import get_active_credentials, record_login_success, record_login_failure
        from pemex.scraper import run_scrape, save_scrape_results
        from database import db

        credentials = get_active_credentials()
        if not credentials:
            logger.info("No active Pemex credentials. Skipping scrape cycle.")
            return

        logger.info("Starting Pemex scrape cycle for %d credentials", len(credentials))

        for i, cred in enumerate(credentials):
            if i > 0:
                # Stagger: 30-second delay between credential scrapes
                stagger = 30 + (i * 5)
                logger.info("Stagger delay: %ds before credential %d", stagger, cred.id)
                time.sleep(stagger)

            try:
                logger.info("Scraping credential %d (%s)", cred.id, cred.label or "unnamed")
                result = run_scrape(cred.id)

                # Save results to database
                save_scrape_results(db.session, result)

                if result.status == "success":
                    record_login_success(db.session, cred.id)
                    logger.info(
                        "Credential %d: %d records scraped successfully",
                        cred.id, result.total_records,
                    )
                else:
                    record_login_failure(db.session, cred.id, result.error_message or "Unknown error")
                    logger.warning(
                        "Credential %d: scrape %s - %s",
                        cred.id, result.status, result.error_message,
                    )

            except Exception as e:
                logger.error("Credential %d: unexpected error - %s", cred.id, e)
                try:
                    record_login_failure(db.session, cred.id, str(e))
                except Exception:
                    db.session.rollback()

        logger.info("Pemex scrape cycle complete")


def _scheduler_heartbeat():
    """Simple heartbeat to verify scheduler is alive."""
    logger.debug("Pemex scheduler heartbeat: alive at %s", datetime.utcnow().isoformat())


def shutdown_scheduler():
    """Cleanly shut down the scheduler."""
    global _scheduler
    if _scheduler and _scheduler.running:
        _scheduler.shutdown(wait=False)
        logger.info("Pemex scheduler shut down")
        _scheduler = None
