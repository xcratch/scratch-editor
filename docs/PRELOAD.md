# 先読み拡張機能（preload）

先読み拡張機能は、editor と一緒に配る拡張機能のコピー（ミラー）です。次の場合でも、作品で使っている拡張機能を読み込めるようにします。

- 学校のフィルタなどで、拡張機能の配布元（例: `*.github.io`）につながらない
- PWA としてインストールしていて、ネットにつながらない

先読みするセットは **editor のビルド後に差し替えられます**。どの editor でもビルドし直さずに自分用のセットを持てます（例: edu.yengawa.com で配布する editor、Xcratch Workshop のセッションごとのセット）。

## しくみ

```
<editor>/
  index.html ...
  preload/
    preload.json                  # manifest（既定のセット）
    files/<host>/<path>           # 元URLのホスト・パスを保ったミラー
```

1. editor は起動時に manifest を読みます（[preload-manifest.js](../packages/scratch-gui/src/lib/preload-manifest.js)）
2. manifest にある拡張機能は、拡張機能ライブラリの「先読み済み」カテゴリに出ます
3. 拡張機能を読み込むとき（作品を開く、ライブラリで選ぶ、`?extension=`）、まず**元URL**を試します。読めなかったら**ミラー**を読みます（[extension-manager.js](../packages/scratch-vm/src/extension-support/extension-manager.js) `loadExtensionURL`）
4. 作品には元URLが保存されます。ミラーから読んだ場合も同じなので、作品は他の環境でも開けます

### manifest の選び方

| URL パラメータ | 読む manifest |
|---|---|
| なし | ページから見た `./preload/preload.json`。無ければ先読みしない |
| `?preload=<URL>` | 指定した URL（相対ならページ基準。他のホストでもよいが CORS が必要） |
| `?preload=none` | 先読みしない |

## セットの作り方

[scripts/preload-mirror.mjs](../packages/scratch-gui/scripts/preload-mirror.mjs) で、拡張機能のURLの一覧（rules）から manifest とミラーを作ります。このスクリプトは Node.js 18 以上の組み込み機能だけで動くので、ファイルをコピーすればこのリポジトリの外でも使えます。

```json
{
    "approved": [
        "https://yokobond.github.io/xcx-gai/dist/gai.mjs",
        "https://yokobond.github.io/xcx-tf-knn/dist/tfknn-entry.mjs"
    ]
}
```

```bash
node packages/scratch-gui/scripts/preload-mirror.mjs --rules preload-rules.json --out packages/scratch-gui/build/preload --origin-timeout 5000
```

| オプション | 説明 |
|---|---|
| `--rules <file>` | rules ファイル（`{"approved": [...]}` または URL の配列） |
| `--out <dir>` | 出力先。editor の隣に置くなら `<editor>/preload` |
| `--name <name>` | セットの名前（既定はディレクトリ名） |
| `--origin-timeout <ms>` | editor が元URLを待つ時間。省略すると 30000。フィルタで元URLが応答しない環境では 3000〜5000 にすると、ミラーに早く切り替わる |
| `--fetch-timeout <ms>` | ダウンロード1件のタイムアウト（既定 30000） |
| `--insecure` | TLS 証明書を検証しない（ローカルの開発サーバー用） |

- モジュール内の相対参照（`import ... from './x.mjs'`、`import('./x.mjs')`、`new URL('./x', import.meta.url)`、`blockClassURL`）は再帰的にミラーされます
- 相対でない参照（CDN の URL など）はミラーできないので警告が出ます。その拡張機能は、フィルタ環境やオフラインでは動かない可能性があります
- 読めなかった拡張機能は警告を出して manifest から外します
- 出力先の `preload.json` と `files/` だけを書き換えるので、`preload/sets/<name>/` のように別のセットを同じディレクトリの下に置けます

### manifest の形式（version 1）

```json
{
  "version": 1,
  "name": "default",
  "originTimeout": 5000,
  "files": [
    "files/yokobond.github.io/xcx-tf-knn/dist/tfknn-entry.mjs",
    "files/yokobond.github.io/xcx-tf-knn/dist/tfknn.mjs"
  ],
  "extensions": [
    {
      "url": "https://yokobond.github.io/xcx-tf-knn/dist/tfknn-entry.mjs",
      "extensionURL": "https://yokobond.github.io/xcx-tf-knn/dist/tfknn.mjs",
      "entry": "files/yokobond.github.io/xcx-tf-knn/dist/tfknn-entry.mjs",
      "module": "files/yokobond.github.io/xcx-tf-knn/dist/tfknn.mjs"
    }
  ]
}
```

| キー | 説明 |
|---|---|
| `extensions[].url` | rules に書いた元URL |
| `extensions[].extensionURL` | 作品に保存される URL（blockClass を含むモジュールの元URL）。entry だけのモジュールでは `url` と違う。省略すると `url` |
| `extensions[].entry` | `url` のミラー。manifest の URL を基準にした相対パスか絶対 URL |
| `extensions[].module` | `extensionURL` のミラー。省略すると `entry` |
| `extensions[].aliases` | 同じ拡張機能を指す他の URL（任意） |
| `extensions[].originTimeout` / `originTimeout` | 元URLを待つ時間 [ms]（任意） |
| `files` | ミラーした全ファイル。PWA のオフライン用キャッシュの対象 |

editor は `url`、`extensionURL`、`aliases` のどれかに一致する URL を読み込むときに、ミラーを使います。

## PWA とオフライン

ビルド後に置いた `preload/` は、ビルド時に作る service worker の precache には入りません。そこで次のようにしています。

- editor（ページ）は manifest を読んだ後、manifest と `files` の全ファイルをキャッシュ `xcratch-preload` に入れます（[preload-cache.js](../packages/scratch-gui/src/lib/preload-cache.js)）。manifest が変わっていれば全部取り直し、どの manifest からも使われなくなったファイルは消します。90日使われていない manifest も消します
- service worker（[service-worker.js](../packages/scratch-gui/src/service-worker.js)）は、`xcratch-preload` にある URL へのリクエストを network-first で返します。オフラインならキャッシュから返します
- この処理は service worker が動いているときだけ行います。開発サーバー（localhost / ポート 8601）では service worker を使わないので、オンラインでだけ動きます

インストールした PWA は `?preload=` なしで起動するので、既定の `./preload/preload.json` を使います。`?preload=` で一度開いたセットもキャッシュに残るので、同じ URL で開けばオフラインでも使えます。

## 配布の手順

### xcratch.github.io

ビルドした後に、rules からミラーを作って `editor/preload/` に置きます。セットを変えるときは、この手順だけをやり直せばよく、ビルドし直す必要はありません。

```bash
npm run build
node packages/scratch-gui/scripts/preload-mirror.mjs --rules ../xcratch.github.io/scripts/preload-rules.json --out packages/scratch-gui/build/preload
```

### 別のドメインで配布する editor（例: edu.yengawa.com）

ビルド済みの editor を置き、自分の rules で `preload/` を作ります。ミラーは editor と同じドメインから配られるので、`github.io` を禁止するフィルタがあっても読めます。

### Xcratch Workshop

workshop 用の editor（`workshop.html`）は空の `preload/` のまま配ります。セッションごとのセットは workshop のサーバーで作り、iframe の URL で渡します。

- サーバーはセッションごとの rules からミラーを作り、例えば `/workshop/store/ws/<slug>/sessions/<id>/preload/preload.json` で配る
- `workshop.html` の URL に `&preload=<encodeURIComponent(manifest の URL)>` を付ける

（workshop 側の実装は xcratch-workshop リポジトリで行います）
