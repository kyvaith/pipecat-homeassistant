"""German, English and Polish farewell detection."""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "addons/pipecat_assist"))

from app.main import _should_end_conversation


class ConversationEndTests(unittest.TestCase):
    def test_german_farewells_end(self):
        for text in ("Tschüss!", "Gern geschehen, bis dann!", "Mach's gut.", "Einen schönen Tag noch!", "Tschüß", "Danke, das war's.", "Das wars", "Ende.", "Okay, fertig",
                     "Gespräch beenden", "Bis später!", "Auf Wiedersehen"):
            self.assertTrue(_should_end_conversation(text), text)

    def test_ordinary_sentences_continue(self):
        for text in ("Ist das Licht im Wohnzimmer an?", "Am Ende des Flurs ist es dunkel.",
                     "Die Waschmaschine ist fertig?", "Stopp die Musik im Büro"):
            self.assertFalse(_should_end_conversation(text), text)

    def test_existing_languages_still_end(self):
        for text in ("Goodbye", "thanks that's all", "dzięki koniec"):
            self.assertTrue(_should_end_conversation(text), text)


if __name__ == "__main__":
    unittest.main()
