(function (root) {
    'use strict';

    var data = {
 "说明": "恒山弟子天赋 · 抽取用数据。talents 是全部天赋；candidates 是可随机抽到的 66 条，数组顺序即游戏内的实际遍历顺序，不可重排。",
 "candidates": [
  4,
  10,
  22,
  408,
  100,
  16,
  94,
  76,
  88,
  58,
  28,
  306,
  324,
  205,
  405,
  342,
  327,
  360,
  363,
  312,
  330,
  1,
  309,
  417,
  7,
  13,
  411,
  25,
  333,
  396,
  393,
  390,
  37,
  387,
  55,
  381,
  19,
  375,
  378,
  199,
  208,
  366,
  414,
  357,
  34,
  181,
  336,
  345,
  315,
  85,
  70,
  103,
  303,
  372,
  31,
  348,
  351,
  166,
  321,
  202,
  300,
  318,
  184,
  384,
  339,
  178
 ],
 "weightSum": 619,
 "talents": [
  {
   "id": 1,
   "name": "雪山行者Ⅰ",
   "qz": 10,
   "origin": 1,
   "class": 1
  },
  {
   "id": 2,
   "name": "雪山行者Ⅱ",
   "qz": 0,
   "origin": 1,
   "class": 1
  },
  {
   "id": 3,
   "name": "雪山行者Ⅲ",
   "qz": 0,
   "origin": 1,
   "class": 1
  },
  {
   "id": 4,
   "name": "水性娴熟Ⅰ",
   "qz": 10,
   "origin": 4
  },
  {
   "id": 5,
   "name": "水性娴熟Ⅱ",
   "qz": 0,
   "origin": 4
  },
  {
   "id": 6,
   "name": "水性娴熟Ⅲ",
   "qz": 0,
   "origin": 4
  },
  {
   "id": 7,
   "name": "走山客Ⅰ",
   "qz": 10,
   "origin": 7
  },
  {
   "id": 8,
   "name": "走山客Ⅱ",
   "qz": 0,
   "origin": 7
  },
  {
   "id": 9,
   "name": "走山客Ⅲ",
   "qz": 0,
   "origin": 7
  },
  {
   "id": 10,
   "name": "名门之后Ⅰ",
   "qz": 10,
   "origin": 10,
   "class": 10
  },
  {
   "id": 11,
   "name": "名门之后Ⅱ",
   "qz": 0,
   "origin": 10,
   "class": 10
  },
  {
   "id": 12,
   "name": "名门之后Ⅲ",
   "qz": 0,
   "origin": 10,
   "class": 10
  },
  {
   "id": 13,
   "name": "混迹市井Ⅰ",
   "qz": 10,
   "origin": 13,
   "class": 10
  },
  {
   "id": 14,
   "name": "混迹市井Ⅱ",
   "qz": 0,
   "origin": 13,
   "class": 0
  },
  {
   "id": 15,
   "name": "混迹市井Ⅲ",
   "qz": 0,
   "origin": 13,
   "class": 10
  },
  {
   "id": 16,
   "name": "出身寒微Ⅰ",
   "qz": 10,
   "origin": 16,
   "class": 10
  },
  {
   "id": 17,
   "name": "出身寒微Ⅱ",
   "qz": 0,
   "origin": 16,
   "class": 10
  },
  {
   "id": 18,
   "name": "出身寒微Ⅲ",
   "qz": 0,
   "origin": 16,
   "class": 10
  },
  {
   "id": 19,
   "name": "大漠之子Ⅰ",
   "qz": 10,
   "origin": 19,
   "class": 1
  },
  {
   "id": 20,
   "name": "大漠之子Ⅱ",
   "qz": 0,
   "origin": 19,
   "class": 1
  },
  {
   "id": 21,
   "name": "大漠之子Ⅲ",
   "qz": 0,
   "origin": 19,
   "class": 1
  },
  {
   "id": 22,
   "name": "剿匪能人Ⅰ",
   "qz": 10,
   "origin": 22
  },
  {
   "id": 23,
   "name": "剿匪能人Ⅱ",
   "qz": 0,
   "origin": 22
  },
  {
   "id": 24,
   "name": "剿匪能人Ⅲ",
   "qz": 0,
   "origin": 22
  },
  {
   "id": 25,
   "name": "动物杀手Ⅰ",
   "qz": 10,
   "origin": 25
  },
  {
   "id": 26,
   "name": "动物杀手Ⅱ",
   "qz": 0,
   "origin": 25
  },
  {
   "id": 27,
   "name": "动物杀手Ⅲ",
   "qz": 0,
   "origin": 25
  },
  {
   "id": 28,
   "name": "嫉恶如仇Ⅰ",
   "qz": 10,
   "origin": 28
  },
  {
   "id": 29,
   "name": "嫉恶如仇Ⅱ",
   "qz": 0,
   "origin": 28
  },
  {
   "id": 30,
   "name": "嫉恶如仇Ⅲ",
   "qz": 0,
   "origin": 28
  },
  {
   "id": 31,
   "name": "天生幸运Ⅰ",
   "qz": 10,
   "origin": 31,
   "class": 31
  },
  {
   "id": 32,
   "name": "天生幸运Ⅱ",
   "qz": 0,
   "origin": 31,
   "class": 31
  },
  {
   "id": 33,
   "name": "天生幸运Ⅲ",
   "qz": 0,
   "origin": 31,
   "class": 31
  },
  {
   "id": 34,
   "name": "邪教克星Ⅰ",
   "qz": 10,
   "origin": 34
  },
  {
   "id": 35,
   "name": "邪教克星Ⅱ",
   "qz": 0,
   "origin": 34
  },
  {
   "id": 36,
   "name": "邪教克星Ⅲ",
   "qz": 0,
   "origin": 34
  },
  {
   "id": 37,
   "name": "能言善道Ⅰ",
   "qz": 1,
   "origin": 37,
   "class": 37
  },
  {
   "id": 38,
   "name": "能言善道Ⅱ",
   "qz": 0,
   "origin": 37,
   "class": 37
  },
  {
   "id": 39,
   "name": "能言善道Ⅲ",
   "qz": 0,
   "origin": 37,
   "class": 37
  },
  {
   "id": 55,
   "name": "天生愚钝Ⅰ",
   "qz": 10,
   "origin": 55,
   "gettag": 1
  },
  {
   "id": 56,
   "name": "心思单纯Ⅱ",
   "qz": 0,
   "origin": 55
  },
  {
   "id": 57,
   "name": "大智若愚Ⅲ",
   "qz": 0,
   "origin": 55
  },
  {
   "id": 58,
   "name": "农家子Ⅰ",
   "qz": 10,
   "origin": 58,
   "class": 58
  },
  {
   "id": 59,
   "name": "农家子Ⅱ",
   "qz": 0,
   "origin": 58,
   "class": 58
  },
  {
   "id": 60,
   "name": "农家子Ⅲ",
   "qz": 0,
   "origin": 58,
   "class": 58
  },
  {
   "id": 70,
   "name": "狩猎传承Ⅰ",
   "qz": 10,
   "origin": 70,
   "class": 58
  },
  {
   "id": 71,
   "name": "狩猎传承Ⅱ",
   "qz": 0,
   "origin": 70,
   "class": 58
  },
  {
   "id": 72,
   "name": "狩猎传承Ⅲ",
   "qz": 0,
   "origin": 70,
   "class": 58
  },
  {
   "id": 76,
   "name": "商贾世家Ⅰ",
   "qz": 1,
   "origin": 76,
   "class": 76
  },
  {
   "id": 77,
   "name": "商贾世家Ⅱ",
   "qz": 0,
   "origin": 76,
   "class": 76
  },
  {
   "id": 78,
   "name": "商贾世家Ⅲ",
   "qz": 0,
   "origin": 76,
   "class": 76
  },
  {
   "id": 85,
   "name": "三代矿工Ⅰ",
   "qz": 10,
   "origin": 85,
   "class": 76
  },
  {
   "id": 86,
   "name": "三代矿工Ⅱ",
   "qz": 0,
   "origin": 85,
   "class": 76
  },
  {
   "id": 87,
   "name": "三代矿工Ⅲ",
   "qz": 0,
   "origin": 85,
   "class": 76
  },
  {
   "id": 88,
   "name": "视器为宝Ⅰ",
   "qz": 10,
   "origin": 88
  },
  {
   "id": 89,
   "name": "视器为宝Ⅱ",
   "qz": 0,
   "origin": 88
  },
  {
   "id": 90,
   "name": "视器为宝Ⅲ",
   "qz": 0,
   "origin": 88
  },
  {
   "id": 94,
   "name": "飞毛腿Ⅰ",
   "qz": 5,
   "origin": 94
  },
  {
   "id": 95,
   "name": "飞毛腿Ⅱ",
   "qz": 0,
   "origin": 94
  },
  {
   "id": 96,
   "name": "飞毛腿Ⅲ",
   "qz": 0,
   "origin": 94
  },
  {
   "id": 100,
   "name": "刻苦训练Ⅰ",
   "qz": 10,
   "origin": 100
  },
  {
   "id": 101,
   "name": "刻苦训练Ⅱ",
   "qz": 0,
   "origin": 100
  },
  {
   "id": 102,
   "name": "刻苦训练Ⅲ",
   "qz": 0,
   "origin": 100
  },
  {
   "id": 103,
   "name": "胸怀大志Ⅰ",
   "qz": 10,
   "origin": 103,
   "class": 103
  },
  {
   "id": 104,
   "name": "胸怀大志Ⅱ",
   "qz": 0,
   "origin": 103,
   "class": 103
  },
  {
   "id": 105,
   "name": "胸怀大志Ⅲ",
   "qz": 0,
   "origin": 103,
   "class": 103
  },
  {
   "id": 166,
   "name": "天生福星Ⅰ",
   "qz": 1,
   "origin": 166
  },
  {
   "id": 167,
   "name": "天生福星Ⅱ",
   "qz": 0,
   "origin": 166
  },
  {
   "id": 168,
   "name": "天生福星Ⅲ",
   "qz": 0,
   "origin": 166
  },
  {
   "id": 178,
   "name": "喜静勿动Ⅰ",
   "qz": 10,
   "origin": 178,
   "class": 175
  },
  {
   "id": 179,
   "name": "喜静勿动Ⅱ",
   "qz": 0,
   "origin": 178,
   "class": 175
  },
  {
   "id": 180,
   "name": "喜静勿动Ⅲ",
   "qz": 0,
   "origin": 178,
   "class": 175
  },
  {
   "id": 181,
   "name": "喜出望外Ⅰ",
   "qz": 10,
   "origin": 181,
   "class": 175
  },
  {
   "id": 182,
   "name": "喜出望外Ⅱ",
   "qz": 0,
   "origin": 181,
   "class": 175
  },
  {
   "id": 183,
   "name": "喜出望外Ⅲ",
   "qz": 0,
   "origin": 181,
   "class": 175
  },
  {
   "id": 184,
   "name": "小偷小摸Ⅰ",
   "qz": 10,
   "origin": 184,
   "class": 76,
   "gettag": 1
  },
  {
   "id": 185,
   "name": "小偷小摸Ⅱ",
   "qz": 0,
   "origin": 184,
   "class": 76
  },
  {
   "id": 186,
   "name": "小偷小摸Ⅲ",
   "qz": 0,
   "origin": 184,
   "class": 76
  },
  {
   "id": 199,
   "name": "胆小鬼Ⅰ",
   "qz": 10,
   "origin": 199,
   "class": 103,
   "gettag": 1
  },
  {
   "id": 200,
   "name": "胆小鬼Ⅱ",
   "qz": 0,
   "origin": 199,
   "class": 103
  },
  {
   "id": 201,
   "name": "胆小鬼Ⅲ",
   "qz": 0,
   "origin": 199,
   "class": 103
  },
  {
   "id": 202,
   "name": "擅言蛮语Ⅰ",
   "qz": 10,
   "origin": 202
  },
  {
   "id": 203,
   "name": "擅言蛮语Ⅱ",
   "qz": 0,
   "origin": 202
  },
  {
   "id": 204,
   "name": "擅言蛮语Ⅲ",
   "qz": 0,
   "origin": 202
  },
  {
   "id": 205,
   "name": "正人君子Ⅰ",
   "qz": 10,
   "origin": 205
  },
  {
   "id": 206,
   "name": "正人君子Ⅱ",
   "qz": 0,
   "origin": 205
  },
  {
   "id": 207,
   "name": "正人君子Ⅲ",
   "qz": 0,
   "origin": 205
  },
  {
   "id": 208,
   "name": "幽闭常居Ⅰ",
   "qz": 10,
   "origin": 208
  },
  {
   "id": 209,
   "name": "幽闭常居Ⅱ",
   "qz": 0,
   "origin": 208
  },
  {
   "id": 210,
   "name": "幽闭常居Ⅲ",
   "qz": 0,
   "origin": 208
  },
  {
   "id": 300,
   "name": "擅使兵刃Ⅰ",
   "qz": 10,
   "origin": 300
  },
  {
   "id": 301,
   "name": "擅使兵刃Ⅱ",
   "qz": 0,
   "origin": 300
  },
  {
   "id": 302,
   "name": "武器大师Ⅲ",
   "qz": 0,
   "origin": 300
  },
  {
   "id": 303,
   "name": "养护宝甲Ⅰ",
   "qz": 10,
   "origin": 303
  },
  {
   "id": 304,
   "name": "养护宝甲Ⅱ",
   "qz": 0,
   "origin": 303
  },
  {
   "id": 305,
   "name": "护甲大师Ⅲ",
   "qz": 0,
   "origin": 303
  },
  {
   "id": 306,
   "name": "剑道天赋Ⅰ",
   "qz": 10,
   "origin": 306
  },
  {
   "id": 307,
   "name": "剑道天赋Ⅱ",
   "qz": 0,
   "origin": 306
  },
  {
   "id": 308,
   "name": "剑道天赋Ⅲ",
   "qz": 0,
   "origin": 306
  },
  {
   "id": 309,
   "name": "刀法有悟Ⅰ",
   "qz": 10,
   "origin": 309
  },
  {
   "id": 310,
   "name": "刀法有悟Ⅱ",
   "qz": 0,
   "origin": 309
  },
  {
   "id": 311,
   "name": "刀法有悟Ⅲ",
   "qz": 0,
   "origin": 309
  },
  {
   "id": 312,
   "name": "拳脚有术Ⅰ",
   "qz": 10,
   "origin": 312
  },
  {
   "id": 313,
   "name": "拳脚有术Ⅱ",
   "qz": 0,
   "origin": 312
  },
  {
   "id": 314,
   "name": "拳脚有术Ⅲ",
   "qz": 0,
   "origin": 312
  },
  {
   "id": 315,
   "name": "长兵操使Ⅰ",
   "qz": 10,
   "origin": 315
  },
  {
   "id": 316,
   "name": "长兵操使Ⅱ",
   "qz": 0,
   "origin": 315
  },
  {
   "id": 317,
   "name": "长兵操使Ⅲ",
   "qz": 0,
   "origin": 315
  },
  {
   "id": 318,
   "name": "自幼习武Ⅰ",
   "qz": 1,
   "origin": 318
  },
  {
   "id": 319,
   "name": "自幼习武Ⅱ",
   "qz": 0,
   "origin": 318
  },
  {
   "id": 320,
   "name": "自幼习武Ⅲ",
   "qz": 0,
   "origin": 318
  },
  {
   "id": 321,
   "name": "天生慧根Ⅰ",
   "qz": 10,
   "origin": 321
  },
  {
   "id": 322,
   "name": "天生慧根Ⅱ",
   "qz": 0,
   "origin": 321
  },
  {
   "id": 323,
   "name": "天生慧根Ⅲ",
   "qz": 0,
   "origin": 321
  },
  {
   "id": 324,
   "name": "天性生猛Ⅰ",
   "qz": 10,
   "origin": 324
  },
  {
   "id": 325,
   "name": "天性生猛Ⅱ",
   "qz": 0,
   "origin": 324
  },
  {
   "id": 326,
   "name": "天性生猛Ⅲ",
   "qz": 0,
   "origin": 324
  },
  {
   "id": 327,
   "name": "稳扎稳打Ⅰ",
   "qz": 10,
   "origin": 327
  },
  {
   "id": 328,
   "name": "稳扎稳打Ⅱ",
   "qz": 0,
   "origin": 327
  },
  {
   "id": 329,
   "name": "稳扎稳打Ⅲ",
   "qz": 0,
   "origin": 327
  },
  {
   "id": 330,
   "name": "我心如铁Ⅰ",
   "qz": 10,
   "origin": 330
  },
  {
   "id": 331,
   "name": "我心如铁Ⅱ",
   "qz": 0,
   "origin": 330
  },
  {
   "id": 332,
   "name": "我心如铁Ⅲ",
   "qz": 0,
   "origin": 330
  },
  {
   "id": 333,
   "name": "其势如火Ⅰ",
   "qz": 10,
   "origin": 333
  },
  {
   "id": 334,
   "name": "其势如火Ⅱ",
   "qz": 0,
   "origin": 333
  },
  {
   "id": 335,
   "name": "其势如火Ⅲ",
   "qz": 0,
   "origin": 333
  },
  {
   "id": 336,
   "name": "体质强硬Ⅰ",
   "qz": 10,
   "origin": 336
  },
  {
   "id": 337,
   "name": "体质强硬Ⅱ",
   "qz": 0,
   "origin": 336
  },
  {
   "id": 338,
   "name": "体质强硬Ⅲ",
   "qz": 0,
   "origin": 336
  },
  {
   "id": 339,
   "name": "身法不俗Ⅰ",
   "qz": 10,
   "origin": 339
  },
  {
   "id": 340,
   "name": "身法不俗Ⅱ",
   "qz": 0,
   "origin": 339
  },
  {
   "id": 341,
   "name": "身法不俗Ⅲ",
   "qz": 0,
   "origin": 339
  },
  {
   "id": 342,
   "name": "臂力惊人Ⅰ",
   "qz": 10,
   "origin": 342
  },
  {
   "id": 343,
   "name": "臂力惊人Ⅱ",
   "qz": 0,
   "origin": 342
  },
  {
   "id": 344,
   "name": "臂力惊人Ⅲ",
   "qz": 0,
   "origin": 342
  },
  {
   "id": 345,
   "name": "心静气沉Ⅰ",
   "qz": 10,
   "origin": 345
  },
  {
   "id": 346,
   "name": "心静气沉Ⅱ",
   "qz": 0,
   "origin": 345
  },
  {
   "id": 347,
   "name": "心静气沉Ⅲ",
   "qz": 0,
   "origin": 345
  },
  {
   "id": 348,
   "name": "气血充沛Ⅰ",
   "qz": 10,
   "origin": 348
  },
  {
   "id": 349,
   "name": "气血充沛Ⅱ",
   "qz": 0,
   "origin": 348
  },
  {
   "id": 350,
   "name": "气血充沛Ⅲ",
   "qz": 0,
   "origin": 348
  },
  {
   "id": 351,
   "name": "外练横骨Ⅰ",
   "qz": 10,
   "origin": 351
  },
  {
   "id": 352,
   "name": "外练横骨Ⅱ",
   "qz": 0,
   "origin": 351
  },
  {
   "id": 353,
   "name": "外练横骨Ⅲ",
   "qz": 0,
   "origin": 351
  },
  {
   "id": 357,
   "name": "丹田充盈Ⅰ",
   "qz": 10,
   "origin": 357
  },
  {
   "id": 358,
   "name": "丹田充盈Ⅱ",
   "qz": 0,
   "origin": 357
  },
  {
   "id": 359,
   "name": "丹田充盈Ⅲ",
   "qz": 0,
   "origin": 357
  },
  {
   "id": 360,
   "name": "身轻如燕Ⅰ",
   "qz": 10,
   "origin": 360
  },
  {
   "id": 361,
   "name": "身轻如燕Ⅱ",
   "qz": 0,
   "origin": 360
  },
  {
   "id": 362,
   "name": "身轻如燕Ⅲ",
   "qz": 0,
   "origin": 360
  },
  {
   "id": 363,
   "name": "眼光八方Ⅰ",
   "qz": 10,
   "origin": 363
  },
  {
   "id": 364,
   "name": "眼光八方Ⅱ",
   "qz": 0,
   "origin": 363
  },
  {
   "id": 365,
   "name": "眼光八方Ⅲ",
   "qz": 0,
   "origin": 363
  },
  {
   "id": 366,
   "name": "福大命大Ⅰ",
   "qz": 10,
   "origin": 366
  },
  {
   "id": 367,
   "name": "福大命大Ⅱ",
   "qz": 0,
   "origin": 366
  },
  {
   "id": 368,
   "name": "福大命大Ⅲ",
   "qz": 0,
   "origin": 366
  },
  {
   "id": 372,
   "name": "冲锋陷阵Ⅰ",
   "qz": 10,
   "origin": 372
  },
  {
   "id": 373,
   "name": "冲锋陷阵Ⅱ",
   "qz": 0,
   "origin": 372
  },
  {
   "id": 374,
   "name": "冲锋陷阵Ⅲ",
   "qz": 0,
   "origin": 372
  },
  {
   "id": 375,
   "name": "直击要害Ⅰ",
   "qz": 10,
   "origin": 375
  },
  {
   "id": 376,
   "name": "直击要害Ⅱ",
   "qz": 0,
   "origin": 375
  },
  {
   "id": 377,
   "name": "直击要害Ⅲ",
   "qz": 0,
   "origin": 375
  },
  {
   "id": 378,
   "name": "千锤百炼Ⅰ",
   "qz": 10,
   "origin": 378
  },
  {
   "id": 379,
   "name": "千锤百炼Ⅱ",
   "qz": 0,
   "origin": 378
  },
  {
   "id": 380,
   "name": "千锤百炼Ⅲ",
   "qz": 0,
   "origin": 378
  },
  {
   "id": 381,
   "name": "意念合存Ⅰ",
   "qz": 10,
   "origin": 381
  },
  {
   "id": 382,
   "name": "意念合存Ⅱ",
   "qz": 0,
   "origin": 381
  },
  {
   "id": 383,
   "name": "意念合存Ⅲ",
   "qz": 0,
   "origin": 381
  },
  {
   "id": 384,
   "name": "一臂之力Ⅰ",
   "qz": 10,
   "origin": 384
  },
  {
   "id": 385,
   "name": "一臂之力Ⅱ",
   "qz": 0,
   "origin": 384
  },
  {
   "id": 386,
   "name": "一臂之力Ⅲ",
   "qz": 0,
   "origin": 384
  },
  {
   "id": 387,
   "name": "身法矫健Ⅰ",
   "qz": 10,
   "origin": 387
  },
  {
   "id": 388,
   "name": "身法矫健Ⅱ",
   "qz": 0,
   "origin": 387
  },
  {
   "id": 389,
   "name": "身法矫健Ⅲ",
   "qz": 0,
   "origin": 387
  },
  {
   "id": 390,
   "name": "攻守兼备Ⅰ",
   "qz": 10,
   "origin": 390
  },
  {
   "id": 391,
   "name": "攻守兼备Ⅱ",
   "qz": 0,
   "origin": 390
  },
  {
   "id": 392,
   "name": "攻守兼备Ⅲ",
   "qz": 0,
   "origin": 390
  },
  {
   "id": 393,
   "name": "紧急疗伤Ⅰ",
   "qz": 10,
   "origin": 393
  },
  {
   "id": 394,
   "name": "紧急疗伤Ⅱ",
   "qz": 0,
   "origin": 393
  },
  {
   "id": 395,
   "name": "紧急疗伤Ⅲ",
   "qz": 0,
   "origin": 393
  },
  {
   "id": 396,
   "name": "安全第一Ⅰ",
   "qz": 10,
   "origin": 396
  },
  {
   "id": 397,
   "name": "安全第一Ⅱ",
   "qz": 0,
   "origin": 396
  },
  {
   "id": 398,
   "name": "安全第一Ⅲ",
   "qz": 0,
   "origin": 396
  },
  {
   "id": 405,
   "name": "藏气于身Ⅰ",
   "qz": 10,
   "origin": 405
  },
  {
   "id": 406,
   "name": "藏气于身Ⅱ",
   "qz": 0,
   "origin": 405
  },
  {
   "id": 407,
   "name": "藏气于身Ⅲ",
   "qz": 0,
   "origin": 405
  },
  {
   "id": 408,
   "name": "均衡发展Ⅰ",
   "qz": 10,
   "origin": 408
  },
  {
   "id": 409,
   "name": "均衡发展Ⅱ",
   "qz": 0,
   "origin": 408
  },
  {
   "id": 410,
   "name": "均衡发展Ⅲ",
   "qz": 0,
   "origin": 408
  },
  {
   "id": 411,
   "name": "不近娱色Ⅰ",
   "qz": 10,
   "origin": 411
  },
  {
   "id": 412,
   "name": "不近娱色Ⅱ",
   "qz": 0,
   "origin": 411
  },
  {
   "id": 413,
   "name": "不近娱色Ⅲ",
   "qz": 0,
   "origin": 411
  },
  {
   "id": 414,
   "name": "孤勇者Ⅰ",
   "qz": 10,
   "origin": 414
  },
  {
   "id": 415,
   "name": "孤勇者Ⅱ",
   "qz": 0,
   "origin": 414
  },
  {
   "id": 416,
   "name": "孤勇者Ⅲ",
   "qz": 0,
   "origin": 414
  },
  {
   "id": 417,
   "name": "周旋不止Ⅰ",
   "qz": 10,
   "origin": 417
  },
  {
   "id": 418,
   "name": "周旋不止Ⅱ",
   "qz": 0,
   "origin": 417
  },
  {
   "id": 419,
   "name": "周旋不止Ⅲ",
   "qz": 0,
   "origin": 417
  }
 ]
};
    root.HENGSHAN_TALENT_DATA = Object.freeze({
        candidates: Object.freeze(data.candidates.slice()),
        talents: Object.freeze(data.talents.map(function (talent) { return Object.freeze(talent); }))
    });
})(typeof globalThis !== 'undefined' ? globalThis : window);
