"""Keep Supervisor, HACS, and frontend cache versions aligned."""

import ast
import json
import re
import tomllib
import unittest
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]


class ReleaseMetadataTests(unittest.TestCase):
    def test_installable_packages_have_one_version(self):
        addon = ROOT / "addons" / "pipecat_assist"
        version = tomllib.loads((addon / "pyproject.toml").read_text(encoding="utf-8"))[
            "project"
        ]["version"]
        paths = [
            addon / "config.yaml",
            ROOT / "addons/pipecat_assist_legacy_amd64/config.yaml",
            ROOT / "custom_components/pipecat_assist/manifest.json",
            addon / "ui-src/package.json",
        ]
        for path in paths:
            with self.subTest(path=path):
                text = path.read_text(encoding="utf-8")
                data = (
                    yaml.safe_load(text) if path.suffix == ".yaml" else json.loads(text)
                )
                self.assertEqual(data["version"], version)
        constants = ast.parse(
            (ROOT / "custom_components/pipecat_assist/const.py").read_text(
                encoding="utf-8"
            )
        )
        component_version = next(
            ast.literal_eval(node.value)
            for node in constants.body
            if isinstance(node, ast.Assign)
            and any(
                isinstance(target, ast.Name) and target.id == "VERSION"
                for target in node.targets
            )
        )
        self.assertEqual(component_version, version)
        for path, name in (
            (
                ROOT / "custom_components/pipecat_assist/www/pipecat-assist-card.js",
                "PIPECAT_ASSIST_CARD_VERSION",
            ),
            (addon / "ui-src/src/main.jsx", "ASSISTANT_CARD_VERSION"),
        ):
            match = re.search(
                rf'const {name} = "([^"]+)"', path.read_text(encoding="utf-8")
            )
            self.assertIsNotNone(match)
            self.assertEqual(match[1], version)


if __name__ == "__main__":
    unittest.main()
