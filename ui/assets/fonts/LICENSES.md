# 字体授权

本站全部字体均为 **SIL Open Font License 1.1**，允许免费商用、嵌入与再分发，允许修改（修改版须遵守保留字体名条款）。完整许可原文见同目录 `licenses/*.txt`。

| 用途 | 字体 | 版权声明 | 文件 | 是否修改 |
|---|---|---|---|---|
| 英文标题/数字 | **Chakra Petch** | Copyright 2018 The Chakra Petch Project Authors (https://github.com/m4rc1e/Chakra-Petch.git) | `chakra-petch-600.woff2`、`chakra-petch-700.woff2` | 否（Latin 子集，Fontsource 构建） |
| 英文正文/UI | **Rajdhani** | Copyright (c) 2014 Indian Type Foundry (info@indiantypefoundry.com) | `rajdhani-500.woff2`、`rajdhani-600.woff2`、`rajdhani-700.woff2` | 否（Latin 子集，Fontsource 构建） |
| 等宽标签/编号 | **Share Tech Mono** | Copyright (c) 2012, Carrois Type Design, Ralph du Carrois (post@carrois.com www.carrois.com), with Reserved Font Name 'Share' | `share-tech-mono-400.woff2` | 否（原样分发，保留保留字体名） |
| 中文标题 | **得意黑 Smiley Sans** | Copyright © 2022–2024 atelierAnchor. All rights reserved. Reserved Font Names: "Smiley"、"得意黑" | `cyber-display-sc.woff2` | 是：按站点用字取子集，并按 OFL 保留字体名条款将内部名称改为 **Cyber Display SC** |

## 来源

- Chakra Petch / Rajdhani / Share Tech Mono：Google Fonts，经 `@fontsource` 包取得 woff2。
  - https://fonts.google.com/specimen/Chakra+Petch
  - https://fonts.google.com/specimen/Rajdhani
  - https://fonts.google.com/specimen/Share+Tech+Mono
- 得意黑：https://github.com/atelier-anchor/smiley-sans/releases/tag/v2.0.1

## 关于中文标题子集

`cyber-display-sc.woff2` 是从 **得意黑 Smiley Sans v2.0.1** 生成的子集，仅包含界面标题实际使用的字符，作为 `--font-display` 的回退字体。子集内部名称按 OFL 保留字体名条款改为 **Cyber Display SC**。源字体与子集脚本不在本仓库内；需要重建时请从上游取得 v2.0.1 原版，并使用 `fonttools` + `brotli` 按页面用字重新生成。

## 许可原文

- `licenses/chakra-petch-OFL.txt`
- `licenses/rajdhani-OFL.txt`
- `licenses/share-tech-mono-OFL.txt`
- `licenses/smiley-sans-OFL.txt`
