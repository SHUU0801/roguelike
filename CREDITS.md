# 素材のクレジット

このゲームで使っている絵・音・フォントの出所とライセンスを記録する。
**素材を足したら、必ずここに1行足すこと。**

CC0 のものは帰属表示の義務が無いが、後から素材を入れ替えるときに
「これはどこから来たのか」が分からなくなるので、義務の有無にかかわらず書く。

---

## 絵

| 素材 | 出所 | ライセンス | 帰属表示 | 使っている場所 |
| --- | --- | --- | --- | --- |
| `public/sprites/tiles.png` | 自作（`tools/make-sprites.mjs` が生成） | このリポジトリと同じ | 不要 | 盤面すべて |

### 入れ替える予定のもの

`public/sprites/tiles.png` は**仮の絵**。
本物の素材に差し替えるときは、同じ並び順（`src/shared/sprites.ts` の `SPRITE_INDEX`）で
16×16 のタイルを並べた PNG を同じ場所に置く。

差し替え候補として調べたもの:

| 素材 | ライセンス | 注意 |
| --- | --- | --- |
| [0x72 DungeonTileset II](https://0x72.itch.io/dungeontileset-ii) | **CC0 1.0** | 帰属表示不要・商用可。16×16。攻撃と死亡のアニメーションは含まれない |
| [Bitcrawl (aamatniekss)](https://aamatniekss.itch.io/bitcrawl-free-pixelart-assets) | 独自 | 商用可だが CC0 ではない。再配布不可。**生成 AI への利用が禁止** |
| [Free Pixel Dungeon Tileset (Kettoman)](https://kettoman.itch.io/free-pixel-dungeon-tileset-16x16) | 独自 | 商用可・再配布不可。キャラクターは含まれない |
| [Dungeon Tileset (Calciumtrice)](https://opengameart.org/content/dungeon-tileset-1) | **CC BY 3.0** | **帰属表示が必須** |

---

## 守ること

1. **CC0 以外を入れたら、上の表に帰属表示の文言を書く。**
   CC BY のものは、ゲーム内のどこか（タイトル画面か設定画面）にも表示する必要がある
2. **AI でスプライトを生成するなら、参考に食わせる素材を選ぶ。**
   Bitcrawl のように「生成 AI への利用禁止」を明記した素材がある。CC0 以外を参照にしない
3. **公開前にもう一度ライセンスを確認する。**
   ダウンロードページの表記は変わることがある
