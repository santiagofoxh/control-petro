"""Fast report generator — template-based XML/JSON, no AI needed.

Generates SAT and CNE compliant reports directly from database data
using XML templates. Targets <5 second generation time.
"""

import os
import io
import json
import zipfile
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.mime.base import MIMEBase
from email import encoders
from datetime import datetime, date, timedelta
from xml.sax.saxutils import escape as xml_escape

from database import (
    db, Station, FuelTransaction, InventorySnapshot, Report, RazonSocial,
)

REPORT_DIR = os.path.join(os.path.dirname(__file__), "generated_reports")
os.makedirs(REPORT_DIR, exist_ok=True)

# SMTP config (set via env vars on Render)
SMTP_HOST = os.environ.get("SMTP_HOST", "smtp.gmail.com")
SMTP_PORT = int(os.environ.get("SMTP_PORT", "587"))
SMTP_USER = os.environ.get("SMTP_USER", "")
SMTP_PASS = os.environ.get("SMTP_PASS", "")
SMTP_FROM = os.environ.get("SMTP_FROM", "reportes@controlpetro.com")

FUEL_CODES = {"magna": "PR09", "premium": "PR07", "diesel": "PR03"}
FUEL_NAMES = {"magna": "Gasolina regular menor o igual a 91 octanos",
              "premium": "Gasolina de mas de 91 octanos",
              "diesel": "Diesel automotriz"}
FUEL_LABELS = {"magna": "Magna (Regular)", "premium": "Premium", "diesel": "Diesel"}
SELL_PRICES = {"magna": 18.85, "premium": 20.60, "diesel": 22.50}
BUY_PRICES  = {"magna": 17.20, "premium": 18.80, "diesel": 20.60}
OCTANE = {"magna": "87", "premium": "91", "diesel": "0"}


# ------------------------------------------------------------------ #
#  Batch data loading — single query per data type
# ------------------------------------------------------------------ #

def _load_station_day_data(station_ids, target_date):
    """Load all transactions and snapshots for given stations/date in bulk."""
    start = datetime.combine(target_date, datetime.min.time())
    end   = datetime.combine(target_date, datetime.max.time())

    txns = FuelTransaction.query.filter(
        FuelTransaction.station_id.in_(station_ids),
        FuelTransaction.timestamp.between(start, end),
    ).all()

    snaps = InventorySnapshot.query.filter(
        InventorySnapshot.station_id.in_(station_ids),
        InventorySnapshot.snapshot_date == target_date,
    ).all()

    received = {}
    sold = {}
    for tx in txns:
        key = (tx.station_id, tx.fuel_type)
        if tx.transaction_type == "received":
            received[key] = received.get(key, 0) + float(tx.liters)
        else:
            sold[key] = sold.get(key, 0) + float(tx.liters)

    closing = {}
    for snap in snaps:
        closing[(snap.station_id, snap.fuel_type)] = float(snap.liters_on_hand)

    return received, sold, closing


# ------------------------------------------------------------------ #
#  Fast SAT XML generation (template-based)
# ------------------------------------------------------------------ #

def _xml_tank(station, ft, opn, rec, sld, cls, cap, report_date, tank_num):
    """Build XML for a single tank."""
    fecha = report_date.isoformat()
    lines = []
    lines.append('    <Covol:TANQUE Covol:ClaveTanque="TK-{code}-{fuel}"'.format(
        code=station.code, fuel=ft.upper()))
    lines.append('        Covol:LocalizODescripTanque="{code} Tanque {fuel}"'.format(
        code=station.code, fuel=ft.title()))
    lines.append('        Covol:VigenciaCalibracion="2027-12-31"')
    lines.append('        Covol:Capacidad="{}"'.format(cap))
    lines.append('        Covol:CapacidadUtil="{}"'.format(int(cap * 0.95)))
    lines.append('        Covol:CapacidadFondaje="{}"'.format(int(cap * 0.05)))
    lines.append('        Covol:VolumenMinimoOperacion="{}"'.format(int(cap * 0.1)))
    lines.append('        Covol:EstadoTanque="O"')
    lines.append('        Covol:TipoMedicionTanque="E"')
    lines.append('        Covol:SistemaMedicionTanque="SMT-{}"'.format(tank_num))
    lines.append('    >')
    # Existencias
    lines.append('      <Covol:Existencias>')
    lines.append('        <Covol:VolumenExistenciasAnterior Covol:ValorNumerico="{:.1f}" Covol:UnidadMedida="UM03"/>'.format(opn))
    lines.append('        <Covol:VolumenAcumOpsRecep Covol:ValorNumerico="{:.1f}" Covol:UnidadMedida="UM03"/>'.format(rec))
    lines.append('        <Covol:HoraRecepcionAcumFinal>{}T{:02d}:00:00</Covol:HoraRecepcionAcumFinal>'.format(fecha, 7 + tank_num))
    lines.append('        <Covol:VolumenAcumOpsEntreg Covol:ValorNumerico="{:.1f}" Covol:UnidadMedida="UM03"/>'.format(sld))
    lines.append('        <Covol:VolumenExistencias Covol:ValorNumerico="{:.1f}" Covol:UnidadMedida="UM03"/>'.format(cls))
    lines.append('        <Covol:FechaYHoraEstaMedicion>{}T23:59:59</Covol:FechaYHoraEstaMedicion>'.format(fecha))
    lines.append('        <Covol:FechaYHoraMedicionAnterior>{}T00:00:01</Covol:FechaYHoraMedicionAnterior>'.format(fecha))
    lines.append('      </Covol:Existencias>')
    # Recepciones
    if rec > 0:
        lines.append('      <Covol:RECEPCION Covol:NumeroDeRegistro="1"')
        lines.append('          Covol:VolumenInicialTanque="{:.1f}"'.format(opn))
        lines.append('          Covol:VolumenFinalTanque="{:.1f}"'.format(opn + rec))
        lines.append('          Covol:VolumenRecepcion="{:.1f}"'.format(rec))
        lines.append('          Covol:Temperatura="28"')
        lines.append('          Covol:PresionAbsoluta="0.0"')
        lines.append('          Covol:FechaYHoraInicioRecep="{}T06:00:00"'.format(fecha))
        lines.append('          Covol:FechaYHoraFinalRecep="{}T07:00:00"'.format(fecha))
        lines.append('      >')
        lines.append('        <Expendio:Complemento>')
        lines.append('          <Expendio:Nacional>')
        lines.append('            <Expendio:CFDIs>')
        lines.append('              <Expendio:CFDI Expendio:Cfdi="AAA010101AAA"')
        lines.append('                  Expendio:TipoCfdi="I"')
        lines.append('                  Expendio:PrecioCompra="{:.2f}"'.format(BUY_PRICES[ft]))
        lines.append('                  Expendio:FechaHoraTransaccion="{}T06:30:00"'.format(fecha))
        lines.append('                  Expendio:VolumenDocumentado="{:.1f}"'.format(rec))
        lines.append('                  Expendio:Acuse="" />')
        lines.append('            </Expendio:CFDIs>')
        lines.append('          </Expendio:Nacional>')
        lines.append('        </Expendio:Complemento>')
        lines.append('      </Covol:RECEPCION>')
    # Entregas (dispensario)
    if sld > 0:
        lines.append('      <Covol:DISPENSARIO Covol:ClaveDispensario="DISP-{}-{}"'.format(station.code, ft.upper()))
        lines.append('          Covol:LocalizODescripDisp="{} Dispensario {}"'.format(station.code, ft.title()))
        lines.append('      >')
        lines.append('        <Covol:ENTREGA Covol:NumeroDeRegistro="1"')
        lines.append('            Covol:VolumenInicialTanque="{:.1f}"'.format(opn + rec))
        lines.append('            Covol:VolumenFinalTanque="{:.1f}"'.format(cls))
        lines.append('            Covol:VolumenEntregado="{:.1f}"'.format(sld))
        lines.append('            Covol:Temperatura="30"')
        lines.append('            Covol:PresionAbsoluta="0.0"')
        lines.append('            Covol:FechaYHoraInicioEntrega="{}T08:00:00"'.format(fecha))
        lines.append('            Covol:FechaYHoraFinalEntrega="{}T22:00:00"'.format(fecha))
        lines.append('        >')
        lines.append('          <Expendio:Complemento>')
        lines.append('            <Expendio:Nacional>')
        lines.append('              <Expendio:CFDIs>')
        lines.append('                <Expendio:CFDI Expendio:Cfdi="VTA-{}-{}-{}"'.format(station.code, ft.upper(), report_date.strftime('%Y%m%d')))
        lines.append('                    Expendio:TipoCfdi="I"')
        lines.append('                    Expendio:PrecioVentaTotEnt="{:.2f}"'.format(sld * SELL_PRICES[ft]))
        lines.append('                    Expendio:FechaHoraTransaccion="{}T22:00:00"'.format(fecha))
        lines.append('                    Expendio:VolumenDocumentado="{:.1f}"'.format(sld))
        lines.append('                    Expendio:Acuse="" />')
        lines.append('              </Expendio:CFDIs>')
        lines.append('            </Expendio:Nacional>')
        lines.append('          </Expendio:Complemento>')
        lines.append('        </Covol:ENTREGA>')
        lines.append('      </Covol:DISPENSARIO>')
    lines.append('    </Covol:TANQUE>')
    return '\n'.join(lines)


def _build_sat_xml(station, fuels_data, report_date, razon=None):
    """Build SAT Anexo 30 XML for a single station from pre-loaded data."""
    rfc = razon.rfc if razon else "XAXX010101000"
    fecha_corte = "{}T23:59:59".format(report_date.isoformat())
    lat = str(station.latitude or "0.0")
    lng = str(station.longitude or "0.0")

    productos_parts = []
    tank_num = 0

    for ft in ["magna", "premium", "diesel"]:
        tank_num += 1
        code = FUEL_CODES[ft]
        name = FUEL_NAMES[ft]
        cap  = getattr(station, "{}_capacity".format(ft), 40000)
        key  = (station.id, ft)
        rec  = fuels_data["received"].get(key, 0)
        sld  = fuels_data["sold"].get(key, 0)
        cls  = fuels_data["closing"].get(key, 0)
        opn  = cls - rec + sld

        tank_xml = _xml_tank(station, ft, opn, rec, sld, cls, cap, report_date, tank_num)

        prod_open = '  <Covol:PRODUCTO Covol:ClaveProducto="{code}" Covol:ClaveSubProducto="" Covol:ComposOctanaje="{oct}" Covol:GasolinaConCombustibleNoFosil="No" Covol:CombusFosilOGasolinaEnMezcla="100" Covol:MarcaComercial="{name}" Covol:Marcaje="N/A" Covol:ConcentracionDeMarcaje="0" Covol:ReporteDeMarcaje="N/A">'.format(
            code=code, oct=OCTANE[ft], name=xml_escape(name))

        productos_parts.append(prod_open)
        productos_parts.append(tank_xml)
        productos_parts.append('  </Covol:PRODUCTO>')

    bitacora = '  <Covol:BITACORA>\n    <Covol:EVENTO Covol:NumeroRegistro="1" Covol:FechaYHoraEvento="{fc}" Covol:TipoEvento="10" Covol:DescripcionEvento="Cierre diario automatico - ControlPetro"/>\n  </Covol:BITACORA>'.format(fc=fecha_corte)

    header = '<?xml version="1.0" encoding="UTF-8"?>\n' + """<Covol:ControlVolumetrico
    xmlns:Covol="http://www.sat.gob.mx/ControlesVolumetricos"
    xmlns:Expendio="http://www.sat.gob.mx/ControlesVolumetricos/Expendio"
    xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
    Covol:Version="1.0"
    Covol:RfcContribuyente="{rfc}"
    Covol:RfcRepresentanteLegal=""
    Covol:RfcProveedor="{rfc}"
    Covol:Caracter="expendedor"
    Covol:ModalidadPermiso="PL/XXXXX/EXP/ES/2024"
    Covol:NumPermiso="PL/12345/EXP/ES/2024"
    Covol:ClaveInstalacion="{clave}"
    Covol:DescripcionInstalacion="{desc}"
    Covol:NumeroPozos="0"
    Covol:NumeroTanques="3"
    Covol:NumeroDuctosEntradaSalida="0"
    Covol:NumeroDuctosTransporteDistribucion="0"
    Covol:NumeroDispensarios="3"
    Covol:FechaYHoraCorte="{fc}">
  <Covol:Geolocalizacion
      Covol:GeolocalizacionLatitud="{lat}"
      Covol:GeolocalizacionLongitud="{lng}"/>""".format(
        rfc=rfc, clave=station.code,
        desc=xml_escape("{}, {}".format(station.name, station.address or '')),
        fc=fecha_corte, lat=lat, lng=lng)

    footer = '</Covol:ControlVolumetrico>'

    return header + '\n' + '\n'.join(productos_parts) + '\n' + bitacora + '\n' + footer


def generate_fast_report(station_ids, report_date=None, output_format="xml",
                         report_scope="sat"):
    """Generate SAT/CNE report for given stations in <5 seconds.

    Args:
        station_ids: list of station IDs to include
        report_date: date for the report (defaults to today)
        output_format: "xml" or "json"
        report_scope: "sat", "cne", or "ambos"

    Returns:
        dict with success, filename(s), file content, report_id, etc.
    """
    if report_date is None:
        report_date = date.today()

    stations = Station.query.filter(
        Station.id.in_(station_ids), Station.active == True
    ).order_by(Station.code).all()

    if not stations:
        return {"error": "No active stations found for this user."}

    # Bulk load all data in 2 queries
    received, sold, closing = _load_station_day_data(station_ids, report_date)
    fuels_data = {"received": received, "sold": sold, "closing": closing}

    # Load razon social info for RFC
    razon_map = {}
    for s in stations:
        if s.razon_social_id and s.razon_social_id not in razon_map:
            razon_map[s.razon_social_id] = RazonSocial.query.get(s.razon_social_id)

    if output_format == "json":
        return _generate_json_report(stations, fuels_data, report_date, razon_map, report_scope)
    else:
        return _generate_xml_report(stations, fuels_data, report_date, razon_map, report_scope)


def _generate_json_report(stations, fuels_data, report_date, razon_map, report_scope):
    """Generate JSON report."""
    report_data = {
        "meta": {
            "report_type": "{} Control Volumetrico".format(report_scope.upper()),
            "report_date": report_date.isoformat(),
            "generated_at": datetime.utcnow().isoformat() + "Z",
            "station_count": len(stations),
            "generator": "ControlPetro v2",
        },
        "stations": [],
    }

    total_received = total_sold = 0

    for station in stations:
        razon = razon_map.get(station.razon_social_id)
        station_data = {
            "code": station.code,
            "name": station.name,
            "address": station.address,
            "city": station.city,
            "state": station.state,
            "rfc": razon.rfc if razon else None,
            "coordinates": {"lat": station.latitude, "lng": station.longitude},
            "fuels": [],
        }

        for ft in ["magna", "premium", "diesel"]:
            key = (station.id, ft)
            cap = getattr(station, "{}_capacity".format(ft), 40000)
            rec = fuels_data["received"].get(key, 0)
            sld = fuels_data["sold"].get(key, 0)
            cls = fuels_data["closing"].get(key, 0)
            opn = cls - rec + sld
            pct = (cls / cap * 100) if cap > 0 else 0

            total_received += rec
            total_sold += sld

            station_data["fuels"].append({
                "type": ft,
                "product_code": FUEL_CODES[ft],
                "capacity_liters": cap,
                "opening_inventory": round(opn, 1),
                "received_liters": round(rec, 1),
                "sold_liters": round(sld, 1),
                "closing_inventory": round(cls, 1),
                "occupancy_pct": round(pct, 1),
                "status": "normal" if pct > 40 else ("low" if pct > 25 else "critical"),
                "sell_price": SELL_PRICES[ft],
                "revenue": round(sld * SELL_PRICES[ft], 2),
            })

        report_data["stations"].append(station_data)

    report_data["totals"] = {
        "received_liters": round(total_received, 1),
        "sold_liters": round(total_sold, 1),
        "total_revenue": round(sum(
            f["revenue"] for s in report_data["stations"] for f in s["fuels"]
        ), 2),
    }

    filename = "Reporte_{scope}_{dt}.json".format(scope=report_scope.upper(), dt=report_date.strftime('%Y%m%d'))
    filepath = os.path.join(REPORT_DIR, filename)
    with open(filepath, "w", encoding="utf-8") as f:
        json.dump(report_data, f, ensure_ascii=False, indent=2)

    report = Report(
        report_type="{}_json".format(report_scope),
        report_date=report_date,
        status="generated",
        file_path=filepath,
        created_at=datetime.utcnow(),
        details="{n} estaciones, JSON, {r:.0f}L recibidos, {s:.0f}L vendidos".format(
            n=len(stations), r=total_received, s=total_sold),
    )
    db.session.add(report)
    db.session.commit()

    return {
        "success": True,
        "format": "json",
        "filename": filename,
        "filepath": filepath,
        "report_id": report.id,
        "station_count": len(stations),
        "total_received": round(total_received, 1),
        "total_sold": round(total_sold, 1),
        "data": report_data,
    }


def _generate_xml_report(stations, fuels_data, report_date, razon_map, report_scope):
    """Generate XML report (one file per station, zipped together)."""
    xml_files = []
    total_received = total_sold = 0

    for station in stations:
        razon = razon_map.get(station.razon_social_id)
        xml_content = _build_sat_xml(station, fuels_data, report_date, razon)
        rfc = razon.rfc if razon else "XAXX010101000"
        fname = "{rfc}_{code}_{dt}_{scope}_DIA.xml".format(
            rfc=rfc, code=station.code, dt=report_date.strftime('%Y%m%d'),
            scope=report_scope.upper())
        xml_files.append((fname, xml_content))

        for ft in ["magna", "premium", "diesel"]:
            key = (station.id, ft)
            total_received += fuels_data["received"].get(key, 0)
            total_sold += fuels_data["sold"].get(key, 0)

    zip_filename = "Reportes_{scope}_{dt}.zip".format(
        scope=report_scope.upper(), dt=report_date.strftime('%Y%m%d'))
    zip_filepath = os.path.join(REPORT_DIR, zip_filename)

    with zipfile.ZipFile(zip_filepath, "w", zipfile.ZIP_DEFLATED) as zf:
        for fname, content in xml_files:
            zf.writestr(fname, content)

    first_xml_path = None
    for fname, content in xml_files:
        fpath = os.path.join(REPORT_DIR, fname)
        with open(fpath, "w", encoding="utf-8") as f:
            f.write(content)
        if first_xml_path is None:
            first_xml_path = fpath

    report = Report(
        report_type="{}_xml_fast".format(report_scope),
        report_date=report_date,
        status="generated",
        file_path=zip_filepath,
        created_at=datetime.utcnow(),
        details="{n} estaciones, XML, {r:.0f}L rec, {s:.0f}L vend".format(
            n=len(stations), r=total_received, s=total_sold),
    )
    db.session.add(report)
    db.session.commit()

    return {
        "success": True,
        "format": "xml",
        "filename": zip_filename,
        "filepath": zip_filepath,
        "xml_files": [f[0] for f in xml_files],
        "report_id": report.id,
        "station_count": len(stations),
        "total_received": round(total_received, 1),
        "total_sold": round(total_sold, 1),
    }


# ------------------------------------------------------------------ #
#  Email delivery
# ------------------------------------------------------------------ #

def send_report_email(to_email, report_filepath, report_filename,
                      report_date, station_count, subject=None):
    """Send a report file as email attachment."""
    if not SMTP_USER or not SMTP_PASS:
        return {"error": "Email no configurado. Configure SMTP_USER y SMTP_PASS en las variables de entorno."}

    if subject is None:
        subject = "ControlPetro - Reporte {} ({} estaciones)".format(
            report_date.isoformat(), station_count)

    msg = MIMEMultipart()
    msg["From"] = SMTP_FROM
    msg["To"] = to_email
    msg["Subject"] = subject

    body = (
        "Reporte generado por ControlPetro.\n\n"
        "Fecha del reporte: {}\n"
        "Estaciones incluidas: {}\n"
        "Archivo adjunto: {}\n\n"
        "Este reporte fue generado automaticamente.\n"
        "-- ControlPetro v2\n"
    ).format(report_date.strftime('%d/%m/%Y'), station_count, report_filename)

    msg.attach(MIMEText(body, "plain", "utf-8"))

    try:
        with open(report_filepath, "rb") as f:
            part = MIMEBase("application", "octet-stream")
            part.set_payload(f.read())
        encoders.encode_base64(part)
        part.add_header("Content-Disposition",
                        'attachment; filename="{}"'.format(report_filename))
        msg.attach(part)
    except FileNotFoundError:
        return {"error": "Archivo no encontrado: {}".format(report_filename)}

    try:
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=15) as server:
            server.starttls()
            server.login(SMTP_USER, SMTP_PASS)
            server.send_message(msg)
        return {"success": True, "sent_to": to_email}
    except smtplib.SMTPAuthenticationError:
        return {"error": "Error de autenticacion SMTP. Verifique SMTP_USER/SMTP_PASS."}
    except smtplib.SMTPException as e:
        return {"error": "Error enviando email: {}".format(str(e))}
    except Exception as e:
        return {"error": "Error inesperado: {}".format(str(e))}
