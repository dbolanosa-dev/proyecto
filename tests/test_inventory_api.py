import os
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

os.environ["SESSION_SECRET"] = "test-session-secret"
os.environ["PULPERIA_PASSWORD"] = "test-password"
os.environ["POSTGRES_URL"] = "postgresql://user:password@localhost/test"

import app as index


class FakeDatabase:
    inventory = None
    version = 0

    @classmethod
    def connect(cls, *_args, **_kwargs):
        return FakeConnection(cls)


class FakeConnection:
    def __init__(self, database):
        self.database = database

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def cursor(self):
        return FakeCursor(self.database)


class FakeCursor:
    def __init__(self, database):
        self.database = database
        self.result = None

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def execute(self, query, parameters=None):
        if "SELECT inventory, version" in query:
            if self.database.inventory is not None:
                self.result = (self.database.inventory, self.database.version)
            return
        if "INSERT INTO pulperia_inventory" in query:
            inventory, expected_version = parameters
            current_version = self.database.version if self.database.inventory is not None else 0
            if expected_version == current_version:
                self.database.inventory = inventory.obj
                self.database.version = current_version + 1
                self.result = (self.database.version,)
            else:
                self.result = None

    def fetchone(self):
        return self.result

    def close(self):
        pass


class InventoryApiTests(unittest.TestCase):
    def setUp(self):
        FakeDatabase.inventory = None
        FakeDatabase.version = 0
        self.client = index.app.test_client()
        self.connection_patch = patch.object(index.psycopg, "connect", FakeDatabase.connect)
        self.connection_patch.start()
        self.addCleanup(self.connection_patch.stop)

    def use_sqlite_database(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        database_path = Path(directory.name) / "inventory.sqlite3"
        self.sqlite_path_patch = patch.object(index, "LOCAL_DATABASE", database_path)
        self.sqlite_mode_patch = patch.object(index, "use_local_sqlite", return_value=True)
        self.sqlite_path_patch.start()
        self.sqlite_mode_patch.start()
        self.addCleanup(self.sqlite_path_patch.stop)
        self.addCleanup(self.sqlite_mode_patch.stop)

    def login(self):
        return self.client.post("/api/login", json={"password": "test-password"})

    def test_inventory_requires_login(self):
        response = self.client.get("/api/inventory")
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.headers["Cache-Control"], "no-store")

    def test_inventory_reports_missing_database_configuration(self):
        with patch.dict(os.environ, {"VERCEL": "1", "POSTGRES_URL": "", "DATABASE_URL": ""}):
            response = self.client.get("/api/session")
        self.assertEqual(response.status_code, 503)
        self.assertIn("POSTGRES_URL", response.get_json()["error"])

    def test_login_rejects_wrong_password(self):
        response = self.client.post("/api/login", json={"password": "wrong"})
        self.assertEqual(response.status_code, 401)

    def test_public_frontend_and_login_page_are_served(self):
        with self.client.get("/") as home:
            self.assertEqual(home.status_code, 200)
            self.assertIn(b"PostgreSQL", home.data)
        with self.client.get("/styles.css") as styles:
            self.assertEqual(styles.status_code, 200)
        with self.client.get("/login", follow_redirects=True) as login:
            self.assertEqual(login.status_code, 200)
            self.assertIn(b"ACCESO PRIVADO", login.data)

    def test_inventory_persists_with_optimistic_version(self):
        self.assertEqual(self.login().status_code, 200)
        initial = self.client.get("/api/inventory").get_json()
        self.assertEqual(initial["version"], 0)

        payload = {
            "products": [{
                "id": "product-1",
                "name": "Arroz",
                "category": "",
                "barcode": "",
                "entryDate": "2026-10-12",
                "expiryDate": "",
                "quantity": 4,
                "remainingQuantity": 4,
                "unitCost": 500,
                "unitPrice": 700,
                "offerPrice": None,
                "offerEndsAt": None,
                "createdAt": "2026-10-12T12:00:00.000Z",
            }],
            "movements": [],
        }
        saved = self.client.put("/api/inventory", json={"inventory": payload, "version": 0})
        self.assertEqual(saved.status_code, 200)
        self.assertEqual(saved.get_json()["version"], 1)

        stale = self.client.put("/api/inventory", json={"inventory": payload, "version": 0})
        self.assertEqual(stale.status_code, 409)
        latest = self.client.get("/api/inventory").get_json()
        self.assertEqual(latest["version"], 1)
        self.assertEqual(latest["inventory"], payload)

    def test_local_sqlite_persists_inventory_and_rejects_stale_writes(self):
        self.use_sqlite_database()
        self.assertEqual(self.login().status_code, 200)
        initial = self.client.get("/api/inventory").get_json()
        self.assertEqual(initial["version"], 0)
        inventory = {"products": [], "movements": []}

        saved = self.client.put("/api/inventory", json={"inventory": inventory, "version": 0})
        self.assertEqual(saved.status_code, 200)
        self.assertEqual(saved.get_json()["version"], 1)
        stale = self.client.put("/api/inventory", json={"inventory": inventory, "version": 0})
        self.assertEqual(stale.status_code, 409)
        persisted = self.client.get("/api/inventory").get_json()
        self.assertEqual(persisted["version"], 1)
        self.assertEqual(persisted["inventory"], inventory)

    def test_invalid_origin_is_rejected(self):
        self.login()
        response = self.client.post("/api/logout", headers={"Origin": "https://attacker.example"})
        self.assertEqual(response.status_code, 403)


if __name__ == "__main__":
    unittest.main()
