; PX-65 BASIC
;
;   node tools/rom.js        # rom/basic.s とモニターを合わせて rom/px65.bin を作る
;
; 仕様と使い方は docs/basic.md を参照。ROM の $A000-$DFFF に置く。
; モニターの BIOS(px65.inc の BIOS_*)を使う。
;
; ファイル:
;   basic.s        このファイル。メモリの割り当て、入口、ほかのファイルの読み込み
;   basic_fp.s     浮動小数点の四則演算、比較、変換
;   basic_math.s   数学関数(SQR、三角関数、指数、対数、べき乗、乱数)
;   basic_main.s   入力、トークン化、プログラムの保存、実行の中心、エラー
;   basic_expr.s   式、変数、配列、関数
;   basic_str.s    文字列とガーベジコレクション
;   basic_stmt.s   命令
;   basic_io.s     グラフィック、音、テープ
;   basic_const.s  浮動小数点の定数(tools/mkfpconst.js が生成)

        .include "px65.inc"

; ===================================================================
; ゼロページ($80-$DF)
; ===================================================================

; ---- 浮動小数点 ----
; FAC(浮動小数点アキュムレーター)と ARG。指数、仮数4バイト、符号($00/$80)、
; 仮数の下に続く1バイト(丸め用)。値 = 0.1mmm…(2進) × 2^(指数-128)、指数0は値0
fac_e      = $80
fac_m1     = $81
fac_m2     = $82
fac_m3     = $83
fac_m4     = $84
fac_s      = $85
fac_x      = $86
arg_e      = $87
arg_m1     = $88
arg_m2     = $89
arg_m3     = $8A
arg_m4     = $8B
arg_s      = $8C
arg_x      = $8D
ft0        = $8E            ; 浮動小数点の計算用(ft0-ft9)
ft1        = $8F
ft2        = $90
ft3        = $91
ft4        = $92
ft5        = $93
ft6        = $94
ft7        = $95
ft8        = $96
ft9        = $97

; ---- インタプリタ ----
txtptr     = $98            ; 2 いま読んでいるプログラムの位置
curlin     = $9A            ; 2 実行中の行番号($FFFF なら直接実行)
valtyp     = $9C            ; 式の型: 0 数、$FF 文字列
varptr     = $9D            ; 2 変数の値の番地
varnam     = $9F            ; 2 変数の名前
vartab     = $A1            ; 2 単純変数の始まり(プログラムの終わり)
arytab     = $A3            ; 2 配列の始まり
strend     = $A5            ; 2 配列の終わり(ここから上が空き)
fretop     = $A7            ; 2 文字列領域の下端(ここから STRTOP の手前までが文字列)
oldlin     = $A9            ; 2 CONT で続ける行番号
oldtxt     = $AB            ; 2 CONT で続ける位置
datptr     = $AD            ; 2 次に READ する DATA の位置
index1     = $AF            ; 2 汎用ポインター
index2     = $B1            ; 2
lowtr      = $B3            ; 2 行を探した結果
linnum     = $B5            ; 2 行番号や16ビット整数
forpnt     = $B7            ; 2 FOR の変数の番地
temppt     = $B9            ; 一時文字列の数
dest       = $BA            ; 2 転送先
srcp       = $BC            ; 2 転送元
movlen     = $BE            ; 2 転送の長さ
bt0        = $C0            ; 汎用(bt0-bt7)
bt1        = $C1
bt2        = $C2
bt3        = $C3
bt4        = $C4
bt5        = $C5
bt6        = $C6
bt7        = $C7
fptr       = $C8            ; 2 浮動小数点の読み書きのポインター
fin_dexp   = $CA            ; 数の読み書き: 10進の指数
fin_pt     = $CB            ; 小数点を見た
fin_neg    = $CC            ; 負
fin_nd     = $CD            ; 読んだ桁数
fin_ev     = $CE            ; 指数部の値
fin_eneg   = $CF            ; 指数部が負
dimflg     = $D0            ; DIM の中なら1
subcnt     = $D1            ; 添字の数
strp       = $D2            ; 2 文字列のポインター
strp2      = $D4            ; 2
gcp        = $D6            ; 2 ガーベジコレクション用
gclim      = $D8            ; 2
gcbest     = $DA            ; 2
gcnew      = $DC            ; 2
errnum     = $DE            ; エラーの番号
listrow    = $DF            ; LIST の表示行数

; ===================================================================
; ワークエリア($0380-$03FF)
; ===================================================================
tempst     = $0380          ; 24 一時文字列の記述子(3バイト × 8)
TEMPMAX    = 8
fbuffr     = $0398          ; 16 数を文字列にしたもの
fodig      = $03A8          ; 9 数を文字列にするときの各桁
rndseed    = $03B1          ; 4 乱数の種
rndlast    = $03B5          ; 5 直前の乱数
angmode    = $03BA          ; 0 ラジアン、1 度
bmagic     = $03BB          ; 2 ウォームスタートの目印
brkflag    = $03BD          ; BREAK が押された
bstate     = $03BE          ; 0 入力待ち、1 実行中、2 INPUT、3 CALL、4 C> で入力待ち
framesp    = $03BF          ; FOR/GOSUB の積み上げの上端(文の始めのスタックポインター)
monnmi     = $03C0          ; 2 モニターの NMI 処理の番地
fpt1       = $03C2          ; 5 浮動小数点の一時置き場
fpt2       = $03C7          ; 5
fpt3       = $03CC          ; 5
fpt4       = $03D1          ; 5
contok     = $03D6          ; CONT できるなら1
fo_e       = $03D7          ; 数の表示: 小数点の位置
fo_nd      = $03D8          ; 数の表示: 桁数
poly_n     = $03D9          ; 多項式: 残りの係数の数
poly_p     = $03DA          ; 2 多項式: 係数の番地
gcflag     = $03DC          ; ガーベジコレクションの段階
datlin     = $03DD          ; 2 DATA の行番号(エラー表示用)
grmode     = $03DF          ; PSET などのモード
pf_ret     = $03E0          ; 2 push_fac / pop_arg の戻り先
ptype      = $03E2          ; pop_arg で戻した値の型
dimbuf_lo  = $03E3          ; 8 配列を作るときの各次元の大きさ
dimbuf_hi  = $03EB          ; 8
MAXDIM     = 8
; $03F3-$03FF は basic_str.s、basic_stmt.s が使う

; ---- $02C6-$02FF(モニターのワークエリアのうち BASIC が使う部分) ----
fpt5       = $02C6          ; 5 浮動小数点の一時置き場(多項式)
fpt6       = $02CB          ; 5
fpt7       = $02D0          ; 5
exp_n      = $02D5          ; EXP、LN: 2 のべき
sin_q      = $02D6          ; SIN: 象限
atn_s      = $02D7          ; ATN: 符号
trig_s     = $02D7          ; SIN、COS、TAN: 引数の符号(ATN とは同時に使わない)
atn_f      = $02D8          ; ATN: 変換の印
pow_n      = $02D9          ; 2 べき乗: 指数
gx0        = $02DB          ; 2 グラフィック: 座標(gx0, gy0, gx1, gy1 の順に並べる)
gy0        = $02DD          ; 2
gx1        = $02DF          ; 2
gy1        = $02E1          ; 2
gdx        = $02E3          ; 2
gdy        = $02E5          ; 2(gdx の2バイト後ろ)
gsx        = $02E7
gsy        = $02E8
gerr       = $02E9          ; 2
bp_half    = $02EB          ; 2 BEEP: 半周期の待ち
bp_cnt     = $02ED          ; 2 BEEP: 半周期の数
bp_lvl     = $02EF          ; BEEP: 出力
tname      = $02F0          ; 8 テープの名前
calcmode   = $02F8          ; 1 なら計算モード(CALC。プロンプトが C>)
fin_dexph  = $02F9          ; 数を読むとき: 10進の指数(fin_dexp)の上位バイト
fin_evh    = $02FA          ; 数を読むとき: 指数部の値(fin_ev)の上位バイト
val_ptr    = $02FB          ; 2 VAL が一時的に0にした番地(上位が0なら、していない)。エラーで抜けても戻すため
; $02FD-$02FF は空き

; RENUM はグラフィックと同時には動かないので、gx0-gerr と同じ場所を使う
rn_new     = $02DB          ; 2 新しい開始番号
rn_inc     = $02DD          ; 2 増分
rn_old     = $02DF          ; 2 元の開始番号
rn_grow    = $02E1          ; 2 行が伸びる分の合計(下調べ)
rn_cur     = $02E3          ; 2 振り直した行の番号
rn_first   = $02E5          ; 1 なら次が振り直す最初の行
rn_mode    = $02E6          ; 0 下調べ、1 書き換える
rn_ref     = $02E7          ; 行番号の前のトークン
rn_olen    = $02E8          ; 元の行番号の桁数(参照)
rn_nlen    = $02E9          ; 新しい行番号の桁数
; RENUM は BEEP、テープとも同時には動かないので、bp_half-tname も使う
rn_cnt     = $02EB          ; 2 振り直す行の数
rn_tab     = $02ED          ; 2 元の番号の表の始め
rn_dst0    = $02F0          ; 2 参照の数字を書き始めた位置
rn_val     = $02F2          ; 2 参照の新しい番号
rn_lnew    = $02F4          ; 2 いま読んでいる行の新しい番号
rn_quiet   = $02F6          ; 1 ならない行への参照を知らせない

MEMSIZ     = $8000          ; RAM の上端 + 1
STRTOP     = $7FFF          ; 文字列領域の上端 + 1。$7FFF は VAL が文字列の直後を一時的に0にするのに使う
                            ; (文字列の直後がいつも RAM の中で、BASIC の持ち物になるように)
PRGSTART   = $0800          ; プログラムの始まり
BMAGIC1    = $B5
BMAGIC2    = $C1

; ---- エラーの番号(err_msgs の順) ----
EN_SN     = 0
EN_OV     = 1
EN_DIV0   = 2
EN_FC     = 3
EN_UL     = 4
EN_OM     = 5
EN_TM     = 6
EN_BS     = 7
EN_DD     = 8
EN_LS     = 9
EN_NF     = 10
EN_RG     = 11
EN_OD     = 12
EN_CN     = 13
EN_ID     = 14
EN_NT     = 15
EN_TP     = 16
EN_TF     = 17
EN_BREAK  = $FF            ; BREAK(エラーではない)

; ===================================================================
; 入口
; ===================================================================
        .org $A000
        jmp b_cold              ; $A000 コールドスタート
        jmp b_warm              ; $A003 ウォームスタート
        .byte "BASIC"           ; $A006 BASIC が入っている印

; BEEP の待ち: bt0/bt1 回 × 14 サイクル。ほかのコードが増えてもページの境目を
; またがないように、ここ(番地が変わらない場所)に置く
beep_wait:
bw_1:
        lda bt0
        bne bw_2
        lda bt1
        beq bw_3
        dec bt1
bw_2:
        dec bt0
        bra bw_1
bw_3:
        rts

        .include "basic_main.s"
        .include "basic_expr.s"
        .include "basic_str.s"
        .include "basic_stmt.s"
        .include "basic_io.s"
        .include "basic_math.s"
        .include "basic_fp.s"
        .include "basic_const.s"

basic_end:
