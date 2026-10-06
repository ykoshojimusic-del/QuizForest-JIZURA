# QuizForest-JIZURA — Phase 0 ベースライン

確認日：2026-10-06（JST）。以下はPhase 0完了時点（Phase 0.5チェックポイント作成前）の記録。QF機能の実装は未着手。

## リポジトリとベース

- upstream： https://github.com/hirazisora/JIZURA
- fork： https://github.com/ykoshojimusic-del/QuizForest-JIZURA （public、mainのみfork）
- clone先： Macの作業フォルダ `QuizForest-JIZURA`
- origin： `https://github.com/ykoshojimusic-del/QuizForest-JIZURA.git`
- upstream remote： `https://github.com/hirazisora/JIZURA.git`
- 開発branch： `qf-mvp-lite` （ローカルのみ）
- 承認済みベースSHA： `c05b20d0f40c9246423fb222a6716921d207fd7d`
- HEAD・origin/main・upstream/mainはいずれも上記SHAと一致。
- 作業開始時のupstream mainも一致しており、未承認の更新を取り込んでいない。
- ベースcommit： `Merge help menu and manual reader into develop`
- 新しいcommit・pushは実施していない。

## ビルド・起動

既存の正式な処理を使用した。

```sh
python3 -B build.py
python3 -B preview_server.py
```

`-B`はPythonキャッシュの作成を抑える実行オプション。ビルド処理そのものは変更していない。

- Python：Mac既存のPython 3.9.6。
- 日本語版 `index.html`：成功、ビルド出力表示 4638891 bytes。
- 英語版 `en/index.html`：成功、ビルド出力表示 4665394 bytes。
- ビルド後のtrackedファイルのGit差分：なし。
- 起動URL： http://127.0.0.1:8765/
- ページタイトル： `【qf-mvp-lite】字面一 JIZURA ONE STOP EDITION`
- Codex内ブラウザーで入力、プレビュー、おまかせ、再生／停止、透過PNG出力の完了表示を確認。
- ローカルサーバーは確認終了時点で起動したまま。再起動時は上記コマンドを作業フォルダで実行する。

## 既存テスト

新しい依存のインストールは行っていない。Codexに既にあるNode 24.19.0／Playwrightを利用した。

| テスト | 結果 | 確認内容 |
|---|---|---|
| `dev/lyric_test.js` | PASS | 歌詞解析、LRC、グループ、強調等 |
| `dev/media_test.js` | PASS | 素材配置、タイミング、動画ループ等 |
| `dev/lyric_avoid_center_test.cjs` | PASS（ja/en） | 中央回避、前景あり／なし、複数seed、UI同期、Undo |
| `dev/project_file_test.cjs` | PASS（ja/en） | 画像／動画／音声／フォントの保存、別コンテキストで復元、reload、破損ファイル拒否、旧JSON、新規プロジェクト、音声削除のUndo/Redo |
| `dev/themes_test.cjs` | PASS（ja/en） | 16テーマ、各言語384回の候補検証、おまかせ、Undo/Redo、保存 |
| `dev/export_menu_test.cjs` | PASS（ja/en） | 実際のMP4／通常PNG／透過PNG ZIP出力、出力ダイアログ、設定同期 |

ブラウザーテストはWindows Edgeの実行パスを固定している。また、保存テストにはWindows Arialのパスが固定されている。そのため、リポジトリ外の一時preloadで実行時だけMac ChromeとMac Arialへ読み替えた。テストファイルやアプリの内容は変更していない。テストのスクリーンショット・ダウンロードもリポジトリ外へ保存した。

## 最低限の8機能

| 機能 | 確認結果 |
|---|---|
| 歌詞入力 | 日本語2行をUI入力し、行／カットへ反映。歌詞解析テストもPASS |
| 曲読み込み | 試験用WAVを読み込み、保存・復元できた |
| おまかせ | 実際のボタンから設定・プレビューが変化。テーマテストもPASS |
| 画像／動画素材 | 試験用SVGとWebMを読み込み、素材入りプロジェクトを保存・復元できた |
| 中央回避 | 既存テストPASS。下記の既存仕様の例外あり |
| プロジェクト保存 | `.jizuraichi`を出力し、別コンテキストとreloadで素材・音声・設定を復元できた |
| Undo/Redo | テーマ変更と音声削除／復元で確認できた |
| 透過PNG連番 | 既存テストPASSに加え、日本語2秒・48枚のZIPを実際に出力・展開・画素検査できた |

追加の透過PNG検証は320×180、24fps、2秒。`神さま1番アイス`と`ベースライン確認`という短い試験入力を使用した。48枚すべてに透明画素と可視画素があり、合計透明画素2,653,282、可視画素111,518、ZIP 462,288 bytes。ZIPのCRCも検証した。ページ実行エラーはなし。

実曲「神さま1番アイス」の45秒制作テスト、Final Cut Proでの合成確認は今回のPhase 0では実施していない。今回の素材は試験用であり、実MVの完成確認ではない。

## ベースライン問題・既存仕様の制約

今回選んだテスト・操作の範囲では、作業を止めるアプリの再現不具合は見つからなかった。全ケースの無不具合を意味しない。

1. **テスト環境の可搬性**：既存ブラウザーテストのWindows Edge／Arial固定パスにより、Macではそのまま実行できない。今回は実行環境だけを読み替えて確認した。修正は未実施。
2. **中央回避の既存仕様**：`autoPlacement`が必要。中央領域は正規化座標 `{x:0.32,y:0.30,w:0.36,h:0.40}`。`*強調*`歌詞は中央回避の対象外。大きい文字領域には、中央矩形全体との非重複より弱い扱いがある。キャラクター／顔の認識や、アニメーション全画素の非重複保証はない。これは既存仕様であり、新たな不具合として判定していない。
3. **透過PNGテストの範囲**：既存出力テストは0.15秒・64×64のため、出力された5枚は文字出現前の全面透明だった。追加の2秒検証で可視文字と透過を確認した。
4. **ZIPのサイズ制約（ソース確認）**：既存ZIP writerは32bitサイズ／offset、16bit件数で、ZIP64や上限チェックがない。巨大出力での破損再現は行っていない。長尺や大容量出力の保証は今回の確認対象外。
5. **確認ツールの制約**：Codex内ブラウザーでは透過PNGの「完成 8.0MB」表示まで確認したが、downloadイベントの取得がtimeoutした。独立したChromeテストで実ファイルを取得して画素検査した。アプリの出力失敗とは判定していない。

## 検証資料

以下の検証資料はリポジトリ外にローカル保存した。この記録のcommitには含めない。

- `artifacts/fork-created.png`：GitHub fork作成後の画面
- `artifacts/local-preview.png`：ローカルUIプレビュー
- `artifacts/phase0-japanese-alpha.zip`：追加確認の日本語透過PNG連番
- `artifacts/alpha-visible-frame.png`：可視文字を含む透過PNGの1枚
- `artifacts/alpha-inspection.json`：PNG画素検査結果
- `mac-test-env.cjs`：今回のみのテスト実行互換preload
- `alpha-smoke.cjs`：今回のみの追加出力検証スクリプト

Phase 0ではこのMarkdown記録のみ追加し、QFファイルの作成、既存ソース編集、依存追加、commit、pushは行っていない。
