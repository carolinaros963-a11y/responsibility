# 概率论与随机过程期中小组作业

题目：大型活动安防中的随机到达、排队拥堵与巡逻发现：高阶叙事性模拟

## 交付内容

- `report/midterm_report.docx`：Word 主报告，可按班级要求重命名为“作业名称+小组编号+组长姓名+组员.docx”。
- `report/midterm_report.pdf`：PDF 备份，可按班级要求重命名为“作业名称+小组编号+组长姓名+组员.pdf”。
- `interactive/index.html`：高阶叙事性交互作品，双击即可离线打开。
- `interactive/styles.css`、`interactive/app.js`：交互作品源代码。
- `webapp/`：正式版高阶叙事性模拟 Web 应用，基于 Vite + React，可本地启动或打包部署。
- `source/simulation.py`：报告图表与指标的可复现实验脚本。
- `report/figures/`：报告插图与 `metrics.json`。

## 运行方式

1. 正式 Web 应用：进入 `webapp` 文件夹后运行：

```powershell
npm install
npm run dev
```

2. 离线备份交互页：打开 `interactive/index.html`。
3. 复现图表：在当前文件夹运行：

```powershell
py -X utf8 source/simulation.py --output report/figures
```

## 需要提交前替换的信息

报告封面中的学院、小组编号、成员姓名、学号、分工和指导教师目前为占位内容。提交前将 `report/midterm_report.docx` 封面对应位置替换为真实信息，并重新另存为 PDF。
