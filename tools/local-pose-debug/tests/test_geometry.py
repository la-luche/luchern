from __future__ import annotations

import unittest

from pose_debug.config import normalize_settings
from pose_debug.pipeline import (
    BoxSample,
    Rect,
    _confidence_color,
    _serialise_landmark,
    body_rect,
    boxes_at,
    face_rect,
)


def landmark(x: float, y: float, confidence: float = 1.0) -> dict[str, float]:
    return {"x": x, "y": y, "z": 0.0, "visibility": confidence, "presence": confidence}


class GeometryTests(unittest.TestCase):
    def test_confidence_heatmap_is_red_yellow_green(self) -> None:
        def point(value: float) -> dict[str, float | bool]:
            return {
                "visibility": value,
                "visibility_set": True,
                "presence": 1.0,
                "presence_set": False,
            }

        self.assertEqual(_confidence_color(point(0.0)), (24, 0, 255))
        self.assertEqual(_confidence_color(point(0.5)), (24, 255, 255))
        self.assertEqual(_confidence_color(point(1.0)), (24, 255, 0))

    def test_unset_proto_presence_defaults_to_visible(self) -> None:
        class ProtoLandmark:
            x = 0.5
            y = 0.4
            z = 0.0
            visibility = 0.9
            presence = 0.0

            @staticmethod
            def HasField(field: str) -> bool:
                return field == "visibility"

        serialised = _serialise_landmark(ProtoLandmark())
        self.assertEqual(serialised["visibility"], 0.9)
        self.assertEqual(serialised["presence"], 1.0)
        self.assertTrue(serialised["visibility_set"])
        self.assertFalse(serialised["presence_set"])

    def test_body_padding_matches_production_defaults(self) -> None:
        points = [landmark(0.3, 0.2), landmark(0.7, 0.8)] * 16 + [landmark(0.5, 0.5)]
        rect = body_rect(points, normalize_settings(None)["boxes"])
        self.assertIsNotNone(rect)
        assert rect is not None
        self.assertAlmostEqual(rect.left, 0.172)
        self.assertAlmostEqual(rect.right, 0.828)
        self.assertAlmostEqual(rect.top, 0.068)
        self.assertAlmostEqual(rect.bottom, 0.908)

    def test_coco17_face_uses_coco_head_indices(self) -> None:
        points = [landmark(0.5, 0.5, 0.1) for _ in range(17)]
        for index, (x, y) in enumerate(
            ((0.48, 0.20), (0.46, 0.19), (0.52, 0.19), (0.44, 0.21), (0.54, 0.21))
        ):
            points[index] = landmark(x, y)
        rect, source = face_rect(
            points,
            Rect(0.2, 0.1, 0.8, 0.9),
            720 / 1280,
            normalize_settings(None)["boxes"],
            "coco17",
        )
        self.assertEqual(source, "landmarks")
        self.assertLess(rect.top, 0.19)
        self.assertGreater(rect.bottom, 0.21)

    def test_strict_interpolation_does_not_carry_stale_box(self) -> None:
        first = BoxSample(0, 0.0, Rect(0, 0, 1, 1), None, None, None)
        second = BoxSample(3, 0.1, None, None, None, None)
        body, _ = boxes_at([first, second], 0.05, "strict")
        self.assertIsNone(body)
        body, _ = boxes_at([first, second], 0.04, "nearest")
        self.assertIsNotNone(body)


if __name__ == "__main__":
    unittest.main()
