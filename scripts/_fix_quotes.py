# -*- coding: utf-8 -*-
"""
Fix all embedded straight-double-quote issues in build_report.py.
Problematic patterns: "text" inside a Python double-quoted string literal.
We convert inner Chinese book-quote pairs to \u201c / \u201d escapes,
and other embedded quotes to single quotes.
"""
from pathlib import Path

path = Path(__file__).parent / "build_report.py"
text = path.read_text(encoding="utf-8")

# All the specific problematic substrings, mapping old -> new
replacements = [
    # Line 252: "到达集中度"
    ('"到达集中度"', '"\\u5230\\u8fbe\\u96c6\\u4e2d\\u5ea6"'),
    # Line 275: "该个体为真实风险人员" and "识别系统发出报警"
    ('"该个体为真实风险人员"', '\'该个体为真实风险人员\''),
    ('"识别系统发出报警"', '\'识别系统发出报警\''),
    # Line 294: "热点偏向"
    ('"热点偏向"', '"\\u70ed\\u70b9\\u504f\\u5411"'),
    # Line 301: "及时发现异常"
    ('"及时发现异常"', '"\\u53ca\\u65f6\\u53d1\\u73b0\\u5f02\\u5e38"'),
    # Line 310: "随机到达并非匀速"
    ('"随机到达并非匀速"', '"\\u968f\\u673a\\u5230\\u8fbe\\u5e76\\u975e\\u5300\\u901f"'),
    # Line 349: "参数改变 → 风险响应 → 策略解释"  (also has arrow chars)
    ('"参数改变 \u2192 风险响应 \u2192 策略解释"',
     '"\\u53c2\\u6570\\u6539\\u53d8 -> \\u98ce\\u9669\\u54cd\\u5e94 -> \\u7b56\\u7565\\u89e3\\u91ca"'),
]

for old, new in replacements:
    if old in text:
        text = text.replace(old, new)
        print(f"Fixed: {repr(old[:40])}")
    else:
        print(f"Not found: {repr(old[:40])}")

path.write_text(text, encoding="utf-8")
print("\nDone. Running syntax check...")
