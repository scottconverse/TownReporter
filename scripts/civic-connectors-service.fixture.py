"""Synthetic loopback service fixture, never a production service launcher."""
import json
import sys
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

import uvicorn
from civic_data_connectors import create_engine
from civic_data_connectors.providers import Response
from civic_data_connectors.storage import SQLiteStorage
from civic_data_connectors.transports.http import create_app
from civic_data_connectors.transports.runtime import ServiceConfig
from civic_data_connectors.write_adapters import default_adapters
from civic_data_connectors.write_transport import WriteResponse


class NoLiveReads:
    def request(self, url, **options):
        if url == "https://synthetic.escribemeetings.com/agenda.txt":
            return Response(url, b"Harbor sidewalk allocation approved for public review.", "text/plain")
        if url == "https://connect.telvue.com/api/v2/videos.json":
            assert options["headers"]["CONNECT-ACCESS-KEY"] == "synthetic-access-key"
            return Response(url, b'{"videos":[{"id":32261,"title":"Fixture Council"}]}', "application/json")
        if url == "https://meetingsgov.devmunicode.com/PublicApi/meeting/42":
            assert options["headers"]["Authorization"] == "Bearer synthetic-account-token"
            return Response(url, b'{"unmapped":"fixture raw response"}', "application/json")
        raise AssertionError(f"The consumer fixture forbids unexpected provider reads: {url}")

    def __getattr__(self, name):
        raise AssertionError("The consumer acceptance fixture forbids live provider reads.")


class SyntheticLegistar:
    mock = True

    def __init__(self, root):
        self.root = root
        self.state = root / "synthetic-provider.json"
        self.records = json.loads(self.state.read_text()) if self.state.exists() else {}

    def send(self, url, *, method, body, headers, byte_limit, deadline_seconds):
        parsed = urlsplit(url)
        assert parsed.hostname == "webapi.legistar.com"
        assert parse_qs(parsed.query)["token"] == ["synthetic-provider-secret"]
        with (self.root / "synthetic-calls.jsonl").open("a", encoding="utf-8") as stream:
            stream.write(json.dumps({"method": method, "path": parsed.path}) + "\n")
        if method == "POST":
            row = json.loads(body)
            row.update(EventId=100 + len(self.records), EventRowVersion="AQ==")
            self.records[str(row["EventId"])] = row
            self.state.write_text(json.dumps(self.records))
            return WriteResponse(200, json.dumps(row).encode())
        if method == "GET":
            if "$filter" in parse_qs(parsed.query):
                expression = parse_qs(parsed.query)["$filter"][0]
                rows = [row for row in self.records.values() if row["EventGuid"] in expression]
                return WriteResponse(200, json.dumps(rows).encode())
            return WriteResponse(200, json.dumps(self.records[parsed.path.rsplit("/", 1)[-1]]).encode())
        raise AssertionError("This fixture only permits synthetic create/readback.")


root = Path(sys.argv[1]).resolve()
assert root.name.startswith("townreporter-connectors-")
assert (root / "fixture-owner.txt").read_text() == "connector-fixture-only\n"
settings = ServiceConfig.from_dict(json.loads((root / "service.json").read_text())["service"])
engine = create_engine(storage=SQLiteStorage(root / "captures.sqlite"),
                       provider_transport=NoLiveReads(),
                       write_adapters=default_adapters(SyntheticLegistar(root)))
uvicorn.run(create_app(engine, settings), host=settings.host, port=settings.port, access_log=False)
