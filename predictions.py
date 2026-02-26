"""AI prediction engine for fuel ordering recommendations."""
import numpy as np
from datetime import datetime, date, timedelta
from database import db, Station, FuelTransaction, InventorySnapshot, Prediction


def get_daily_sales_history(station_id, fuel_type, days=30):
    """Get daily sales totals for a station/fuel over the last N days."""
    end = datetime.utcnow()
    start = end - timedelta(days=days)
    rows = db.session.query(
        db.func.date(FuelTransaction.timestamp).label("day"),
        db.func.sum(FuelTransaction.liters).label("total"),
    ).filter(
        FuelTransaction.station_id == station_id,
        FuelTransaction.fuel_type == fuel_type,
        FuelTransaction.transaction_type == "sold",
        FuelTransaction.timestamp >= start,
    ).group_by(
        db.func.date(FuelTransaction.timestamp)
    ).order_by("day").all()

    return [(str(r.day), float(r.total)) for r in rows]


def predict_demand(station_id, fuel_type, horizon_days=7):
    """Predict daily demand using weighted moving average with trend detection."""
    history = get_daily_sales_history(station_id, fuel_type, days=30)
    if len(history) < 3:
        return None

    values = np.array([v for _, v in history])

    # Weighted moving average: recent days weighted more heavily
    weights_7 = np.array([1, 1, 2, 2, 3, 3, 4]) if len(values) >= 7 else np.arange(1, len(values) + 1)
    recent = values[-len(weights_7):]
    wma = np.average(recent, weights=weights_7[-len(recent):])

    # Detect trend using simple linear regression on last 14 days
    trend_data = values[-min(14, len(values)):]
    x = np.arange(len(trend_data))
    if len(trend_data) >= 5:
        coeffs = np.polyfit(x, trend_data, 1)
        daily_trend = coeffs[0]
    else:
        daily_trend = 0

    # Day-of-week adjustment using available data
    dow_factors = {}
    for i, (day_str, val) in enumerate(history):
        try:
            d = datetime.strptime(day_str, "%Y-%m-%d")
            dow = d.weekday()
            if dow not in dow_factors:
                dow_factors[dow] = []
            dow_factors[dow].append(val)
        except ValueError:
            pass

    dow_avg = {dow: np.mean(vals) for dow, vals in dow_factors.items()}
    overall_avg = np.mean(values) if len(values) > 0 else wma
    dow_multipliers = {}
    for dow, avg in dow_avg.items():
        dow_multipliers[dow] = avg / overall_avg if overall_avg > 0 else 1.0

    # Generate predictions
    predictions = []
    base_date = date.today()
    for d in range(1, horizon_days + 1):
        future_date = base_date + timedelta(days=d)
        dow = future_date.weekday()
        dow_mult = dow_multipliers.get(dow, 1.0)
        predicted = (wma + daily_trend * d) * dow_mult
        predicted = max(predicted, 0)
        predictions.append({
            "date": future_date.isoformat(),
            "predicted_liters": round(predicted, 0),
            "dow_multiplier": round(dow_mult, 3),
        })

    # Confidence based on data quality and consistency
    if len(values) >= 14:
        cv = np.std(values) / np.mean(values) if np.mean(values) > 0 else 1
        confidence = max(0.7, min(0.99, 1.0 - cv * 0.5))
    elif len(values) >= 7:
        confidence = 0.80
    else:
        confidence = 0.65

    return {
        "avg_daily": round(float(wma), 0),
        "trend": round(float(daily_trend), 1),
        "confidence": round(confidence, 3),
        "predictions": predictions,
    }


def get_current_inventory(station_id, fuel_type):
    """Get the most recent inventory level for a station/fuel."""
    snap = InventorySnapshot.query.filter_by(
        station_id=station_id, fuel_type=fuel_type,
    ).order_by(InventorySnapshot.snapshot_date.desc()).first()

    if snap:
        return {"liters": float(snap.liters_on_hand), "capacity": float(snap.capacity), "date": snap.snapshot_date.isoformat()}
    return None


def calculate_days_until_empty(current_liters, avg_daily_demand, min_threshold_pct=0.15, capacity=40000):
    """Calculate how many days until inventory hits minimum threshold."""
    min_level = capacity * min_threshold_pct
    usable = current_liters - min_level
    if usable <= 0:
        return 0
    if avg_daily_demand <= 0:
        return 999
    return usable / avg_daily_demand


def generate_order_recommendations(horizon_hours=72):
    """Generate order recommendations for all stations."""
    stations = Station.query.filter_by(active=True).all()
    recommendations = []

    for station in stations:
        for fuel_type in ["magna", "premium", "diesel"]:
            inv = get_current_inventory(station.id, fuel_type)
            if not inv:
                continue

            demand = predict_demand(station.id, fuel_type, horizon_days=7)
            if not demand:
                continue

            capacity = getattr(station, f"{fuel_type}_capacity", 40000)
            current_pct = (inv["liters"] / capacity * 100) if capacity > 0 else 0
            days_left = calculate_days_until_empty(
                inv["liters"], demand["avg_daily"], 0.15, capacity
            )

            # Determine if order is needed within horizon
            horizon_days = horizon_hours / 24
            if days_left > horizon_days + 2:
                continue

            # Calculate optimal order amount: fill to 85% capacity
            target_fill = capacity * 0.85
            order_liters = max(0, target_fill - inv["liters"] + demand["avg_daily"])
            order_liters = round(order_liters / 500) * 500  # Round to nearest 500L

            if order_liters < 1000:
                continue

            # Determine urgency
            if days_left <= 1:
                urgency = "urgent"
            elif days_left <= 2:
                urgency = "high"
            else:
                urgency = "normal"

            # Optimal delivery time: early morning for high-traffic stations
            if urgency == "urgent":
                delivery_hour = 6
                delivery_date = date.today() + timedelta(days=1)
            elif urgency == "high":
                delivery_hour = 8
                delivery_date = date.today() + timedelta(days=1)
            else:
                delivery_hour = 7
                delivery_date = date.today() + timedelta(days=int(days_left) - 1)

            delivery_dt = datetime.combine(delivery_date, datetime.min.time().replace(hour=delivery_hour))

            reason = (
                f"Nivel actual: {current_pct:.0f}% ({inv['liters']:.0f}L). "
                f"Demanda promedio: {demand['avg_daily']:.0f}L/dia. "
                f"Dias restantes estimados: {days_left:.1f}."
            )

            rec = {
                "station_id": station.id,
                "station_code": station.code,
                "station_name": station.name,
                "station_address": station.address,
                "fuel_type": fuel_type,
                "current_liters": round(inv["liters"], 0),
                "current_pct": round(current_pct, 1),
                "capacity": capacity,
                "recommended_liters": order_liters,
                "recommended_date": delivery_dt.isoformat(),
                "urgency": urgency,
                "days_until_empty": round(days_left, 1),
                "avg_daily_demand": demand["avg_daily"],
                "confidence": demand["confidence"],
                "reason": reason,
                "trend": demand["trend"],
            }
            recommendations.append(rec)

            # Save prediction to database
            pred = Prediction(
                station_id=station.id,
                fuel_type=fuel_type,
                recommended_liters=order_liters,
                recommended_date=delivery_dt,
                urgency=urgency,
                confidence=demand["confidence"],
                reason=reason,
            )
            db.session.add(pred)

    db.session.commit()

    # Sort: urgent first, then by days_until_empty
    recommendations.sort(key=lambda r: (
        {"urgent": 0, "high": 1, "normal": 2}[r["urgency"]],
        r["days_until_empty"],
    ))

    return recommendations


def get_demand_forecast(station_id=None, days=7):
    """Get aggregated demand forecast for all or a specific station."""
    if station_id:
        stations = [Station.query.get(station_id)]
    else:
        stations = Station.query.filter_by(active=True).all()

    forecast = {}
    for d in range(1, days + 1):
        future = date.today() + timedelta(days=d)
        forecast[future.isoformat()] = {"magna": 0, "premium": 0, "diesel": 0}

    for station in stations:
        if not station:
            continue
        for fuel_type in ["magna", "premium", "diesel"]:
            demand = predict_demand(station.id, fuel_type, horizon_days=days)
            if demand and demand["predictions"]:
                for p in demand["predictions"]:
                    if p["date"] in forecast:
                        forecast[p["date"]][fuel_type] += p["predicted_liters"]

    result = []
    for dt in sorted(forecast.keys()):
        result.append({
            "date": dt,
            "magna": round(forecast[dt]["magna"], 0),
            "premium": round(forecast[dt]["premium"], 0),
            "diesel": round(forecast[dt]["diesel"], 0),
            "total": round(sum(forecast[dt].values()), 0),
        })

    return result
