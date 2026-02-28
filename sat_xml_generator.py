"""SAT XML Report Generator using Anthropic Claude API.

This module takes raw station data (tank readings, receptions, sales)
and uses Claude Opus to generate SAT-compliant XML for controles volumetricos.
"""
import os
import io
import zipfile
import xml.etree.ElementTree as ET
from datetime import datetime, date

try:
    import anthropic
    HAS_ANTHROPIC = True
except ImportError:
    HAS_ANTHROPIC = False


ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")

# SAT Anexo 30 XML template for a gasolinera (expendio al publico)
SAT_XML_TEMPLATE = '''<?xml version="1.0" encoding="UTF-8"?>
<Covol:ControlVolumetrico
  xmlns:Covol="http://www.sat.gob.mx/ControlesVolumetricos"
  xmlns:Expendio="http://www.sat.gob.mx/ControlesVolumetricos/Expendio"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.sat.gob.mx/ControlesVolumetricos https://repositorio.cloudb.sat.gob.mx/Covol/xml/Diario.xsd
                       http://www.sat.gob.mx/ControlesVolumetricos/Expendio https://repositorio.cloudb.sat.gob.mx/Covol/xml/Comp-Expendio.xsd"
  Covol:Version="1.0"
  Covol:RfcContribuyente="{rfc}"
  Covol:RfcRepresentanteLegal=""
  Covol:RfcProveedor="{rfc_proveedor}"
  Covol:Caracter="expendedor"
  Covol:ModalidadPermiso="{modalidad_permiso}"
  Covol:NumPermiso="{num_permiso}"
  Covol:NumContratoOAsignacion=""
  Covol:InstalacionAlmacenGasNatural=""
  Covol:ClaveInstalacion="{clave_instalacion}"
  Covol:DescripcionInstalacion="{descripcion_instalacion}"
  Covol:NumeroPozos="0"
  Covol:NumeroTanques="{num_tanques}"
  Covol:NumeroDuctosEntradaSalida="0"
  Covol:NumeroDuctosTransporteDistribucion="0"
  Covol:NumeroDispensarios="{num_dispensarios}"
  Covol:FechaYHoraCorte="{fecha_corte}">

  <Covol:Geolocalizacion
    Covol:GeolocalizacionLatitud="{latitud}"
    Covol:GeolocalizacionLongitud="{longitud}"/>

  {productos_xml}

  {bitacora_xml}

</Covol:ControlVolumetrico>'''


SYSTEM_PROMPT = """You are an expert Mexican fiscal compliance assistant specializing in SAT controles volumetricos (Anexo 30/21).

Your job is to take raw operational data from a gas station and generate a COMPLETE, VALID XML daily report following the SAT's Covol namespace schema.

CRITICAL RULES:
1. Use Covol: prefix for all control volumetrico elements
2. Use Expendio: prefix for all complemento elements (CFDI, Nacional, etc.)
3. All volumes in liters (UM03), prices in MXN
4. Balance MUST validate: VolumenExistencias = VolumenExistenciasAnterior + VolumenAcumOpsRecep - VolumenAcumOpsEntreg
5. Every reception must have a Complemento with Nacional/CFDI data
6. Every tank delivery must reference its Dispensario
7. Every dispensario delivery must have PrecioVentaTotEnt and CFDI
8. Product codes: PR09=Magna(87oct), PR07=Premium(91oct), PR03=Diesel
9. FechaYHoraCorte must be end of day: YYYY-MM-DDT23:59:59
10. Temperature range: 15-45°C, PresionAbsoluta: 0.0 for liquids

OUTPUT: Return ONLY the complete XML document. No markdown, no code fences, no explanation. Just the raw XML starting with <?xml and ending with </Covol:ControlVolumetrico>."""


def generate_sat_xml_with_ai(station_data, raw_data_text, report_date=None):
    """Use Claude to generate SAT-compliant XML from raw station data.

    Args:
        station_data: dict with station config (RFC, permit, tanks, etc.)
        raw_data_text: str with the raw operational data (readings, sales, etc.)
        report_date: date for the report (defaults to today)

    Returns:
        dict with xml_content, filename, filepath, and validation info
    """
    if not HAS_ANTHROPIC:
        return {"error": "Anthropic SDK not installed. Run: pip install anthropic"}

    if not ANTHROPIC_API_KEY:
        return {"error": "ANTHROPIC_API_KEY not configured. Set it in environment variables."}

    if report_date is None:
        report_date = date.today()

    # Build the user prompt with all context
    user_prompt = f"""Generate a complete SAT controles volumetricos DAILY XML report for this gas station.

STATION CONFIGURATION:
- RFC: {station_data.get('rfc', 'GAZ850101ABC')}
- RFC Proveedor Sistema: {station_data.get('rfc_proveedor', 'XAXX010101000')}
- Permiso: {station_data.get('num_permiso', 'PL/12345/EXP/ES/2024')}
- Modalidad: {station_data.get('modalidad_permiso', 'PL/XXXXX/EXP/ES/2024')}
- Clave Instalacion: {station_data.get('clave_instalacion', 'EDS-0001')}
- Descripcion: {station_data.get('descripcion', 'Estacion de servicio')}
- Latitud: {station_data.get('latitud', '31.6904')}
- Longitud: {station_data.get('longitud', '-106.4245')}
- Numero de Tanques: {station_data.get('num_tanques', '4')}
- Numero de Dispensarios: {station_data.get('num_dispensarios', '8')}

REPORT DATE: {report_date.isoformat()}

RAW OPERATIONAL DATA:
{raw_data_text}

Generate the COMPLETE XML with all products, tanks, dispensarios, recepciones, entregas, existencias, and bitacora. Make sure the volumetric balance validates for every tank."""

    try:
        client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)

        message = client.messages.create(
            model="claude-opus-4-5-20251101",
            max_tokens=16000,
            system=SYSTEM_PROMPT,
            messages=[
                {"role": "user", "content": user_prompt}
            ]
        )

        xml_content = message.content[0].text.strip()

        # Clean up any markdown fences if present
        if xml_content.startswith("```"):
            lines = xml_content.split("\n")
            xml_content = "\n".join(lines[1:-1] if lines[-1].strip() == "```" else lines[1:])

        # Validate XML is well-formed
        validation = validate_xml(xml_content)

        if not validation["valid"]:
            return {
                "error": f"Generated XML is not well-formed: {validation['error']}",
                "xml_content": xml_content,
                "validation": validation,
            }

        # Save and zip
        rfc = station_data.get('rfc', 'GAZ850101ABC')
        clave = station_data.get('clave_instalacion', 'EDS-0001')
        date_str = report_date.strftime('%Y%m%d')

        xml_filename = f"{rfc}_{clave}_{date_str}_DIA.xml"
        zip_filename = f"{rfc}_{clave}_{date_str}_DIA.xml.zip"

        report_dir = os.path.join(os.path.dirname(__file__), "generated_reports")
        os.makedirs(report_dir, exist_ok=True)

        xml_path = os.path.join(report_dir, xml_filename)
        zip_path = os.path.join(report_dir, zip_filename)

        # Write XML file
        with open(xml_path, "w", encoding="utf-8") as f:
            f.write(xml_content)

        # Create zip
        with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
            zf.write(xml_path, xml_filename)

        return {
            "success": True,
            "xml_filename": xml_filename,
            "zip_filename": zip_filename,
            "xml_path": xml_path,
            "zip_path": zip_path,
            "validation": validation,
            "tokens_used": {
                "input": message.usage.input_tokens,
                "output": message.usage.output_tokens,
            },
        }

    except anthropic.APIError as e:
        return {"error": f"Anthropic API error: {str(e)}"}
    except Exception as e:
        return {"error": f"Unexpected error: {str(e)}"}


def validate_xml(xml_content):
    """Validate that XML is well-formed and check volumetric balance."""
    result = {"valid": False, "error": None, "warnings": [], "products": []}

    try:
        root = ET.fromstring(xml_content)
        result["valid"] = True

        # Check namespaces
        covol_ns = "http://www.sat.gob.mx/ControlesVolumetricos"
        exp_ns = "http://www.sat.gob.mx/ControlesVolumetricos/Expendio"

        # Count products
        productos = root.findall(f"{{{covol_ns}}}PRODUCTO")
        result["product_count"] = len(productos)

        for prod in productos:
            clave = prod.get(f"{{{covol_ns}}}ClaveProducto", "unknown")
            marca = prod.get(f"{{{covol_ns}}}MarcaComercial", "")
            tanques = prod.findall(f"{{{covol_ns}}}TANQUE")
            dispensarios = prod.findall(f"{{{covol_ns}}}DISPENSARIO")

            prod_info = {
                "clave": clave,
                "marca": marca,
                "tanques": len(tanques),
                "dispensarios": len(dispensarios),
                "balance_ok": True,
            }

            # Check volumetric balance for each tank
            for tanque in tanques:
                existencias = tanque.find(f"{{{covol_ns}}}Existencias")
                if existencias is not None:
                    try:
                        anterior_el = existencias.find(f"{{{covol_ns}}}VolumenExistenciasAnterior")
                        recep_el = existencias.find(f"{{{covol_ns}}}VolumenAcumOpsRecep")
                        entreg_el = existencias.find(f"{{{covol_ns}}}VolumenAcumOpsEntreg")
                        final_el = existencias.find(f"{{{covol_ns}}}VolumenExistencias")

                        if all(el is not None for el in [anterior_el, recep_el, entreg_el, final_el]):
                            anterior = float(anterior_el.get(f"{{{covol_ns}}}ValorNumerico", "0"))
                            recep = float(recep_el.get(f"{{{covol_ns}}}ValorNumerico", "0"))
                            entreg = float(entreg_el.get(f"{{{covol_ns}}}ValorNumerico", "0"))
                            final = float(final_el.get(f"{{{covol_ns}}}ValorNumerico", "0"))

                            expected = anterior + recep - entreg
                            if abs(expected - final) > 1.0:  # 1L tolerance
                                clave_tq = tanque.get(f"{{{covol_ns}}}ClaveTanque", "?")
                                result["warnings"].append(
                                    f"Balance mismatch in {clave_tq}: {anterior}+{recep}-{entreg}={expected} vs {final}"
                                )
                                prod_info["balance_ok"] = False
                    except (ValueError, TypeError):
                        pass

            result["products"].append(prod_info)

        # Check bitacora
        bitacoras = root.findall(f"{{{covol_ns}}}BITACORA")
        result["bitacora_count"] = len(bitacoras)

        if not bitacoras:
            result["warnings"].append("BITACORA section is empty")

    except ET.ParseError as e:
        result["error"] = str(e)

    return result


def generate_demo_xml(report_date=None):
    """Generate a demo XML report using data from the database (no AI needed)."""
    from database import db, Station, FuelTransaction, InventorySnapshot

    if report_date is None:
        report_date = date.today()

    stations = Station.query.filter_by(active=True).order_by(Station.code).all()
    if not stations:
        return {"error": "No active stations found"}

    # Use first station as the primary
    station = stations[0]

    # Build raw data text from database
    raw_lines = [f"FECHA: {report_date.isoformat()}", f"ESTACION: {station.name} ({station.code})", ""]

    start = datetime.combine(report_date, datetime.min.time())
    end = datetime.combine(report_date, datetime.max.time())

    for ft in ["magna", "premium", "diesel"]:
        snap = InventorySnapshot.query.filter_by(
            station_id=station.id, fuel_type=ft, snapshot_date=report_date
        ).first()

        cap = getattr(station, f"{ft}_capacity", 40000)
        closing = snap.liters_on_hand if snap else 0

        received = float(db.session.query(
            db.func.coalesce(db.func.sum(FuelTransaction.liters), 0)
        ).filter(
            FuelTransaction.station_id == station.id,
            FuelTransaction.fuel_type == ft,
            FuelTransaction.transaction_type == "received",
            FuelTransaction.timestamp.between(start, end),
        ).scalar())

        sold = float(db.session.query(
            db.func.coalesce(db.func.sum(FuelTransaction.liters), 0)
        ).filter(
            FuelTransaction.station_id == station.id,
            FuelTransaction.fuel_type == ft,
            FuelTransaction.transaction_type == "sold",
            FuelTransaction.timestamp.between(start, end),
        ).scalar())

        opening = closing - received + sold

        raw_lines.append(f"TANQUE {ft.upper()}:")
        raw_lines.append(f"  Capacidad: {cap}L")
        raw_lines.append(f"  Inventario Inicial: {opening:.0f}L")
        raw_lines.append(f"  Litros Recibidos: {received:.0f}L")
        raw_lines.append(f"  Litros Vendidos: {sold:.0f}L")
        raw_lines.append(f"  Inventario Final: {closing:.0f}L")
        raw_lines.append("")

    raw_data_text = "\n".join(raw_lines)

    station_config = {
        "rfc": "GAZ850101ABC",
        "rfc_proveedor": "XAXX010101000",
        "num_permiso": "PL/12345/EXP/ES/2024",
        "modalidad_permiso": "PL/XXXXX/EXP/ES/2024",
        "clave_instalacion": "EDS-0001",
        "descripcion": f"{station.name}, {station.address}, {station.city}",
        "latitud": str(station.latitude or "31.6904"),
        "longitud": str(station.longitude or "-106.4245"),
        "num_tanques": "3",
        "num_dispensarios": "8",
    }

    return generate_sat_xml_with_ai(station_config, raw_data_text, report_date)
