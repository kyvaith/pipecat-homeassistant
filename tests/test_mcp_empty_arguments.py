"""The delegated Live backend fills every optional parameter; blanks must not reach MCP."""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "addons/pipecat_assist"))

from app.mcp_bridge import _drop_empty_arguments


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


if __name__ == "__main__":
    unittest.main()
