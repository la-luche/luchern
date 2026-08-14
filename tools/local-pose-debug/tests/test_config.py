from __future__ import annotations

import unittest

from pose_debug.config import automatic_experiment_name, normalize_settings, slugify


class ConfigTests(unittest.TestCase):
    def test_partial_settings_merge_with_defaults(self) -> None:
        settings = normalize_settings({"boxes": {"face": {"pad_top": 1.1}}})
        self.assertEqual(settings["boxes"]["face"]["pad_top"], 1.1)
        self.assertEqual(settings["boxes"]["body"]["pad_x"], 0.32)

    def test_unknown_setting_is_rejected(self) -> None:
        with self.assertRaisesRegex(ValueError, "unknown setting"):
            normalize_settings({"boxes": {"face": {"mystery": 1}}})

    def test_automatic_name_describes_geometry(self) -> None:
        settings = normalize_settings(None)
        name = automatic_experiment_name(settings)
        self.assertIn("face-l40-t85-r40-b60-h200", name)
        self.assertIn("body-x32-t22-b18", name)
        self.assertTrue(slugify(name).startswith("face-l40"))


if __name__ == "__main__":
    unittest.main()
