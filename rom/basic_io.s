; PX-65 BASIC: グラフィック、音、テープ

; ===================================================================
; グラフィック
; ===================================================================
;
; 座標は -1024 から 1023 まで書ける(画面の外の点は描かない)。
; モード: 1 点ける、0 消す、2 反転

; (gx0, gy0) の点を grmode で描く
plot:
        lda gx0+1
        bne plt_out
        lda gx0
        cmp #96
        bcs plt_out
        lda gy0+1
        bne plt_out
        lda gy0
        cmp #32
        bcs plt_out
        jsr pix_addr
        lda grmode
        beq plt_clr
        cmp #2
        beq plt_xor
        lda (index1)
        ora bt0
        sta (index1)
plt_out:
        rts
plt_clr:
        lda bt0
        eor #$FF
        and (index1)
        sta (index1)
        rts
plt_xor:
        lda (index1)
        eor bt0
        sta (index1)
        rts

; (gx0, gy0)(画面の中)の VRAM の番地を index1 に、ビットを bt0 に
pix_addr:
        lda gy0
        lsr
        lsr
        lsr
        tax
        clc
        lda pg_lo,X
        adc gx0
        sta index1
        lda pg_hi,X
        adc #0
        sta index1+1
        lda gy0
        and #7
        tax
        lda pix_bit,X
        sta bt0
        rts
pg_lo:  .byte <VRAM, <(VRAM+96), <(VRAM+192), <(VRAM+288)
pg_hi:  .byte >VRAM, >(VRAM+96), >(VRAM+192), >(VRAM+288)
pix_bit:
        .byte $01, $02, $04, $08, $10, $20, $40, $80

; 座標を1つ読んで、gx0 から X バイト目に置く(-1024 から 1023)
get_coord:
        phx
        jsr frmnum
        jsr getint16
        plx
        clc                     ; linnum + 1024 が 2048 未満か
        lda linnum+1
        adc #4
        cmp #8
        bcs gc_fc
        lda linnum
        sta gx0,X
        lda linnum+1
        sta gx0+1,X
        rts
gc_fc:
        jmp err_fc

; [, モード] を読む(なければ A のまま)
get_mode:
        sta grmode
        jsr chrgot
        cmp #','
        bne gm_1
        jsr chrget
        jsr frmnum
        jsr getbyte
        cmp #3
        bcs gc_fc
        sta grmode
gm_1:
        rts

; x, y を gx0, gy0 に
get_xy:
        ldx #0
        jsr get_coord
        jsr chkcom
        ldx #gy0-gx0
        jmp get_coord

st_pset:
        jsr get_xy
        lda #1
        jsr get_mode
        jmp plot

st_preset:
        jsr get_xy
        lda #0
        jsr get_mode
        jmp plot

; POINT(x, y): 点いていれば 1。
; PSET 10,POINT(20,0) のように座標の式の中で使われるので、外側の gx0, gy0 を戻す
fn_point:
        ldx #3
fpn_1:
        lda gx0,X               ; gx0, gy0 は続いている
        pha
        dex
        bpl fpn_1
        jsr fpn_body
        ldx #0
fpn_2:
        pla
        sta gx0,X
        inx
        cpx #4
        bne fpn_2
        rts
fpn_body:
        jsr chkopen
        jsr get_xy
        jsr chkclose
        stz valtyp
        lda gx0+1
        bne fp_off
        lda gx0
        cmp #96
        bcs fp_off
        lda gy0+1
        bne fp_off
        lda gy0
        cmp #32
        bcs fp_off
        jsr pix_addr
        lda (index1)
        and bt0
        beq fp_off
        lda #1
        jmp fac_u8
fp_off:
        jmp fac_zero

; LINE x1, y1, x2, y2 [, モード]
st_line:
        jsr get_xy
        jsr chkcom
        ldx #gx1-gx0
        jsr get_coord
        jsr chkcom
        ldx #gy1-gx0
        jsr get_coord
        lda #1
        jsr get_mode
        ; dx = |x1 - x0|、sx = 符号
        ldx #0
        jsr ln_delta            ; gdx, gsx
        ldx #gy0-gx0
        jsr ln_delta            ; gdy, gsy(gdx の2バイト後ろ)
        sec                     ; dy = -|y1 - y0|
        lda #0
        sbc gdy
        sta gdy
        lda #0
        sbc gdy+1
        sta gdy+1
        clc                     ; err = dx + dy
        lda gdx
        adc gdy
        sta gerr
        lda gdx+1
        adc gdy+1
        sta gerr+1
ln_loop:
        jsr plot
        lda brkflag
        bne ln_done
        lda gx0                 ; 終わりの点か
        cmp gx1
        bne ln_1
        lda gx0+1
        cmp gx1+1
        bne ln_1
        lda gy0
        cmp gy1
        bne ln_1
        lda gy0+1
        cmp gy1+1
        beq ln_done
ln_1:
        lda gerr                ; e2 = 2 × err
        asl
        sta bt2
        lda gerr+1
        rol
        sta bt3
        ; e2 >= dy なら err += dy、x += sx
        sec
        lda bt2
        sbc gdy
        lda bt3
        sbc gdy+1
        bmi ln_2
        clc
        lda gerr
        adc gdy
        sta gerr
        lda gerr+1
        adc gdy+1
        sta gerr+1
        ldx #0
        lda gsx
        jsr ln_step
ln_2:
        ; e2 <= dx なら err += dx、y += sy
        sec
        lda gdx
        sbc bt2
        lda gdx+1
        sbc bt3
        bmi ln_loop
        clc
        lda gerr
        adc gdx
        sta gerr
        lda gerr+1
        adc gdx+1
        sta gerr+1
        ldx #gy0-gx0
        lda gsy
        jsr ln_step
        jmp ln_loop
ln_done:
        rts

; 座標(gx0 から X バイト目)に A(1 か $FF)を足す
ln_step:
        cmp #1
        beq lsp_inc
        lda gx0,X
        bne lsp_1
        dec gx0+1,X
lsp_1:
        dec gx0,X
        rts
lsp_inc:
        inc gx0,X
        bne lsp_2
        inc gx0+1,X
lsp_2:
        rts

; X=0 なら x、X=gy0-gx0 なら y について、差の絶対値を gdx+X に、符号を gsx+X/2 に
ln_delta:
        sec
        lda gx1,X
        sbc gx0,X
        sta gdx,X
        lda gx1+1,X
        sbc gx0+1,X
        sta gdx+1,X
        bmi ld_neg
        lda #1
        bra ld_1
ld_neg:
        sec
        lda #0
        sbc gdx,X
        sta gdx,X
        lda #0
        sbc gdx+1,X
        sta gdx+1,X
        lda #$FF
ld_1:
        cpx #0
        bne ld_2
        sta gsx
        rts
ld_2:
        sta gsy
        rts

; CIRCLE x, y, r [, モード]
st_circle:
        jsr get_xy
        jsr chkcom
        ldx #gx1-gx0
        jsr get_coord           ; r
        lda gx1+1
        bpl cir_1
        jmp err_fc
cir_1:
        lda #1
        jsr get_mode
        lda gx0                 ; 中心を gdx, gdy に
        sta gdx
        lda gx0+1
        sta gdx+1
        lda gy0
        sta gdy
        lda gy0+1
        sta gdy+1
        stz gy1                 ; x = r(gx1)、y = 0(gy1)
        stz gy1+1
        sec                     ; err = 1 - r
        lda #1
        sbc gx1
        sta gerr
        lda #0
        sbc gx1+1
        sta gerr+1
ci_loop:
        lda brkflag
        bne ci_done
        sec                     ; x >= y の間
        lda gx1
        sbc gy1
        lda gx1+1
        sbc gy1+1
        bmi ci_done
        ldx #7                  ; 8つの点
ci_8:
        phx
        txa
        jsr cplot
        plx
        dex
        bpl ci_8
        inc gy1                 ; y = y + 1
        bne ci_2
        inc gy1+1
ci_2:
        lda gerr+1
        bpl ci_pos
        ; err += 2y + 1
        lda gy1
        asl
        sta bt0
        lda gy1+1
        rol
        sta bt1
        sec
        lda gerr
        adc bt0
        sta gerr
        lda gerr+1
        adc bt1
        sta gerr+1
        bra ci_loop
ci_pos:
        lda gx1                 ; x = x - 1
        bne ci_3
        dec gx1+1
ci_3:
        dec gx1
        sec                     ; err += 2(y - x) + 1
        lda gy1
        sbc gx1
        sta bt0
        lda gy1+1
        sbc gx1+1
        sta bt1
        asl bt0
        rol bt1
        sec
        lda gerr
        adc bt0
        sta gerr
        lda gerr+1
        adc bt1
        sta gerr+1
        bra ci_loop
ci_done:
        rts

; 円の1点を描く。A の bit0: x と y を入れ替える、bit1: 横を負に、bit2: 縦を負に。
; 8つの点のうち同じ座標になるもの(x = y のときの入れ替え、横か縦が0のときの負)は描かない。
; 反転(モード2)で同じ点を2回反転すると消えてしまうため
cplot:
        sta bt4
        lsr
        bcs cp_sw0
        lda gx1                 ; 横 = x、縦 = y
        sta bt0
        lda gx1+1
        sta bt1
        lda gy1
        sta bt2
        lda gy1+1
        sta bt3
        bra cp_1
cp_sw0:
        lda gx1                 ; x = y なら入れ替えた点は同じ
        cmp gy1
        bne cp_sw
        lda gx1+1
        cmp gy1+1
        beq cp_skip
cp_sw:
        lda gy1
        sta bt0
        lda gy1+1
        sta bt1
        lda gx1
        sta bt2
        lda gx1+1
        sta bt3
cp_1:
        lda bt4                 ; 横が0なら、横を負にした点は同じ
        and #2
        beq cp_1a
        lda bt0
        ora bt1
        beq cp_skip
cp_1a:
        lda bt4                 ; 縦が0なら、縦を負にした点は同じ
        and #4
        beq cp_1b
        lda bt2
        ora bt3
        bne cp_1b
cp_skip:
        rts
cp_1b:
        lda bt4
        and #2
        bne cp_xn
        clc
        lda gdx
        adc bt0
        sta gx0
        lda gdx+1
        adc bt1
        sta gx0+1
        bra cp_2
cp_xn:
        sec
        lda gdx
        sbc bt0
        sta gx0
        lda gdx+1
        sbc bt1
        sta gx0+1
cp_2:
        lda bt4
        and #4
        bne cp_yn
        clc
        lda gdy
        adc bt2
        sta gy0
        lda gdy+1
        adc bt3
        sta gy0+1
        jmp plot
cp_yn:
        sec
        lda gdy
        sbc bt2
        sta gy0
        lda gdy+1
        sbc bt3
        sta gy0+1
        jmp plot

; ===================================================================
; 音
; ===================================================================

; BEEP [周波数(Hz) [, 長さ(1/100秒)]]。省くと 1000Hz、0.1秒
st_beep:
        lda #<1000
        ldy #>1000
        jsr fac_u16
        jsr chrgot
        beq bp_1
        jsr frmnum
bp_1:
        lda #<fpt6              ; f
        ldy #>fpt6
        jsr fac_st
        jsr getint16            ; 20 から 20000 まで
        lda linnum+1
        bpl *+5
        jmp bp_fc
        cmp #>20001
        bcc bp_2
        beq *+5
        jmp bp_fc
        lda linnum
        cmp #<20001
        bcc *+5
        jmp bp_fc
bp_2:
        lda linnum+1
        bne bp_3
        lda linnum
        cmp #20
        bcs *+5
        jmp bp_fc
bp_3:
        lda #10                 ; d
        ldy #0
        jsr fac_u16
        jsr chrgot
        cmp #','
        bne bp_4
        jsr chrget
        jsr frmnum
        lda fac_s
        bpl *+5
        jmp bp_fc
bp_4:
        ; 半周期の数 = f × d / 50
        lda #<fpt6
        ldy #>fpt6
        jsr arg_ld
        jsr fmul
        lda #<c_50
        ldy #>c_50
        jsr arg_ld
        jsr swap_fa
        jsr fdiv
        jsr getint16
        lda linnum
        sta bp_cnt
        lda linnum+1
        sta bp_cnt+1
        ; 半周期の待ちの回数 = 34786 / f - 6.29(beep_wait の1回が14サイクル)
        lda #<c_beepk
        ldy #>c_beepk
        jsr arg_ld
        lda #<fpt6
        ldy #>fpt6
        jsr fac_ld
        jsr fdiv
        lda #<c_beepofs
        ldy #>c_beepofs
        jsr addc
        lda fac_s
        bpl bp_5
        jsr fac_zero
bp_5:
        jsr getint16
        lda linnum
        ora linnum+1
        bne bp_6
        inc linnum
bp_6:
        lda linnum
        sta bp_half
        lda linnum+1
        sta bp_half+1
        stz bp_lvl
bp_loop:
        lda bp_cnt
        ora bp_cnt+1
        beq bp_end
        lda brkflag
        bne bp_end
        lda bp_lvl
        eor #1
        sta bp_lvl
        sta BEEP
        lda bp_half             ; 待つ
        sta bt0
        lda bp_half+1
        sta bt1
        jsr beep_wait
        lda bp_cnt
        bne bp_w4
        dec bp_cnt+1
bp_w4:
        dec bp_cnt
        bra bp_loop
bp_end:
        stz BEEP
        rts
bp_fc:
        jmp err_fc

; ===================================================================
; テープ
; ===================================================================

; [文字列] を tname(8文字、足りない分は空白)に。名前があれば bt5 = 1
get_tname:
        ldx #7
        lda #' '
gtn_1:
        sta tname,X
        dex
        bpl gtn_1
        stz bt5
        jsr chrgot
        beq gtn_done
        jsr frmstr
        jsr fac_str
        pha
        jsr free_fac
        pla
        cmp #9
        bcc gtn_2
        lda #8
gtn_2:
        tay
        beq gtn_3
gtn_c:
        dey
        lda (strp),Y
        sta tname,Y
        cpy #0
        bne gtn_c
gtn_3:
        inc bt5
gtn_done:
        rts

; SAVE ["名前"]
st_save:
        jsr get_tname
        ldx #7
ssv_1:
        lda tname,X
        sta T_NAME,X
        dex
        bpl ssv_1
        lda #TT_BASIC
        sta T_TYPE
        lda #<PRGSTART
        sta T_START
        lda #>PRGSTART
        sta T_START+1
        sec
        lda vartab
        sbc #<PRGSTART
        sta T_LEN
        lda vartab+1
        sbc #>PRGSTART
        sta T_LEN+1
        lda #ANN_BUSY
        tsb LCD_ANN
        jsr BIOS_TSAVE
        php
        lda #ANN_BUSY
        trb LCD_ANN
        plp
        bcc ssv_2
        ldx #EN_TF              ; テープがいっぱい(テープは保存前のまま)
        jmp b_error
ssv_2:
        rts

; LOAD ["名前"]
;   名前を省くと最初のプログラム。同じ名前のプログラムがいくつかあれば、最後(最新)のものを読む
st_load:
        jsr get_tname
        lda #ANN_BUSY
        tsb LCD_ANN
        stz bt6                 ; bt6/bt7 = 名前の合うプログラムの数
        stz bt7
        lda bt5
        beq sld_find            ; 名前を省いたら最初のプログラム
        ; 1回目: 名前の合うプログラムを数える
        lda #0
        jsr BIOS_TFIND
        bcs sld_err
sld_cnt:
        jsr sld_match
        bne sld_cn
        inc bt6
        bne sld_cn
        inc bt7
sld_cn:
        lda #1
        jsr BIOS_TFIND
        bcc sld_cnt
        cmp #TE_BAD
        beq sld_tp
        ; 2回目: bt6/bt7 番目(最後)のものを探す
sld_find:
        lda #0
        jsr BIOS_TFIND
        bcs sld_err
sld_chk:
        jsr sld_match
        bne sld_next
        lda bt6                 ; 名前を省いたとき(0)は最初のもの
        ora bt7
        beq sld_found
        lda bt6
        bne sld_dec
        dec bt7
sld_dec:
        dec bt6
        lda bt6
        ora bt7
        bne sld_next
sld_found:
        clc                     ; 入るか: PRGSTART + 長さ + 256 <= MEMSIZ
        lda T_LEN+1
        adc #>PRGSTART+1
        bcs sld_om
        cmp #>MEMSIZ
        bcs sld_om
        lda #<PRGSTART
        sta T_START
        lda #>PRGSTART
        sta T_START+1
        jsr BIOS_TLOAD
        bcs sld_bad
        clc
        lda #<PRGSTART
        adc T_LEN
        sta vartab
        lda #>PRGSTART
        adc T_LEN+1
        sta vartab+1
        jsr fix_program
        jsr relink
        jsr clearc
        lda #ANN_BUSY
        trb LCD_ANN
        jmp ready
sld_next:
        lda #1
        jsr BIOS_TFIND
        bcc sld_chk
sld_err:
        cmp #TE_BAD
        beq sld_tp
        ldx #EN_NT
        jmp b_error
sld_bad:
        jsr b_new_mem           ; 途中まで読んだプログラムは使えない
sld_tp:
        ldx #EN_TP
        jmp b_error
sld_om:
        stz TAPE_CTRL
        jmp err_om

; FILES: テープの中身の一覧
st_files:
        stz listrow
        lda #2
        sta bstate
        lda #0
        jsr BIOS_TFIND
        bcc sfl_1
        cmp #TE_BAD
        beq sld_tp
        ldx #EN_NT
        jmp b_error
sfl_1:
        lda listrow
        cmp #3
        bcc sfl_2
        jsr BIOS_GETKEY
        cmp #K_RET
        beq sfl_k
        cmp #K_DOWN
        beq sfl_k
        cmp #' '
        bne sfl_end
sfl_k:
        stz listrow
sfl_2:
        jsr crlf_if
        lda T_TYPE              ; B: BASIC、M: メモリ
        ldx #'B'
        cmp #TT_BASIC
        beq sfl_3
        ldx #'M'
        cmp #TT_MEM
        beq sfl_3
        ldx #'?'
sfl_3:
        txa
        jsr BIOS_CHROUT
        jsr out_space
        ldx #0
sfl_4:
        lda T_NAME,X
        jsr BIOS_CHROUT
        inx
        cpx #8
        bne sfl_4
        jsr out_space
        lda T_LEN
        ldy T_LEN+1
        jsr linprt
        inc listrow
        lda #1
        jsr BIOS_TFIND
        bcc sfl_1
        cmp #TE_BAD
        beq sld_tp
sfl_end:
        stz TAPE_CTRL
        lda #1
        sta bstate
        rts

; T_* が LOAD で読むプログラムなら Z=1(BASIC のブロックで、名前を省いたか名前が合う)
sld_match:
        lda T_TYPE
        cmp #TT_BASIC
        bne slm_done
        lda bt5
        beq slm_done
        ldx #7
slm_1:
        lda T_NAME,X
        cmp tname,X
        bne slm_done
        dex
        bpl slm_1
        lda #0
slm_done:
        rts
