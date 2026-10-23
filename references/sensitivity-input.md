# sensitivity.js 輸入格式

```json
{
  "k": 3,
  "criteria": [
    { "id": "C1", "name": "使用者價值", "weight": 4, "rank": 1 },
    { "id": "C2", "name": "可行性", "weight": 3, "rank": 2 },
    { "id": "C3", "name": "學習價值", "weight": 2, "rank": 3 },
    { "id": "C4", "name": "展示效果", "weight": 1, "rank": 4 }
  ],
  "candidates": [
    { "id": "P1", "name": "記帳小幫手", "scores": { "C1": 5, "C2": 3, "C3": 4, "C4": 4 } },
    { "id": "P3", "name": "讀書計時器", "scores": { "C1": [3, 4, 4], "C2": 3, "C3": 4, "C4": 3 } }
  ],
  "options": {
    "mode": "weighted",
    "runs": 2000,
    "sigma": 0.2,
    "seed": 42,
    "tieDelta": 0.1,
    "oatFactor": 0.2,
    "stableAt": 0.8,
    "edgeAt": 0.3
  }
}
```

## 欄位

| 欄位 | 必填 | 說明 |
|---|---|---|
| `k` | 是 | 最後要選幾個 |
| `criteria[].id` | 是 | 評分條件代號 |
| `criteria[].weight` | 加權模式必填 | 原始權重，不必加總為 1，腳本會自動正規化 |
| `criteria[].rank` | 否 | 重要性名次（1 最重要）。全部條件都有填時，才會比較 rank-sum、ROC、名次倒數 |
| `candidates[].scores` | 是 | 每條條件的分數。單一數字＝有把握；`[下限, 最可能, 上限]`＝不確定，蒙地卡羅會在區間內依三角分布抽樣 |
| `options.mode` | 否 | `weighted`（預設）或 `lexicographic`（字典序：依 `criteria` 陣列順序比較，分差小於 `tieDelta` 才比下一條；只擾動分數，不擾動權重） |
| `options.runs` | 否 | 蒙地卡羅次數，預設 2000 |
| `options.sigma` | 否 | 權重擾動幅度（對數常態），預設 0.2，約等於權重上下浮動 20% |
| `options.seed` | 否 | 亂數種子，固定後結果可重現 |
| `options.tieDelta` | 否 | 平手門檻 δ |
| `options.oatFactor` | 否 | 單一權重擾動的幅度，預設 0.2 |
| `options.stableAt`／`edgeAt` | 否 | 分級門檻，預設 80%／30% |

## 混合偏好結構（門檻＋加權）

腳本只處理純加權與純字典序。若規格是「前幾條設門檻、其餘加權」，先把未過門檻的候選拿掉，再把門檻條件的權重設為 0（或不列入 `criteria`），用加權模式跑。

## 兩個目標（外部分數＋自己的偏好）

分別跑兩次（各自一組 `criteria`），再依凍結規格的合併方式解讀。若規格是加權合併，也可以把兩組條件放進同一個 `criteria`，權重乘上合併比例。

## 輸出

- 基準排名（含平手標記）
- 單一權重 ±20% 時前 k 名是否改變
- 翻轉點：單一權重放大或縮小到幾倍時，前 k 名開始改變；±30% 內就翻轉的會標為「敏感」
- 換加權方法：等權重、rank-sum、ROC、名次倒數
- 蒙地卡羅：每個候選的前 k 名入選率、平均名次、名次 90% 區間、分級，以及最常出現的前 k 名組合
