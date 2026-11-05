"""Native PowerPoint charts built from data, each with an embedded workbook for "Edit Data".

Pure Python (the server image has python3 without packages). The chart XML keeps
the element order the DrawingML chart schema requires; PowerPoint rejects files
that do not.
"""

import io
import zipfile
from html import escape
from xml.etree import ElementTree

from chart_images import Svg, ads_trend, nice_axis, number

C = "http://schemas.openxmlformats.org/drawingml/2006/chart"
A = "http://schemas.openxmlformats.org/drawingml/2006/main"
R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
C15 = "http://schemas.microsoft.com/office/drawing/2012/chart"
SHEET = "Sheet1"
GRID, AXIS_TEXT, NAVY = "D9D9D9", "404040", "1F4E79"
DOUYIN, DOUYIN_LIGHT, WECHAT, WECHAT_LIGHT = "FF2222", "E6A3AB", "0B9A46", "93D39F"
DOUYIN_LINE, WECHAT_LINE = "E60012", "1A8A3C"


def x(value):
    return escape(str(value), quote=True)


def column(index):
    name = ""
    index += 1
    while index:
        index, rest = divmod(index - 1, 26)
        name = chr(65 + rest) + name
    return name


def ref(col, first, last=None):
    return f"{SHEET}!${column(col)}${first}" + (f":${column(col)}${last}" if last else "")


# --- embedded workbook -------------------------------------------------------

def workbook(rows):
    """A minimal .xlsx: one sheet, strings inline, numbers as values, None as empty."""
    body = []
    for r, row in enumerate(rows, 1):
        cells = []
        for c, value in enumerate(row):
            if value is None or value == "":
                continue
            where = f"{column(c)}{r}"
            if isinstance(value, (int, float)) and not isinstance(value, bool):
                cells.append(f'<c r="{where}"><v>{value}</v></c>')
            else:
                cells.append(f'<c r="{where}" t="inlineStr"><is><t>{x(value)}</t></is></c>')
        body.append(f'<row r="{r}">{"".join(cells)}</row>')
    main = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
    parts = {
        "[Content_Types].xml": '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
            '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
            '<Default Extension="xml" ContentType="application/xml"/>'
            '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
            '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
            '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
            '</Types>',
        "_rels/.rels": '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
            '</Relationships>',
        "xl/workbook.xml": f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="{main}" xmlns:r="{R}">'
            f'<sheets><sheet name="{SHEET}" sheetId="1" r:id="rId1"/></sheets></workbook>',
        "xl/_rels/workbook.xml.rels": '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'
            '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
            '</Relationships>',
        "xl/styles.xml": f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="{main}">'
            '<fonts count="1"><font><sz val="11"/><name val="等线"/></font></fonts>'
            '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>'
            '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
            '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
            '<cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>'
            '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>',
        "xl/worksheets/sheet1.xml": f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="{main}">'
            f'<sheetData>{"".join(body)}</sheetData></worksheet>',
    }
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        for name, text in parts.items():
            # Fixed timestamp: the same data always gives the same file.
            archive.writestr(zipfile.ZipInfo(name, (1980, 1, 1, 0, 0, 0)), text, zipfile.ZIP_DEFLATED)
    return buffer.getvalue()


# --- chart XML pieces ----------------------------------------------------------

def run_props(size, color=AXIS_TEXT, bold=False, tag="defRPr"):
    return (f'<a:{tag} sz="{size}" b="{1 if bold else 0}"><a:solidFill><a:srgbClr val="{color}"/></a:solidFill>'
            f'<a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/></a:{tag}>')


def text_props(size, color=AXIS_TEXT, bold=False, rotate=None):
    body = f'<a:bodyPr rot="{rotate}" vert="horz"/>' if rotate is not None else "<a:bodyPr/>"
    return f'<c:txPr>{body}<a:lstStyle/><a:p><a:pPr>{run_props(size, color, bold)}</a:pPr><a:endParaRPr lang="zh-CN"/></a:p></c:txPr>'


def rich(paragraphs, rotate=None):
    """paragraphs: [(text, size, color, bold)]"""
    body = f'<a:bodyPr rot="{rotate}" vert="horz"/>' if rotate is not None else "<a:bodyPr/>"
    content = "".join(f'<a:p><a:pPr>{run_props(size, color, bold)}</a:pPr><a:r>{run_props(size, color, bold, "rPr")}'
                      f'<a:t>{x(text)}</a:t></a:r></a:p>' for text, size, color, bold in paragraphs)
    return f'<c:tx><c:rich>{body}<a:lstStyle/>{content}</c:rich></c:tx>'


def fill(color):
    return f'<c:spPr><a:solidFill><a:srgbClr val="{color}"/></a:solidFill></c:spPr>'


def no_line():
    return '<c:spPr><a:ln><a:noFill/></a:ln></c:spPr>'


def string_ref(col, first, values):
    points = "".join(f'<c:pt idx="{i}"><c:v>{x(v)}</c:v></c:pt>' for i, v in enumerate(values) if v not in (None, ""))
    return (f'<c:strRef><c:f>{ref(col, first, first + len(values) - 1 if len(values) > 1 else None)}</c:f>'
            f'<c:strCache><c:ptCount val="{len(values)}"/>{points}</c:strCache></c:strRef>')


def number_ref(col, first, values, code="General"):
    points = "".join(f'<c:pt idx="{i}"><c:v>{v}</c:v></c:pt>' for i, v in enumerate(values) if v is not None)
    return (f'<c:numRef><c:f>{ref(col, first, first + len(values) - 1)}</c:f><c:numCache><c:formatCode>{x(code)}</c:formatCode>'
            f'<c:ptCount val="{len(values)}"/>{points}</c:numCache></c:numRef>')


def series_name(col, name):
    return f'<c:tx><c:strRef><c:f>{ref(col, 1)}</c:f><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>{x(name)}</c:v></c:pt></c:strCache></c:strRef></c:tx>'


def labels(size, color, bold, position=None, code=None, per_point="", show=True):
    flags = (f'<c:showLegendKey val="0"/><c:showVal val="{1 if show else 0}"/><c:showCatName val="0"/>'
             '<c:showSerName val="0"/><c:showPercent val="0"/><c:showBubbleSize val="0"/>')
    fmt = f'<c:numFmt formatCode="{x(code)}" sourceLinked="0"/>' if code else ""
    pos = f'<c:dLblPos val="{position}"/>' if position else ""
    return f'<c:dLbls>{per_point}{fmt}<c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr>{text_props(size, color, bold)}{pos}{flags}</c:dLbls>'


def point_label(index, size=None, color=None, bold=True, position=None, delete=False, code=None):
    if delete:
        return f'<c:dLbl><c:idx val="{index}"/><c:delete val="1"/></c:dLbl>'
    pos = f'<c:dLblPos val="{position}"/>' if position else ""
    # A point label does not inherit the series number format, so it carries its own.
    fmt = f'<c:numFmt formatCode="{x(code)}" sourceLinked="0"/>' if code else ""
    return (f'<c:dLbl><c:idx val="{index}"/>{fmt}<c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr>{text_props(size, color, bold)}{pos}'
            '<c:showLegendKey val="0"/><c:showVal val="1"/><c:showCatName val="0"/><c:showSerName val="0"/>'
            '<c:showPercent val="0"/><c:showBubbleSize val="0"/></c:dLbl>')


def axis_title(text, rotate):
    return f'<c:title>{rich([(text, 900, AXIS_TEXT, False)], rotate)}<c:overlay val="0"/></c:title>'


def chart_space(chart):
    return (f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            f'<c:chartSpace xmlns:c="{C}" xmlns:a="{A}" xmlns:r="{R}"><c:date1904 val="0"/><c:lang val="zh-CN"/>'
            f'<c:roundedCorners val="0"/>{chart}<c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr>'
            f'{text_props(900)}<c:externalData r:id="rId1"><c:autoUpdate val="0"/></c:externalData></c:chartSpace>')


# --- page 2: material volume and advertising games ----------------------------

def ads_trend_chart(months):
    """months: [{"label", "douyin": (info, talent, total) or None, "wechat": ..., "douyinGames", "wechatGames"}].

    Each month is a category group of two stacked bars (Douyin, WeChat), so the
    categories have two levels. Games counts are lines on the right axis drawn at
    their own platform's bar; blanks are spanned.
    """
    platforms = [("douyin", "抖音"), ("wechat", "微信")]
    rows = [[item["label"] if position == 0 else None, label] for item in months for position, (_, label) in enumerate(platforms)]
    def take(name, part):
        return [item[key][part] if key == name and item[key] else None for item in months for key, _ in platforms]
    columns = {"抖音信息流广告": take("douyin", 0), "抖音达人广告": take("douyin", 1),
               "微信信息流广告": take("wechat", 0), "微信达人广告": take("wechat", 1),
               "合计": [item[key][2] if item[key] else None for item in months for key, _ in platforms],
               "抖音游戏数": [item["douyinGames"] if key == "douyin" else None for item in months for key, _ in platforms],
               "微信游戏数": [item["wechatGames"] if key == "wechat" else None for item in months for key, _ in platforms]}
    names = list(columns)
    sheet = [["月份", "平台", *names]] + [rows[i] + [columns[name][i] for name in names] for i in range(len(rows))]
    count, last = len(rows), len(rows) + 1
    totals = [value for value in columns["合计"] if value is not None]
    games = [value for name in ("抖音游戏数", "微信游戏数") for value in columns[name] if value is not None]
    left_top, left_step = nice_axis(max(totals, default=0), 9, 1.08)
    right_top, right_step = nice_axis(max(games, default=0), 7, 1.2)

    outer = "".join(f'<c:pt idx="{i}"><c:v>{x(row[0])}</c:v></c:pt>' for i, row in enumerate(rows) if row[0])
    inner = "".join(f'<c:pt idx="{i}"><c:v>{x(row[1])}</c:v></c:pt>' for i, row in enumerate(rows))
    categories = (f'<c:cat><c:multiLvlStrRef><c:f>{SHEET}!$A$2:$B${last}</c:f><c:multiLvlStrCache><c:ptCount val="{count}"/>'
                  f'<c:lvl>{inner}</c:lvl><c:lvl>{outer}</c:lvl></c:multiLvlStrCache></c:multiLvlStrRef></c:cat>')

    def line_heights(i):
        """Heights (0-1 of the plot) where the games lines pass category i."""
        found = []
        for name in ("抖音游戏数", "微信游戏数"):
            values = columns[name]
            if values[i] is not None:
                found.append(values[i] / right_top)
                continue
            before = next((values[j] for j in range(i - 1, -1, -1) if values[j] is not None), None)
            after = next((values[j] for j in range(i + 1, len(values)) if values[j] is not None), None)
            if before is not None and after is not None:
                found.append((before + after) / 2 / right_top)
        return found

    def bar_series(index, color, label_color, bold, minimum):
        name = names[index]
        values = columns[name]
        base_column = names[index - 1] if index % 2 else None
        per_point = ""
        for i, value in enumerate(values):
            if value is None:
                continue
            if value < minimum:
                per_point += point_label(i, delete=True)
                continue
            low = (columns[base_column][i] or 0) / left_top if base_column else 0
            high = low + value / left_top
            spots = {"ctr": (low + high) / 2, "inEnd": high - 0.035, "inBase": low + 0.035}
            free = [where for where, height in spots.items() if all(abs(height - line) > 0.045 for line in line_heights(i))]
            if free and free[0] != "ctr":
                per_point += point_label(i, 800, label_color, bold, free[0], code="0.0")
        hidden = per_point
        return (f'<c:ser><c:idx val="{index}"/><c:order val="{index}"/>{series_name(index + 2, name)}{fill(color)}'
                f'<c:invertIfNegative val="0"/>{labels(800, label_color, bold, "ctr", "0.0", hidden)}{categories}'
                f'<c:val>{number_ref(index + 2, 2, values, "0.0")}</c:val></c:ser>')

    small = left_top * 0.045  # segments too thin for a readable label
    bars = "".join(bar_series(i, color, text, bold, small) for i, (color, text, bold) in enumerate(
        [(DOUYIN, "FFFFFF", True), (DOUYIN_LIGHT, "333333", False), (WECHAT, "FFFFFF", True), (WECHAT_LIGHT, "333333", False)]))
    total_points = "".join(point_label(i, 900, DOUYIN if i % 2 == 0 else WECHAT, True, "t", code="0.0")
                           for i, value in enumerate(columns["合计"]) if value is not None)
    total = (f'<c:ser><c:idx val="4"/><c:order val="4"/>{series_name(6, "合计")}<c:spPr><a:ln><a:noFill/></a:ln></c:spPr>'
             f'<c:marker><c:symbol val="none"/></c:marker>{labels(900, DOUYIN, True, "t", "0.0", total_points)}{categories}'
             f'<c:val>{number_ref(6, 2, columns["合计"], "0.0")}</c:val><c:smooth val="0"/></c:ser>')

    def games_series(index, name, color, symbol, dash):
        values, own = columns[name], 2 if name == "抖音游戏数" else 1
        per_point = ""
        for i, value in enumerate(values):
            if value is None:
                continue
            point, stack = value / right_top, (columns["合计"][i] or 0) / left_top
            # Put the label under the point when it would sit on the bar total's label.
            clash = stack - 0.02 <= point + 0.085 and point <= stack + 0.10
            per_point += point_label(i, 900, color, True, "b" if clash else "t", code="#,##0")
        line = f'<a:ln w="28575" cap="rnd"><a:solidFill><a:srgbClr val="{color}"/></a:solidFill>' + \
               (f'<a:prstDash val="{dash}"/>' if dash else "") + '<a:round/></a:ln>'
        return (f'<c:ser><c:idx val="{index}"/><c:order val="{index}"/>{series_name(index + 2, name)}<c:spPr>{line}</c:spPr>'
                f'<c:marker><c:symbol val="{symbol}"/><c:size val="6"/>{fill(color)}</c:marker>'
                f'{labels(900, color, True, "t", "#,##0", per_point)}{categories}'
                f'<c:val>{number_ref(index + 2, 2, values, "#,##0")}</c:val><c:smooth val="0"/></c:ser>')

    lines = games_series(5, "抖音游戏数", DOUYIN_LINE, "circle", None) + games_series(6, "微信游戏数", WECHAT_LINE, "square", "dash")
    gridline = f'<c:majorGridlines><c:spPr><a:ln w="6350"><a:solidFill><a:srgbClr val="{GRID}"/></a:solidFill><a:prstDash val="dash"/></a:ln></c:spPr></c:majorGridlines>'
    axis_line = '<c:spPr><a:ln w="9525"><a:solidFill><a:srgbClr val="333333"/></a:solidFill></a:ln></c:spPr>'
    plot = (f'<c:plotArea><c:layout/>'
            f'<c:barChart><c:barDir val="col"/><c:grouping val="stacked"/><c:varyColors val="0"/>{bars}'
            f'<c:gapWidth val="45"/><c:overlap val="100"/><c:axId val="1001"/><c:axId val="1002"/></c:barChart>'
            f'<c:lineChart><c:grouping val="standard"/><c:varyColors val="0"/>{total}<c:marker val="1"/>'
            f'<c:axId val="1001"/><c:axId val="1002"/></c:lineChart>'
            f'<c:lineChart><c:grouping val="standard"/><c:varyColors val="0"/>{lines}<c:marker val="1"/>'
            f'<c:axId val="1003"/><c:axId val="1004"/></c:lineChart>'
            f'<c:catAx><c:axId val="1001"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/>'
            f'<c:axPos val="b"/><c:numFmt formatCode="General" sourceLinked="1"/><c:majorTickMark val="none"/>'
            f'<c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/>{axis_line}{text_props(900)}<c:crossAx val="1002"/>'
            f'<c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/><c:noMultiLvlLbl val="0"/></c:catAx>'
            f'<c:valAx><c:axId val="1002"/><c:scaling><c:orientation val="minMax"/><c:max val="{left_top:g}"/><c:min val="0"/></c:scaling>'
            f'<c:delete val="0"/><c:axPos val="l"/>{gridline}{axis_title("素材数（万条）", -5400000)}'
            f'<c:numFmt formatCode="General" sourceLinked="0"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/>'
            f'<c:tickLblPos val="nextTo"/>{axis_line}{text_props(900)}<c:crossAx val="1001"/><c:crosses val="autoZero"/>'
            f'<c:crossBetween val="between"/><c:majorUnit val="{left_step:g}"/></c:valAx>'
            f'<c:catAx><c:axId val="1003"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="1"/>'
            f'<c:axPos val="b"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/>'
            f'<c:crossAx val="1004"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/>'
            f'<c:noMultiLvlLbl val="0"/></c:catAx>'
            f'<c:valAx><c:axId val="1004"/><c:scaling><c:orientation val="minMax"/><c:max val="{right_top:g}"/><c:min val="0"/></c:scaling>'
            f'<c:delete val="0"/><c:axPos val="r"/>{axis_title("在投游戏数（款）", 5400000)}'
            f'<c:numFmt formatCode="#,##0" sourceLinked="0"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/>'
            f'<c:tickLblPos val="nextTo"/>{axis_line}{text_props(900)}<c:crossAx val="1003"/><c:crosses val="max"/>'
            f'<c:crossBetween val="between"/><c:majorUnit val="{right_step:g}"/></c:valAx>'
            f'<c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr></c:plotArea>')
    legend = (f'<c:legend><c:legendPos val="t"/><c:legendEntry><c:idx val="4"/><c:delete val="1"/></c:legendEntry>'
              f'<c:overlay val="0"/>{text_props(900)}</c:legend>')
    chart = f'<c:chart><c:autoTitleDeleted val="1"/>{plot}{legend}<c:plotVisOnly val="1"/><c:dispBlanksAs val="span"/></c:chart>'
    return chart_space(chart), workbook(sheet)


def ads_platform_chart(months, platform):
    """Compact editable chart for one acquisition platform on slide 2."""
    if platform not in ("wechat", "douyin"):
        raise ValueError("Unknown acquisition platform")
    month_labels = [item["label"] for item in months]
    splits = [item[platform] for item in months]
    info = [parts[0] if parts else None for parts in splits]
    talent = [parts[1] if parts else None for parts in splits]
    total = [parts[2] if parts else None for parts in splits]
    games = [item[platform + "Games"] for item in months]
    is_douyin = platform == "douyin"
    colors = ("002B58", "8FAECD", "2464E9") if is_douyin else ("218357", "218357", "218357")
    columns = [info, talent, games] if is_douyin else [total, games]
    names = ["信息流广告", "达人广告", "在投游戏数"] if is_douyin else ["信息流广告", "在投游戏数"]
    sheet = [["月份", *names]] + [[month_labels[i], *(column[i] for column in columns)] for i in range(len(month_labels))]
    left_top, left_step = nice_axis(max((value for value in total if value is not None), default=0), 5, 1.15)
    right_top, right_step = nice_axis(max((value for value in games if value is not None), default=0), 4, 1.15)
    cats = f'<c:cat>{string_ref(0, 2, month_labels)}</c:cat>'

    def bar(index, color, values, label_color):
        return (f'<c:ser><c:idx val="{index}"/><c:order val="{index}"/>{series_name(index + 1, names[index])}'
                f'{fill(color)}<c:invertIfNegative val="0"/>{labels_xml(label_color)}{cats}'
                f'<c:val>{number_ref(index + 1, 2, values, "0.0")}</c:val></c:ser>')

    def labels_xml(color):
        return labels(850, color, True, "ctr", "0.0")

    bars = bar(0, colors[0], columns[0], "FFFFFF")
    if is_douyin:
        bars += bar(1, colors[1], columns[1], "002B58")
    line_index = 2 if is_douyin else 1
    line = (f'<c:ser><c:idx val="{line_index}"/><c:order val="{line_index}"/>'
            f'{series_name(line_index + 1, names[line_index])}'
            f'<c:spPr><a:ln w="25400"><a:solidFill><a:srgbClr val="{colors[2]}"/></a:solidFill>'
            f'{"<a:prstDash val=\"dash\"/>" if not is_douyin else ""}</a:ln></c:spPr>'
            f'<c:marker><c:symbol val="square"/><c:size val="5"/>{fill(colors[2])}</c:marker>'
            f'{labels(850, colors[2], True, "t", "#,##0")}{cats}'
            f'<c:val>{number_ref(line_index + 1, 2, games, "#,##0")}</c:val><c:smooth val="0"/></c:ser>')
    grid = ('<c:majorGridlines><c:spPr><a:ln w="6350"><a:solidFill><a:srgbClr val="D9D9D9"/>'
            '</a:solidFill></a:ln></c:spPr></c:majorGridlines>')
    cat_axis = lambda ax, cross, hidden: (f'<c:catAx><c:axId val="{ax}"/><c:scaling><c:orientation val="minMax"/></c:scaling>'
        f'<c:delete val="{int(hidden)}"/><c:axPos val="b"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/>'
        f'<c:tickLblPos val="nextTo"/>{text_props(850)}<c:crossAx val="{cross}"/><c:crosses val="autoZero"/>'
        '<c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/></c:catAx>')
    val_axis = lambda ax, cross, top, step, right: (f'<c:valAx><c:axId val="{ax}"/><c:scaling><c:orientation val="minMax"/>'
        f'<c:max val="{top:g}"/><c:min val="0"/></c:scaling><c:delete val="0"/><c:axPos val="{"r" if right else "l"}"/>'
        f'{"" if right else grid}<c:numFmt formatCode="#,##0" sourceLinked="0"/><c:majorTickMark val="none"/>'
        f'<c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/>{text_props(800)}<c:crossAx val="{cross}"/>'
        f'<c:crosses val="{"max" if right else "autoZero"}"/><c:crossBetween val="between"/>'
        f'<c:majorUnit val="{step:g}"/></c:valAx>')
    plot = ('<c:plotArea><c:layout/>'
            f'<c:barChart><c:barDir val="col"/><c:grouping val="{"stacked" if is_douyin else "clustered"}"/>'
            f'<c:varyColors val="0"/>{bars}<c:gapWidth val="165"/><c:overlap val="100"/>'
            '<c:axId val="4101"/><c:axId val="4102"/></c:barChart>'
            f'<c:lineChart><c:grouping val="standard"/><c:varyColors val="0"/>{line}<c:marker val="1"/>'
            '<c:axId val="4103"/><c:axId val="4104"/></c:lineChart>'
            + cat_axis(4101, 4102, False) + val_axis(4102, 4101, left_top, left_step, False)
            + cat_axis(4103, 4104, True) + val_axis(4104, 4103, right_top, right_step, True)
            + '</c:plotArea>')
    legend = f'<c:legend><c:legendPos val="b"/><c:overlay val="0"/>{text_props(800)}</c:legend>'
    return chart_space(f'<c:chart><c:autoTitleDeleted val="1"/>{plot}{legend}<c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart>'), workbook(sheet)


def new_game_daily_chart(days, ranks, materials):
    """Editable dual-axis lines: lower rank is better; material is a daily snapshot count."""
    count = len(days)
    sheet = [["日期", "排名", "素材数"]] + [[day, rank, material] for day, rank, material in zip(days, ranks, materials)]
    categories = f'<c:cat>{string_ref(0, 2, days)}</c:cat>'
    rank_values = [value for value in ranks if value is not None]
    material_values = [value for value in materials if value is not None]
    rank_min = max(1, min(rank_values, default=1) - 10)
    rank_max = max(rank_min + 20, max(rank_values, default=100) + 10)
    material_max, material_step = nice_axis(max(material_values, default=0), 4, 1.15)

    def line(index, label, color, axis_cat, axis_val, values):
        style = (f'<c:spPr><a:ln w="19050"><a:solidFill><a:srgbClr val="{color}"/>'
                 '</a:solidFill></a:ln></c:spPr>')
        return (f'<c:lineChart><c:grouping val="standard"/><c:varyColors val="0"/>'
                f'<c:ser><c:idx val="{index}"/><c:order val="{index}"/>{series_name(index + 1, label)}'
                f'{style}<c:marker><c:symbol val="circle"/><c:size val="3"/>{fill(color)}</c:marker>'
                f'{categories}<c:val>{number_ref(index + 1, 2, values, "#,##0")}</c:val>'
                '<c:smooth val="0"/></c:ser><c:marker val="1"/>'
                f'<c:axId val="{axis_cat}"/><c:axId val="{axis_val}"/></c:lineChart>')

    def category_axis(axis_id, cross_id, hidden=False):
        return (f'<c:catAx><c:axId val="{axis_id}"/><c:scaling><c:orientation val="minMax"/></c:scaling>'
                f'<c:delete val="{1 if hidden else 0}"/><c:axPos val="b"/><c:numFmt formatCode="dd" sourceLinked="0"/>'
                '<c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/>'
                f'{text_props(550)}<c:crossAx val="{cross_id}"/><c:crosses val="max"/><c:auto val="1"/>'
                '<c:lblAlgn val="ctr"/><c:lblOffset val="100"/><c:tickLblSkip val="5"/></c:catAx>')

    def value_axis(axis_id, cross_id, top, step, reverse, right, minimum=0):
        return (f'<c:valAx><c:axId val="{axis_id}"/><c:scaling><c:orientation val="{"maxMin" if reverse else "minMax"}"/>'
                f'<c:max val="{top:g}"/><c:min val="{minimum:g}"/></c:scaling><c:delete val="0"/>'
                f'<c:axPos val="{"r" if right else "l"}"/><c:numFmt formatCode="#,##0" sourceLinked="0"/>'
                '<c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/>'
                f'{text_props(550)}<c:crossAx val="{cross_id}"/><c:crosses val="{"max" if right else "min"}"/>'
                f'<c:crossBetween val="between"/><c:majorUnit val="{step:g}"/></c:valAx>')

    layout = ('<c:layout><c:manualLayout><c:layoutTarget val="inner"/><c:xMode val="edge"/>'
              '<c:yMode val="edge"/><c:wMode val="factor"/><c:hMode val="factor"/>'
              '<c:x val="0.09"/><c:y val="0.18"/><c:w val="0.81"/><c:h val="0.62"/></c:manualLayout></c:layout>')
    plot = ('<c:plotArea>' + layout
            + line(0, "排名", "D6A03D", 3001, 3002, ranks)
            + line(1, "素材数", "002B58", 3003, 3004, materials)
            + category_axis(3001, 3002)
            + value_axis(3002, 3001, rank_max, 10, True, False, rank_min)
            + category_axis(3003, 3004, True)
            + value_axis(3004, 3003, material_max, material_step, False, True)
            + '</c:plotArea>')
    legend = f'<c:legend><c:legendPos val="t"/><c:overlay val="0"/>{text_props(600)}</c:legend>'
    chart = f'<c:chart><c:autoTitleDeleted val="1"/>{plot}{legend}<c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart>'
    return chart_space(chart), workbook(sheet)


# --- page 5: top genres -------------------------------------------------------

def category_chart(rows, title, note):
    """rows: [(genre, count, label)] in display order (largest first)."""
    count, last = len(rows), len(rows) + 1
    sheet = [["品类", "数量", "标签"]] + [list(row) for row in rows]
    # Headroom so the longest bar's "11 (+3)" label stays inside the plot.
    top, step = nice_axis(max((row[1] for row in rows), default=0), 8, 1.25)
    cache = "".join(f'<c:pt idx="{i}"><c:v>{x(row[2])}</c:v></c:pt>' for i, row in enumerate(rows))
    flags = ('<c:showLegendKey val="0"/><c:showVal val="0"/><c:showCatName val="0"/><c:showSerName val="0"/>'
             '<c:showPercent val="0"/><c:showBubbleSize val="0"/>')
    from_cells = (f'<c:extLst><c:ext uri="{{CE6537A1-D6FC-4f65-9D91-7224C49458BB}}" xmlns:c15="{C15}">'
                  '<c15:dlblFieldTable/><c15:xForSave val="1"/><c15:showDataLabelsRange val="1"/></c:ext></c:extLst>')
    # PowerPoint shows "value from cells" only through a CELLRANGE field in each label,
    # the form it writes itself; the text comes from the label column of the workbook.
    per_point = "".join(
        f'<c:dLbl><c:idx val="{i}"/><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p>'
        f'<a:fld id="{{6F1C3B2A-0000-4000-8000-{i:012d}}}" type="CELLRANGE">{run_props(1000, NAVY, True, "rPr")}<a:pPr/>'
        f'<a:t>[CELLRANGE]</a:t></a:fld><a:endParaRPr lang="zh-CN"/></a:p></c:rich></c:tx>'
        f'<c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr><c:dLblPos val="outEnd"/>{flags}{from_cells}</c:dLbl>'
        for i in range(count))
    group_flags = (f'<c:extLst><c:ext uri="{{CE6537A1-D6FC-4f65-9D91-7224C49458BB}}" xmlns:c15="{C15}">'
                   '<c15:showDataLabelsRange val="1"/><c15:showLeaderLines val="0"/></c:ext></c:extLst>')
    label_block = (f'<c:dLbls>{per_point}<c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr>{text_props(1000, NAVY, True)}'
                   f'<c:dLblPos val="outEnd"/>{flags}<c:showLeaderLines val="0"/>{group_flags}</c:dLbls>')
    # PowerPoint reads the label range from the second extension; it writes both, so do we.
    label_range = "".join(
        f'<c:ext uri="{uri}" xmlns:c15="{C15}"><c15:datalabelsRange><c15:f>{SHEET}!$C$2:$C${last}</c15:f>'
        f'<c15:dlblRangeCache><c:ptCount val="{count}"/>{cache}</c15:dlblRangeCache></c15:datalabelsRange></c:ext>'
        for uri in ("{02D57815-91ED-43cb-85C5-34E9C95B4C1F}", "{02D57815-91ED-43cb-92C2-25804820EDAC}"))
    series = (f'<c:ser><c:idx val="0"/><c:order val="0"/>{series_name(1, "数量")}{fill(NAVY)}<c:invertIfNegative val="0"/>'
              f'{label_block}<c:cat>{string_ref(0, 2, [row[0] for row in rows])}</c:cat>'
              f'<c:val>{number_ref(1, 2, [row[1] for row in rows])}</c:val>'
              f'<c:extLst>{label_range}</c:extLst></c:ser>')
    gridline = f'<c:majorGridlines><c:spPr><a:ln w="6350"><a:solidFill><a:srgbClr val="E4E8F0"/></a:solidFill></a:ln></c:spPr></c:majorGridlines>'
    plot = (f'<c:plotArea><c:layout/><c:barChart><c:barDir val="bar"/><c:grouping val="clustered"/><c:varyColors val="0"/>'
            f'{series}<c:gapWidth val="55"/><c:axId val="2001"/><c:axId val="2002"/></c:barChart>'
            f'<c:catAx><c:axId val="2001"/><c:scaling><c:orientation val="maxMin"/></c:scaling><c:delete val="0"/>'
            f'<c:axPos val="l"/><c:numFmt formatCode="General" sourceLinked="1"/><c:majorTickMark val="none"/>'
            f'<c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:spPr><a:ln><a:noFill/></a:ln></c:spPr>'
            f'{text_props(1000, "222222")}<c:crossAx val="2002"/><c:crosses val="autoZero"/><c:auto val="1"/>'
            f'<c:lblAlgn val="ctr"/><c:lblOffset val="100"/><c:noMultiLvlLbl val="0"/></c:catAx>'
            f'<c:valAx><c:axId val="2002"/><c:scaling><c:orientation val="minMax"/><c:max val="{top:g}"/><c:min val="0"/></c:scaling>'
            f'<c:delete val="0"/><c:axPos val="b"/>{gridline}<c:numFmt formatCode="General" sourceLinked="0"/>'
            f'<c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/>'
            f'<c:spPr><a:ln w="9525"><a:solidFill><a:srgbClr val="333333"/></a:solidFill></a:ln></c:spPr>{text_props(900)}'
            f'<c:crossAx val="2001"/><c:crosses val="max"/><c:crossBetween val="between"/><c:majorUnit val="{step:g}"/></c:valAx>'
            f'<c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr></c:plotArea>')
    heading = f'<c:title>{rich([(title, 1600, NAVY, True), (note, 800, "7F7F7F", False)])}<c:overlay val="0"/></c:title>'
    chart = f'<c:chart>{heading}<c:autoTitleDeleted val="0"/>{plot}<c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart>'
    return chart_space(chart), workbook(sheet)


# --- web preview of the same charts ------------------------------------------

def _points(node, tag):
    return {int(point.get("idx")): point.findtext(f"{{{C}}}v") for point in node.iter(f"{{{C}}}pt")} if node is not None else {}


def preview_svg(chart_xml, width, height):
    """Draw the web-view picture of a chart this module built, from its caches."""
    root = ElementTree.fromstring(chart_xml)
    series = {}
    for item in root.iter(f"{{{C}}}ser"):
        name = "".join(node.text or "" for node in item.find(f"{{{C}}}tx").iter(f"{{{C}}}v"))
        series[name] = {index: float(value) for index, value in _points(item.find(f"{{{C}}}val"), "pt").items()}
        series[name + ":cat"] = item.find(f"{{{C}}}cat")
        labels_range = item.find(f".//{{{C15}}}dlblRangeCache")
        if labels_range is not None:
            series[name + ":labels"] = _points(labels_range, "pt")
    if root.find(f".//{{{C}}}barDir").get("val") == "bar":
        categories = _points(series["数量:cat"], "pt")
        rows = [(categories[i], series["数量"].get(i, 0), series.get("数量:labels", {}).get(i, "")) for i in sorted(categories)]
        title = [node.text or "" for node in root.find(f"{{{C}}}chart/{{{C}}}title").iter(f"{{{A}}}t")]
        return category_svg(rows, title[0] if title else "", title[1] if len(title) > 1 else "", width, height)
    levels = series["合计:cat"].findall(f".//{{{C}}}lvl")
    months = {i: value for i, value in _points(levels[1], "pt").items()}
    entries = []
    for i in sorted(months):
        entry = {"label": months[i]}
        for name, key, at in (("抖音", "douyin", i), ("微信", "wechat", i + 1)):
            info, talent = series[f"{name}信息流广告"].get(at), series[f"{name}达人广告"].get(at)
            total = series["合计"].get(at)
            entry[key] = (info, talent, total) if None not in (info, talent, total) else None
            entry[key + "Games"] = series[f"{name}游戏数"].get(at)
            if entry[key + "Games"] is not None:
                entry[key + "Games"] = int(entry[key + "Games"])
        entries.append(entry)
    return ads_trend(entries, width, height)[0]


def category_svg(rows, title, note, width, height):
    canvas = Svg(width, height)
    canvas.rect(0, 0, width, height, "#FFFFFF")
    canvas.text(width / 2, 0.075 * height, title, 18, "#" + NAVY, bold=True)
    canvas.text(width / 2, 0.125 * height, note, 9, "#7F7F7F")
    left, right, top, bottom = 0.17 * width, 0.88 * width, 0.17 * height, 0.92 * height
    maximum, step = nice_axis(max((row[1] for row in rows), default=0), 8, 1.25)  # same axis as the chart
    tick = 0
    while tick <= maximum + 1e-9:
        x_pos = left + (right - left) * tick / maximum
        canvas.line([(x_pos, top), (x_pos, bottom)], "#E4E8F0", 0.8)
        canvas.text(x_pos, bottom + 15, f"{tick:g}", 10)
        tick += step
    band = (bottom - top) / max(len(rows), 1)
    for index, (name, value, label) in enumerate(rows):
        y = top + index * band
        length = (right - left) * value / maximum
        canvas.rect(left, y + band * 0.18, length, band * 0.64, "#" + NAVY)
        canvas.text(left - 6, y + band / 2 + 4, name, 11, "#222222", anchor="end")
        canvas.text(left + length + 6, y + band / 2 + 4, label or number(value, 0), 11, "#" + NAVY, anchor="start", bold=True)
    return canvas.svg()
