"""Regression tests for the Zotero install manifest and private update policy."""
import copy
import importlib.util
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("zotmeta_build", ROOT / "scripts" / "build.py")
build = importlib.util.module_from_spec(spec)
spec.loader.exec_module(build)


class ManifestTests(unittest.TestCase):
    def setUp(self):
        self.manifest = json.loads((ROOT / "src" / "manifest.json").read_text(encoding="utf-8"))
        self.manifest["version"] = build.VERSION

    def test_current_build_supports_zotero_10_0_7(self):
        build.validate_manifest(self.manifest, "10.0.7")

    def test_previous_broken_package_is_rejected(self):
        self.manifest["version"] = "2.1.1-local.1"
        del self.manifest["applications"]["zotero"]["update_url"]
        with self.assertRaisesRegex(ValueError, "required.*update_url"):
            build.validate_manifest(self.manifest)

    def test_all_three_native_required_fields(self):
        for field in ("id", "update_url", "strict_max_version"):
            with self.subTest(field=field):
                manifest = copy.deepcopy(self.manifest)
                del manifest["applications"]["zotero"][field]
                with self.assertRaisesRegex(ValueError, field):
                    build.validate_manifest(manifest)

    def test_secure_update_url(self):
        for url in ("", "http://example.invalid/updates.json", "data:application/json,{}", "https:"):
            with self.subTest(url=url):
                self.manifest["applications"]["zotero"]["update_url"] = url
                with self.assertRaises(ValueError):
                    build.validate_manifest(self.manifest)

    def test_out_of_range_target_is_rejected(self):
        self.manifest["applications"]["zotero"]["strict_max_version"] = "9.0.*"
        with self.assertRaisesRegex(ValueError, "does not support"):
            build.validate_manifest(self.manifest)

    def test_numeric_build_version(self):
        for version in ("2.1.1-local.1", "2.1.01.2", "2.1.1.2.3"):
            with self.subTest(version=version):
                self.manifest["version"] = version
                with self.assertRaisesRegex(ValueError, "four integer"):
                    build.validate_manifest(self.manifest)


if __name__ == "__main__":
    unittest.main()
