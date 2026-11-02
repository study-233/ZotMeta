"""Build a private XPI on Windows or Unix: python scripts/build.py.

Runs the repository tests first. Release metadata in the checkout is untouched;
the packaged manifests retain Zotero's required HTTPS update URL. A packaged
default preference disables background updates for this add-on at startup.
"""
import hashlib
import json
from pathlib import Path
import re
import subprocess
from urllib.parse import urlparse
import xml.etree.ElementTree as ET
import zipfile

ROOT = Path(__file__).resolve().parents[1]
VERSION = json.loads((ROOT / "src" / "manifest.json").read_text(encoding="utf-8"))["version"]
PRIVATE_PREF = 'pref("extensions.zotmeta.privateBuild", true);\n'


def validate_manifest(manifest, target_version="10.0.7"):
    """Mirror Zotero's required fields, then check our intended target range.

    Zotero 10.0.7's modules/Extension.sys.mjs rejects extensions without
    applications.zotero.id, update_url, or strict_max_version.
    """
    if manifest.get("manifest_version") != 2:
        raise ValueError("Expected manifest_version 2")
    zotero = manifest.get("applications", {}).get("zotero", {})
    for field in ("id", "update_url", "strict_max_version"):
        if not zotero.get(field):
            raise ValueError(f"Missing Zotero-required applications.zotero.{field}")
    url = urlparse(zotero["update_url"])
    if url.scheme != "https" or not url.netloc:
        raise ValueError("Zotero update_url must use HTTPS")
    if not re.fullmatch(r"(?:0|[1-9][0-9]{0,8})(?:\.(?:0|[1-9][0-9]{0,8})){0,3}", manifest.get("version", "")):
        raise ValueError("Build version must contain at most four integer components")

    def version_tuple(value):
        parts = value.split(".")
        if not 1 <= len(parts) <= 4 or any(not (p.isdigit() or p == "*") for p in parts):
            raise ValueError("Unexpected compatibility version: " + value)
        return tuple(10**9 if p == "*" else int(p) for p in parts) + (0,) * (4 - len(parts))

    minimum = zotero.get("strict_min_version", "0")
    if "*" in minimum:
        raise ValueError("strict_min_version cannot contain a wildcard")
    if not version_tuple(minimum) <= version_tuple(target_version) <= version_tuple(zotero["strict_max_version"]):
        raise ValueError(f"Manifest does not support Zotero {target_version}")


def validate_package(path, expected_names):
    with zipfile.ZipFile(path) as archive:
        assert archive.testzip() is None
        assert set(archive.namelist()) == set(expected_names)
        assert len(archive.namelist()) == len(set(archive.namelist()))
        manifest = json.loads(archive.read("manifest.json"))
        validate_manifest(manifest)
        assert manifest["version"] == VERSION
        rdf = ET.fromstring(archive.read("install.rdf"))
        ns = {"em": "http://www.mozilla.org/2004/em-rdf#"}
        assert rdf.find(".//em:updateURL", ns).text == manifest["applications"]["zotero"]["update_url"]
        assert rdf.find(".//em:version", ns).text == VERSION
        assert PRIVATE_PREF.encode() in archive.read("prefs.js")
        assert b"AddonManager.AUTOUPDATE_DISABLE" in archive.read("bootstrap.js")
        for locale in ("en-US", "zh-CN"):
            for name in (f"locale/{locale}/zotmeta.ftl", f"chrome/locale/{locale}/zotmeta.properties"):
                assert archive.read(name).decode("utf-8").strip()


def main():
    subprocess.run(["node", "tests/run-tests.js"], cwd=ROOT, check=True)
    subprocess.run(["python", "-B", "-m", "unittest", "discover", "-s", "tests", "-p", "test_build.py"], cwd=ROOT, check=True)
    src = ROOT / "src"
    files = {p.relative_to(src).as_posix(): p.read_bytes()
             for p in sorted(src.rglob("*")) if p.is_file()}
    manifest = json.loads(files["manifest.json"])
    manifest["version"] = VERSION
    validate_manifest(manifest)
    files["manifest.json"] = (json.dumps(manifest, ensure_ascii=False, indent=4) + "\n").encode()
    rdf = files["install.rdf"].decode()
    rdf = re.sub(r"<em:version>[^<]+</em:version>", f"<em:version>{VERSION}</em:version>", rdf)
    files["install.rdf"] = rdf.encode()
    # Zotero 7+ reads default preferences from the plugin root.
    files["prefs.js"] = files["defaults/preferences/prefs.js"] + b"\n" + PRIVATE_PREF.encode()
    files["LICENSE"] = (ROOT / "LICENSE").read_bytes()
    ET.fromstring(files["preferences.xhtml"])
    ET.fromstring(files["install.rdf"])
    out = ROOT / "build" / f"zotmeta-{VERSION}.xpi"
    out.parent.mkdir(exist_ok=True)
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as archive:
        for name, content in sorted(files.items()):
            info = zipfile.ZipInfo(name, (2026, 11, 2, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, content)
    validate_package(out, files)
    digest = hashlib.sha256(out.read_bytes()).hexdigest()
    out.with_suffix(".xpi.sha256").write_text(f"{digest}  {out.name}\n", encoding="utf-8")
    print(f"XPI: {out}\nSHA256: {digest}\nLocales: en-US, zh-CN\nRequired HTTPS update_url: retained\nBackground updates: disabled for this add-on at private-build startup")


if __name__ == "__main__":
    main()
