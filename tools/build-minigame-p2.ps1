param(
  [Parameter(Mandatory=$true)][string]$Source,
  [Parameter(Mandatory=$true)][string]$Output,
  [Parameter(Mandatory=$true)][string]$IdsOutput
)

$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Drawing
$asset=Join-Path (Split-Path $Output) 'mini-chart-placeholder.png'
$bitmap=[System.Drawing.Bitmap]::new(16,16)
$graphics=[System.Drawing.Graphics]::FromImage($bitmap)
$graphics.Clear([System.Drawing.Color]::White)
$graphics.Dispose();$bitmap.Save($asset,[System.Drawing.Imaging.ImageFormat]::Png);$bitmap.Dispose()
function Rgb([int]$r,[int]$g,[int]$b){return $r+256*$g+65536*$b}
$navy=Rgb 0 43 88;$ink=Rgb 17 25 40;$muted=Rgb 91 101 117;$gold=Rgb 205 158 70
$green=Rgb 29 126 82;$blue=Rgb 30 91 205;$red=Rgb 182 99 85;$border=Rgb 199 218 238
$ppt=New-Object -ComObject PowerPoint.Application
$deck=$ppt.Presentations.Open((Resolve-Path $Source).Path,$false,$false,$false)
$slide=$deck.Slides.Item(2)
foreach($shape in @($slide.Shapes)){if($shape.Id -notin @(10,11,12,13,14,22)){$shape.Delete()}}
$ids=@{}
function AddBox([string]$name,[double]$x,[double]$y,[double]$w,[double]$h,[int]$fill,[int]$line=0,[double]$radius=0){
  $type=if($radius -gt 0){5}else{1}
  $s=$slide.Shapes.AddShape($type,$x,$y,$w,$h);$s.Name=$name;$s.Fill.ForeColor.RGB=$fill
  if($radius -gt 0){$s.Adjustments.Item(1)=0.025}
  if($line -eq 0){$s.Line.Visible=0}else{$s.Line.ForeColor.RGB=$line;$s.Line.Weight=0.9}
  $ids[$name]=$s.Id;return $s
}
function AddText([string]$name,[string]$value,[double]$x,[double]$y,[double]$w,[double]$h,[double]$size,[int]$color,[bool]$bold=$false,[int]$align=1){
  $s=$slide.Shapes.AddTextbox(1,$x,$y,$w,$h);$s.Name=$name
  $s.TextFrame.MarginLeft=0;$s.TextFrame.MarginRight=0;$s.TextFrame.MarginTop=0;$s.TextFrame.MarginBottom=0
  $s.TextFrame.WordWrap=-1;$s.TextFrame.AutoSize=0;$s.TextFrame.TextRange.Text=$value
  $s.TextFrame.TextRange.Font.Name='Microsoft YaHei';$s.TextFrame.TextRange.Font.NameFarEast='微软雅黑'
  $s.TextFrame.TextRange.Font.Size=$size;$s.TextFrame.TextRange.Font.Bold=if($bold){-1}else{0}
  $s.TextFrame.TextRange.Font.Color.RGB=$color;$s.TextFrame.TextRange.ParagraphFormat.Alignment=$align
  $ids[$name]=$s.Id;return $s
}
function AddChartPlaceholder([string]$name,[double]$x,[double]$y,[double]$w,[double]$h){
  $s=$slide.Shapes.AddPicture($asset,0,-1,$x,$y,$w,$h);$s.Name=$name;$ids[$name]=$s.Id
}

AddText 'acq_headline' '暑期激励部分结束，大盘整体回落，抖音 -20.9%、微信 -7.4%' 44 85 840 18 15 $navy $true | Out-Null
AddBox 'acq_wechat_card' 43 107 400 385 (Rgb 255 255 255) $border 6 | Out-Null
AddBox 'acq_douyin_card' 478 107 407 385 (Rgb 255 255 255) $border 6 | Out-Null
AddBox 'acq_wechat_badge' 58 119 29 23 $navy | Out-Null
AddBox 'acq_douyin_badge' 495 119 29 23 $navy | Out-Null
AddText 'acq_wechat_no' '01' 58 122 29 18 10 (Rgb 255 255 255) $true 2 | Out-Null
AddText 'acq_douyin_no' '02' 495 122 29 18 10 (Rgb 255 255 255) $true 2 | Out-Null
AddText 'acq_wechat_heading' '微信：9月 265.0 万条，环比 -7.4%' 92 121 335 22 12 $navy $true | Out-Null
AddText 'acq_douyin_heading' '抖音：9月 653.1 万条，环比 -20.9%' 529 121 345 22 12 $navy $true | Out-Null

AddBox 'acq_wechat_accent_1' 59 156 13 4 $gold | Out-Null
AddText 'acq_wechat_reason_title_1' '非首发老游暑期专项激励结束' 77 151 345 16 11 $navy $true | Out-Null
AddText 'acq_wechat_reason_1' '7月1日前已上线的非首发老游，买量激励于8月31日结束，但对于新游和首发老游的激励持续至9月30日。' 59 173 361 34 10 $muted | Out-Null
AddBox 'acq_wechat_accent_2' 59 210 13 4 $gold | Out-Null
AddText 'acq_wechat_reason_title_2' '首发新游激励金使用范围收紧' 77 205 345 16 11 $navy $true | Out-Null
AddText 'acq_wechat_reason_2' '自2026年9月22日起，首发新游激励金（上限2000万）仅支持转给当前小游戏的广告主账户投放使用（之前同主体下其他游戏也可用）。' 59 226 361 37 10 $muted | Out-Null
AddBox 'acq_wechat_divider' 59 265 357 0.8 (Rgb 226 221 210) | Out-Null
AddText 'acq_wechat_stat_1' '信息流素材             265.0 万条        -7.4%' 59 270 355 17 10 $ink | Out-Null
AddText 'acq_wechat_stat_2' '在投游戏数             13,914 款       +10.4%' 59 288 355 17 10 $ink | Out-Null

AddBox 'acq_douyin_accent' 495 156 13 4 $gold | Out-Null
AddText 'acq_douyin_reason_title' '7—8 月达人广告激励结束' 513 151 350 16 11 $navy $true | Out-Null
AddText 'acq_douyin_reason' '7—8月首次上线的小游戏，上线30天内内容流水达10万/50万元，可分别获2万/10万元任务金，按最高档领取一次，相关考核于9月底前结束。' 495 173 366 38 10 $muted | Out-Null
AddBox 'acq_douyin_divider' 495 213 355 0.8 (Rgb 226 221 210) | Out-Null
AddText 'acq_douyin_stat_1' '抖音信息流素材         237.5 万条       -16.3%' 495 220 355 17 10 $ink | Out-Null
AddText 'acq_douyin_stat_2' '抖音达人素材           416.5 万条       -23.4%' 495 238 355 17 10 $ink | Out-Null
AddText 'acq_douyin_stat_3' '抖音在投游戏数         20,097 款       +2.0%' 495 256 355 17 10 $ink | Out-Null

AddText 'acq_wechat_chart_title' '微信 · 素材量与在投游戏数（7—9月）' 86 305 314 18 12 $green $true 2 | Out-Null
AddText 'acq_douyin_chart_title' '抖音 · 素材量与在投游戏数（7—9月）' 526 286 310 18 12 $navy $true 2 | Out-Null
AddChartPlaceholder 'acq_wechat_chart' 54 324 374 153
AddChartPlaceholder 'acq_douyin_chart' 489 305 382 172
AddText 'acq_footnote' '注:ADX素材抓取不全,微信广告版位缺失较多,所统计素材主要来自非微信广告版位' 56 500 825 21 10 $muted | Out-Null

$deck.SaveAs($Output,24);$deck.Close();$ppt.Quit()
$ids | ConvertTo-Json -Depth 3 | Set-Content -LiteralPath $IdsOutput -Encoding utf8
Write-Output "saved $Output objects=$($ids.Count)"
