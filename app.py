import hmac
import json
import os
import sqlite3
from datetime import date, datetime, timedelta
from pathlib import Path
from urllib.parse import urlsplit
from contextlib import contextmanager

import psycopg
from dotenv import load_dotenv
from flask import Flask, jsonify, redirect, request, send_from_directory, session
from psycopg.types.json import Jsonb
from werkzeug.middleware.proxy_fix import ProxyFix


ROOT = Path(__file__).resolve().parent
INVENTORY_DIRECTORY = ROOT / "public"
LOCAL_DATABASE = ROOT / ".data" / "pulperia.sqlite3"
load_dotenv(ROOT / ".env")

app = Flask(__name__)
app.secret_key = os.environ.get("SESSION_SECRET")
app.config.update(
    MAX_CONTENT_LENGTH=5 * 1024 * 1024,
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Strict",
    SESSION_COOKIE_SECURE=bool(os.environ.get("VERCEL")),
    PERMANENT_SESSION_LIFETIME=timedelta(hours=8),
)
app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1)


def inventory_database_url():
    return os.environ.get("POSTGRES_URL") or os.environ.get("DATABASE_URL")


def use_local_sqlite():
    return not os.environ.get("VERCEL") and not inventory_database_url()


def missing_configuration():
    missing = [
        name
        for name, value in (
            ("SESSION_SECRET", app.secret_key),
            ("PULPERIA_PASSWORD", os.environ.get("PULPERIA_PASSWORD")),
            ("POSTGRES_URL", inventory_database_url() if os.environ.get("VERCEL") else True),
        )
        if not value
    ]
    return missing


@app.before_request
def check_configuration():
    missing = missing_configuration()
    if missing and request.path.startswith("/api/"):
        app.logger.error("Missing required environment variables: %s", ", ".join(missing))
        return jsonify(
            error=f"Falta configurar en el servidor: {', '.join(missing)}. "
            "Configure estas variables y vuelva a iniciar la aplicación."
        ), 503


@app.before_request
def protect_api_from_cross_site_requests():
    if request.path.startswith("/api/") and request.method in {"POST", "PUT", "DELETE"}:
        origin = request.headers.get("Origin")
        if origin:
            parsed_origin = urlsplit(origin)
            if parsed_origin.scheme not in {"http", "https"} or parsed_origin.netloc.lower() != request.host.lower():
                return jsonify(error="Origen de solicitud no permitido."), 403


@app.after_request
def prevent_api_caching(response):
    if request.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store"
    return response


@app.errorhandler(413)
def request_too_large(_error):
    return jsonify(error="La solicitud excede el tamaño máximo permitido."), 413


def api_error(message, status):
    return jsonify(error=message), status


def authenticated():
    if not session.get("authenticated"):
        return api_error("Debe iniciar sesión para continuar.", 401)
    return None


def parse_date(value):
    if not isinstance(value, str):
        return False
    try:
        return date.fromisoformat(value).isoformat() == value
    except ValueError:
        return False


def parse_datetime(value):
    if not isinstance(value, str):
        return False
    try:
        datetime.fromisoformat(value.replace("Z", "+00:00"))
        return True
    except ValueError:
        return False


def is_number(value, minimum=0):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and value >= minimum


def is_nonempty_string(value, maximum=200):
    return isinstance(value, str) and 0 < len(value) <= maximum


def is_valid_inventory(value):
    if not isinstance(value, dict):
        return False
    products = value.get("products")
    movements = value.get("movements")
    if not isinstance(products, list) or not isinstance(movements, list):
        return False
    if len(products) > 10000 or len(movements) > 50000:
        return False

    product_ids = set()
    for product in products:
        if not isinstance(product, dict):
            return False
        if not all(
            (
                is_nonempty_string(product.get("id")),
                is_nonempty_string(product.get("name"), 80),
                isinstance(product.get("category"), str) and len(product["category"]) <= 40,
                product.get("barcode") is None
                or isinstance(product.get("barcode"), str) and len(product["barcode"]) <= 80,
                parse_date(product.get("entryDate")),
                product.get("expiryDate") == "" or parse_date(product.get("expiryDate")),
                is_nonempty_string(product.get("createdAt")),
                is_number(product.get("quantity"), 0.000000001),
                is_number(product.get("remainingQuantity")),
                is_number(product.get("unitCost")),
                is_number(product.get("unitPrice")),
            )
        ):
            return False
        if product["remainingQuantity"] > product["quantity"]:
            return False
        offer_price = product.get("offerPrice")
        offer_ends_at = product.get("offerEndsAt")
        if (offer_price is None) != (offer_ends_at is None):
            return False
        if offer_price is not None and not (
            is_number(offer_price) and offer_price < product["unitPrice"] and parse_datetime(offer_ends_at)
        ):
            return False
        if product["id"] in product_ids:
            return False
        product_ids.add(product["id"])

    for movement in movements:
        if not isinstance(movement, dict):
            return False
        if not all(
            (
                is_nonempty_string(movement.get("id")),
                is_nonempty_string(movement.get("productId")),
                is_nonempty_string(movement.get("productName"), 80),
                movement.get("type") in {"sale", "consumption"},
                parse_date(movement.get("date")),
                is_nonempty_string(movement.get("createdAt")),
                is_number(movement.get("quantity"), 0.000000001),
                is_number(movement.get("unitPrice")),
                is_number(movement.get("total")),
                movement.get("unitCost") is None or is_number(movement.get("unitCost")),
                movement.get("personName") is None
                or isinstance(movement.get("personName"), str)
                and len(movement["personName"]) <= 80,
                movement.get("orderId") is None
                or isinstance(movement.get("orderId"), str)
                and 0 < len(movement["orderId"]) <= 80,
            )
        ):
            return False
        if movement["productId"] not in product_ids:
            return False

    try:
        json.dumps(value, allow_nan=False)
    except (TypeError, ValueError):
        return False
    return True


def ensure_inventory_table(cursor):
    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS pulperia_inventory (
            id SMALLINT PRIMARY KEY CHECK (id = 1),
            inventory JSONB NOT NULL,
            version BIGINT NOT NULL DEFAULT 0
        )
        """
    )


@contextmanager
def local_sqlite_connection():
    LOCAL_DATABASE.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(LOCAL_DATABASE, timeout=5)
    try:
        yield connection
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


@contextmanager
def database_cursor(connection):
    cursor = connection.cursor()
    try:
        yield cursor
    finally:
        cursor.close()


def ensure_local_inventory_table(cursor):
    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS pulperia_inventory (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            inventory TEXT NOT NULL,
            version INTEGER NOT NULL DEFAULT 0
        )
        """
    )


def current_request_path(resource):
    return resource.strip("/")


@app.route("/api/<path:resource>", methods=["GET", "POST", "PUT"])
def handle_api(resource):
    path = current_request_path(resource)

    if path == "session" and request.method == "GET":
        return jsonify(authenticated=bool(session.get("authenticated")))

    if path == "login" and request.method == "POST":
        body = request.get_json(silent=True)
        password = body.get("password") if isinstance(body, dict) else None
        expected_password = os.environ["PULPERIA_PASSWORD"]
        if not isinstance(password, str) or not hmac.compare_digest(password, expected_password):
            return api_error("La contraseña es incorrecta.", 401)
        session.clear()
        session["authenticated"] = True
        session.permanent = True
        return jsonify(authenticated=True)

    if path == "logout" and request.method == "POST":
        session.clear()
        return jsonify(authenticated=False)

    if path == "inventory" and request.method in {"GET", "PUT"}:
        auth_error = authenticated()
        if auth_error:
            return auth_error
        try:
            if use_local_sqlite():
                connection_context = local_sqlite_connection()
            else:
                connection_context = psycopg.connect(
                    inventory_database_url(), sslmode="require", connect_timeout=5
                )
            with connection_context as connection:
                with database_cursor(connection) as cursor:
                    if use_local_sqlite():
                        ensure_local_inventory_table(cursor)
                    else:
                        ensure_inventory_table(cursor)
                    if request.method == "GET":
                        cursor.execute("SELECT inventory, version FROM pulperia_inventory WHERE id = 1")
                        row = cursor.fetchone()
                        if row is None:
                            return jsonify(inventory={"products": [], "movements": []}, version=0)
                        value = json.loads(row[0]) if use_local_sqlite() else row[0]
                        return jsonify(inventory=value, version=row[1])

                    body = request.get_json(silent=True)
                    if not isinstance(body, dict):
                        return api_error("El contenido de la solicitud no es válido.", 400)
                    expected_version = body.get("version")
                    payload = body.get("inventory")
                    if (
                        not isinstance(expected_version, int)
                        or isinstance(expected_version, bool)
                        or expected_version < 0
                        or not is_valid_inventory(payload)
                    ):
                        return api_error("El inventario no tiene un formato válido.", 400)
                    if use_local_sqlite():
                        cursor.execute("BEGIN IMMEDIATE")
                        cursor.execute(
                            """
                            INSERT INTO pulperia_inventory (id, inventory, version)
                            VALUES (1, ?, 1)
                            ON CONFLICT (id) DO UPDATE
                            SET inventory = excluded.inventory,
                                version = pulperia_inventory.version + 1
                            WHERE pulperia_inventory.version = ?
                            RETURNING version
                            """,
                            (json.dumps(payload, allow_nan=False), expected_version),
                        )
                    else:
                        cursor.execute(
                            """
                            INSERT INTO pulperia_inventory (id, inventory, version)
                            VALUES (1, %s, 1)
                            ON CONFLICT (id) DO UPDATE
                            SET inventory = EXCLUDED.inventory,
                                version = pulperia_inventory.version + 1
                            WHERE pulperia_inventory.version = %s
                            RETURNING version
                            """,
                            (Jsonb(payload), expected_version),
                        )
                    row = cursor.fetchone()
                    if row is None:
                        return api_error(
                            "El inventario cambió en otro dispositivo. Se recargará la versión más reciente.",
                            409,
                        )
                    return jsonify(version=row[0])
        except (psycopg.Error, sqlite3.Error):
            app.logger.exception("Inventory database request failed.")
            return api_error("No se pudo acceder a la base de datos del inventario.", 503)

    return api_error("Recurso no encontrado.", 404)


@app.get("/")
def serve_inventory():
    return send_from_directory(INVENTORY_DIRECTORY, "index.html")


@app.get("/login")
def serve_login():
    return redirect("/login.html")


@app.get("/<path:filename>")
def serve_static_file(filename):
    return send_from_directory(INVENTORY_DIRECTORY, filename)


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=int(os.environ.get("PORT", "8000")), debug=False)
