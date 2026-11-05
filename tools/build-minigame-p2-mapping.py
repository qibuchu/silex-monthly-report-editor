"""Rebind the mini-game monthly mapping after rebuilding slide 2 with PowerPoint."""
import hashlib
import json
import sys
from pathlib import Path


source, ids_file, existing, output = map(Path, sys.argv[1:5])
ids = json.loads(ids_file.read_text(encoding="utf-8-sig"))
mapping = json.loads(existing.read_text(encoding="utf-8"))
mapping["seedSha256"] = hashlib.sha256(source.read_bytes()).hexdigest()
mapping["templateNote"] = "第2页按微信/抖音双卡片重排，近三个月双轴图表为可编辑 PowerPoint 原生图表。"
mapping["pageNotes"]["2"] = "微信与抖音分别展示买量摘要和原生图表；原因说明在来源月保留，跨月份生成改为人工可编辑提示。"
ops = [op for op in mapping["ops"] if op.get("slide") != 2]
slide = 2
ops.extend([
    {"op": "replaceFragment", "slide": slide, "shapeId": 14, "find": r"\d{1,2}月", "value": "{monthNumber}月"},
    {"op": "replaceText", "slide": slide, "shapeId": ids["acq_headline"], "value": "{acquisitionHeadline}"},
    {"op": "replaceText", "slide": slide, "shapeId": ids["acq_wechat_heading"],
     "value": "微信：{monthNumber}月 {wechatMaterialWan} 万条，环比 {acqWechatGrowth}"},
    {"op": "replaceText", "slide": slide, "shapeId": ids["acq_douyin_heading"],
     "value": "抖音：{monthNumber}月 {douyinMaterialWan} 万条，环比 {acqDouyinGrowth}"},
    {"op": "replaceText", "slide": slide, "shapeId": ids["acq_wechat_stat_1"],
     "value": "信息流素材             {wechatInfoWan} 万条        {acqWechatInfoGrowth}"},
    {"op": "replaceText", "slide": slide, "shapeId": ids["acq_wechat_stat_2"],
     "value": "在投游戏数             {wechatGames} 款       {acqWechatGamesGrowth}"},
    {"op": "replaceText", "slide": slide, "shapeId": ids["acq_douyin_stat_1"],
     "value": "抖音信息流素材         {douyinInfoWan} 万条       {acqDouyinInfoGrowth}"},
    {"op": "replaceText", "slide": slide, "shapeId": ids["acq_douyin_stat_2"],
     "value": "抖音达人素材           {douyinTalentWan} 万条       {acqDouyinTalentGrowth}"},
    {"op": "replaceText", "slide": slide, "shapeId": ids["acq_douyin_stat_3"],
     "value": "抖音在投游戏数         {douyinGames} 款       {acqDouyinGamesGrowth}"},
    {"op": "replaceFragment", "slide": slide, "shapeId": ids["acq_wechat_chart_title"],
     "find": r"\d{1,2}—\d{1,2}月", "value": "{twoMonthsAgoNumber}—{monthNumber}月"},
    {"op": "replaceFragment", "slide": slide, "shapeId": ids["acq_douyin_chart_title"],
     "find": r"\d{1,2}—\d{1,2}月", "value": "{twoMonthsAgoNumber}—{monthNumber}月"},
    {"op": "nativeChart", "slide": slide, "pictureId": ids["acq_wechat_chart"],
     "source": "minigame.adsWechat", "name": "微信素材与在投游戏数"},
    {"op": "nativeChart", "slide": slide, "pictureId": ids["acq_douyin_chart"],
     "source": "minigame.adsDouyin", "name": "抖音素材与在投游戏数"},
])
for name in ("acq_wechat_reason_title_1", "acq_wechat_reason_1", "acq_wechat_reason_title_2",
             "acq_wechat_reason_2", "acq_douyin_reason_title", "acq_douyin_reason"):
    ops.append({"op": "sourceMonthText", "slide": slide, "shapeId": ids[name],
                "sample": "示例：填写本月事实与依据"})
mapping["ops"] = ops
output.write_text(json.dumps(mapping, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(json.dumps({"sha256": mapping["seedSha256"], "ops": len(ops), "slide2": sum(op.get("slide") == 2 for op in ops)}))
