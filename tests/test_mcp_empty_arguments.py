"""The delegated Live backend fills every optional parameter; blanks must not reach MCP."""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "addons/pipecat_assist"))

from app.mcp_bridge import _drop_empty_arguments
from app.openai_live_ha import strict_nullable


class DropEmptyArgumentsTests(unittest.TestCase):
    def test_blank_optionals_are_omitted_and_real_values_kept(self):
        observed = {  # ha_search call recorded from GPT-Live delegation
            "area_filter": "", "domain_filter": "sensor", "exact_match": False, "limit": 30,
            "offset": 0, "query": "Whirlpool", "search_types": "", "state_filter": "",
            "result_fields": ["entity_id"], "fields": [],
        }
        self.assertEqual(
            _drop_empty_arguments(observed),
            {"domain_filter": "sensor", "exact_match": False, "limit": 30, "offset": 0,
             "query": "Whirlpool", "result_fields": ["entity_id"]},
        )


    def test_nullable_becomes_null_type_so_strict_models_can_omit(self):
        schema = {
            "type": "object",
            "properties": {
                "query": {"type": "string", "nullable": True},
                "search_types": {"anyOf": [{"type": "string"}, {"type": "array"}], "nullable": True},
                "nullable": {"type": "boolean"},
            },
        }
        self.assertEqual(
            strict_nullable(schema)["properties"],
            {
                "query": {"type": ["string", "null"]},
                "search_types": {"anyOf": [{"type": "string"}, {"type": "array"}, {"type": "null"}]},
                "nullable": {"type": "boolean"},
            },
        )


if __name__ == "__main__":
    unittest.main()
