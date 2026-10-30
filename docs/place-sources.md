# 景点资料与照片来源

核实日期：**2026-10-30**。适用行程：2026-10-31、2026-11-01、2026-11-02。所有时间均为图卢兹当地时间。静态数据在 `src/lib/places.ts`，不是实时营业状态接口。

另外 10 处景点及照片见 [新增景点来源](places-extra-sources.md)。现有 14 处景点各有 2 张不同实景照片。

## 地址与开放信息

| 景点 | 官方来源 | 此次采用的信息与范围 |
| --- | --- | --- |
| Cité de l’espace（太空城） | [图卢兹旅游局日期开放表](https://www.handi.toulouse-tourisme.com/offre/cite-de-lespace/)、[景点官网](https://www.cite-espace.com/) | Avenue Jean Gonord, 31500 Toulouse。旅游局表列 2026-10-19 至 11-01 每天 10:00–18:00；11-02 至 12-20 周一关闭。因此 10/31、11/1 开放 10:00–18:00，11/2 关闭。展映与体验场次未预填。 |
| Halle de La Machine（机械馆） | [场馆实用信息](https://www.halledelamachine.fr/infos-pratiques/)、[场馆 Autom’Halle 2026 活动](https://www.halledelamachine.fr/evenements/automhalle/)、[图卢兹旅游局日期开放表](https://www.handi.toulouse-tourisme.com/offre/la-halle-de-la-machine/) | 3 avenue de l’Aérodrome de Montaudran, 31400 Toulouse；官网提示自驾入口 6 rue Jacqueline Auriol。Autom’Halle 为 2026-10-17 至 11-01，周二至周日 10:00–18:00；旅游局同样确认 10/31、11/1 为 10:00–18:00，最后入场为闭馆前 1 小时；11/2 周一关闭。机械牛头人乘坐场次不等同于场馆开放时间。 |
| Jardin japonais Pierre-Baudis（日式花园） | [图卢兹市政府景点页](https://metropole.toulouse.fr/annuaire/jardin-japonais-pierre-baudis)、[市政府公园季节时刻表](https://metropole.toulouse.fr/mon-environnement/nature-et-climat/nature-en-ville/parcs-et-jardins) | 9 boulevard Lascrosses, 31000 Toulouse。采用官方季节常规时间：9/1–10/31 为 08:00–20:00；11/1–2/28 为 08:00–18:00。网页当前公告茶亭因露台安全问题临时关闭；不代表整个花园关闭。大风等天气可能临时闭园，不能把季节表表述为当天保证开放。 |
| Basilique Saint-Sernin（圣塞尔南教堂） | [市政府景点页](https://metropole.toulouse.fr/annuaire/basilique-saint-sernin)、[官方古迹参观说明](https://monuments.toulouse.fr/basilique-saint-sernin/)、[图卢兹旅游局日期开放表](https://www.handi.toulouse-tourisme.com/offre/la-basilique-saint-sernin/) | Place Saint-Sernin, 31000 Toulouse。旅游局表列 2026-10-01 至 2027-05-31 每天 08:30–18:00，市政府说明礼拜期间不接待观光。11/1 为节日，未核实到当天具体礼拜/参观切换时段，数据明确标为待当日确认。地下墓室有独立时段，未混入教堂开放时间。 |

太空城官网在本次抓取中超时，具体日期依据同属官方机构的图卢兹旅游局公开日历，而非根据旧年或第三方攻略推算。花园使用市政府季节规则，不冒称核实过三天全部临时公告。实际活动时间由用户决定；`closedDates` 可以用于提醒所选日期闭馆。

开放信息独立展示，不复制到活动备注。详情和编辑器使用 `findPlaceByLocation(location)` 对保存地址或当前输入做精确匹配，再按活动日期读取 `hoursByDate`，同时展示 `hoursNote` 和官方链接。匹配仅限正式名称、完整地址、`locationQuery` 和已核实别名：旅游局采用的 `La Halle de La Machine`、市政府使用的 `Jardin japonais` / `Jardin japonais Pierre Baudis`。规范化仅处理 Unicode NFC、大小写、弯引号、连字符及标点周围空白；不去除重音、不做子串或模糊匹配。`Jardin Japonais · 运河`、`Capitole → Saint-Sernin → Pont Neuf` 等路线不会被套用为单个景点的开放时间。

## 照片与署名

照片直接使用 Wikimedia Commons 文件页提供的 960 px 缩略图地址，未从景点营销网站复制图片、未绕过访问限制、未下载原图到项目。照片拍摄年份与旅行日期不同，属于景点实景参考，不表示当前天气或现场情况。

| 景点 | 原作品及文件页 | 作者 | 照片日期 | 文件页列出的许可 |
| --- | --- | --- | --- | --- |
| 太空城 | [Cité de l'espace Toulouse 1.jpg](https://commons.wikimedia.org/wiki/File:Cit%C3%A9_de_l%27espace_Toulouse_1.jpg) | kallerna | 2022-05-26 | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) |
| 机械馆 | [Minotaure.jpg](https://commons.wikimedia.org/wiki/File:Minotaure.jpg) | Frédéric Neupont | 2021-08-17 | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) |
| 日式花园 | [Toulouse - Vue du jardin japonais.jpg](https://commons.wikimedia.org/wiki/File:Toulouse_-_Vue_du_jardin_japonais.jpg) | Pixou31 | 2013-06-11 | [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) |
| 圣塞尔南教堂 | [Extérieur de la Basilique Saint-Sernin.jpg](https://commons.wikimedia.org/wiki/File:Ext%C3%A9rieur_de_la_Basilique_Saint-Sernin.jpg) | Don-vip | 2012-09-16 | [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) |
| 太空城 · Mir 舱段 | [Musée de la Cité de l'Espace 02.jpg](https://commons.wikimedia.org/wiki/File:Mus%C3%A9e_de_la_Cit%C3%A9_de_l%27Espace_02.jpg) | Celeda | 2018-08-24 | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0) |
| 机械馆 · 场馆与步行区 | [Piste des Géants et halle de la Machine.jpg](https://commons.wikimedia.org/wiki/File:Piste_des_G%C3%A9ants_et_halle_de_la_Machine.jpg) | Abdoucondorcet | 2021-10-26 | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0) |
| 日式花园 · 枯山水 | [Jardin sec (枯山水karesansui) du jardin japonais de Toulouse.jpg](https://commons.wikimedia.org/wiki/File:Jardin_sec_%28%E6%9E%AF%E5%B1%B1%E6%B0%B4karesansui%29_du_jardin_japonais_de_Toulouse.jpg) | Antoninmorvan | 2021-03-05 | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0) |
| 圣塞尔南教堂 · 中殿 | [St Sernin,intérieur12,nef12,stalles sud1.jpg](https://commons.wikimedia.org/wiki/File:St_Sernin,int%C3%A9rieur12,nef12,stalles_sud1.jpg) | Finoskov | 2013-04-20 | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0) |

四张新增照片均由 Commons 文件元数据与文件页核实为 CC BY-SA 4.0；960 px 链接经 HEAD 检查均返回 `200 image/jpeg`，未下载图片。机械馆照片的 Commons 当前版本已由 User-duck 裁切，文件页保留变更记录。太空城照片为曾用于宇航员训练的 Mir 舱段；对应简介改为“舱段”，[市政府介绍](https://metropole.toulouse.fr/annuaire/cite-de-lespace)明确区分真实舱段与火箭等实物尺寸复制品。

界面使用 `imageCredit` 显示作者及 Wikimedia Commons，链接 `imageSourceUrl`，并提供 `imageLicense` / `imageLicenseUrl` 的许可证链接。界面如使用 `object-fit: cover`，在照片来源区注明“照片按版面裁切”。如另行制作并分发照片改编版本，遵守对应许可的同方式共享条件。此处许可记录对应照片文件，不改变应用代码的许可。

远程图片加载失败时，保留景点名称、开放信息和添加入口；不要把图片请求失败当作资料不可用。Google Maps 搜索可使用已包含法文景点名和完整地址的 `locationQuery`，不需要地图 API 密钥。
