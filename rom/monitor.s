; PX-65 モニター ROM
;
;   node tools/asm.js rom/monitor.s -o rom/monitor.bin --range A000:FFFF -l rom/monitor.lst
;
; 使い方は docs/monitor.md を参照。
;
; ROM の配置:
;   $A000-$DFFF  BASIC(rom/basic.s。入っていなければ空き)
;   $E000-       モニター本体、フォント、命令表
;   $FF00-       BIOS のジャンプテーブル
;   $FFFA-$FFFF  割り込みベクタ

; ===================================================================
; 定数
; ===================================================================

        .include "px65.inc"

USER_START = $0600          ; R の PC の初期値
REPEAT_DELAY = 32           ; キーリピートが始まるまで(1/64秒単位)
REPEAT_RATE  = 4            ; キーリピートの間隔

; ---- ゼロページ($E0-$FF はシステム用) ----
ptr        = $E0            ; 2 汎用ポインター
ptr2       = $E2            ; 2
num        = $E4            ; 2 読み取った16進数
a1         = $E6            ; 2 コマンドの引数1
a2         = $E8            ; 2 引数2
a3         = $EA            ; 2 引数3
daddr      = $EC            ; 2 逆アセンブルするアドレス
                            ; $EE cur_x, $EF cur_y(px65.inc)
vptr       = $F0            ; 2 VRAM のポインター
                            ; $F2-$F3 ticks(px65.inc)
lp         = $F4            ; 入力行を読む位置
tmp        = $F5
tmp2       = $F6
cur_on     = $F7            ; カーソルを表示中なら1
cnt        = $F8
ir_tmp     = $F9            ; 以下3つは割り込み処理専用
ir_new     = $FA
ir_row     = $FB
gptr       = $FC            ; 2 フォントのポインター
sptr       = $FE            ; 2 文字列のポインター

; ---- ワークエリア($0200-$02FF) ----
KBUF       = $0200          ; 16 キーバッファ(リング)
KPREV      = $0210          ; 8  前回スキャンしたマトリクス
KB_HEAD    = $0218
KB_TAIL    = $0219
RPT_KEY    = $021A          ; リピート中のキー位置($FF ならなし)
RPT_CNT    = $021B
KB_SHIFT   = $021C          ; SHIFT が押されていれば0以外
UNGOT      = $021D          ; 次に getkey が返すキー(0 ならなし)
BEEP_P     = $021E
LINEPOS    = $021F          ; GETLINE: カーソルの位置(LINEBUF の何文字目か)
BYTEBUF    = $0252          ; 16 バイト列の引数
R_PCL      = $0262          ; 以下、ユーザーのレジスタ
R_PCH      = $0263
R_A        = $0264
R_X        = $0265
R_Y        = $0266
R_P        = $0267
R_S        = $0268
MON_SP     = $0269          ; モニターが使うスタックの底
MON_ACTIVE = $026A          ; モニターが動いている間は1
FRESH      = $026B          ; 1 なら次の実行は新しく始める(戻り番地を積む)
RUN_MODE   = $026C          ; 0: G  1: T/P  2: ブレークポイントを1命令越えてから G
STEP_CNT   = $026D
STEP_OVER  = $026E          ; 1 なら P(JSR を飛ばす)
STOP_WHY   = $026F
BP_LO      = $0270          ; 4 ブレークポイント
BP_HI      = $0274          ; 4 ($80以上なら空き)
BP_SAVE    = $0278          ; 4 BRK を書く前のバイト
BP_INST    = $027C          ; ブレークポイントを書き込み中なら1
TB_N       = $027D          ; ステップ実行用の一時 BRK の数(0-2)
TB_LO      = $027E          ; 2
TB_HI      = $0280          ; 2
TB_SAVE    = $0282          ; 2
DNEXT      = $0284          ; 2 次の D の番地
UNEXT      = $0286          ; 2 次の U の番地
MAGIC      = $0288          ; 2 ウォームスタートの目印
A_ADDR     = $028A          ; 2 アセンブラ: 次に書く番地
A_START    = $028C          ; 2 アセンブラ: A を始めた番地
A_SP       = $028E          ; アセンブラ: 1行の始めのスタックポインター(エラーで戻す)
A_MNEM     = $028F          ; ニーモニックの番号
A_BIT      = $0290          ; RMB/SMB/BBR/BBS のビット番号($FF ならなし)
A_CLS      = $0291          ; オペランドの形(下の a_cls_* を参照)
A_LONG     = $0292          ; オペランドを3桁以上で書いたら1
A_VAL      = $0293          ; 2 オペランドの値
A_VAL2     = $0295          ; 2 BBR/BBS の分岐先
A_MODE     = $0297          ; 決まったアドレッシング
                            ; $02C0-$02C5 IRQVEC, BRKVEC, NMIVEC(px65.inc)
T_PEND     = $02AE          ; 2 テープ: 読み残しのバイト数
T_SUM      = $02B0          ; テープ: チェックサム
BOOT_COLD  = $02B1          ; リセットがコールドスタートなら1

MAGIC1     = $A5
MAGIC2     = $5A

RM_GO      = 0
RM_STEP    = 1
RM_STEPGO  = 2

WHY_BP     = 0              ; モニターが置いた BRK で止まった
WHY_BRK    = 1              ; プログラムの BRK 命令
WHY_BREAK  = 2              ; BREAK キー
WHY_RTS    = 3              ; RTS でモニターに戻った

        .org $E000

; ===================================================================
; リセット
; ===================================================================
reset:
        sei
        cld
        ldx #$FF
        txs
        lda #$81                ; 表示オン、コントラスト8
        sta LCD_CTRL
        stz LCD_ANN

        ; ウォームスタートか(RAM が残っていて目印がある)
        lda MAGIC
        cmp #MAGIC1
        bne cold
        lda MAGIC+1
        cmp #MAGIC2
        bne cold
        lda TB_N
        cmp #3
        bcs cold
        lda BP_INST
        cmp #2
        bcs cold
        jsr remove_brks         ; 実行中にリセットされたら BRK を元に戻す
        stz BOOT_COLD
        bra start

cold:
        ldx #0
cold_clr:
        stz $0200,X
        inx
        bne cold_clr
        ldx #$E0
cold_zp:
        stz $00,X
        inx
        bne cold_zp
        lda #$FF
        ldx #3
cold_bp:
        sta BP_HI,X
        dex
        bpl cold_bp
        lda #<USER_START
        sta R_PCL
        sta DNEXT
        sta UNEXT
        sta A_ADDR
        lda #>USER_START
        sta R_PCH
        sta DNEXT+1
        sta UNEXT+1
        sta A_ADDR+1
        lda #MAGIC1
        sta MAGIC
        lda #MAGIC2
        sta MAGIC+1
        lda #1
        sta BOOT_COLD

start:
        ; RAM ベクタはいつも初期値に戻す
        ldx #5
st_vec:
        lda default_vecs,X
        sta IRQVEC,X
        dex
        bpl st_vec
        ; キーボード
        stz KB_HEAD
        stz KB_TAIL
        stz KB_SHIFT
        stz UNGOT
        lda #$FF
        sta RPT_KEY
        ldx #7
st_kp:
        stz KPREV,X
        dex
        bpl st_kp
        ; レジスタ
        lda #$FF
        sta R_S
        sta MON_SP
        lda #1
        sta FRESH
        stz RUN_MODE

        ; BASIC が入っていれば BASIC を起動する
        jsr basic_present
        bcc st_mon
        lda BOOT_COLD
        beq st_bwarm
        jmp BASIC_COLD
st_bwarm:
        clc                     ; リセット: 変数は消す
        jmp BASIC_WARM
st_mon:
        jsr cls
        jsr prinline
        .byte "PX-65 MONITOR", K_RET, "V0.11", 0
        jmp mon_restart

; BASIC の ROM が入っていれば C=1
basic_present:
        ldx #4
bpr_1:
        lda BASIC_SIG,X
        cmp sig_text,X
        bne bpr_no
        dex
        bpl bpr_1
        sec
        rts
bpr_no:
        clc
        rts
sig_text:
        .byte "BASIC"

; BIOS の MONENTER: モニターのプロンプトに入る(BASIC の MON から)
mon_enter:
        sei
        cld
        ldx #5                  ; ベクタをモニターのものに戻す
me_1:
        lda default_vecs,X
        sta IRQVEC,X
        dex
        bpl me_1
        lda #$FF
        sta MON_SP
        sta R_S
        lda #1
        sta FRESH
        stz RUN_MODE
        lda #ANN_BUSY+ANN_RUN   ; BASIC の実行中の表示も消す
        trb LCD_ANN
        jmp mon_restart

default_vecs:
        .word sys_irq, mon_brk, mon_nmi

; ===================================================================
; 割り込みの入口
; ===================================================================

; IRQ と BRK。スタックに積まれた P の B ビットで区別し、RAM ベクタへ飛ぶ。
; どちらのベクタも、割り込みが起きたときと同じレジスタで呼ばれる。
irq_entry:
        pha
        phx
        tsx
        lda $0103,X             ; 積まれた P
        and #$10
        bne irq_is_brk
        plx
        pla
        jmp (IRQVEC)
irq_is_brk:
        plx
        pla
        jmp (BRKVEC)

nmi_entry:
        jmp (NMIVEC)

; 標準のタイマー割り込み処理: ticks を進めてキーボードを読む
sys_irq:
        pha
        phx
        phy
        lda #$81                ; 要求をクリア(IRQは有効のまま)
        sta TIMER_CTRL
        inc ticks
        bne sirq_1
        inc ticks+1
sirq_1:
        jsr kbd_scan
        ply
        plx
        pla
        rti

; ===================================================================
; キーボード
; ===================================================================

; マトリクスを読み、新しく押されたキーとリピートをキーバッファに入れる(割り込みから呼ぶ)
kbd_scan:
        lda #$FF
        sta ir_new
        ldx #0
ks_row:
        lda row_select,X
        sta KEY_ROW
        lda KEY_COL
        eor #$FF                ; 押されている列を1に
        cpx #3
        bne ks_store
        ; 行3の列4は SHIFT。キーとしては扱わない
        pha
        and #$10
        sta KB_SHIFT
        beq ks_shoff
        lda #ANN_SHIFT
        tsb LCD_ANN
        bra ks_shd
ks_shoff:
        lda #ANN_SHIFT
        trb LCD_ANN
ks_shd:
        pla
        and #$EF
ks_store:
        sta ir_tmp              ; 今回の状態
        lda KPREV,X
        eor #$FF
        and ir_tmp              ; 新しく押された列
        pha
        lda ir_tmp
        sta KPREV,X
        pla
        beq ks_next
        bit ir_new              ; すでに見つけていれば最初の1つだけ
        bpl ks_next
        ldy #0
ks_bit:
        lsr
        bcs ks_found
        iny
        bra ks_bit
ks_found:
        sty ir_row
        txa
        asl
        asl
        asl
        ora ir_row
        sta ir_new
ks_next:
        inx
        cpx #8
        bne ks_row
        lda #$FF
        sta KEY_ROW

        lda ir_new
        bmi ks_repeat
        sta RPT_KEY
        lda #REPEAT_DELAY
        sta RPT_CNT
        lda ir_new
        bra kb_enqueue
ks_repeat:
        lda RPT_KEY
        bmi ks_done
        ; まだ押されているか
        lsr
        lsr
        lsr
        tay                     ; 行
        lda RPT_KEY
        and #7
        tax
        lda bitmask,X
        and KPREV,Y
        beq ks_released
        dec RPT_CNT
        bne ks_done
        lda #REPEAT_RATE
        sta RPT_CNT
        lda RPT_KEY
        bra kb_enqueue
ks_released:
        lda #$FF
        sta RPT_KEY
ks_done:
        rts

; A = キーの位置(行×8+列)を文字にしてバッファに入れる
kb_enqueue:
        tax
        lda KB_SHIFT
        beq kbe_ns
        lda keymap_s,X
        bra kbe_1
kbe_ns:
        lda keymap,X
kbe_1:
        beq kbe_done            ; 文字のないキー
        ldx KB_TAIL
        sta KBUF,X
        inx
        txa
        and #$0F
        cmp KB_HEAD
        beq kbe_done            ; いっぱい
        sta KB_TAIL
kbe_done:
        rts

; キーがあれば C=1、A=キー。なければ C=0(待たない)。X, Y は保存
keyget:
        lda UNGOT
        beq kg_buf
        stz UNGOT
        sec
        rts
kg_buf:
        phx
        ldx KB_HEAD
        cpx KB_TAIL
        beq kg_none
        lda KBUF,X
        pha
        inx
        txa
        and #$0F
        sta KB_HEAD
        pla
        plx
        sec
        rts
kg_none:
        plx
        clc
        rts

; キーを1つ待つ(カーソルを点滅させる)。A = キー。X, Y は保存
; 割り込みが有効になっている必要がある
getkey:
        jsr keyget
        bcs gk_got
        lda ticks
        and #$10                ; 約0.25秒ごとに点滅
        beq gk_on
        lda cur_on
        beq gk_wait
        jsr cur_toggle
        bra gk_wait
gk_on:
        lda cur_on
        bne gk_wait
        jsr cur_toggle
gk_wait:
        wai
        bra getkey
gk_got:
        pha
        jsr cursor_off
        pla
        rts

; ===================================================================
; 画面
; ===================================================================

; 1文字を出力する。A, X, Y は保存
;   $0D 改行、$08 1文字戻って消す、$0C 画面を消す、$20-$7E 文字
putc:
        pha
        phx
        phy
        cmp #K_RET
        beq pc_cr
        cmp #K_DEL
        beq pc_bs
        cmp #K_CLS
        beq pc_cls
        cmp #$20
        bcc pc_done
        cmp #$7F
        bcs pc_done
        ldx cur_x
        cpx #COLS
        bcc pc_draw
        pha
        jsr newline
        pla
pc_draw:
        jsr drawch
        inc cur_x
pc_done:
        ply
        plx
        pla
        rts
pc_cr:
        jsr newline
        bra pc_done
pc_cls:
        jsr cls
        bra pc_done
pc_bs:
        lda cur_x
        beq pc_bs_up
        dec cur_x
        bra pc_bs_erase
pc_bs_up:
        lda cur_y
        beq pc_done
        dec cur_y
        lda #COLS-1
        sta cur_x
pc_bs_erase:
        lda #' '
        jsr drawch
        bra pc_done

; 改行(最下行ならスクロール)
newline:
        stz cur_x
        inc cur_y
        lda cur_y
        cmp #ROWS
        bcc nl_done
        jsr scroll
        lda #ROWS-1
        sta cur_y
nl_done:
        rts

; 画面を1行上げる
scroll:
        ldx #0
scr_1:
        lda VRAM+96,X           ; ページ1,2 -> 0,1
        sta VRAM,X
        inx
        cpx #192
        bne scr_1
        ldx #0
scr_2:
        lda VRAM+288,X          ; ページ3 -> 2
        sta VRAM+192,X
        stz VRAM+288,X
        inx
        cpx #96
        bne scr_2
        rts

; 画面を消してカーソルを左上に
cls:
        ldx #0
cls_1:
        stz VRAM,X
        stz VRAM+192,X
        inx
        cpx #192
        bne cls_1
        stz cur_x
        stz cur_y
        stz cur_on
        rts

; カーソルを X=桁、Y=行 に移す
locate:
        stx cur_x
        sty cur_y
        rts

; A の文字をカーソルの位置に描く(カーソルは動かさない)
drawch:
        sec
        sbc #$20
        sta gptr
        stz gptr+1
        asl
        rol gptr+1
        asl
        rol gptr+1              ; ×4
        clc
        adc gptr
        sta gptr
        lda gptr+1
        adc #0
        sta gptr+1              ; ×5
        lda gptr
        clc
        adc #<font
        sta gptr
        lda gptr+1
        adc #>font
        sta gptr+1
        jsr cellptr
        ldy #0
dch_1:
        lda (gptr),Y
        sta (vptr),Y
        iny
        cpy #5
        bne dch_1
        lda #0
        sta (vptr),Y
        rts

; vptr = カーソル位置のマスの VRAM アドレス
cellptr:
        lda cur_x
        asl
        adc cur_x
        asl                     ; ×6
        ldy cur_y
        clc
        adc row_lo,Y
        sta vptr
        lda row_hi,Y
        adc #0
        sta vptr+1
        rts

; カーソルの表示を反転する
cur_toggle:
        lda cur_on
        eor #1
        sta cur_on
        lda cur_x
        cmp #COLS
        bcs ct_done
        phy
        jsr cellptr
        ldy #5
ct_1:
        lda (vptr),Y
        eor #$FF
        sta (vptr),Y
        dey
        bpl ct_1
        ply
ct_done:
        rts

cursor_off:
        lda cur_on
        beq co_done
        jsr cur_toggle
co_done:
        rts

; 改行(行の途中にいるときだけ)
crlf_if:
        lda cur_x
        beq crlf_done
crlf:
        lda #K_RET
        jmp putc
crlf_done:
        rts

prspace:
        lda #' '
        jmp putc

; A を16進数2桁で表示する。A, X, Y は保存
prhex8:
        pha
        lsr
        lsr
        lsr
        lsr
        jsr prnib
        pla
        pha
        and #$0F
        jsr prnib
        pla
        rts
prnib:
        cmp #10
        bcc prn_1
        adc #6                  ; C=1 なので +7
prn_1:
        adc #'0'
        jmp putc

; ゼロページ X, X+1 の16ビット値を4桁で表示する
prhex16:
        lda 1,X
        jsr prhex8
        lda 0,X
        jmp prhex8

; JSR の直後に置いた0終わりの文字列を表示し、その後ろに戻る。X, Y は保存
prinline:
        pla
        sta sptr
        pla
        sta sptr+1
pri_1:
        inc sptr
        bne pri_2
        inc sptr+1
pri_2:
        lda (sptr)
        beq pri_done
        jsr putc
        bra pri_1
pri_done:
        lda sptr+1
        pha
        lda sptr
        pha
        rts

; ブザーを鳴らす。A = 音の高さ(大きいほど低い)、X = 長さ(周期の数)。A, X, Y を壊す
sound:
        sta BEEP_P
bp_1:
        lda #1
        sta BEEP
        jsr bp_delay
        stz BEEP
        jsr bp_delay
        dex
        bne bp_1
        rts
bp_delay:
        ldy BEEP_P
bp_d1:
        dey
        bne bp_d1
        rts

; ===================================================================
; 1行の入力
; ===================================================================

; LINEBUF に1行を読む。LINELEN = 文字数。最後に改行する。A, X を壊す(Y は保存)
;   文字はカーソルの位置に入る(挿入)
;   ← → カーソルを動かす  DEL カーソルの前の1文字を消す  ↑ 直前の行を呼び出す
;   RET 確定(カーソルがどこにあっても行全体)
getline:
        phy
        stz LINELEN
        stz LINEPOS
        bra gl_key

; LINEBUF に入っている LINELEN 文字を表示して、続きを入力する(BASIC の EDIT)
getline_edit:
        phy
        lda LINELEN
        sta LINEPOS
        ldx #0
        clc
        jsr gl_tail             ; 全部を表示する(カーソルは行の終わり)
gl_key:
        jsr getkey
        cmp #K_RET
        bne glk_1
        jmp gl_ret
glk_1:
        cmp #K_DEL
        beq gl_del
        cmp #K_LEFT
        beq gl_left
        cmp #K_RIGHT
        beq gl_right
        cmp #K_UP
        beq gl_hist
        cmp #$20
        bcc gl_key
        cmp #$7F
        bcs gl_key
        ; カーソルの位置に1文字入れる
        ldx LINELEN
        cpx #LINEMAX
        bcs gl_key
        pha
gli_1:
        cpx LINEPOS
        beq gli_2
        lda LINEBUF-1,X
        sta LINEBUF,X
        dex
        bra gli_1
gli_2:
        pla
        sta LINEBUF,X
        inc LINELEN
        inc LINEPOS
        clc
        jsr gl_tail             ; 入れた文字から後ろを描き直す
        bra gl_key
gl_del:
        ldx LINEPOS
        beq gl_key
        jsr cur_left
        bcs gl_key              ; 行の頭が画面の上に出ていて戻れない
        dec LINEPOS
        ldx LINEPOS
gld_1:
        inx
        cpx LINELEN
        bcs gld_2
        lda LINEBUF,X
        sta LINEBUF-1,X
        bra gld_1
gld_2:
        dec LINELEN
        ldx LINEPOS
        sec
        jsr gl_tail             ; 後ろを描き直し、最後の1文字ぶんを消す
        bra gl_key
gl_left:
        lda LINEPOS
        beq glk_j
        jsr cur_left
        bcs glk_j
        dec LINEPOS
        bra glk_j
gl_right:
        lda LINEPOS
        cmp LINELEN
        bcs glk_j
        jsr cur_right
        inc LINEPOS
glk_j:
        jmp gl_key
gl_hist:
        jsr gl_end
        ldx LINELEN             ; いまの入力を消す
        beq glh_2
glh_1:
        lda #K_DEL
        jsr putc
        dex
        bne glh_1
glh_2:
        cpx HISTLEN
        beq glh_3
        lda HISTBUF,X
        sta LINEBUF,X
        jsr echo
        inx
        bra glh_2
glh_3:
        stx LINELEN
        stx LINEPOS
        jmp gl_key
gl_ret:
        jsr gl_end
        ldx LINELEN
        beq glr_2
        stx HISTLEN
glr_1:
        lda LINEBUF-1,X
        sta HISTBUF-1,X
        dex
        bne glr_1
glr_2:
        ; 右端で折り返した直後でなければ改行する
        lda cur_x
        bne glr_nl
        lda LINELEN
        bne glr_done
glr_nl:
        jsr newline
glr_done:
        ply
        rts

; カーソルを行の終わりへ動かす
gl_end:
        lda LINEPOS
        cmp LINELEN
        bcs gle_done
        jsr cur_right
        inc LINEPOS
        bra gl_end
gle_done:
        rts

; LINEBUF の X 文字目から終わりまでを描き、C=1 なら続けて1文字ぶん消す。
; その後、カーソルを LINEPOS 文字目に戻す。行の頭が画面の上に出ていて戻りきれないときは、
; LINEPOS を戻れたところに合わせる。A, X を壊す
gl_tail:
        php
glt_1:
        cpx LINELEN
        beq glt_2
        lda LINEBUF,X
        jsr echo
        inx
        bra glt_1
glt_2:
        plp
        bcc glt_3
        lda #' '                ; カーソルの位置の文字を消す(カーソルは動かない)
        jsr putc
        lda #K_DEL
        jsr putc
glt_3:
        cpx LINEPOS
        beq glt_5
        jsr cur_left
        bcs glt_4
        dex
        bra glt_3
glt_4:
        inc LINEPOS
        bra glt_3
glt_5:
        rts

; カーソルを1文字左へ(行の頭なら上の行の右端へ)。左上で動けなければ C=1。A を壊す
cur_left:
        lda cur_x
        beq cl_up
        dec cur_x
        clc
        rts
cl_up:
        lda cur_y
        beq cl_fail
        dec cur_y
        lda #COLS-1
        sta cur_x
        clc
        rts
cl_fail:
        sec
        rts

; カーソルを1文字右へ(右端を越えたら次の行の頭へ)。表示してある範囲の中だけで使う。A を壊す
cur_right:
        inc cur_x
        lda cur_x
        cmp #COLS
        bcc cr_done
        stz cur_x
        inc cur_y
cr_done:
        rts

; 入力した文字を表示し、右端に来たらすぐ次の行へ移る(カーソルが見えるように)
echo:
        jsr putc
        lda cur_x
        cmp #COLS
        bcc echo_done
        phx
        jsr newline
        plx
echo_done:
        rts

; ===================================================================
; モニター本体
; ===================================================================

mon_restart:
        ldx MON_SP
        txs
        cld
        lda #1
        sta MON_ACTIVE
        stz RUN_MODE
        jsr cursor_off
        lda #$81
        sta TIMER_CTRL
        stz TAPE_CTRL           ; BREAK でテープの途中から戻ったときのため
        lda #ANN_BUSY
        trb LCD_ANN
        cli
mon_loop:
        jsr crlf_if
        lda #'*'
        jsr putc
        jsr getline
        jsr exec_line
        bra mon_loop

; エラー: "?" を表示してビープを鳴らし、プロンプトに戻る
error:
        jsr crlf_if
        lda #'?'
        jsr putc
err_beep:
        lda #100
        ldx #80
        jsr sound
        jmp mon_restart

; 入力行を実行する
exec_line:
        stz lp
        jsr skipsp
        jsr peek
        beq ex_done
        inc lp
        ldx #0
ex_find:
        cmp cmd_chars,X
        beq ex_found
        inx
        cpx #cmd_addrs-cmd_chars
        bne ex_find
        jmp error
ex_found:
        txa
        asl
        tax
        jmp (cmd_addrs,X)
ex_done:
        rts

cmd_chars:
        .byte "DEFMSCGRHUBTPWLAQ"
cmd_addrs:
        .word cmd_d, cmd_e, cmd_f, cmd_m, cmd_s, cmd_c, cmd_g, cmd_r, cmd_h, cmd_u, cmd_b, cmd_t, cmd_p
        .word cmd_w, cmd_l, cmd_a, cmd_q

; ---- 入力行の解析 ----

; A = いまの文字(英小文字は大文字に)。行の終わりなら A=0。Z は A に従う。Y を壊す
peek:
        ldy lp
        cpy LINELEN
        bcs pk_end
        lda LINEBUF,Y
        jsr toupper
        ora #0
        rts
pk_end:
        lda #0
        rts

toupper:
        cmp #'a'
        bcc tu_done
        cmp #'z'+1
        bcs tu_done
        and #$DF
tu_done:
        rts

; 空白とカンマを飛ばす
skipsp:
        jsr peek
        cmp #' '
        beq ssp_1
        cmp #','
        bne ssp_done
ssp_1:
        inc lp
        bra skipsp
ssp_done:
        rts

; A が16進数の数字なら C=0、A = 値。そうでなければ C=1
hexval:
        cmp #'0'
        bcc hv_no
        cmp #'9'+1
        bcc hv_dig
        cmp #'A'
        bcc hv_no
        cmp #'F'+1
        bcs hv_no
        sbc #'A'-11             ; C=0 なので A-'A'+10
        clc
        rts
hv_dig:
        sbc #'0'-1              ; C=0 なので A-'0'
        clc
        rts
hv_no:
        sec
        rts

; 16進数を読んで num に入れる。数字がなければ C=1
gethex:
        jsr skipsp
        stz num
        stz num+1
        stz tmp
gh_1:
        jsr peek
        jsr hexval
        bcs gh_end
        inc lp
        ldx #4
gh_2:
        asl num
        rol num+1
        dex
        bne gh_2
        ora num
        sta num
        inc tmp
        bra gh_1
gh_end:
        lda tmp
        beq gh_fail
        clc
        rts
gh_fail:
        sec
        rts

; 16進数が必ずある
need_hex:
        jsr gethex
        bcs nh_err
        rts
nh_err:
        jmp error

; 16進数を読んでゼロページ X, X+1 に入れる
arg_x:
        phx
        jsr need_hex
        plx
        lda num
        sta 0,X
        lda num+1
        sta 1,X
        rts

; 行がここで終わっていなければエラー
need_end:
        jsr skipsp
        jsr peek
        bne nh_err
        rts

; あと引数があれば Z=0
more_args:
        jsr skipsp
        jmp peek

; バイト列(16進数か "文字列")を BYTEBUF に読む。cnt = 個数(1以上)
getbytes:
        stz cnt
gb_1:
        jsr more_args
        beq gb_done
        cmp #'"'
        beq gb_str
        jsr need_hex
        lda num+1
        bne gb_err
        lda num
        jsr gb_put
        bra gb_1
gb_str:
        inc lp
gb_s1:
        ldy lp
        cpy LINELEN
        bcs gb_1                ; 閉じていなくてもよい
        lda LINEBUF,Y           ; 大文字にしない
        inc lp
        cmp #'"'
        beq gb_1
        jsr gb_put
        bra gb_s1
gb_done:
        lda cnt
        beq gb_err
        rts
gb_put:
        ldx cnt
        cpx #16
        bcs gb_err
        sta BYTEBUF,X
        inc cnt
        rts
gb_err:
        jmp error

; 開始 a1 と終了 a2 を読み、a2 >= a1 を確かめる
get_range:
        ldx #a1
        jsr arg_x
        ldx #a2
        jsr arg_x
        lda a2
        cmp a1
        lda a2+1
        sbc a1+1
        bcc gb_err
        rts

; a1 が a2 なら C=1。そうでなければ a1 を1進めて C=0
a1_step:
        lda a1
        cmp a2
        bne a1s_inc
        lda a1+1
        cmp a2+1
        bne a1s_inc
        sec
        rts
a1s_inc:
        inc a1
        bne a1s_done
        inc a1+1
a1s_done:
        clc
        rts

; アドレスを3つずつ並べて表示する(tmp2 が数を数える)
praddr3:
        jsr prhex16
        inc tmp2
        lda tmp2
        cmp #3
        bne pa3_sp
        stz tmp2
        jmp crlf
pa3_sp:
        jmp prspace

; ページ送りのキー以外で抜けたとき、文字キーなら次の入力の1文字目にする
unget:
        cmp #'!'
        bcc ug_done
        cmp #$7F
        bcs ug_done
        sta UNGOT
ug_done:
        rts

; ===================================================================
; D [番地]  メモリダンプ(↓↑で4バイト、RET/SPACE で16バイト進む)
; ===================================================================
cmd_d:
        jsr more_args
        beq d_cont
        ldx #a1
        jsr arg_x
        jsr need_end
        bra d_draw
d_cont:
        lda DNEXT
        sta a1
        lda DNEXT+1
        sta a1+1
d_draw:
        lda #K_CLS
        jsr putc
        lda a1
        sta ptr
        lda a1+1
        sta ptr+1
        ldx #ptr
        jsr dump_line
        jsr crlf
        jsr dump_line
        jsr crlf
        jsr dump_line
        jsr crlf
        jsr dump_line
        jsr getkey
        ldx #4
        cmp #K_DOWN
        beq d_fwd
        ldx #16
        cmp #K_RET
        beq d_fwd
        cmp #' '
        beq d_fwd
        cmp #K_UP
        bne d_exit
        sec
        lda a1
        sbc #4
        sta a1
        bcs d_draw
        dec a1+1
        bra d_draw
d_fwd:
        txa
        clc
        adc a1
        sta a1
        bcc d_draw
        inc a1+1
        bra d_draw
d_exit:
        jsr unget
        lda ptr
        sta DNEXT
        lda ptr+1
        sta DNEXT+1
        rts

; "AAAA bb bb bb bb" を表示して ptr を4進める
dump_line:
        ldx #ptr
        jsr prhex16
        ldy #0
dl_1:
        jsr prspace
        lda (ptr),Y
        jsr prhex8
        iny
        cpy #4
        bne dl_1
        lda ptr
        clc
        adc #4
        sta ptr
        bcc dl_2
        inc ptr+1
dl_2:
        rts

; ===================================================================
; E 番地 [値 ...]  メモリに書き込む。値がなければ1バイトずつ編集する
; ===================================================================
cmd_e:
        ldx #a1
        jsr arg_x
        jsr more_args
        beq e_inter
        jsr getbytes
        ldy #0
e_wr:
        lda BYTEBUF,Y
        sta (a1),Y
        iny
        cpy cnt
        bne e_wr
        rts

; 1バイトずつ: "AAAA vv-" の後に16進数を打つ
;   SPACE, ↓ 次へ  ↑ 前へ  RET 終わり  DEL, ← 1桁消す
e_inter:
e_line:
        ldx #a1
        jsr prhex16
        jsr prspace
        lda (a1)
        jsr prhex8
        lda #'-'
        jsr putc
        stz cnt
        stz tmp2
e_key:
        jsr getkey
        jsr toupper
        pha
        jsr hexval
        bcs e_nothex
        ldx cnt
        cpx #2
        bcs e_skip
        sta tmp
        lda tmp2
        asl
        asl
        asl
        asl
        ora tmp
        sta tmp2
        inc cnt
        pla
        jsr putc
        bra e_key
e_skip:
        pla
        bra e_key
e_nothex:
        pla
        cmp #K_DEL
        beq e_del
        cmp #K_LEFT
        beq e_del
        cmp #' '
        beq e_next
        cmp #K_DOWN
        beq e_next
        cmp #K_UP
        beq e_prev
        cmp #K_RET
        bne e_key
        jmp e_store
e_del:
        lda cnt
        beq e_key
        dec cnt
        lsr tmp2
        lsr tmp2
        lsr tmp2
        lsr tmp2
        lda #K_DEL
        jsr putc
        bra e_key
e_next:
        jsr e_store
        inc a1
        bne e_nl
        inc a1+1
        bra e_nl
e_prev:
        jsr e_store
        lda a1
        bne e_p1
        dec a1+1
e_p1:
        dec a1
e_nl:
        jsr crlf
        jmp e_line
e_store:
        lda cnt
        beq e_st1
        lda tmp2
        sta (a1)
e_st1:
        rts

; ===================================================================
; F 開始 終了 値 [値 ...]  範囲を値(の並び)で埋める
; ===================================================================
cmd_f:
        jsr get_range
        jsr getbytes
        ldx #0
f_1:
        lda BYTEBUF,X
        sta (a1)
        inx
        cpx cnt
        bne f_2
        ldx #0
f_2:
        jsr a1_step
        bcc f_1
        rts

; ===================================================================
; M 開始 終了 転送先  メモリを転送する(重なっていてもよい)
; ===================================================================
cmd_m:
        jsr get_range
        ldx #a3
        jsr arg_x
        jsr need_end
        ; 転送先が開始より後ろなら後ろから写す
        lda a1
        cmp a3
        lda a1+1
        sbc a3+1
        bcc m_back
m_fwd:
        lda (a1)
        sta (a3)
        inc a3
        bne m_f1
        inc a3+1
m_f1:
        jsr a1_step
        bcc m_fwd
        rts
m_back:
        ; ptr = 終了、ptr2 = 転送先 + (終了 - 開始)
        lda a2
        sta ptr
        lda a2+1
        sta ptr+1
        sec
        lda a2
        sbc a1
        sta ptr2
        lda a2+1
        sbc a1+1
        sta ptr2+1
        clc
        lda ptr2
        adc a3
        sta ptr2
        lda ptr2+1
        adc a3+1
        sta ptr2+1
m_b1:
        lda (ptr)
        sta (ptr2)
        lda ptr
        cmp a1
        bne m_b2
        lda ptr+1
        cmp a1+1
        beq m_done
m_b2:
        lda ptr
        bne m_b3
        dec ptr+1
m_b3:
        dec ptr
        lda ptr2
        bne m_b4
        dec ptr2+1
m_b4:
        dec ptr2
        bra m_b1
m_done:
        rts

; ===================================================================
; S 開始 終了 値 [値 ...]  バイト列を探す
; ===================================================================
cmd_s:
        jsr get_range
        jsr getbytes
        stz tmp2
s_1:
        ldy #0
s_2:
        lda (a1),Y
        cmp BYTEBUF,Y
        bne s_next
        iny
        cpy cnt
        bne s_2
        ldx #a1
        jsr praddr3
s_next:
        jsr a1_step
        bcc s_1
        rts

; ===================================================================
; C 開始 終了 比較先  2つの範囲を比べ、違うところを表示する
; ===================================================================
cmd_c:
        jsr get_range
        ldx #a3
        jsr arg_x
        jsr need_end
c_1:
        lda (a1)
        cmp (a3)
        beq c_next
        ldx #a1                 ; "AAAA bb AAAA bb"
        jsr prhex16
        jsr prspace
        lda (a1)
        jsr prhex8
        jsr prspace
        ldx #a3
        jsr prhex16
        jsr prspace
        lda (a3)
        jsr prhex8
        jsr crlf
c_next:
        inc a3
        bne c_2
        inc a3+1
c_2:
        jsr a1_step
        bcc c_1
        rts

; ===================================================================
; H 値1 値2  和と差
; ===================================================================
cmd_h:
        ldx #a1
        jsr arg_x
        ldx #a2
        jsr arg_x
        jsr need_end
        clc
        lda a1
        adc a2
        sta num
        lda a1+1
        adc a2+1
        sta num+1
        ldx #num
        jsr prhex16
        jsr prspace
        sec
        lda a1
        sbc a2
        sta num
        lda a1+1
        sbc a2+1
        sta num+1
        ldx #num
        jmp prhex16

; ===================================================================
; R [レジスタ 値]  レジスタの表示と変更(レジスタは A X Y S P PC)
; ===================================================================
cmd_r:
        jsr more_args
        bne r_set
        jmp show_regs
r_set:
        inc lp
        ldx #R_A-R_PCL
        cmp #'A'
        beq r_8
        inx
        cmp #'X'
        beq r_8
        inx
        cmp #'Y'
        beq r_8
        ldx #R_S-R_PCL
        cmp #'S'
        beq r_8
        cmp #'P'
        bne r_err
        jsr peek
        cmp #'C'
        beq r_pc
        ldx #R_P-R_PCL
r_8:
        phx
        jsr need_hex
        jsr need_end
        plx
        lda num+1
        bne r_err
        lda num
        sta R_PCL,X
        rts
r_pc:
        inc lp
        jsr need_hex
        jsr need_end
        lda num
        sta R_PCL
        lda num+1
        sta R_PCH
        rts
r_err:
        jmp error

; レジスタを3行で表示する
;   A=00 X=00 Y=00
;   S=FF P=..-B.I..
;   0600 LDA #01      (PC の命令)
show_regs:
        jsr show_regs2
        jsr crlf
        lda R_PCL
        sta daddr
        lda R_PCH
        sta daddr+1
        jmp disline

show_regs2:
        jsr prinline
        .byte "A=", 0
        lda R_A
        jsr prhex8
        jsr prinline
        .byte " X=", 0
        lda R_X
        jsr prhex8
        jsr prinline
        .byte " Y=", 0
        lda R_Y
        jsr prhex8
        jsr crlf
        jsr prinline
        .byte "S=", 0
        lda R_S
        jsr prhex8
        jsr prinline
        .byte " P=", 0
        lda R_P
        sta tmp
        ldx #0
sr_1:
        lda flag_names,X
        asl tmp
        bcs sr_2
        cpx #2                  ; bit5 はいつも "-"
        beq sr_2
        lda #'.'
sr_2:
        jsr putc
        inx
        cpx #8
        bne sr_1
        rts

flag_names:
        .byte "NV-BDIZC"

; ===================================================================
; U [番地]  逆アセンブル(↓で1行、RET/SPACE で4行進む)
; ===================================================================
cmd_u:
        jsr more_args
        beq u_cont
        ldx #daddr
        jsr arg_x
        jsr need_end
        bra u_go
u_cont:
        lda UNEXT
        sta daddr
        lda UNEXT+1
        sta daddr+1
u_go:
        jsr disline
        ldx #3
u_more:
        jsr crlf
        jsr disline
        dex
        bne u_more
u_key:
        jsr getkey
        ldx #1
        cmp #K_DOWN
        beq u_more
        ldx #4
        cmp #K_RET
        beq u_more
        cmp #' '
        beq u_more
        jsr unget
        lda daddr
        sta UNEXT
        lda daddr+1
        sta UNEXT+1
        rts

; daddr の命令を1行表示して daddr を進める。X は保存
;   "AAAA MNE OPERAND"(数はすべて16進数で $ は付けない)
disline:
        phx
        ldx #daddr
        jsr prhex16
        jsr prspace
        lda (daddr)
        sta tmp                 ; オペコード
        tax
        lda op_mnem,X
        sta tmp2
        asl
        adc tmp2                ; ×3
        tax
        lda mnem_text,X
        jsr putc
        lda mnem_text+1,X
        jsr putc
        lda mnem_text+2,X
        jsr putc
        ; RMB/SMB/BBR/BBS(下位4ビットが7か$F)はビット番号を付ける
        lda tmp
        and #$07
        cmp #$07
        bne dis_1
        lda tmp
        lsr
        lsr
        lsr
        lsr
        and #7
        ora #'0'
        jsr putc
dis_1:
        ldx tmp
        lda op_mode,X
        tax
        lda m_kind,X
        beq dis_end             ; オペランドなし
        jsr prspace
        lda m_pre,X
        beq dis_2
        jsr putc
dis_2:
        lda m_kind,X
        cmp #5
        beq dis_acc
        cmp #2
        beq dis_word
        cmp #3
        beq dis_rel
        cmp #4
        beq dis_zpr
        ldy #1                  ; 1バイト
        lda (daddr),Y
        jsr prhex8
        bra dis_suf
dis_acc:
        lda #'A'
        jsr putc
        bra dis_suf
dis_word:
        ldy #2
        lda (daddr),Y
        jsr prhex8
        dey
        lda (daddr),Y
        jsr prhex8
        bra dis_suf
dis_rel:
        ldy #1
        lda (daddr),Y
        ldy #2
        jsr prrel
        bra dis_suf
dis_zpr:
        ldy #1
        lda (daddr),Y
        jsr prhex8
        lda #','
        jsr putc
        ldy #2
        lda (daddr),Y
        ldy #3
        jsr prrel
dis_suf:
        lda m_suf1,X
        beq dis_end
        jsr putc
        lda m_suf2,X
        beq dis_end
        jsr putc
        lda m_suf3,X
        beq dis_end
        jsr putc
dis_end:
        ; daddr += 長さ
        ldx tmp
        lda op_mode,X
        tax
        lda m_len,X
        clc
        adc daddr
        sta daddr
        bcc dis_ret
        inc daddr+1
dis_ret:
        plx
        rts

; 分岐先 = daddr + Y + (A を符号付きで) を4桁で表示する。X は保存
prrel:
        pha
        tya
        clc
        adc daddr
        sta ptr
        lda daddr+1
        adc #0
        sta ptr+1
        pla
        bpl prr_1
        dec ptr+1
prr_1:
        clc
        adc ptr
        sta ptr
        bcc prr_2
        inc ptr+1
prr_2:
        phx
        ldx #ptr
        jsr prhex16
        plx
        rts

; ===================================================================
; B                一覧
; B 番地           ブレークポイントを置く(4つまで、RAM のみ)
; B - [番地]       消す(番地がなければ全部)
; ===================================================================
cmd_b:
        jsr more_args
        beq b_list
        cmp #'-'
        beq b_del
        jsr need_hex
        jsr need_end
        lda num+1
        bmi b_err               ; RAM($0000-$7FFF)だけ
        sta ptr+1
        lda num
        sta ptr
        jsr is_prot             ; モニターの使う番地には置けない
        bcs b_err
        jsr b_find
        bcs b_list              ; すでにある
        ldx #0
b_free:
        lda BP_HI,X
        bmi b_put
        inx
        cpx #4
        bne b_free
b_err:
        jmp error
b_put:
        lda num
        sta BP_LO,X
        lda num+1
        sta BP_HI,X
        bra b_list
b_del:
        inc lp
        jsr more_args
        beq b_clear
        jsr need_hex
        jsr need_end
        jsr b_find
        bcc b_err
        lda #$FF
        sta BP_HI,X
        bra b_list
b_clear:
        lda #$FF
        ldx #3
b_c1:
        sta BP_HI,X
        dex
        bpl b_c1
b_list:
        stz tmp2
        stz cnt
        ldy #0
b_l1:
        lda BP_HI,Y
        bmi b_l2
        sta num+1
        lda BP_LO,Y
        sta num
        ldx #num
        jsr praddr3
        inc cnt
b_l2:
        iny
        cpy #4
        bne b_l1
        lda cnt
        bne b_l3
        lda #'-'
        jmp putc
b_l3:
        rts

; num と同じブレークポイントがあれば C=1、X = 番号
b_find:
        ldx #3
bf_1:
        lda BP_HI,X
        cmp num+1
        bne bf_2
        lda BP_LO,X
        cmp num
        beq bf_yes
bf_2:
        dex
        bpl bf_1
        clc
        rts
bf_yes:
        sec
        rts

; ===================================================================
; A [番地]  1行ずつアセンブルする
;
;   番地が出たら命令を1行打つ。書き方は U の表示と同じ(数は16進数、$ は付けても
;   付けなくてもよい)。何も打たずに RET で終わる。間違えると ? を出して同じ番地で
;   やり直す。オペランドを2桁以下で書くとゼロページ、3桁以上で書くと絶対番地を選ぶ
;   (その命令にない方は、もう一方で代わりにする)。分岐命令には分岐先の番地を書く。
; ===================================================================

; オペランドの形
A_CLS_NONE = 0              ; なし
A_CLS_ACC  = 1              ; A
A_CLS_IMM  = 2              ; #v
A_CLS_V    = 3              ; v
A_CLS_VX   = 4              ; v,X
A_CLS_VY   = 5              ; v,Y
A_CLS_IX   = 6              ; (v,X)
A_CLS_IY   = 7              ; (v),Y
A_CLS_I    = 8              ; (v)
A_CLS_ZR   = 9              ; v,w(BBR/BBS)

cmd_a:
        jsr more_args
        beq a_go
        jsr need_hex
        jsr need_end
        lda num
        sta A_ADDR
        lda num+1
        sta A_ADDR+1
a_go:
        lda A_ADDR
        sta A_START
        lda A_ADDR+1
        sta A_START+1
a_line:
        tsx
        stx A_SP
        jsr crlf_if
        lda A_ADDR+1
        jsr prhex8
        lda A_ADDR
        jsr prhex8
        jsr prspace
        jsr getline
        stz lp
        jsr a_skip
        jsr peek
        beq a_done
        jsr asm_one
        bra a_line
a_done:
        lda A_START             ; 続けて U で確かめられるように
        sta UNEXT
        lda A_START+1
        sta UNEXT+1
        rts

; エラー: ? を出して同じ番地の入力に戻る
a_err:
        ldx A_SP
        txs
        jsr crlf_if
        lda #'?'
        jsr putc
        lda #100
        ldx #80
        jsr sound
        bra a_line

; 空白を飛ばす(カンマは飛ばさない)
a_skip:
        jsr peek
        cmp #' '
        bne a_skip_done
        inc lp
        bra a_skip
a_skip_done:
        rts

; 行がここで終わっていなければエラー
a_end:
        jsr a_skip
        jsr peek
        bne a_err
        rts

; 16進数を num に読む($ を付けてもよい)。なければエラー。A_LONG も決める
a_num:
        jsr a_skip
        jsr peek
        cmp #'$'
        bne a_n1
        inc lp
a_n1:
        jsr gethex
        bcs a_err
        stz A_LONG
        lda tmp                 ; 桁数
        cmp #3
        bcc a_n2
        inc A_LONG
a_n2:
        rts

; A をその文字として読めれば進める。読めなければエラー
a_expect:
        sta tmp2
        jsr a_skip
        jsr peek
        cmp tmp2
        bne a_err
        inc lp
        rts

; LINEBUF の命令を1つアセンブルして A_ADDR に書き、A_ADDR を進める
asm_one:
        ; ---- ニーモニック(英字3文字) ----
        ldx #0
ao_m1:
        jsr peek
        cmp #'A'
        bcc a_err
        cmp #'Z'+1
        bcs a_err
        sta BYTEBUF,X
        inc lp
        inx
        cpx #3
        bne ao_m1
        ldx #0                  ; X = 表の位置、A_MNEM = 番号
        stz A_MNEM
ao_m2:
        lda mnem_text,X
        cmp BYTEBUF
        bne ao_m3
        lda mnem_text+1,X
        cmp BYTEBUF+1
        bne ao_m3
        lda mnem_text+2,X
        cmp BYTEBUF+2
        beq ao_m4
ao_m3:
        inx
        inx
        inx
        inc A_MNEM
        cpx #m_len-mnem_text    ; 表の終わり(m_len は mnem_text のすぐ後ろ)
        bne ao_m2
        jmp a_err
ao_m4:
        ; ---- ビット番号(RMB/SMB/BBR/BBS) ----
        lda #$FF
        sta A_BIT
        jsr peek
        cmp #'0'
        bcc ao_b1
        cmp #'8'
        bcs ao_b1
        and #$07
        sta A_BIT
        inc lp
ao_b1:
        ; ニーモニックの後は空白か行の終わり
        jsr peek
        beq ao_opr
        cmp #' '
        beq ao_opr
        jmp a_err

        ; ---- オペランド ----
ao_opr:
        stz A_VAL
        stz A_VAL+1
        stz A_LONG
        jsr a_skip
        jsr peek
        bne ao_o1
        lda #A_CLS_NONE
        jmp ao_cls
ao_o1:
        cmp #'#'
        bne ao_o2
        inc lp
        jsr a_num
        jsr a_setval
        jsr a_end
        lda #A_CLS_IMM
        jmp ao_cls
ao_o2:
        cmp #'('
        bne ao_o5
        inc lp
        jsr a_num
        jsr a_setval
        jsr a_skip
        jsr peek
        cmp #','
        bne ao_o3
        inc lp                  ; (v,X)
        lda #'X'
        jsr a_expect
        lda #')'
        jsr a_expect
        jsr a_end
        lda #A_CLS_IX
        jmp ao_cls
ao_o3:
        lda #')'
        jsr a_expect
        jsr a_skip
        jsr peek
        bne ao_o4
        lda #A_CLS_I            ; (v)
        jmp ao_cls
ao_o4:
        lda #','                ; (v),Y
        jsr a_expect
        lda #'Y'
        jsr a_expect
        jsr a_end
        lda #A_CLS_IY
        jmp ao_cls
ao_o5:
        ; "A" だけならアキュムレーター(なければ $0A として扱う)
        cmp #'A'
        bne ao_o6
        lda lp
        pha
        inc lp
        jsr a_skip
        jsr peek
        bne ao_o5b
        pla
        lda #$0A
        sta A_VAL
        lda #A_CLS_ACC
        jmp ao_cls
ao_o5b:
        pla
        sta lp
ao_o6:
        jsr a_num
        jsr a_setval
        jsr a_skip
        jsr peek
        bne ao_o7
        lda #A_CLS_V
        jmp ao_cls
ao_o7:
        lda #','
        jsr a_expect
        jsr a_skip
        jsr peek
        cmp #'X'
        bne ao_o8
        inc lp
        jsr a_end
        lda #A_CLS_VX
        jmp ao_cls
ao_o8:
        cmp #'Y'
        bne ao_o9
        inc lp
        jsr a_end
        lda #A_CLS_VY
        jmp ao_cls
ao_o9:
        jsr a_num               ; v,w
        lda num
        sta A_VAL2
        lda num+1
        sta A_VAL2+1
        jsr a_end
        lda #A_CLS_ZR

        ; ---- アドレッシングを決める ----
ao_cls:
        sta A_CLS
        asl
        adc A_CLS               ; ×3
        ldx A_LONG
        beq ao_c1
        clc
        adc #a_long_modes-a_short_modes
ao_c1:
        tax
        ldy #3
ao_c2:
        lda a_short_modes,X
        bmi ao_fail
        sta A_MODE
        phx
        phy
        jsr a_try
        ply
        plx
        bcc ao_found
        inx
        dey
        bne ao_c2
ao_fail:
        jmp a_err

; A_MODE で A_MNEM の命令があり、値が収まれば C=0、tmp = オペコード
a_try:
        ldy A_MODE
        lda m_kind,Y
        cmp #1                  ; 1バイトのオペランド
        beq at_byte
        cpy #OPM_ZPR
        bne at_find
at_byte:
        lda A_VAL+1
        bne at_no
at_find:
        ldx #0
at_1:
        lda op_mnem,X
        cmp A_MNEM
        bne at_2
        lda op_mode,X
        cmp A_MODE
        beq at_yes
at_2:
        inx
        bne at_1
at_no:
        sec
        rts
at_yes:
        stx tmp
        clc
        rts

; num を A_VAL に
a_setval:
        lda num
        sta A_VAL
        lda num+1
        sta A_VAL+1
        rts

        ; ---- 書き出す ----
ao_found:
        ; ビット番号: RMB/SMB/BBR/BBS(下位3ビットが7)には必要、それ以外には付けない
        lda tmp
        and #$07
        cmp #$07
        bne ao_f1
        lda A_BIT
        bmi ao_fail
        asl
        asl
        asl
        asl
        clc
        adc tmp
        sta tmp
        bra ao_f2
ao_f1:
        lda A_BIT
        bpl ao_fail
ao_f2:
        lda tmp
        sta BYTEBUF
        lda A_VAL
        sta BYTEBUF+1
        lda A_VAL+1
        sta BYTEBUF+2
        ldx A_MODE
        lda m_kind,X
        cmp #3
        beq ao_rel
        cmp #4
        beq ao_zpr
        bra ao_write
ao_rel:
        lda #2                  ; 分岐: 次の命令からの距離
        jsr a_offset
        sta BYTEBUF+1
        bra ao_write
ao_zpr:
        lda A_VAL2
        sta A_VAL
        lda A_VAL2+1
        sta A_VAL+1
        lda #3
        jsr a_offset
        sta BYTEBUF+2
ao_write:
        lda A_ADDR
        sta a1
        lda A_ADDR+1
        sta a1+1
        ldx A_MODE
        lda m_len,X
        sta cnt
        ldy #0
ao_w1:
        lda BYTEBUF,Y
        sta (a1),Y
        iny
        cpy cnt
        bne ao_w1
        clc
        lda A_ADDR
        adc cnt
        sta A_ADDR
        bcc ao_w2
        inc A_ADDR+1
ao_w2:
        rts

; A_VAL(分岐先)- (A_ADDR + A) を返す。-128〜127 に収まらなければエラー
a_offset:
        clc
        adc A_ADDR
        sta ptr
        lda A_ADDR+1
        adc #0
        sta ptr+1
        sec
        lda A_VAL
        sbc ptr
        sta tmp2
        lda A_VAL+1
        sbc ptr+1
        beq aof_pos             ; 上位が0なら 0〜127 のはず
        cmp #$FF
        bne aof_err
        lda tmp2                ; 上位が$FFなら -128〜-1 のはず
        bmi aof_ok
aof_err:
        jmp a_err
aof_pos:
        lda tmp2
        bmi aof_err
aof_ok:
        lda tmp2
        rts

; オペランドの形ごとに試すアドレッシング(3つずつ、$FF で終わり)
a_short_modes:
        .byte OPM_IMP, OPM_ACC, $FF     ; なし
        .byte OPM_ACC, OPM_ZP, OPM_ABS  ; A
        .byte OPM_IMM, $FF, $FF         ; #v
        .byte OPM_REL, OPM_ZP, OPM_ABS  ; v
        .byte OPM_ZPX, OPM_ABX, $FF     ; v,X
        .byte OPM_ZPY, OPM_ABY, $FF     ; v,Y
        .byte OPM_IZX, OPM_AIX, $FF     ; (v,X)
        .byte OPM_IZY, $FF, $FF         ; (v),Y
        .byte OPM_IZP, OPM_IND, $FF     ; (v)
        .byte OPM_ZPR, $FF, $FF         ; v,w
; 3桁以上で書いたとき
a_long_modes:
        .byte OPM_IMP, OPM_ACC, $FF
        .byte OPM_ACC, OPM_ZP, OPM_ABS
        .byte OPM_IMM, $FF, $FF
        .byte OPM_REL, OPM_ABS, OPM_ZP
        .byte OPM_ABX, OPM_ZPX, $FF
        .byte OPM_ABY, OPM_ZPY, $FF
        .byte OPM_AIX, OPM_IZX, $FF
        .byte OPM_IZY, $FF, $FF
        .byte OPM_IND, OPM_IZP, $FF
        .byte OPM_ZPR, $FF, $FF

; ===================================================================
; テープ(BIOS の TSAVE, TFIND, TLOAD と、モニターの W, L)
;
; テープの形式: ブロックを続けて記録する。1つのブロックは
;   "PX"  種類(1)  名前(8)  開始番地(2)  長さ(2)  データ  チェックサム(1)
; チェックサムは、そのブロックのそれより前のすべてのバイトの和の下位8ビット。
; 保存はいつもテープの最後に足す(APPEND)。
; ===================================================================

; T_TYPE, T_NAME, T_START, T_LEN のブロックをテープの最後に足す。
; 保存できれば C=0。テープがいっぱいなら C=1、A = TE_FULL(テープは保存前のまま)
tsave:
        lda #TAPE_APPEND
        sta TAPE_CTRL
        stz T_SUM
        lda #'P'
        jsr t_put
        lda #'X'
        jsr t_put
        lda T_TYPE
        jsr t_put
        ldx #0
ts_1:
        lda T_NAME,X
        jsr t_put
        inx
        cpx #8
        bne ts_1
        lda T_START
        jsr t_put
        lda T_START+1
        jsr t_put
        lda T_LEN
        jsr t_put
        lda T_LEN+1
        jsr t_put
        lda T_START
        sta ptr
        lda T_START+1
        sta ptr+1
        lda T_LEN
        sta T_PEND
        lda T_LEN+1
        sta T_PEND+1
ts_2:
        lda T_PEND
        ora T_PEND+1
        beq ts_3
        lda (ptr)
        jsr t_put
        inc ptr
        bne ts_2b
        inc ptr+1
ts_2b:
        jsr t_dec
        bra ts_2
ts_3:
        lda T_SUM
        sta TAPE_DATA
        lda TAPE_CTRL           ; いっぱいで書けなかったバイトがあるか
        and #TAPE_FULL
        bne ts_full
        stz TAPE_CTRL           ; 止めて確定する
        clc
        rts
ts_full:
        lda #TAPE_CANCEL        ; このブロックを捨てて、保存前の中身に戻す
        sta TAPE_CTRL
        lda #TE_FULL
        sec
        rts

; A をテープに書き、チェックサムに足す
t_put:
        sta TAPE_DATA
        clc
        adc T_SUM
        sta T_SUM
        rts

; テープから1バイト読み、チェックサムに足す。もうなければ C=1
t_get:
        lda TAPE_CTRL
        bpl tg_eot              ; bit7: 読めるデータがある
        lda TAPE_DATA
        pha
        clc
        adc T_SUM
        sta T_SUM
        pla
        clc
        rts
tg_eot:
        sec
        rts

; T_PEND を1減らす
t_dec:
        lda T_PEND
        bne td_1
        dec T_PEND+1
td_1:
        dec T_PEND
        rts

; 次のブロックの見出しを T_* に読む。A=0 なら先頭から、A=1 なら続きから。
; 見つかれば C=0。なければ C=1、A = TE_NOTAPE(テープが空)/ TE_NOTFOUND(もうない)/ TE_BAD
tfind:
        cmp #0
        bne tf_skip
        lda #TAPE_PLAY
        sta TAPE_CTRL
        stz T_PEND
        stz T_PEND+1
        lda TAPE_CTRL
        bmi tf_hdr
        lda #TE_NOTAPE
        bra tf_err
tf_skip:
        lda T_PEND              ; 前のブロックの残りを読み飛ばす
        ora T_PEND+1
        beq tf_next
        jsr t_get
        bcs tf_bad
        jsr t_dec
        bra tf_skip
tf_next:
        lda TAPE_CTRL
        bmi tf_hdr
        lda #TE_NOTFOUND
        bra tf_err
tf_hdr:
        stz T_SUM
        jsr t_get
        cmp #'P'
        bne tf_bad
        jsr t_get
        cmp #'X'
        bne tf_bad
        ldx #0                  ; 種類、名前、開始番地、長さ(12バイト)
tf_h1:
        jsr t_get
        bcs tf_bad
        sta T_TYPE,X
        inx
        cpx #13
        bne tf_h1
        clc                     ; 残り = データ + チェックサム
        lda T_LEN
        adc #1
        sta T_PEND
        lda T_LEN+1
        adc #0
        sta T_PEND+1
        clc
        rts
tf_bad:
        lda #TE_BAD
tf_err:
        stz TAPE_CTRL
        sec
        rts

; TFIND で見つけたブロックのデータを T_START から書き込む(T_START は変えてよい)。
; チェックサムを確かめてテープを止める。C=1 なら A = TE_BAD
tload:
        lda T_START
        sta ptr
        lda T_START+1
        sta ptr+1
        lda T_LEN
        sta T_PEND
        lda T_LEN+1
        sta T_PEND+1
tl_1:
        lda T_PEND
        ora T_PEND+1
        beq tl_2
        jsr t_get
        bcs tf_bad
        sta (ptr)
        inc ptr
        bne tl_1b
        inc ptr+1
tl_1b:
        jsr t_dec
        bra tl_1
tl_2:
        lda T_SUM               ; ここまでの和
        pha
        jsr t_get
        sta tmp
        pla
        bcs tf_bad
        cmp tmp
        bne tf_bad
        stz TAPE_CTRL
        clc
        rts

; "名前" を BYTEBUF に読む(8文字まで、足りない分は空白)。名前がなければ C=1(全部空白)
get_name:
        ldx #7
        lda #' '
gn_1:
        sta BYTEBUF,X
        dex
        bpl gn_1
        jsr more_args
        cmp #'"'
        bne gn_none
        inc lp
        ldx #0
gn_2:
        ldy lp
        cpy LINELEN
        bcs gn_done
        lda LINEBUF,Y           ; 大文字にしない
        inc lp
        cmp #'"'
        beq gn_done
        cpx #8
        bcs gn_2                ; 9文字目からは捨てる
        sta BYTEBUF,X
        inx
        bra gn_2
gn_done:
        clc
        rts
gn_none:
        sec
        rts

; W 開始 終了 ["名前"]  テープに保存する
cmd_w:
        jsr get_range
        jsr get_name
        jsr need_end
        ldx #7
w_1:
        lda BYTEBUF,X
        sta T_NAME,X
        dex
        bpl w_1
        lda #TT_MEM
        sta T_TYPE
        lda a1
        sta T_START
        sta a3
        lda a1+1
        sta T_START+1
        sta a3+1
        sec                     ; 長さ = 終了 - 開始 + 1
        lda a2
        sbc a1
        sta T_LEN
        lda a2+1
        sbc a1+1
        sta T_LEN+1
        inc T_LEN
        bne w_2
        inc T_LEN+1
w_2:
        lda #ANN_BUSY
        tsb LCD_ANN
        jsr tsave
        php
        lda #ANN_BUSY
        trb LCD_ANN
        plp
        bcc w_3
        jsr tape_msg            ; いっぱいで保存できない(テープは保存前のまま)
        .byte "TAPE FULL", 0
w_3:
        jsr prinline
        .byte "SAVE ", 0
        jmp pr_a3_a2

; L ["名前"] [番地]  テープから読み込む
;   名前がなければ最初のメモリのブロック。同じ名前のブロックがいくつかあれば最後(最新)のもの。
;   番地を書くとそこへ読み込む
cmd_l:
        stz cnt                 ; 1: 番地の指定あり
        stz tmp2                ; 1: 名前の指定あり
        jsr get_name
        bcs l_1
        inc tmp2
l_1:
        jsr more_args
        beq l_go
        ldx #a3
        jsr arg_x
        jsr need_end
        inc cnt
l_go:
        lda #ANN_BUSY
        tsb LCD_ANN
        stz a2                  ; 名前の合うブロックの数
        stz a2+1
        lda tmp2
        beq l_find              ; 名前を省いたら最初のメモリのブロック
        ; 1回目: 名前の合うブロックを数える(同じ名前がいくつかあれば、最後のものを読む)
        lda #0
        jsr tfind
        bcs l_err1
l_cnt:
        jsr l_match
        bne l_cn
        inc a2
        bne l_cn
        inc a2+1
l_cn:
        lda #1
        jsr tfind
        bcc l_cnt
        cmp #TE_BAD
        beq l_err1
        ; 2回目: a2 番目(最後)のものを探す
l_find:
        lda #0
        jsr tfind
        bcc l_chk
l_err1:
        jmp l_err
l_chk:
        jsr l_match
        bne l_next
        lda a2                  ; 名前を省いたとき(0)は最初のもの
        ora a2+1
        beq l_found
        lda a2
        bne l_dec
        dec a2+1
l_dec:
        dec a2
        lda a2
        ora a2+1
        bne l_next
l_found:
        lda cnt
        beq l_2
        lda a3
        sta T_START
        lda a3+1
        sta T_START+1
l_2:
        jsr tload
        bcs l_err
        ; a3 = 開始、a2 = 開始 + 長さ - 1
        lda T_START
        sta a3
        clc
        adc T_LEN
        sta a2
        lda T_START+1
        sta a3+1
        adc T_LEN+1
        sta a2+1
        lda a2
        bne l_3
        dec a2+1
l_3:
        dec a2
        lda #ANN_BUSY
        trb LCD_ANN
        ; 読み込んだプログラムをすぐ G で実行できるようにする
        lda a3
        sta R_PCL
        sta DNEXT
        sta UNEXT
        lda a3+1
        sta R_PCH
        sta DNEXT+1
        sta UNEXT+1
        lda #$FF
        sta R_S
        lda #1
        sta FRESH
        jsr prinline
        .byte "LOAD ", 0
        jmp pr_a3_a2
l_next:
        lda #1
        jsr tfind
        bcs l_err
        jmp l_chk

; T_* が L で読むブロックなら Z=1(メモリのブロックで、名前を省いたか名前が合う)
l_match:
        lda T_TYPE
        cmp #TT_MEM
        bne lm_done
        lda tmp2
        beq lm_done
        ldx #7
lm_1:
        lda T_NAME,X
        cmp BYTEBUF,X
        bne lm_done
        dex
        bpl lm_1
        lda #0
lm_done:
        rts

l_err:
        cmp #TE_NOTAPE
        bne l_e2
        jsr tape_msg
        .byte "NO TAPE", 0
l_e2:
        cmp #TE_NOTFOUND
        bne l_e3
        jsr tape_msg
        .byte "NOT FOUND", 0
l_e3:
        jsr tape_msg
        .byte "TAPE ERROR", 0

; テープを止め、JSR の後ろのメッセージを表示してエラーにする(戻らない)
tape_msg:
        stz TAPE_CTRL
        jsr crlf_if
        pla                     ; 戻り先 = 文字列の1バイト手前
        sta sptr
        pla
        sta sptr+1
tm_1:
        inc sptr
        bne tm_2
        inc sptr+1
tm_2:
        lda (sptr)
        beq tm_3
        jsr putc
        bra tm_1
tm_3:
        jmp err_beep            ; スタックは mon_restart で戻す

; "AAAA-BBBB"(a3 から a2)を表示する
pr_a3_a2:
        ldx #a3
        jsr prhex16
        lda #'-'
        jsr putc
        ldx #a2
        jmp prhex16

; Q  BASIC に戻る
cmd_q:
        jsr need_end
        jsr basic_present
        bcs q_1
        jmp error
q_1:
        sec                     ; Q: 変数を残して戻る
        jmp BASIC_WARM

; ===================================================================
; G [番地]  実行する
;   番地を書くと新しく始める(S=FF。RTS でモニターに戻る)
;   書かなければ、止まったところから続ける
; ===================================================================
cmd_g:
        jsr more_args
        beq g_go
        jsr need_hex
        jsr need_end
        lda num
        sta R_PCL
        lda num+1
        sta R_PCH
        lda #$FF
        sta R_S
        lda #1
        sta FRESH
g_go:
        jsr chk_bps             ; モニターの使う番地のもの(前の保存状態から)があれば実行しない
        bcc g_go1
        jmp error
g_go1:
        ; PC にブレークポイントがあれば、まず1命令進めてから置く
        lda R_PCL
        sta num
        lda R_PCH
        sta num+1
        jsr b_find
        bcc g_run
        lda #RM_STEPGO
        sta RUN_MODE
        stz STEP_OVER
        jmp do_step
g_run:
        stz RUN_MODE
        jsr install_bps
        jmp resume

; ===================================================================
; T [回数]  1命令ずつ実行する
; P [回数]  同じだが、JSR はサブルーチンごと実行する
; ===================================================================
cmd_t:
        lda #0
        bra tp_1
cmd_p:
        lda #1
tp_1:
        sta STEP_OVER
        lda #1
        sta STEP_CNT
        jsr more_args
        beq tp_2
        jsr need_hex
        jsr need_end
        lda num+1
        bne tp_err
        lda num
        beq tp_err
        sta STEP_CNT
tp_2:
        lda #RM_STEP
        sta RUN_MODE
        jmp do_step
tp_err:
        jmp error

; 次に実行される命令の位置に一時 BRK を置いて実行する
do_step:
        jsr calc_next
        jsr chk_temps           ; 全部を調べてから書く
        bcs ds_err
        jsr install_temps
        jmp resume
; 次の命令がモニターの使う番地なら、レジスタを表示して ? (何も書いていない)
; 一時 BRK の候補は取り消す(残すと、次に止まったときやリセットで、書いていない番地へ TB_SAVE を書き戻してしまう。B24-01)
ds_err:
        stz TB_N
        stz RUN_MODE
        jsr cursor_off
        jsr crlf_if
        jsr show_regs
        jmp error

; ptr がモニターの使う番地($00E0-$057F)なら C=1。A を壊す
is_prot:
        lda ptr+1
        beq ip_zp
        cmp #$05
        bcc ip_yes              ; $0100-$04FF
        bne ip_no               ; $0600 から
        lda ptr
        cmp #$80
        bcs ip_no               ; $0580 から
ip_yes:
        sec
        rts
ip_no:
        clc
        rts
ip_zp:
        lda ptr
        cmp #$E0                ; $00E0 から C=1
        rts

; ブレークポイントに、モニターの使う番地のものがあれば C=1
chk_bps:
        ldx #3
cbp_1:
        lda BP_HI,X
        bmi cbp_2
        sta ptr+1
        lda BP_LO,X
        sta ptr
        jsr is_prot
        bcs cbp_3
cbp_2:
        dex
        bpl cbp_1
        clc
cbp_3:
        rts

; 一時 BRK の場所に、モニターの使う番地があれば C=1
chk_temps:
        ldx TB_N
ctp_1:
        dex
        bmi ctp_2
        lda TB_LO,X
        sta ptr
        lda TB_HI,X
        sta ptr+1
        jsr is_prot
        bcc ctp_1
        rts
ctp_2:
        clc
        rts

; PC の命令の次に来るアドレス(分岐なら2つ)を TB_LO/TB_HI に入れる。
; RAM でないアドレスには置けないので数えない
calc_next:
        stz TB_N
        lda R_PCL
        sta daddr
        lda R_PCH
        sta daddr+1
        lda (daddr)
        sta tmp                 ; オペコード
        tax
        lda op_mode,X
        sta tmp2                ; アドレッシング
        lda tmp
        cmp #$20                ; JSR
        beq cn_jsr
        cmp #$4C                ; JMP abs
        beq cn_jmp
        cmp #$6C                ; JMP (abs)
        beq cn_jmpi
        cmp #$7C                ; JMP (abs,X)
        beq cn_jmpx
        cmp #$60                ; RTS
        beq cn_rts
        cmp #$40                ; RTI
        beq cn_rti
        cmp #$00                ; BRK はそのまま実行して止まる
        beq cn_done
        cmp #$DB                ; STP
        beq cn_done
        ; 次の命令
        ldx tmp2
        lda m_len,X
        jsr cn_add_len
        ; 分岐なら分岐先も
        lda tmp2
        cmp #OPM_REL
        beq cn_rel
        cmp #OPM_ZPR
        bne cn_done
        ldy #2                  ; BBR/BBS: オペランドの2バイト目、命令長3
        lda (daddr),Y
        ldy #3
        bra cn_branch
cn_rel:
        ldy #1
        lda (daddr),Y
        ldy #2
cn_branch:
        jsr calc_rel            ; ptr = 分岐先
        jmp cn_add
cn_done:
        rts

cn_jsr:
        lda STEP_OVER
        bne cn_jsr_over
        jsr cn_word             ; ptr = 呼び出し先
        jsr cn_add
        lda TB_N
        bne cn_done             ; ROM のサブルーチンは中に入らない
cn_jsr_over:
        lda #3
        bra cn_add_len

cn_jmp:
        jsr cn_word
        bra cn_add

cn_jmpi:
        jsr cn_word
        bra cn_ind

cn_jmpx:
        jsr cn_word
        clc
        lda ptr
        adc R_X
        sta ptr
        bcc cn_ind
        inc ptr+1
cn_ind:
        ; ptr の指す2バイトを ptr に
        lda (ptr)
        tax
        ldy #1
        lda (ptr),Y
        sta ptr+1
        stx ptr
        bra cn_add

cn_rts:
        ldx R_S
        lda $0101,X
        sta ptr
        lda $0102,X
        sta ptr+1
        inc ptr
        bne cn_add
        inc ptr+1
        bra cn_add

cn_rti:
        ldx R_S
        lda $0102,X
        sta ptr
        lda $0103,X
        sta ptr+1
        bra cn_add

; ptr = 命令のオペランドの2バイト
cn_word:
        ldy #1
        lda (daddr),Y
        sta ptr
        iny
        lda (daddr),Y
        sta ptr+1
        rts

; ptr = daddr + A にして追加
cn_add_len:
        clc
        adc daddr
        sta ptr
        lda daddr+1
        adc #0
        sta ptr+1
; ptr を一時 BRK の場所に追加する(RAM でなければ何もしない)
cn_add:
        lda ptr+1
        bmi cna_done
        ldx TB_N
        lda ptr
        sta TB_LO,X
        lda ptr+1
        sta TB_HI,X
        inc TB_N
cna_done:
        rts

; ptr = daddr + Y + (A を符号付きで)
calc_rel:
        pha
        tya
        clc
        adc daddr
        sta ptr
        lda daddr+1
        adc #0
        sta ptr+1
        pla
        bpl crl_1
        dec ptr+1
crl_1:
        clc
        adc ptr
        sta ptr
        bcc crl_2
        inc ptr+1
crl_2:
        rts

; ---- BRK の書き込みと復元 ----

install_bps:
        ldx #3
ib_1:
        lda BP_HI,X
        bmi ib_2
        sta ptr+1
        lda BP_LO,X
        sta ptr
        lda (ptr)
        sta BP_SAVE,X
        lda #$00
        sta (ptr)
ib_2:
        dex
        bpl ib_1
        lda #1
        sta BP_INST
        rts

install_temps:
        ldx #0
it_1:
        cpx TB_N
        beq it_done
        lda TB_LO,X
        sta ptr
        lda TB_HI,X
        sta ptr+1
        lda (ptr)
        sta TB_SAVE,X
        lda #$00
        sta (ptr)
        inx
        bra it_1
it_done:
        rts

; 書き込んだ BRK をすべて元に戻す(一時 BRK は逆順に)
remove_brks:
        ldx TB_N
rb_1:
        dex
        bmi rb_2
        lda TB_LO,X
        sta ptr
        lda TB_HI,X
        sta ptr+1
        lda TB_SAVE,X
        sta (ptr)
        bra rb_1
rb_2:
        stz TB_N
        lda BP_INST
        beq rb_done
        ldx #3
rb_3:
        lda BP_HI,X
        bmi rb_4
        sta ptr+1
        lda BP_LO,X
        sta ptr
        lda BP_SAVE,X
        sta (ptr)
rb_4:
        dex
        bpl rb_3
        stz BP_INST
rb_done:
        rts

; ptr がいま書き込んでいる BRK の場所なら C=1
is_our_brk:
        ldx TB_N
iob_1:
        dex
        bmi iob_2
        lda TB_LO,X
        cmp ptr
        bne iob_1
        lda TB_HI,X
        cmp ptr+1
        bne iob_1
        sec
        rts
iob_2:
        lda BP_INST
        beq iob_no
        ldx #3
iob_3:
        lda BP_HI,X
        cmp ptr+1
        bne iob_4
        lda BP_LO,X
        cmp ptr
        beq iob_yes
iob_4:
        dex
        bpl iob_3
iob_no:
        clc
        rts
iob_yes:
        sec
        rts

; ---- ユーザーのプログラムへ ----

; R_* のレジスタで実行を始める
resume:
        sei
        stz MON_ACTIVE
        lda #ANN_BUSY
        tsb LCD_ANN
        ldx R_S
        txs
        lda FRESH
        beq rs_1
        stz FRESH
        lda #>(mon_ret-1)       ; RTS でモニターに戻る
        pha
        lda #<(mon_ret-1)
        pha
rs_1:
        lda R_PCH
        pha
        lda R_PCL
        pha
        lda R_P
        pha
        lda R_A
        ldx R_X
        ldy R_Y
        rti

; ---- モニターに戻る入口 ----

; BRK(BRKVEC から)
mon_brk:
        sta R_A
        stx R_X
        sty R_Y
        pla
        sta R_P
        pla
        sta R_PCL
        pla
        sta R_PCH
        tsx
        stx R_S
        cld
        ; BRK の番地 = 積まれた PC - 2
        sec
        lda R_PCL
        sbc #2
        sta ptr
        lda R_PCH
        sbc #0
        sta ptr+1
        jsr is_our_brk
        lda #WHY_BRK
        bcc mon_stop
        lda ptr                 ; モニターの BRK なら、その命令から続けられるように
        sta R_PCL
        lda ptr+1
        sta R_PCH
        lda #WHY_BP
        bra mon_stop

; BREAK キー(NMIVEC から)
mon_nmi:
        cld
        pha
        lda MON_ACTIVE
        beq mn_user
        pla                     ; モニターの中なら、いまの処理をやめてプロンプトへ
        jmp mon_restart
mn_user:
        pla
        sta R_A
        stx R_X
        sty R_Y
        pla
        sta R_P
        pla
        sta R_PCL
        pla
        sta R_PCH
        tsx
        stx R_S
        lda #WHY_BREAK
        bra mon_stop

; RTS(G で始めたプログラムが戻ってきた)、または BIOS の MONITOR から
mon_ret:
        php
        sei
        cld
        sta R_A
        stx R_X
        sty R_Y
        pla
        sta R_P
        tsx
        stx R_S
        lda #1
        sta FRESH
        lda #WHY_RTS

; 止まったときの共通処理。A = 理由
mon_stop:
        sta STOP_WHY
        tsx
        stx MON_SP
        jsr remove_brks
        lda #ANN_BUSY+ANN_RUN   ; BASIC の実行中の表示も消す(CALL した機械語から BIOS で入ったとき)
        trb LCD_ANN
        lda #1
        sta MON_ACTIVE
        lda #$81
        sta TIMER_CTRL
        lda LCD_CTRL
        ora #$01
        sta LCD_CTRL
        stz UNGOT
        cli
        ; ステップ実行の続き
        lda STOP_WHY
        bne ms_show             ; WHY_BP 以外
        lda RUN_MODE
        cmp #RM_STEPGO
        beq ms_go
        cmp #RM_STEP
        bne ms_show
        dec STEP_CNT
        beq ms_show
        jmp do_step
ms_go:
        stz RUN_MODE
        jsr install_bps
        jmp resume
ms_show:
        stz RUN_MODE
        jsr cursor_off
        jsr crlf_if
        lda STOP_WHY
        cmp #WHY_RTS
        beq ms_rts
        jsr show_regs
        jmp mon_restart
ms_rts:
        jsr show_regs2
        jmp mon_restart

; ===================================================================
; データ
; ===================================================================
row_lo:     .byte <VRAM, <(VRAM+96), <(VRAM+192), <(VRAM+288)
row_hi:     .byte >VRAM, >(VRAM+96), >(VRAM+192), >(VRAM+288)
bitmask:    .byte $01, $02, $04, $08, $10, $20, $40, $80
row_select: .byte $FE, $FD, $FB, $F7, $EF, $DF, $BF, $7F

; キーの位置(行×8+列)-> 文字。0 は文字のないキー
keymap:
        .byte "ABCDEFGH"
        .byte "IJKLMNOP"
        .byte "QRSTUVWX"
        .byte "YZ ", K_RET, 0, K_DEL, ",."
        .byte "01234567"
        .byte "89+-*/=", 0
        .byte K_LEFT, K_RIGHT, K_UP, K_DOWN, 0, 0, 0, 0
        .byte 0, 0, 0, 0, 0, 0, 0, 0
; SHIFT を押しているとき
keymap_s:
        .byte "abcdefgh"
        .byte "ijklmnop"
        .byte "qrstuvwx"
        .byte "yz ", K_RET, 0, K_DEL, "<>"
        .byte "@!", '"', "#$%&'"
        .byte "();_:?^", 0
        .byte K_LEFT, K_RIGHT, K_UP, K_DOWN, 0, 0, 0, 0
        .byte 0, 0, 0, 0, 0, 0, 0, 0

        .include "font.s"
        .include "optable.s"

rom_end:

; ===================================================================
; BIOS のジャンプテーブル(番地は今後も変えない)
; ===================================================================
        .org $FF00
        jmp putc                ; $FF00 CHROUT  A の文字を出力
        jmp getkey              ; $FF03 GETKEY  キーを待つ -> A
        jmp keyget              ; $FF06 KEYCHK  キーがあれば C=1, A
        jmp getline             ; $FF09 GETLINE 1行入力 -> LINEBUF, LINELEN
        jmp prhex8              ; $FF0C PRHEX   A を16進数2桁で出力
        jmp prinline            ; $FF0F PRINT   JSR の後ろの文字列(0終わり)を出力
        jmp sound               ; $FF12 BEEP    A=高さ X=長さ
        jmp cls                 ; $FF15 CLS     画面を消す
        jmp locate              ; $FF18 LOCATE  X=桁 Y=行
        jmp mon_ret             ; $FF1B MONITOR モニターに戻る
        jmp getline_edit        ; $FF1E GETLINE_ED LINEBUF を表示してから入力を続ける
        jmp mon_enter           ; $FF21 MONENTER モニターのプロンプトに入る
        jmp tsave               ; $FF24 TSAVE   テープにブロックを足す
        jmp tfind               ; $FF27 TFIND   次のブロックの見出しを読む
        jmp tload               ; $FF2A TLOAD   見つけたブロックのデータを読む
        jmp cursor_off          ; $FF2D CUROFF  点滅中のカーソルを消す

; ===================================================================
; 割り込みベクタ
; ===================================================================
        .org $FFFA
        .word nmi_entry, reset, irq_entry
