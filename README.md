# 中西文字体替换

独立的 Chromium Manifest V3 扩展。配置共用标点字形、常见简体中文正文黑体、宋体与楷体，并为 `serif` 和 `宋体`/`SimSun` 组合中文与西文字体，保留网站其余字体列表。

## 使用

从 [GitHub Release](https://github.com/Speechlessmanbilibili/chinese-western-font-replacer/releases/latest) 下载带版本号的 ZIP，拖入 Chrome/Edge 扩展管理页，打开设置，填写已安装的本机字体名称并保存。默认字体为 `PingFang UI SC`。固定扩展 ID 为 `leodnciablfoggcacioldiippnfdonmg`，更新包覆盖原扩展并沿用已有设置。

标点、黑体、宋体、楷体、中西文组合及本站标点字体输入框均支持多个字体，用英文或中文逗号分隔，例如 `PingFang UI SC, PingFang SC`。浏览器按填写顺序选择可用字体，并在缺字时继续尝试后备项。字体名称本身含逗号时，用 CSS 引号包住，例如 `"A,B", Arial`。

填写本机字体的完整名称，包括名称中的后缀，例如 `方正新书宋_GBK` 或 `方正新书宋简体`。名称检测失败时，设置页提示相近的已安装字体名称；正文使用浏览器字体家族目录辅助检测，标点字体另行检查字形加载结果。

默认包括弯引号、省略号、破折号、连接号、间隔号、项目符号、参考符号、章节符号、段落符号和匕首号。角形引号、英文标点及常用符号可另行勾选，也可直接输入额外字符。字符按 Unicode 码位统一处理，中文和西文中的同一个字符使用相同字形。

站点规则支持跟随全局、开启、关闭及单独的标点字体。域名同时匹配其子域名，更具体的域名优先；端口规则只匹配指定端口。例子使用 `example.com`。

简体中文正文黑体处理默认开启，目标字体为 `PingFang UI SC`。目标中文字体前补充 `SF Pro Text`；只填写 `PingFang UI SC` 时，其后自动补充 `PingFang SC`，填写多个字体时按自选顺序保留。命中的名称原位替换为这一组合，没有命中时在原字体列表末尾追加。字体栈明确包含宋体、楷体、仿宋等中文字体时，跳过末尾追加；支持中英文名称、CSS 转义与字体变量依赖。默认名单在设置页可编辑，此功能也可按站点关闭。

宋体与楷体替换默认关闭，开关与目标字体列表相互独立，也独立于黑体开关。开启后按填写的字体列表原位替换命中的名称。默认宋体目标为 `Songti SC`，楷体目标为 `Kaiti SC`，可填写多个已安装的本机字体。“宋体替换”与下方中西文组合互斥，启用任意一项会关闭另一项。站点选择“网站中文字体”时，同时关闭该站点的黑体、宋体、楷体和中西文组合。

- 宋体只匹配 `宋体` 及其英文名称 `SimSun`，其他宋体名称沿用网站原声明。
- 楷体匹配 `KaiTi`、`KaiTi_GB2312`、`STKaiti`、`Kaiti SC`、`楷体`、`楷体_GB2312`、`华文楷体`、`楷体-简` 和 `generic(kai)`。

仿宋、繁体宋体及繁体楷体沿用网站原字体；黑体后备追加仍按网站原列表中的宋体、楷体等判断。字体变量、嵌套回退及网站后来改变的声明继续应用当前开关，关闭后恢复网站最终声明与优先级。

### serif/宋体中西文字体组合

默认关闭。启用后，在网站字体列表中原位替换通用字体 `serif` 及 `宋体`/`SimSun`，分别填写中文与西文字体列表。中文默认使用 `Songti SC, SimSun`，西文默认使用 `Times New Roman`；每个板块按填写顺序回退。

内部通过 `unicode-range` 分配字符：汉字、注音、部首、笔画、中文标点及全角形式使用中文字体，其他字符使用西文字体。弯引号、省略号、破折号、间隔号、参考与章节符号等中西文共用字符默认使用中文字体，可切换为西文字体。设置页提供专门的混排预览。

例如 `Arial, serif` 改为 `Arial, 中西文组合字体, serif`，前面的 `Arial` 继续优先；原来的 `serif` 作为缺字或本机字体缺失时的后备。`宋体`/`SimSun` 同样在原位置替换，保留原项作为后备。其他宋体名称、`ui-serif` 及带引号的 `"serif"` 字体家族沿用原声明。

本功能命中的字体列表按本功能选项提供共用字符字形，保留前置字体的优先级；其他字体列表继续使用独立的标点设置。支持字体变量、多层引用、嵌套回退、动态 CSSOM、Shadow DOM、跨域 CSS 与子框架。关闭后恢复网站最新的字体声明和 `!important` 优先级。

### 正文黑体与系统字体名单

默认名单包括 14 个简中正文黑体名称和 24 个系统无衬线/Apple 文本样式名称。简中名单参考 [Element Plus](https://github.com/element-plus/element-plus/blob/dev/packages/theme-chalk/src/common/var.scss) 和 [typo.css](https://github.com/sofish/typo.css/blob/master/typo.css) 的字体栈，并加入鸿蒙 SC：

- 微软雅黑：`Microsoft YaHei`、`Microsoft YaHei UI`、`微软雅黑`。
- 苹方：`PingFang SC`、`PingFang UI SC`、`苹方-简`。
- 冬青：`Hiragino Sans GB`。
- Noto/思源：`Noto Sans SC`、`Noto Sans CJK SC`、`Source Han Sans SC`、`思源黑体`。
- 文泉驿：`WenQuanYi Micro Hei`。
- 鸿蒙：`HarmonyOS Sans SC`、`HarmonyOS_Sans_SC`。

系统字体包括 `-apple-system`、`-apple-system-font`、`-webkit-system-font`、`BlinkMacSystemFont`、`system-ui`、`ui-sans-serif` 和 `sans-serif`。Apple 文本系列包括 `-apple-system-body`、`-apple-system-headline`、`-apple-system-subheadline`、`-apple-system-footnote`、`-apple-system-caption1`、`-apple-system-caption2`，对应的 `short-headline`、`short-body`、`short-subheadline`、`short-footnote`、`short-caption1`，以及 `tall-body` 和 `title0` 至 `title4`。名称依据 [WebKit 字体实现](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/platform/graphics/cocoa/FontCacheCoreText.cpp) 与[关键字表](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/css/CSSValueKeywords.in)维护。

保存过旧默认名单时自动更新为上述集合，用户编辑过的名单保留。

例如，`Arial, sans-serif` 改为 `Arial, "SF Pro Text", "PingFang UI SC", "PingFang SC"`；`-apple-system-body` 改为 `"SF Pro Text", "PingFang UI SC", "PingFang SC"`；`Arial, SimSun, sans-serif` 保留原列表。明确包含宋体、楷体等中文字体时，保留系统后备项；指定的简中正文黑体仍原位替换。字体栈前面已有的西文字体仍优先，标点专用字体另行前置。使用字体列表变量时，沿变量引用替换目标名称，并根据变量中的宋体、楷体等取值更新后备判断；保留变量表达式与原优先级。

## 工作方式

通过浏览器 `FontFace` 接口引用本机字体，使用与 `@font-face` 等价的 `local()` 与 `unicode-range` 限定字符范围。每个标点字体分别注册为 `Shared Punctuation Font`、`Shared Punctuation Font 2` 等名称，按输入顺序前置，保留静态字体的合成粗体与苹方 UI 的变量字重。原字体列表、规则位置和优先级继续保留。浏览器完成字符匹配与绘制。根元素没有作者字体声明时，使用浏览器原有标准字体；补充声明以 `USER` 普通优先级注入。与主字体替换扩展同时启用多标点字体时，使用主扩展 v2.1.9 或更新版本。

启动时直接传递站点配置，注册并预加载标点专用字体；页面解析期间通过微任务处理新出现的字体声明。浏览器默认字体查询与根元素补充样式独立完成，网站字体声明可以先行替换。

处理普通样式表、内联字体声明、字体列表变量、媒体条件、状态选择器、动态 CSSOM 写入、脚本创建的 Shadow DOM 与 adopted stylesheets。不可直接读取的跨域 CSS 由后台取得，并在原样式表位置建立副本；副本保留媒体条件，资源地址按来源解析，CSS 导入按层、支持条件及媒体条件展开。读取失败或遇到命名空间时保留原样式表。

跨域 CSS 按文件与响应声明的编码读取，支持中文字体名和中文变量名；导入子表继承父表的编码。样式表重写、分组与关键帧规则增删后同步更新字体声明和变量依赖，保留浏览器原生 CSSOM 的参数行为。

特殊来源的 about:blank/srcdoc/blob/data 框架沿用创建来源的站点规则，保留端口。页面使用 document.open/write 重建文档后，继续应用当前配置并处理后续样式变化。

初次配置时读取四个空控件的浏览器默认字体，补充普通优先级声明，使没有作者字体声明的输入框、按钮等保留默认字体并替换标点。网站只改变颜色、位置、文字或浏览器状态时，不需要重新读取字体。文字内容及选区由网站和浏览器管理。关闭扩展或本站覆盖时，恢复已改写的字体声明。

设置页在配置读取完成后开放编辑，保存期间继续保留新输入的草稿；保存完成后，新草稿仍显示为未保存状态。未选择字符组且额外字符为空时，预览清除标点专用字体并显示“未选择标点字符。”

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
