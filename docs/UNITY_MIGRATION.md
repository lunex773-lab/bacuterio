# Unity 6 への移行ガイド

この Web 版は、設計書どおり Unity 6（URP）へ移行できるように構成しています。
移行の基本方針は **「シミュレーションはそのまま移植し、描画と UI だけを作り直す」** です。

## 1. 移行しやすくするために守っている約束

| 約束 | 内容 | Unity 側での意味 |
|---|---|---|
| 描画非依存 | `src/core` と `src/simulation` は Three.js も DOM も import しない | `Assets/_Project/Core`・`Simulation` を `UnityEngine` 非依存の asmdef にできる |
| 素朴な型 | クラス＋フィールド＋数値 enum のみ。クロージャ・ジェネリクス・Map の反復順に依存しない | C# の `class` / `enum` / `List<T>` に1対1 |
| 乱数 | `Random.ts`（xoshiro128**）を32bit整数演算だけで実装 | `uint` で同じビット演算を書けば同じ乱数列 |
| 時間 | 固定刻み `dt = 0.25 s`、`SimulationClock` が描画と分離 | `MonoBehaviour.Update` から `SimulationClock.Tick` を呼ぶだけ |
| データ | パラメータは `src/data/*.json`（根拠メタデータ付き） | `ScriptableObject` へ取り込み、または同じ JSON をそのまま読む |
| セーブ | `SaveSystem.ts` の JSON（`format`/`version` 付き、実体は数値配列） | C# から同じファイルを読み書きでき、Web ⇔ Unity でセーブを共有可能 |
| 検証 | `stateHash()` とリプレイ | C# 版で同じハッシュが出ることを移植の合格条件にできる |

## 2. ファイル対応表

| Web (TypeScript) | Unity (C#) の推奨配置 | 備考 |
|---|---|---|
| `core/Random.ts` | `_Project/Core/Random.cs` | `uint` 演算。`Math.imul` → `unchecked(a * b)` |
| `core/SimulationClock.ts` | `_Project/Core/SimulationClock.cs` | `performance.now()` → `Stopwatch` |
| `core/SimulationConfig.ts` + `data/*.json` | `_Project/Core/SimulationConfig.cs` + `_Project/Data/*.asset` | `ParamMeta` を `[Serializable] struct` に |
| `core/EventQueue.ts` | `_Project/Core/EventQueue.cs` | `SimEvent` は `struct` 推奨 |
| `core/SimulationWorld.ts` | `_Project/Core/SimulationWorld.cs` | 各 System の所有者 |
| `simulation/bacteria/*` | `_Project/Simulation/Bacteria/` | `BacteriaSystem.Mechanics` は Burst 化候補 |
| `simulation/phage/*` | `_Project/Simulation/Phage/` | `PhageSystem.Update` は Job/Burst 化の第一候補 |
| `simulation/infection/*` | `_Project/Simulation/Infection/` | |
| `simulation/population/*` | `_Project/Simulation/Population/` | |
| `simulation/environment/*` | `_Project/Simulation/Environment/` | |
| `simulation/spatial/SpatialHash.ts` | `_Project/Simulation/Spatial/` | 配列ベースなので `NativeArray` に置換可 |
| `simulation/CellGeometry.ts` | `_Project/Simulation/CellGeometry.cs` | `out` 引数の static メソッドに |
| `save/SaveSystem.ts` | `_Project/Save/SaveSystem.cs` | `localStorage` → `Application.persistentDataPath` |
| `visualization/*` | `_Project/Visualization/*` | 作り直し（下記） |
| `observation/*` | `_Project/Observation/*`（UI Toolkit） | 作り直し（i18n キーは流用） |
| `i18n/i18n.ts` | Localization パッケージのテーブル | キー名をそのまま使える |
| `tests/simulation.test.ts` | `_Project/Tests/EditMode/` | 同じテストケースを NUnit で |

## 3. 描画の置き換え

| Web | Unity 6 / URP |
|---|---|
| `BacteriaView`（InstancedMesh + 頂点シェーダでカプセルを伸長） | `Graphics.RenderMeshInstanced` + Shader Graph / HLSL。`aShape`/`aInfo` は `MaterialPropertyBlock` かインスタンスバッファへ |
| `CellMaterial` の手続き的な内部表現（核様体・DNA・カプシドの斑点） | 同じノイズ（`ShaderChunks.ts` の hash/fbm/worley）を HLSL に移植 |
| `PhageView`（光点 + 近距離の実寸モデル） | 遠景: VFX Graph か GPU パーティクル、近景: インスタンス描画。`PhageGeometry.ts` の寸法で Blender モデルを作成 |
| `PopulationCloudView` | VFX Graph（ボクセル個数をテクスチャで渡す） |
| `HeroCell` / `HeroPhage` | 通常の GameObject と Animator / Timeline。尾繊維・尾鞘はボーンで |
| `LysisEffects` | VFX Graph。`SimEventType.Lysis` を受けて再生 |
| `PostFX`（Bloom・控えめなDOF・ビネット・粒状ノイズ） | URP Volume（Bloom / Depth of Field / Vignette / Film Grain） |
| `CameraController`（OrbitControls） | Cinemachine（Orbital Follow）。断面は Clipping 用のグローバルシェーダ変数 |

## 4. 数値の一致について

- JS の数値は倍精度です。C# でも **`double` で移植** すれば、同じシード・同じ操作ログで同じ `stateHash()` を目標にできます（`float` にすると一致しません）。
- Burst/Jobs 化で `float` に落とす場合は、ハッシュ一致ではなく統計的妥当性テスト（`statistical validity`）で検証してください（設計書 §10 の考え方）。
- `Math.round` は .NET の既定（偶数丸め）と異なるため、`Math.Floor(x + 0.5)` を使います。

## 5. 推奨する移植順

1. `Random` → `SimulationConfig`（JSON 読込）→ `SimulationWorld` と各 System を C# に移植
2. `tests/simulation.test.ts` を EditMode テストへ移植し、Web 版で保存したセーブファイルを読み込んで `stateHash` が一致することを確認
3. 細菌のインスタンス描画とカメラだけで最小の観察画面を作る
4. ファージの光点・近景モデル、イベント駆動の溶菌演出
5. 細胞内部スケール、UI、セーブ／ロード
6. プロファイリングして `PhageSystem` と `BacteriaSystem.Mechanics` を Jobs/Burst 化
