# 补充六处景点来源

核实日期：2026-10-30。数据位于 `src/lib/places-more.ts`，导出 `MORE_PLACES`；共 6 处独立景点，每处 4 张不同照片，含封面。时间均为图卢兹当地时间（Europe/Paris）。既有目录依据见[首批景点来源](place-sources.md)与[另外十处景点来源](places-extra-sources.md)。

## 地址与三日开放信息

以下日期按官方周历、季节与节假日规则对应；明确的当日公告优先于常规时间。

| 景点 | 地址 | 10/31 周六 | 11/1 周日 | 11/2 周一 | 官方依据 |
| --- | --- | --- | --- | --- | --- |
| 圣雷蒙考古博物馆 | 1 place Saint-Sernin, 31000 Toulouse | 10:00–18:00 | 10:00–18:00 | 周一闭馆 | [市政场馆资料](https://metropole.toulouse.fr/annuaire/musee-saint-raymond-musee-darcheologie-de-toulouse)；[11/1 当日活动](https://saintraymond.toulouse.fr/bienvenue-au-moyen-age/)明确 10:00–18:00。 |
| 圣艾蒂安主教座堂 | Place Saint-Étienne, 31000 Toulouse | 常规 08:00–19:00 | 常规 09:00–19:00；节日参观时段待确认 | 常规 08:00–19:00 | [市政资料](https://metropole.toulouse.fr/annuaire/cathedrale-saint-etienne)与[旅游局资料](https://www.toulouse-tourisme.com/activite/la-cathedrale-saint-etienne/)均区分周日与平日；礼拜期间不按连续观光开放处理。 |
| 维克多雨果市场 | Place Victor Hugo, 31000 Toulouse | 06:00–14:00 | 06:00–14:00 | 周一休市 | [市场官网](https://www.marche-victor-hugo.fr/)与[市政资料](https://metropole.toulouse.fr/annuaire/marche-couvert-victor-hugo)均注明周二至周日、节假日照常；楼上餐厅时段另查。 |
| Aeroscopia 航空馆 | Allée André Turcat, 31700 Blagnac | 09:30–19:00，18:00 停止入场 | 09:30–18:00，17:00 停止入场 | 09:30–18:00，17:00 停止入场 | [馆方实用信息](https://www.aeroscopia.fr/infospratiques/)明确假期最后一个周日 18:00 关闭；[教育部校历](https://www.education.gouv.fr/calendrier-scolaire-toutes-les-dates-des-cours-et-des-vacances-100148?annee=308)确认 11/2 复课。 |
| L’Envol des Pionniers | 6 rue Jacqueline Auriol, 31400 Toulouse | 10:00–18:00 | 10:00–18:00 | 周一闭馆 | [馆方参观资料](https://www.lenvol-des-pionniers.com/visiter/preparer-ma-visite/)明确周末及 11/1 开放 10:00–18:00，提前一小时停止售票。 |
| Grand Rond 花园 | Square Boulingrin, 31000 Toulouse | 08:00–20:00 | 08:00–18:00 | 08:00–18:00 | [市政花园资料](https://metropole.toulouse.fr/annuaire/jardin-du-grand-rond)明确 11/1 起执行冬季时间；大风可能闭园。 |

- 圣雷蒙 11/1 常设展及当日动画活动免费，临展另收费；没有把免费范围扩大到所有展览。[当日公告](https://saintraymond.toulouse.fr/bienvenue-au-moyen-age/)
- 主教座堂的[堂区常规页面](https://paroissescathedraletoulouse.fr/home-2/vocationbox/trouver-nos-eglises/)概括写每日 08:00–19:00，与市政和旅游局的周日 09:00 有差异。目录采用后两者一致的周日时间，并保留 11/1 节日参观待确认，不把礼拜开放承诺为全天观光。
- Aeroscopia 的 [FAQ](https://www.aeroscopia.fr/faq/)只概括假期 19:00 关闭；目录采用更具体的[实用信息](https://www.aeroscopia.fr/infospratiques/)中“假期最后一个周日 18:00”规则。博物馆参观与 Airbus 工厂参观分别安排。
- L’Envol 的[当日停车公告](https://www.lenvol-des-pionniers.com/visiter/preparer-ma-visite/)注明 2026-11-01 P0、P1 停车场至 12:00 不可使用，P2 可用；开放时间不因此改变。简介依据[常设展介绍](https://www.lenvol-des-pionniers.com/decouvrir/exposition-permanente/)。
- Grand Rond 的[旅游局辅助站](https://www.handi.toulouse-tourisme.com/offre/jardin-du-grand-rond/)把 9–12 月统写为 20:00；目录采用管理方市政页面按 11/1 分段的具体规则。

## 照片来源与检查

逐张保留作者、Commons 文件页、图片许可及尺寸。24 个实际使用的图片 URL 均于核实日通过 HTTP HEAD 检查，返回 `200` 与 `image/jpeg`，并完成缩略图内容检查；没有使用同一照片的裁切版补足数量。历史照片和节庆照片在图片说明中标明年代，不代表本次行程现场状态。

| 景点 | 照片 | 作者 | 图片许可 |
| --- | --- | --- | --- |
| 圣雷蒙考古博物馆 | [圣雷蒙博物馆的砖石外墙与入口](https://commons.wikimedia.org/wiki/File:Musee-Saint-Raymond-Toulouse-fa%C3%A7ade.jpeg) | Christelle Molinié | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0) |
| 圣雷蒙考古博物馆 | [圣雷蒙博物馆庭院](https://commons.wikimedia.org/wiki/File:Cour_mus%C3%A9e_Saint_Raymond.jpg) | Léna | [CC BY 3.0](https://creativecommons.org/licenses/by/3.0) |
| 圣雷蒙考古博物馆 | [圣雷蒙博物馆地下考古遗址的石灰窑](https://commons.wikimedia.org/wiki/File:Mus%C3%A9e_Saint-Raymond_-_Four_%C3%A0_chaux_02.jpg) | Tylwyth Eldar | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0) |
| 圣雷蒙考古博物馆 | [圣雷蒙博物馆展出的贝济耶古罗马雕像组](https://commons.wikimedia.org/wiki/File:The_Statuary_Group_from_Beziers,_MSR,_Mus%C3%A9e_Saint-Raymond_(7221210570).jpg) | Carole Raddato | [CC BY-SA 2.0](https://creativecommons.org/licenses/by-sa/2.0) |
| 圣艾蒂安主教座堂 | [图卢兹圣艾蒂安主教座堂的西立面](https://commons.wikimedia.org/wiki/File:Fa%C3%A7ade_de_la_cath%C3%A9drale_Saint-%C3%89tienne_de_Toulouse.jpg) | Didier Descouens | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0) |
| 圣艾蒂安主教座堂 | [圣艾蒂安主教座堂的祭坛与哥特式后殿](https://commons.wikimedia.org/wiki/File:Autel_cath%C3%A9drale_Saint-%C3%89tienne,_Toulouse.jpg) | Pom² | [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0) |
| 圣艾蒂安主教座堂 | [圣艾蒂安主教座堂内部空间](https://commons.wikimedia.org/wiki/File:Katedrala_Tolosa_5043.jpg) | Luistxo | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0) |
| 圣艾蒂安主教座堂 | [圣艾蒂安主教座堂彩色玻璃窗](https://commons.wikimedia.org/wiki/File:Vitralo_en_la_katedralo_de_Sankta_Stefano_en_Tuluzo.jpg) | Dynas Dzie | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0) |
| 维克多雨果市场 | [维克多雨果市场内的食品摊位](https://commons.wikimedia.org/wiki/File:Toulouse_-_March%C3%A9_Victor_Hugo_01.jpg) | Frédéric Neupont | [CC0](https://creativecommons.org/publicdomain/zero/1.0/deed.en) |
| 维克多雨果市场 | [维克多雨果市场的另一侧外观](https://commons.wikimedia.org/wiki/File:Toulouse_-_March%C3%A9_Victor_Hugo_02.jpg) | Frédéric Neupont | [CC0](https://creativecommons.org/publicdomain/zero/1.0/deed.en) |
| 维克多雨果市场 | [维克多雨果市场建筑与周边街景](https://commons.wikimedia.org/wiki/File:Marchevictorhugo.JPG) | Catalarem~commonswiki | [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) |
| 维克多雨果市场 | [2023 年圣诞灯饰下的维克多雨果市场](https://commons.wikimedia.org/wiki/File:March%C3%A9_Victor-Hugo,_illuminations_de_No%C3%ABl_2023.jpg) | Abdoucondorcet | [CC0](https://creativecommons.org/publicdomain/zero/1.0/deed.en) |
| Aeroscopia 航空馆 | [Aeroscopia 室外展区的 Airbus A380 尾部](https://commons.wikimedia.org/wiki/File:Airbus_A380_Aeroscopia_-_vue_arri%C3%A8re.jpg) | Kuremu Sakura | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0) |
| Aeroscopia 航空馆 | [Aeroscopia 馆内协和客机下方的展区](https://commons.wikimedia.org/wiki/File:Aeroscopia_-_Main_hall_under_Concorde.JPG) | Duch.seb | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0) |
| Aeroscopia 航空馆 | [Aeroscopia 航空博物馆的主展厅](https://commons.wikimedia.org/wiki/File:Aeroscopia_-_Main_hall_1.JPG) | Duch.seb | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0) |
| Aeroscopia 航空馆 | [Aeroscopia 南侧室外停机坪](https://commons.wikimedia.org/wiki/File:Aeroscopia_-_Tarmac_Sud.jpg) | Kuremu Sakura | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0) |
| 航空邮政博物馆 | [L’Envol des Pionniers 航空邮政展厅](https://commons.wikimedia.org/wiki/File:Envol_des_pionniers.jpg) | Frédéric Neupont | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0) |
| 航空邮政博物馆 | [步行桥与 L’Envol des Pionniers 博物馆外观](https://commons.wikimedia.org/wiki/File:Jardins_de_la_Ligne,_passerelle_et_L%27Envol_des_pionniers_(Toulouse).jpg) | Abdoucondorcet | [CC0](https://creativecommons.org/publicdomain/zero/1.0/deed.en) |
| 航空邮政博物馆 | [从 Jardins de la Ligne 望向 L’Envol des Pionniers](https://commons.wikimedia.org/wiki/File:Jardins_de_la_Ligne,_vue_sur_l%27Envol_des_Pionniers_(Toulouse).jpg) | Abdoucondorcet | [CC0](https://creativecommons.org/publicdomain/zero/1.0/deed.en) |
| 航空邮政博物馆 | [1939 年前 Montaudran 的 Latécoère 厂房历史照片](https://commons.wikimedia.org/wiki/File:9Fi6266_-_6._Montaudran_(Toulouse)._Les_usines_Lat%C3%A9co%C3%A8re.jpg) | APA; Phototypie tarnaise; POUX; Lapoujade - (Albi) – Mairie de Toulouse, Archives municipales, 9Fi6266 | [Public domain](https://commons.wikimedia.org/wiki/File:9Fi6266_-_6._Montaudran_(Toulouse)._Les_usines_Lat%C3%A9co%C3%A8re.jpg#Licensing) |
| Grand Rond 花园 | [图卢兹 Grand Rond 花园实景](https://commons.wikimedia.org/wiki/File:Jardin_du_Grand_Rond_-_2016-08-09.jpg) | MathieuMD | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0) |
| Grand Rond 花园 | [Grand Rond 花园的装饰铁门](https://commons.wikimedia.org/wiki/File:Toulouse_-_Grilles_du_Grand-Rond.jpg) | Didier Descouens | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0) |
| Grand Rond 花园 | [Grand Rond 花园内的 Wallace 饮水喷泉](https://commons.wikimedia.org/wiki/File:Toulouse_-_Fontaine_Wallace_du_Jardin_du_Grand_Rond.jpg) | Didier Descouens | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0) |
| Grand Rond 花园 | [Grand Rond 花园内的《大卫战胜歌利亚》雕塑](https://commons.wikimedia.org/wiki/File:Antonin_Merci%C3%A9_-_David_vainqueur_de_Goliath-_Toulouse_-_Jardin_du_Grand_Rond.jpg) | Didier Descouens | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0) |
