; PX-65 の共通定義(モニターと BASIC の両方が .include する)
;
; ここにあるアドレスと番号は、ROM の外のプログラムからも使ってよい(今後も変えない)。

; ---- I/O ----
KEY_ROW    = $8000
KEY_COL    = $8001
LCD_ANN    = $8002
LCD_CTRL   = $8003
TIMER_CTRL = $8010
BEEP       = $8020
TAPE_DATA  = $8030
TAPE_CTRL  = $8031

TAPE_STOP  = $00            ; TAPE_CTRL に書くコマンド
TAPE_PLAY  = $01
TAPE_REC   = $02
TAPE_APPEND = $03
TAPE_CANCEL = $04            ; 録音をやめ、録音前の中身に戻す
TAPE_FULL  = $20            ; TAPE_CTRL を読んだときのビット: 録音中に、いっぱいで書けなかった

ANN_BUSY   = $01            ; LCD_ANN のビット
ANN_SHIFT  = $02
ANN_CAPS   = $04
ANN_DEG    = $08
ANN_RAD    = $10
ANN_RUN    = $20
ANN_PRO    = $40
ANN_LOW    = $80

VRAM       = $0400          ; 96バイト × 4ページ
COLS       = 16
ROWS       = 4

; ---- キーコード(GETKEY が返す値) ----
K_DEL      = $08
K_CLS      = $0C            ; CHROUT に渡すと画面を消す
K_RET      = $0D
K_LEFT     = $11
K_RIGHT    = $12
K_UP       = $13
K_DOWN     = $14

; ---- ゼロページ(モニターが使う $E0-$FF のうち、外から読んでよいもの) ----
cur_x      = $EE            ; カーソルの桁(0-15。16は「次の文字で改行」)
cur_y      = $EF            ; カーソルの行(0-3)
ticks      = $F2            ; 2 タイマー割り込みの回数(64Hz)

; ---- 入力行 ----
LINEBUF    = $0300          ; 64 GETLINE が読んだ行
HISTBUF    = $0340          ; 64 直前に入力した行
LINEMAX    = 58             ; 1行の最大文字数
LINELEN    = $0250          ; LINEBUF の文字数
HISTLEN    = $0251

; ---- テープの読み書き(BIOS_TSAVE, BIOS_TFIND, BIOS_TLOAD に渡す値) ----
T_TYPE     = $02A0          ; 種類
T_NAME     = $02A1          ; 8 名前(足りない分は空白)
T_START    = $02A9          ; 2 開始番地
T_LEN      = $02AB          ; 2 長さ

TT_MEM     = $01            ; T_TYPE: メモリ(モニターの W)
TT_BASIC   = $02            ; T_TYPE: BASIC のプログラム

TE_NOTAPE  = 1              ; テープのエラー(C=1 のときの A)
TE_NOTFOUND = 2
TE_BAD     = 3
TE_FULL    = 4              ; 保存: テープがいっぱい(テープは保存前のまま)

; ---- BIOS のジャンプテーブル ----
BIOS_CHROUT    = $FF00          ; A の文字を出力。A, X, Y を保存
BIOS_GETKEY    = $FF03          ; キーを待つ -> A。X, Y を保存
BIOS_KEYCHK    = $FF06          ; キーがあれば C=1, A。X, Y を保存
BIOS_GETLINE   = $FF09          ; 1行入力 -> LINEBUF, LINELEN。A, X を壊す
BIOS_PRHEX     = $FF0C          ; A を16進数2桁で出力
BIOS_PRINT     = $FF0F          ; JSR の後ろの文字列(0終わり)を出力
BIOS_BEEP      = $FF12          ; A=高さ X=長さ。A, X, Y を壊す
BIOS_CLS       = $FF15          ; 画面を消す。A, X を壊す
BIOS_LOCATE    = $FF18          ; X=桁 Y=行
BIOS_MONITOR   = $FF1B          ; モニターに戻ってレジスタを表示
BIOS_GETLINE_ED= $FF1E          ; LINEBUF の LINELEN 文字を表示してから入力を続ける
BIOS_MONENTER  = $FF21          ; モニターのプロンプトに入る(戻らない)
BIOS_TSAVE     = $FF24          ; T_* のブロックをテープの最後に足す
BIOS_TFIND     = $FF27          ; A=0 で先頭から、A=1 で続きから、次のブロックの見出しを T_* に読む
BIOS_TLOAD     = $FF2A          ; BIOS_TFIND で見つけたブロックのデータを T_START から読む
BIOS_CUROFF    = $FF2D          ; 点滅中のカーソルを消す(入力を途中でやめたとき)

; $02C6-$02FF は BASIC が使う

; ---- RAM ベクタ(割り込みの処理の番地。書き換えてよい) ----
IRQVEC     = $02C0
BRKVEC     = $02C2
NMIVEC     = $02C4

; ---- BASIC の入口(BASIC の ROM の先頭) ----
BASIC_COLD = $A000
BASIC_WARM = $A003         ; C=0 リセットから(変数を消す)、C=1 モニターの Q から(変数を残す)
BASIC_SIG  = $A006          ; "BASIC" があれば BASIC が入っている
