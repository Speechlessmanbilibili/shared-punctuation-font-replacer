# 共用标点字体替换

独立的 Chromium Manifest V3 扩展。为中西文共用标点指定本机字体，并按名称调整常见简体中文正文黑体，保留网站其余字体列表。

## 使用

从 [GitHub Release](https://github.com/Speechlessmanbilibili/shared-punctuation-font-replacer/releases/latest) 下载 `shared-punctuation-font-replacer-v1.0.0.zip`，拖入 Chrome/Edge 扩展管理页，打开设置，填写已安装的本机字体名称并保存。默认字体为 `PingFang UI SC`。固定扩展 ID 为 `leodnciablfoggcacioldiippnfdonmg`，更新包覆盖原扩展并沿用已有设置。

默认包括弯引号、省略号、破折号、连接号、间隔号、项目符号、参考符号、章节符号、段落符号和匕首号。角形引号、英文标点及常用符号可另行勾选，也可直接输入额外字符。字符按 Unicode 码位统一处理，中文和西文中的同一个字符使用相同字形。

站点规则支持跟随全局、开启、关闭及单独的标点字体。域名同时匹配其子域名，更具体的域名优先；端口规则只匹配指定端口。例子使用 `example.com`。

简体中文正文黑体处理默认开启，目标字体为 `PingFang UI SC`。目标中文字体前补充 `SF Pro Text`，命中的名称原位替换为这一组合，没有命中时在原字体列表末尾追加。字体栈明确包含宋体、楷体、仿宋等中文字体时，跳过末尾追加；支持中英文名称、CSS 转义与字体变量依赖。默认名单在设置页可编辑，此功能也可按站点关闭。

默认名单包括 14 个简中正文黑体名称和 24 个系统无衬线/Apple 文本样式名称。简中名单参考 [Element Plus](https://github.com/element-plus/element-plus/blob/dev/packages/theme-chalk/src/common/var.scss) 和 [typo.css](https://github.com/sofish/typo.css/blob/master/typo.css) 的字体栈，并加入鸿蒙 SC：

- 微软雅黑：`Microsoft YaHei`、`Microsoft YaHei UI`、`微软雅黑`。
- 苹方：`PingFang SC`、`PingFang UI SC`、`苹方-简`。
- 冬青：`Hiragino Sans GB`。
- Noto/思源：`Noto Sans SC`、`Noto Sans CJK SC`、`Source Han Sans SC`、`思源黑体`。
- 文泉驿：`WenQuanYi Micro Hei`。
- 鸿蒙：`HarmonyOS Sans SC`、`HarmonyOS_Sans_SC`。

系统字体包括 `-apple-system`、`-apple-system-font`、`-webkit-system-font`、`BlinkMacSystemFont`、`system-ui`、`ui-sans-serif` 和 `sans-serif`。Apple 文本系列包括 `-apple-system-body`、`-apple-system-headline`、`-apple-system-subheadline`、`-apple-system-footnote`、`-apple-system-caption1`、`-apple-system-caption2`，对应的 `short-headline`、`short-body`、`short-subheadline`、`short-footnote`、`short-caption1`，以及 `tall-body` 和 `title0` 至 `title4`。名称依据 [WebKit 字体实现](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/platform/graphics/cocoa/FontCacheCoreText.cpp) 与[关键字表](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/css/CSSValueKeywords.in)维护。

保存过旧默认名单时自动更新为上述集合，用户编辑过的名单保留。

例如，`Arial, sans-serif` 改为 `Arial, "SF Pro Text", "PingFang UI SC"`；`-apple-system-body` 改为 `"SF Pro Text", "PingFang UI SC"`；`Arial, SimSun, sans-serif` 保留原列表。明确包含宋体、楷体等中文字体时，保留系统后备项；指定的简中正文黑体仍原位替换。字体栈前面已有的西文字体仍优先，标点专用字体另行前置。使用字体列表变量时，沿变量引用替换目标名称，并根据变量中的宋体、楷体等取值更新后备判断；保留变量表达式与原优先级。

## 工作方式

通过浏览器 `FontFace` 接口引用本机字体，使用与 `@font-face` 等价的 `local()` 与 `unicode-range` 限定字符范围。在网站的字体声明中前置这个专用字体，原字体列表、规则位置和优先级继续保留。浏览器完成字符匹配与绘制。根元素没有作者字体声明时，使用浏览器原有标准字体；补充声明以 `USER` 普通优先级注入。

处理普通样式表、内联字体声明、字体列表变量、媒体条件、状态选择器、动态 CSSOM 写入、脚本创建的 Shadow DOM 与 adopted stylesheets。不可直接读取的跨域 CSS 由后台取得，并在原样式表位置建立副本；副本保留媒体条件，资源地址按来源解析，CSS 导入按层、支持条件及媒体条件展开。读取失败或遇到命名空间时保留原样式表。

初次配置时读取四个空控件的浏览器默认字体，补充普通优先级声明，使没有作者字体声明的输入框、按钮等保留默认字体并替换标点。网站只改变颜色、位置、文字或浏览器状态时，不需要重新读取字体。文字内容及选区由网站和浏览器管理。关闭扩展或本站覆盖时，恢复已改写的字体声明。

Chrome/Edge 内部页面不支持注入。浏览器是否允许文件页面访问由扩展管理页中的对应选项控制。严格 CSP 下可处理可读字体声明；若同时限制跨域 CSS 副本，则保留该原样式表。页面使用完全由变量组成的 `font` 简写时，CSSOM 可能不提供独立的 `font-family` 声明；此类声明保留原值。安装本机字体后如仍显示字体缺失，可重启浏览器。

## 开发

```powershell
npm install
npm test
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\build-release.ps1
```

打包脚本生成版本 ZIP，文件直接位于根目录，并自动复制到系统下载目录。

[更新日志](CHANGELOG.md) · [隐私说明](PRIVACY.md)

## 许可证

采用 [GNU GPL v3.0 或更新版本](LICENSE)（GPL-3.0-or-later）。
