"""Control Petro - AI platform for Mexican petroleum distributors."""
import os
import json
from datetime import datetime, date, timedelta
from flask import Flask, jsonify, request, send_from_directory, send_file, abort

from database import db, Station, FuelTransaction, InventorySnapshot, Report, Prediction
import reports
import predictions
import sat_xml_generator

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

app = Flask(__name__, static_folder="static", template_folder="templates")
app.config["SQLALCHEMY_DATABASE_URI"] = f"sqlite:///{os.path.join(BASE_DIR, 'controlpetro.db')}"
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
app.config["JSON_SORT_KEYS"] = False

db.init_app(app)


# ------------------------------------------------------------------ #
#  Serve SPA frontend
# ------------------------------------------------------------------ #
@app.route("/")
def index():
        return send_from_directory("static", "index.html")
    

@app.route("/static/<path:path>")
def serve_static(path):
        return send_from_directory("static", path)
    

# ------------------------------------------------------------------ #
#  API: Dashboard
# ------------------------------------------------------------------ #
@app.route("/api/dashboard")
def api_dashboard():
        today = date.today()
        start = datetime.combine(today, datetime.min.time())
        end = datetime.combine(today, datetime.max.time())
    
    # Total liters sold today
    total_sold = db.session.query(
                db.func.coalesce(db.func.sum(FuelTransaction.liters), 0)
    ).filter(
                FuelTransaction.transaction_type == "sold",
                FuelTransaction.timestamp.between(start, end),
    ).scalar()

    # Sold by fuel type
    fuel_sold = {}
    for ft in ["magna", "premium", "diesel"]:
                val = db.session.query(
                                db.func.coalesce(db.func.sum(FuelTransaction.liters), 0)
                ).filter(
                                FuelTransaction.transaction_type == "sold",
                                FuelTransaction.fuel_type == ft,
                                FuelTransaction.timestamp.between(start, end),
                ).scalar()
                fuel_sold[ft] = float(val)
        
    # Yesterday comparison
    ystart = datetime.combine(today - timedelta(days=1), datetime.min.time())
    yend = datetime.combine(today - timedelta(days=1), datetime.max.time())
    yesterday_sold = db.session.query(
                db.func.coalesce(db.func.sum(FuelTransaction.liters), 0)
    ).filter(
                FuelTransaction.transaction_type == "sold",
                FuelTransaction.timestamp.between(ystart, yend),
    ).scalar()

    change_pct = ((float(total_sold) - float(yesterday_sold)) / float(yesterday_sold) * 100) if yesterday_sold else 0

    # Station counts by alert level
    active_stations = Station.query.filter_by(active=True).count()
    critical_count = 0
    low_count = 0
    normal_count = 0
    for station in Station.query.filter_by(active=True).all():
                worst = 100
                for ft in ["magna", "premium", "diesel"]:
                                snap = InventorySnapshot.query.filter_by(
                                                    station_id=station.id, fuel_type=ft, snapshot_date=today,
                                ).first()
                                cap = getattr(station, f"{ft}_capacity", 40000)
                                pct = (snap.liters_on_hand / cap * 100) if (snap and cap > 0) else 50
                                worst = min(worst, pct)
                            if worst < 25:
                                            critical_count += 1
                            elif worst < 40:
                                            low_count += 1
                            else:
                                            normal_count += 1
                                
    # Reports status
    today_reports = Report.query.filter_by(report_date=today).count()

    # Pending predictions
    pending_orders = Prediction.query.filter(
                Prediction.fulfilled == False,
                Prediction.recommended_date >= datetime.combine(today, datetime.min.time()),
    ).count()

    return jsonify({
                "total_sold_today": float(total_sold),
                "fuel_sold": fuel_sold,
                "change_pct": round(change_pct, 1),
                "active_stations": active_stations,
                "critical_stations": critical_count,
                "low_stations": low_count,
                "normal_stations": normal_count,
                "reports_today": today_reports,
                "pending_orders": pending_orders,
                "date": today.isoformat(),
    })


@app.route("/api/dashboard/sales-chart")
def api_sales_chart():
        days = request.args.get("days", 7, type=int)
    today = date.today()
    result = []
    for d in range(days - 1, -1, -1):
                target = today - timedelta(days=d)
        start = datetime.combine(target, datetime.min.time())
        end = datetime.combine(target, datetime.max.time())
        day_data = {"date": target.isoformat(), "label": target.strftime("%d %b")}
        for ft in ["magna", "premium", "diesel"]:
                        val = db.session.query(
                                            db.func.coalesce(db.func.sum(FuelTransaction.liters), 0)
                        ).filter(
                                            FuelTransaction.transaction_type == "sold",
                                            FuelTransaction.fuel_type == ft,
                                            FuelTransaction.timestamp.between(start, end),
                        ).scalar()
                        day_data[ft] = float(val)
                    day_data["total"] = day_data["magna"] + day_data["premium"] + day_data["diesel"]
        result.append(day_data)
    return jsonify(result)


# ------------------------------------------------------------------ #
#  API: Stations
# ------------------------------------------------------------------ #
@app.route("/api/stations")
def api_stations():
        today = date.today()
    stations = Station.query.filter_by(active=True).order_by(Station.code).all()
    result = []
    for s in stations:
                levels = {}
        worst_pct = 100
        for ft in ["magna", "premium", "diesel"]:
                        snap = InventorySnapshot.query.filter_by(
                                            station_id=s.id, fuel_type=ft, snapshot_date=today,
                        ).first()
                        cap = getattr(s, f"{ft}_capacity", 40000)
                        liters = snap.liters_on_hand if snap else 0
                        pct = (liters / cap * 100) if cap > 0 else 0
                        levels[ft] = {"liters": round(liters, 0), "capacity": cap, "pct": round(pct, 1)}
                        worst_pct = min(worst_pct, pct)
            
        # Today sales
        start = datetime.combine(today, datetime.min.time())
        end = datetime.combine(today, datetime.max.time())
        today_sold = db.session.query(
                        db.func.coalesce(db.func.sum(FuelTransaction.liters), 0)
        ).filter(
                        FuelTransaction.station_id == s.id,
                        FuelTransaction.transaction_type == "sold",
                        FuelTransaction.timestamp.between(start, end),
        ).scalar()

        # SAT compliance check
        has_report = Report.query.filter_by(report_date=today).filter(
                        (Report.station_id == s.id) | (Report.station_id.is_(None))
        ).first()

        status = "normal" if worst_pct > 40 else ("low" if worst_pct > 25 else "critical")
        result.append({
                        "id": s.id, "code": s.code, "name": s.name,
                        "address": s.address, "city": s.city,
                        "levels": levels,
                        "today_sold": float(today_sold),
                        "sat_compliant": has_report is not None,
                        "status": status,
        })
    return jsonify(result)


@app.route("/api/stations/<int:station_id>")
def api_station_detail(station_id):
        station = Station.query.get_or_404(station_id)
    today = date.today()
    levels = {}
    for ft in ["magna", "premium", "diesel"]:
                snap = InventorySnapshot.query.filter_by(
                    station_id=station.id, fuel_type=ft, snapshot_date=today,
    ).first()
        cap = getattr(station, f"{ft}_capacity", 40000)
        liters = snap.liters_on_hand if snap else 0
        levels[ft] = {"liters": round(liters, 0), "capacity": cap, "pct": round(liters/cap*100, 1) if cap > 0 else 0}

    return jsonify({
                "id": station.id, "code": station.code, "name": station.name,
                "address": station.address, "city": station.city,
                "levels": levels,
                "magna_capacity": station.magna_capacity,
                "premium_capacity": station.premium_capacity,
                "diesel_capacity": station.diesel_capacity,
    })


# ------------------------------------------------------------------ #
#  API: Inventory
# ------------------------------------------------------------------ #
@app.route("/api/inventory/summary")
def api_inventory_summary():
        today = date.today()
    summary = {"magna": 0, "premium": 0, "diesel": 0, "total_capacity": {"magna": 0, "premium": 0, "diesel": 0}}
    stations = Station.query.filter_by(active=True).all()
    for s in stations:
                for ft in ["magna", "premium", "diesel"]:
                                snap = InventorySnapshot.query.filter_by(
                                                    station_id=s.id, fuel_type=ft, snapshot_date=today,
                                ).first()
                                summary[ft] += snap.liters_on_hand if snap else 0
                                summary["total_capacity"][ft] += getattr(s, f"{ft}_capacity", 0)
                    
    summary["total"] = summary["magna"] + summary["premium"] + summary["diesel"]
    return jsonify(summary)


@app.route("/api/inventory/history")
def api_inventory_history():
        days = request.args.get("days", 7, type=int)
    today = date.today()
    result = []
    for d in range(days - 1, -1, -1):
                target = today - timedelta(days=d)
        start = datetime.combine(target, datetime.min.time())
        end = datetime.combine(target, datetime.max.time())
        received = float(db.session.query(
                        db.func.coalesce(db.func.sum(FuelTransaction.liters), 0)
        ).filter(
                        FuelTransaction.transaction_type == "received",
                        FuelTransaction.timestamp.between(start, end),
        ).scalar())
        sold = float(db.session.query(
                        db.func.coalesce(db.func.sum(FuelTransaction.liters), 0)
        ).filter(
                        FuelTransaction.transaction_type == "sold",
                        FuelTransaction.timestamp.between(start, end),
        ).scalar())
        total_on_hand = float(db.session.query(
                        db.func.coalesce(db.func.sum(InventorySnapshot.liters_on_hand), 0)
        ).filter(InventorySnapshot.snapshot_date == target).scalar())

        result.append({
                        "date": target.isoformat(),
                        "label": target.strftime("%d %b"),
                        "received": round(received, 0),
                        "sold": round(sold, 0),
                        "on_hand": round(total_on_hand, 0),
                        "net": round(received - sold, 0),
        })
    return jsonify(result)


@app.route("/api/inventory/record", methods=["POST"])
def api_record_transaction():
        data = request.json
    required = ["station_id", "fuel_type", "transaction_type", "liters"]
    for field in required:
                if field not in data:
                                return jsonify({"error": f"Missing field: {field}"}), 400
                    
    station = Station.query.get(data["station_id"])
    if not station:
                return jsonify({"error": "Station not found"}), 404

    tx = FuelTransaction(
                station_id=data["station_id"],
                fuel"""Control Petro - AI platform for Mexican petroleum distributors."""
import os
import json
from datetime import datetime, date, timedelta
from flask import Flask, jsonify, request, send_from_directory, send_file, abort

from database import db, Station, FuelTransaction, InventorySnapshot, Report, Prediction
import reports
import predictions
import sat_xml_generator

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

app = Flask(__name__, static_folder="static", template_folder="templates")
app.config["SQLALCHEMY_DATABASE_URI"] = f"sqlite:///{os.path.join(BASE_DIR, 'controlpetro.db')}"
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
app.config["JSON_SORT_KEYS"] = False

db.init_app(app)


# ------------------------------------------------------------------ #
#  Serve SPA frontend
# ------------------------------------------------------------------ #
@app.route("/")
def index():
    return send_from_directory("static", "index.html")


@app.route("/static/<path:path>")
def serve_static(path):
    return send_from_directory("static", path)


# ------------------------------------------------------------------ #
#  API: Dashboard
# ------------------------------------------------------------------ #
@app.route("/api/dashboard")
def api_dashboard():
    today = date.today()
    start = datetime.combine(today, datetime.min.time())
    end = datetime.combine(today, datetime.max.time())

    # Total liters sold today
    total_sold = db.session.query(
        db.func.coalesce(db.func.sum(FuelTransaction.liters), 0)
    ).filter(
        FuelTransaction.transaction_type == "sold",
        FuelTransaction.timestamp.between(start, end),
    ).scalar()

    # Sold by fuel type
    fuel_sold = {}
    for ft in ["magna", "premium", "diesel"]:
        val = db.session.query(
            db.func.coalesce(db.func.sum(FuelTransaction.liters), 0)
        ).filter(
            FuelTransaction.transaction_type == "sold",
            FuelTransaction.fuel_type == ft,
            FuelTransaction.timestamp.between(start, end),
        ).scalar()
        fuel_sold[ft] = float(val)

    # Yesterday comparison
    ystart = datetime.combine(today - timedelta(days=1), datetime.min.time())
    yend = datetime.combine(today - timedelta(days=1), datetime.max.time())
    yesterday_sold = db.session.query(
        db.func.coalesce(db.func.sum(FuelTransaction.liters), 0)
    ).filter(
        FuelTransaction.transaction_type == "sold",
        FuelTransaction.timestamp.between(ystart, yend),
    ).scalar()

    change_pct = ((float(total_sold) - float(yesterday_sold)) / float(yesterday_sold) * 100) if yesterday_sold else 0

    # Station counts by alert level
    active_stations = Station.query.filter_by(active=True).count()
    critical_count = 0
    low_count = 0
    normal_count = 0
    for station in Station.query.filter_by(active=True).all():
        worst = 100
        for ft in ["magna", "premium", "diesel"]:
            snap = InventorySnapshot.query.filter_by(
                station_id=station.id, fuel_type=ft, snapshot_date=today,
            ).first()
            cap = getattr(station, f"{ft}_capacity", 40000)
            pct = (snap.liters_on_hand / cap * 100) if (snap and cap > 0) else 50
            worst = min(worst, pct)
        if worst < 25:
            critical_count += 1
        elif worst < 40:
            low_count += 1
        else:
            normal_count += 1

    # Reports status
    today_reports = Report.query.filter_by(report_date=today).count()

    # Pending predictions
    pending_orders = Prediction.query.filter(
        Prediction.fulfilled == False,
        Prediction.recommended_date >= datetime.combine(today, datetime.min.time()),
    ).count()

    return jsonify({
        "total_sold_today": float(total_sold),
        "fuel_sold": fuel_sold,
        "change_pct": round(change_pct, 1),
        "active_stations": active_stations,
        "critical_stations": critical_count,
        "low_stations": low_count,
        "normal_stations": normal_count,
        "reports_today": today_reports,
        "pending_orders": pending_orders,
        "date": today.isoformat(),
    })


@app.route("/api/dashboard/sales-chart")
def api_sales_chart():
    days = request.args.get("days", 7, type=int)
    today = date.today()
    result = []
    for d in range(days - 1, -1, -1):
        target = today - timedelta(days=d)
        start = datetime.combine(target, datetime.min.time())
        end = datetime.combine(target, datetime.max.time())
        day_data = {"date": target.isoformat(), "label": target.strftime("%d %b")}
        for ft in ["magna", "premium", "diesel"]:
            val = db.session.query(
                db.func.coalesce(db.func.sum(FuelTransaction.liters), 0)
            ).filter(
                FuelTransaction.transaction_type == "sold",
                FuelTransaction.fuel_type == ft,
                FuelTransaction.timestamp.between(start, end),
            ).scalar()
            day_data[ft] = float(val)
        day_data["total"] = day_data["magna"] + day_data["premium"] + day_data["diesel"]
        result.append(day_data)
    return jsonify(result)


# ------------------------------------------------------------------ #
#  API: Stations
# ------------------------------------------------------------------ #
@app.route("/api/stations")
def api_stations():
    today = date.today()
    stations = Station.query.filter_by(active=True).order_by(Station.code).all()
    result = []
    for s in stations:
        levels = {}
        worst_pct = 100
        for ft in ["magna", "premium", "diesel"]:
            snap = InventorySnapshot.query.filter_by(
                station_id=s.id, fuel_type=ft, snapshot_date=today,
            ).first()
            cap = getattr(s, f"{ft}_capacity", 40000)
            liters = snap.liters_on_hand if snap else 0
            pct = (liters / cap * 100) if cap > 0 else 0
            levels[ft] = {"liters": round(liters, 0), "capacity": cap, "pct": round(pct, 1)}
            worst_pct = min(worst_pct, pct)

        # Today sales
        start = datetime.combine(today, datetime.min.time())
        end = datetime.combine(today, datetime.max.time())
        today_sold = db.session.query(
            db.func.coalesce(db.func.sum(FuelTransaction.liters), 0)
        ).filter(
            FuelTransaction.station_id == s.id,
            FuelTransaction.transaction_type == "sold",
            FuelTransaction.timestamp.between(start, end),
        ).scalar()

        # SAT compliance check
        has_report = Report.query.filter_by(report_date=today).filter(
            (Report.station_id == s.id) | (Report.station_id.is_(None))
        ).first()

        status = "normal" if worst_pct > 40 else ("low" if worst_pct > 25 else "critical")
        result.append({
            "id": s.id, "code": s.code, "name": s.name,
            "address": s.address, "city": s.city,
            "levels": levels,
            "today_sold": float(today_sold),
            "sat_compliant": has_report is not None,
            "status": status,
        })
    return jsonify(result)


@app.route("/api/stations/<int:station_id>")
def api_station_detail(station_id):
    station = Station.query.get_or_404(station_id)
    today = date.today()
    levels = {}
    for ft in ["magna", "premium", "diesel"]:
        snap = InventorySnapshot.query.filter_by(
            station_id=station.id, fuel_type=ft, snapshot_date=today,
        ).first()
        cap = getattr(station, f"{ft}_capacity", 40000)
        liters = snap.liters_on_hand if snap else 0
        levels[ft] = {"liters": round(liters, 0), "capacity": cap, "pct": round(liters/cap*100, 1) if cap > 0 else 0}

    return jsonify({
        "id": station.id, "code": station.code, "name": station.name,
        "address": station.address, "city": station.city,
        "levels": levels,
        "magna_capacity": station.magna_capacity,
        "premium_capacity": station.premium_capacity,
        "diesel_capacity": station.diesel_capacity,
    })


# ------------------------------------------------------------------ #
#  API: Inventory
# ------------------------------------------------------------------ #
@app.route("/api/inventory/summary")
def api_inventory_summary():
    today = date.today()
    summary = {"magna": 0, "premium": 0, "diesel": 0, "total_capacity": {"magna": 0, "premium": 0, "diesel": 0}}
    stations = Station.query.filter_by(active=True).all()
    for s in stations:
        for ft in ["magna", "premium", "diesel"]:
            snap = InventorySnapshot.query.filter_by(
                station_id=s.id, fuel_type=ft, snapshot_date=today,
            ).first()
            summary[ft] += snap.liters_on_hand if snap else 0
            summary["total_capacity"][ft] += getattr(s, f"{ft}_capacity", 0)

    summary["total"] = summary["magna"] + summary["premium"] + summary["diesel"]
    return jsonify(summary)


@app.route("/api/inventory/history")
def api_inventory_history():
    days = request.args.get("days", 7, type=int)
    today = date.today()
    result = []
    for d in range(days - 1, -1, -1):
        target = today - timedelta(days=d)
        start = datetime.combine(target, datetime.min.time())
        end = datetime.combine(target, datetime.max.time())
        received = float(db.session.query(
            db.func.coalesce(db.func.sum(FuelTransaction.liters), 0)
        ).filter(
            FuelTransaction.transaction_type == "received",
            FuelTransaction.timestamp.between(start, end),
        ).scalar())
        sold = float(db.session.query(
            db.func.coalesce(db.func.sum(FuelTransaction.liters), 0)
        ).filter(
            FuelTransaction.transaction_type == "sold",
            FuelTransaction.timestamp.between(start, end),
        ).scalar())
        total_on_hand = float(db.session.query(
            db.func.coalesce(db.func.sum(InventorySnapshot.liters_on_hand), 0)
        ).filter(InventorySnapshot.snapshot_date == target).scalar())

        result.append({
            "date": target.isoformat(),
            "label": target.strftime("%d %b"),
            "received": round(received, 0),
            "sold": round(sold, 0),
            "on_hand": round(total_on_hand, 0),
            "net": round(received - sold, 0),
        })
    return jsonify(result)


@app.route("/api/inventory/record", methods=["POST"])
def api_record_transaction():
    data = request.json
    required = ["station_id", "fuel_type", "transaction_type", "liters"]
    for field in required:
        if field not in data:
            return jsonify({"error": f"Missing field: {field}"}), 400

    station = Station.query.get(data["station_id"])
    if not station:
        return jsonify({"error": "Station not found"}), 404

    tx = FuelTransaction(
        station_id=data["station_id"],
        fuel_type=data["fuel_type"],
        transaction_type=data["transaction_type"],
        liters=float(data["liters"]),
        price_per_liter=data.get("price_per_liter"),
        timestamp=datetime.utcnow(),
        notes=data.get("notes"),
    )
    db.session.add(tx)

    # Update today's inventory snapshot
    today = date.today()
    snap = InventorySnapshot.query.filter_by(
        station_id=data["station_id"],
        fuel_type=data["fuel_type"],
        snapshot_date=today,
    ).first()

    if snap:
        if data["transaction_type"] == "received":
            snap.liters_on_hand += float(data["liters"])
        else:
            snap.liters_on_hand = max(0, snap.liters_on_hand - float(data["liters"]))
    else:
        cap = getattr(station, f"{data['fuel_type']}_capacity", 40000)
        liters = float(data["liters"]) if data["transaction_type"] == "received" else 0
        snap = InventorySnapshot(
            station_id=data["station_id"],
            fuel_type=data["fuel_type"],
            liters_on_hand=liters,
            capacity=cap,
            snapshot_date=today,
        )
        db.session.add(snap)

    db.session.commit()
    return jsonify({"success": True, "transaction_id": tx.id})


# ------------------------------------------------------------------ #
#  API: Reports
# ------------------------------------------------------------------ #
@app.route("/api/reports/generate", methods=["POST"])
def api_generate_report():
    data = request.json or {}
    report_type = data.get("type", "sat_volumetric")
    target_date_str = data.get("date")
    target_date = date.fromisoformat(target_date_str) if target_date_str else date.today()

    generators = {
        "sat_volumetric": reports.generate_sat_volumetric,
        "cne_weekly": reports.generate_cne_weekly,
        "inventory_close": reports.generate_inventory_close,
        "price_tariff": reports.generate_price_report,
    }
    gen = generators.get(report_type)
    if not gen:
        return jsonify({"error": f"Unknown report type: {report_type}"}), 400

    result = gen(target_date)
    return jsonify(result)


@app.route("/api/reports/history")
def api_report_history():
    limit = request.args.get("limit", 50, type=int)
    return jsonify(reports.get_report_history(limit))


@app.route("/api/reports/download/<int:report_id>")
def api_download_report(report_id):
    report = Report.query.get_or_404(report_id)
    if not report.file_path or not os.path.exists(report.file_path):
        abort(404)
    return send_file(report.file_path, as_attachment=True)


@app.route("/api/reports/send/<int:report_id>", methods=["POST"])
def api_send_report(report_id):
    success = reports.mark_report_sent(report_id)
    if success:
        return jsonify({"success": True})
    return jsonify({"error": "Report not found"}), 404


@app.route("/api/reports/generate-all", methods=["POST"])
def api_generate_all_reports():
    target_date_str = (request.json or {}).get("date")
    target_date = date.fromisoformat(target_date_str) if target_date_str else date.today()
    results = {}
    for rtype, gen in [
        ("sat_volumetric", reports.generate_sat_volumetric),
        ("cne_weekly", reports.generate_cne_weekly),
        ("inventory_close", reports.generate_inventory_close),
        ("price_tariff", reports.generate_price_report),
    ]:
        try:
            results[rtype] = gen(target_date)
        except Exception as e:
            results[rtype] = {"error": str(e)}
    return jsonify(results)


# ------------------------------------------------------------------ #
#  API: Predictions
# ------------------------------------------------------------------ #
@app.route("/api/predictions/recommendations")
def api_recommendations():
    hours = request.args.get("hours", 72, type=int)
    recs = predictions.generate_order_recommendations(horizon_hours=hours)
    return jsonify(recs)


@app.route("/api/predictions/forecast")
def api_forecast():
    station_id = request.args.get("station_id", type=int)
    days = request.args.get("days", 7, type=int)
    forecast = predictions.get_demand_forecast(station_id=station_id, days=days)
    return jsonify(forecast)


@app.route("/api/predictions/station/<int:station_id>/<fuel_type>")
def api_station_prediction(station_id, fuel_type):
    demand = predictions.predict_demand(station_id, fuel_type)
    inv = predictions.get_current_inventory(station_id, fuel_type)
    if not demand:
        return jsonify({"error": "Insufficient data"}), 400
    station = Station.query.get_or_404(station_id)
    cap = getattr(station, f"{fuel_type}_capacity", 40000)
    days_left = predictions.calculate_days_until_empty(
        inv["liters"] if inv else 0, demand["avg_daily"], 0.15, cap
    ) if inv else None
    return jsonify({
        "station": {"id": station.id, "code": station.code, "name": station.name},
        "fuel_type": fuel_type,
        "current_inventory": inv,
        "demand": demand,
        "days_until_empty": round(days_left, 1) if days_left is not None else None,
    })


# ------------------------------------------------------------------ #
#  API: Alerts
# ------------------------------------------------------------------ #
@app.route("/api/alerts")
def api_alerts():
    today = date.today()
    alerts = []

    # Critical inventory alerts
    for station in Station.query.filter_by(active=True).all():
        for ft in ["magna", "premium", "diesel"]:
            snap = InventorySnapshot.query.filter_by(
                station_id=station.id, fuel_type=ft, snapshot_date=today,
            ).first()
            cap = getattr(station, f"{ft}_capacity", 40000)
            if snap and cap > 0:
                pct = snap.liters_on_hand / cap * 100
                if pct < 25:
                    alerts.append({
                        "type": "critical",
                        "station": station.name,
                        "message": f"{ft.capitalize()} al {pct:.0f}% ({snap.liters_on_hand:.0f}L). Pedido urgente recomendado.",
                        "time": "Ahora",
                    })
                elif pct < 35:
                    alerts.append({
                        "type": "warning",
                        "station": station.name,
                        "message": f"{ft.capitalize()} por debajo del 35% ({pct:.0f}%). Pedido recomendado.",
                        "time": "Reciente",
                    })

    # Recent report alerts
    recent_reports = Report.query.filter_by(report_date=today).order_by(Report.created_at.desc()).limit(3).all()
    for r in recent_reports:
        type_labels = {
            "sat_volumetric": "Reporte SAT volumetrico",
            "cne_weekly": "Reporte CNE semanal",
            "inventory_close": "Inventario de cierre",
            "price_tariff": "Precios y tarifas",
        }
        alerts.append({
            "type": "info",
            "station": type_labels.get(r.report_type, r.report_type),
            "message": f"Generado exitosamente. Estado: {r.status}.",
            "time": r.created_at.strftime("%H:%M") if r.created_at else "",
        })

    # Sort: critical first
    order = {"critical": 0, "warning": 1, "info": 2}
    alerts.sort(key=lambda a: order.get(a["type"], 3))
    return jsonify(alerts[:15])


# ------------------------------------------------------------------ #
#  API: SAT XML Generator (AI-powered)
# ------------------------------------------------------------------ #
@app.route("/api/sat-xml/generate", methods=["POST"])
def api_generate_sat_xml():
    """Generate SAT-compliant XML from raw station data using Claude."""
    data = request.json or {}

    station_config = {
        "rfc": data.get("rfc", "GAZ850101ABC"),
        "rfc_proveedor": data.get("rfc_proveedor", "XAXX010101000"),
        "num_permiso": data.get("num_permiso", "PL/12345/EXP/ES/2024"),
        "modalidad_permiso": data.get("modalidad_permiso", "PL/XXXXX/EXP/ES/2024"),
        "clave_instalacion": data.get("clave_instalacion", "EDS-0001"),
        "descripcion": data.get("descripcion", "Estacion de servicio"),
        "latitud": data.get("latitud", "31.6904"),
        "longitud": data.get("longitud", "-106.4245"),
        "num_tanques": data.get("num_tanques", "3"),
        "num_dispensarios": data.get("num_dispensarios", "8"),
    }

    raw_data = data.get("raw_data", "")
    if not raw_data.strip():
        return jsonify({"error": "raw_data is required. Provide tank readings, receptions, and sales data."}), 400

    report_date_str = data.get("date")
    report_date = date.fromisoformat(report_date_str) if report_date_str else date.today()

    result = sat_xml_generator.generate_sat_xml_with_ai(station_config, raw_data, report_date)

    if result.get("error"):
        return jsonify(result), 500 if "API error" in result["error"] else 400

    # Save to reports DB
    report = Report(
        report_type="sat_xml_volumetric",
        report_date=report_date,
        status="generated",
        file_path=result["zip_path"],
        created_at=datetime.utcnow(),
        details=f"XML SAT generado con IA. {result['validation'].get('product_count', 0)} productos. Archivo: {result['zip_filename']}",
    )
    db.session.add(report)
    db.session.commit()

    return jsonify({
        "success": True,
        "report_id": report.id,
        "xml_filename": result["xml_filename"],
        "zip_filename": result["zip_filename"],
        "validation": result["validation"],
        "tokens_used": result.get("tokens_used"),
    })


@app.route("/api/sat-xml/generate-from-db", methods=["POST"])
def api_generate_sat_xml_from_db():
    """Generate SAT XML using existing database data + AI."""
    data = request.json or {}
    report_date_str = data.get("date")
    report_date = date.fromisoformat(report_date_str) if report_date_str else date.today()

    result = sat_xml_generator.generate_demo_xml(report_date)

    if result.get("error"):
        return jsonify(result), 500 if "API error" in result.get("error", "") else 400

    report = Report(
        report_type="sat_xml_volumetric",
        report_date=report_date,
        status="generated",
        file_path=result["zip_path"],
        created_at=datetime.utcnow(),
        details=f"XML SAT desde BD. {result['validation'].get('product_count', 0)} productos. {result['zip_filename']}",
    )
    db.session.add(report)
    db.session.commit()

    return jsonify({
        "success": True,
        "report_id": report.id,
        "xml_filename": result["xml_filename"],
        "zip_filename": result["zip_filename"],
        "validation": result["validation"],
        "tokens_used": result.get("tokens_used"),
    })


@app.route("/api/sat-xml/download/<int:report_id>")
def api_download_sat_xml(report_id):
    """Download a generated SAT XML zip file."""
    report = Report.query.get_or_404(report_id)
    if not report.file_path or not os.path.exists(report.file_path):
        abort(404)
    return send_file(
        report.file_path,
        as_attachment=True,
        download_name=os.path.basename(report.file_path),
    )


# ------------------------------------------------------------------ #
#  Initialize
# ------------------------------------------------------------------ #
def init_db():
    with app.app_context():
        db_path = os.path.join(BASE_DIR, "controlpetro.db")
        if not os.path.exists(db_path):
            print("Creating database...")
            db.create_all()
            from seed_data import seed_database
            seed_database()
            # Generate initial reports
            print("Generating initial reports...")
            reports.generate_sat_volumetric()
            reports.generate_cne_weekly()
            reports.generate_inventory_close()
            reports.generate_price_report()
            print("Database initialized with demo data and reports.")
        else:
            print("Database already exists.")


init_db()
if __name__ == "__main__":
    init_db()
    app.run(host="0.0.0.0", port=5000, debug=False)
