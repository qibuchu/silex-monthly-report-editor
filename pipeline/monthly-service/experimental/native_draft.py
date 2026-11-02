"""Build an editable PPTX draft from a template, its native mapping and audited data."""

import argparse
import hashlib
import json
import shutil
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

from native_mapping import check_mapping, compile_mapping, presentation_order, shape_texts, validate_mapping
from pptx_market_charts import patch_pptx as patch_charts


HERE = Path(__file__).resolve().parent


def run_script(script, *args):
    subprocess.run([sys.executable, "-B", str(HERE / script), *(str(arg) for arg in args)],
                   check=True, capture_output=True, text=True)


def scan_old_month(output, mapping, contract):
    """Report text that still names the template's own month."""
    source = mapping.get("sourceMonth")
    if not source or source == contract["month"]:
        return []
    label, dotted = f"{int(source[-2:])}月", source.replace("-", ".")
    comparison = f"环比{int(contract['previous'][-2:])}月"
    stale = []
    with zipfile.ZipFile(output) as archive:
        for position, slide in enumerate(presentation_order(archive), 1):
            for shape_id, value in shape_texts(archive.read(f"ppt/slides/slide{slide}.xml")).items():
                scanned = value.replace(comparison, "")
                if label in scanned or dotted in scanned:
                    stale.append({"page": position, "slidePart": slide, "shapeId": shape_id, "sample": value[:100]})
    return stale


def build(original: Path, data_file: Path, output: Path, mapping_file: Path, extra_files=None):
    """extra_files: named side inputs a data source may need (Steam: audit; minigame: previous)."""
    if output.suffix.lower() != ".pptx" or output.resolve() == original.resolve():
        raise ValueError("Output must be a distinct PPTX file")
    load = lambda path: json.loads(path.read_text(encoding="utf-8"))
    data, mapping = load(data_file), validate_mapping(load(mapping_file))
    extras = {name: load(path) for name, path in (extra_files or {}).items() if path is not None}
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="native-draft-", dir=output.parent) as temp:
        temp = Path(temp)
        plan_file, cloned, merged_file, slides_only = (temp / "plan.json", temp / "cloned.pptx",
                                                        temp / "merged.json", temp / "slides-only.pptx")
        continuations = mapping.get("continuations") or []
        if continuations:
            plan_file.write_text(json.dumps(continuations), encoding="utf-8")
            run_script("pptx_clone_slides.py", original, plan_file, cloned)
        else:
            shutil.copyfile(original, cloned)
        compiled = compile_mapping(mapping, cloned, data, extras)
        contract = compiled["contract"]
        merged = {"sourceSha256": hashlib.sha256(cloned.read_bytes()).hexdigest(), "reportMonth": contract["month"],
                  "dataSnapshotId": contract["snapshotId"], "replacements": compiled["replacements"]}
        merged_file.write_text(json.dumps(merged, ensure_ascii=False), encoding="utf-8")
        try:
            subprocess.run([sys.executable, "-B", str(HERE / "pptx_preserve_patch.py"), str(cloned), str(merged_file), str(slides_only)],
                           check=True, capture_output=True, text=True)
        except subprocess.CalledProcessError as error:
            raise ValueError((error.stderr or "").strip().splitlines()[-1]) from error
        if compiled["charts"] or compiled["blankCharts"]:
            patch_charts(slides_only, output, compiled["charts"], compiled["blankCharts"])
        else:
            shutil.copyfile(slides_only, output)
    with zipfile.ZipFile(output) as archive:
        if archive.testzip() is not None:
            raise ValueError("Native draft ZIP integrity failed")
        pages = len(presentation_order(archive))
    manifest = {"status": "partial_experiment", "dataSource": compiled["dataSource"], "reportMonth": contract["month"],
                "dataSnapshotId": contract["snapshotId"], "output": str(output), "pages": pages,
                "marketDataStatus": (data.get("market") or {}).get("status"),
                "marketReviewTrendAvailable": bool((data.get("market") or {}).get("review_trend")) and
                    all(item.get("review_rate_all") is not None
                        for item in (data.get("market") or {}).get("review_trend") or []),
                "sourceIssues": compiled["sourceIssues"], "mappingIssues": compiled["mappingIssues"],
                "manualSlots": compiled["slots"], "removedObjects": compiled["removed"],
                "unfilledOriginalPages": [{"sourceSlide": int(slide), "reason": reason}
                                          for slide, reason in (mapping.get("pageNotes") or {}).items()],
                "oldMonthText": scan_old_month(output, mapping, contract),
                "warning": compiled["warning"]}
    issues_path = output.with_suffix(".issues.json")
    issues_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    return manifest, issues_path


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser()
    subcommands = parser.add_subparsers(dest="command", required=True)
    generate = subcommands.add_parser("generate")
    for name in ("original", "data", "output", "mapping"):
        generate.add_argument(name, type=Path)
    generate.add_argument("--audit", type=Path)
    generate.add_argument("--previous", type=Path)
    check = subcommands.add_parser("check")
    for name in ("original", "mapping"):
        check.add_argument(name, type=Path)
    args = parser.parse_args()
    if args.command == "check":
        mapping = json.loads(args.mapping.read_text(encoding="utf-8"))
        print(json.dumps(check_mapping(mapping, args.original), ensure_ascii=False))
        return
    manifest, issues = build(args.original, args.data, args.output, args.mapping,
                             {"audit": args.audit, "previous": args.previous})
    print(json.dumps({"output": str(args.output), "issuesFile": str(issues), "pages": manifest["pages"],
                      "sourceIssues": len(manifest["sourceIssues"]), "mappingIssues": len(manifest["mappingIssues"]),
                      "oldMonthShapes": len(manifest["oldMonthText"])}, ensure_ascii=False))


if __name__ == "__main__":
    main()
