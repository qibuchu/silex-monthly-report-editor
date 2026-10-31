"""Build an auditable, editable PPTX data draft from the reviewed Steam template.

This experiment fills the head and new-release tables only. The issue manifest
explicitly marks untouched July pages so the file cannot be mistaken for a final
monthly report.
"""

import argparse
import hashlib
import json
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

from steam_head_to_spec import make_spec as head_spec
from steam_manual_slots import make_spec as manual_spec
from steam_market_to_spec import make_spec as market_spec
from pptx_market_charts import patch_pptx as patch_market_charts
from steam_release_to_spec import make_spec as release_spec, presentation_order, shape_texts


HERE = Path(__file__).resolve().parent
EXPECTED_TEMPLATE_SHA = "9e5577353e1f1721383a6c50bee63a5e9dbbee5dd3cb6e4d441655a5bb4621cf"
PLAN = [{"sourceSlide": 5, "newSlide": 10}, {"sourceSlide": 9, "newSlide": 11}]
UNFILLED_PAGES = {
    1: "封面导语已留空，封面装饰图仍需核对",
    2: "右侧头部活动原因与图标已留为可编辑空槽",
    3: "头部异动专题文字与图片已留为可编辑空槽",
    4: "大盘数量与上新图表已填；历史评测、AI披露和分析文案仍缺失",
    6: "热门新游专题文字与图片已留为可编辑空槽",
    7: "亮眼独游专题文字与图片已留为可编辑空槽",
    8: "亮眼独游专题文字与图片已留为可编辑空槽",
}


def run_script(script, *args):
    subprocess.run([sys.executable, "-B", str(HERE / script), *(str(arg) for arg in args)],
                   check=True, capture_output=True, text=True)


def build(original: Path, data_file: Path, audit_file: Path, output: Path):
    if output.suffix.lower() != ".pptx" or output.resolve() == original.resolve():
        raise ValueError("Output must be a distinct PPTX file")
    if hashlib.sha256(original.read_bytes()).hexdigest() != EXPECTED_TEMPLATE_SHA:
        raise ValueError("Original PPTX differs from the reviewed Steam template")
    load = lambda path: json.loads(path.read_text(encoding="utf-8"))
    data, audit = load(data_file), load(audit_file)
    binding = load(HERE / "steam_head_binding.json")
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="native-draft-", dir=output.parent) as temp:
        temp = Path(temp)
        plan_file, cloned, merged_file, slides_only = (temp / "plan.json", temp / "cloned.pptx",
                                                        temp / "merged.json", temp / "slides-only.pptx")
        plan_file.write_text(json.dumps(PLAN), encoding="utf-8")
        run_script("pptx_clone_slides.py", original, plan_file, cloned)
        binding["templateSha256"] = hashlib.sha256(cloned.read_bytes()).hexdigest()
        head = head_spec(cloned, binding, data, audit)
        releases = release_spec(cloned, data, audit)
        manual = manual_spec(cloned, data["report_month"])
        market = market_spec(cloned, data, audit)
        if head["sourceSha256"] != releases["sourceSha256"] or head["dataSnapshotId"] != releases["dataSnapshotId"]:
            raise ValueError("Head and release specifications disagree")
        merged = {"sourceSha256": head["sourceSha256"], "reportMonth": head["reportMonth"],
                  "dataSnapshotId": head["dataSnapshotId"],
                  "replacements": head["replacements"] + releases["replacements"] + manual["replacements"] + market["replacements"]}
        merged_file.write_text(json.dumps(merged, ensure_ascii=False), encoding="utf-8")
        run_script("pptx_preserve_patch.py", cloned, merged_file, slides_only)
        patch_market_charts(slides_only, output, market["months"])
    with zipfile.ZipFile(output) as archive:
        if archive.testzip() is not None:
            raise ValueError("Native draft ZIP integrity failed")
        order = presentation_order(archive)
        if len(order) != 11:
            raise ValueError("Native draft page count changed")
        stale = []
        comparison_label = f"环比{int(data['previous_month'][-2:])}月"
        for position, slide in enumerate(order, 1):
            texts = shape_texts(archive.read(f"ppt/slides/slide{slide}.xml"))
            for shape_id, value in texts.items():
                scan_value = value.replace(comparison_label, "")
                if "7月" in scan_value or "2026.07" in scan_value:
                    stale.append({"page": position, "slidePart": slide, "shapeId": shape_id,
                                  "sample": value[:100]})
    manifest = {"status": "partial_experiment", "reportMonth": data["report_month"],
                "dataSnapshotId": data["snapshot_id"], "output": str(output),
                "filled": ["head.top20", "new_releases.gold", "new_releases.silver", "new_releases.bronze",
                           "market.months", "market.kpis.total", "market.kpis.mom_growth"],
                "marketDataStatus": (data.get("market") or {}).get("status"),
                "marketReviewTrendAvailable": bool((data.get("market") or {}).get("review_trend")) and
                    all(item.get("review_rate_all") is not None
                        for item in (data.get("market") or {}).get("review_trend") or []),
                "sourceIssues": head["issues"] + releases["issues"] + market["issues"],
                "manualSlots": manual["slots"],
                "unfilledOriginalPages": [{"sourceSlide": slide, "reason": reason} for slide, reason in UNFILLED_PAGES.items()],
                "oldMonthText": stale,
                "warning": "历史评测、AI披露和研究文案仍待补；生成结果尚未完成数据与视觉验收。"}
    issues_path = output.with_suffix(".issues.json")
    issues_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    return manifest, issues_path


def main():
    parser = argparse.ArgumentParser()
    for name in ("original", "data", "audit", "output"):
        parser.add_argument(name, type=Path)
    args = parser.parse_args()
    manifest, issues = build(args.original, args.data, args.audit, args.output)
    print(json.dumps({"output": str(args.output), "issuesFile": str(issues),
                      "pages": 11, "sourceIssues": len(manifest["sourceIssues"]),
                      "oldMonthShapes": len(manifest["oldMonthText"])}, ensure_ascii=False))


if __name__ == "__main__":
    main()
