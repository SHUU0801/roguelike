# 元絵の置き場

ここに **`characters.png`** を置く。

職業の並びは上から **ファイター / アサシン / 魔法使い / 僧侶**
（ゲーム側の `warrior` / `rogue` / `mage` / `cleric` に対応）。

1枚絵のままでいい。ラベルや余白が入っていても、
`npm run art` が中身のある塊を探して切り出す。

```bash
npm run art             # 下見。どこを切るか出すだけ
npm run art -- --write  # public/sprites/portraits.png を書き出す
```

背景は透過か白。中間色のグレーだと「絵」と見分けが付かないので避ける。
